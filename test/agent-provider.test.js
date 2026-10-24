// Run: node --test test/agent-provider.test.js
// Loads the plugin bundle outside Obsidian. Sources are JSON, which is valid YAML, so the
// 'obsidian' stub can parse them without a YAML library. Plotly itself is not loaded here,
// so Plotly.validate (the attribute-level check) is not covered by this test.
'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'obsidian') {
        return {
            Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {},
            parseYaml: (text) => JSON.parse(text)
        };
    }
    return load.call(this, request, ...rest);
};
const bundle = new Module(path.join(__dirname, 'plugin-under-test.js'), module);
bundle.filename = bundle.id;
bundle.paths = Module._nodeModulePaths(__dirname);
bundle._compile(require('./helpers/build-plugin')(), bundle.filename);
const { default: Plugin, createAgentProvider } = bundle.exports;
Module._load = load;

const MANIFEST = { id: 'chart-hands', name: 'Chart Hands', version: '0.9.0' };
const provide = (markdown) => createAgentProvider({
    app: {
        vault: {
            getAbstractFileByPath: (file) => file === 'notes/chart.md' ? { path: file, extension: 'md' }
                : file === 'doc.pdf' ? { path: file, extension: 'pdf' } : null,
            cachedRead: async () => markdown
        }
    },
    manifest: MANIFEST
});
const text = (result) => result.content.map(part => part.text).join('\n');
const errorCode = (result) => result._meta && result._meta['dev.agentinterop/error'] && result._meta['dev.agentinterop/error'].code;

// What an agentinterop host accepts: JSON only, no undefined, no class instances.
const assertPlainJson = (value, where = '$') => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') return assert.ok(Number.isFinite(value), `${where}: non-finite number`);
    assert.equal(typeof value, 'object', `${where}: ${typeof value} is not JSON`);
    if (Array.isArray(value)) return value.forEach((item, index) => assertPlainJson(item, `${where}[${index}]`));
    assert.equal(Object.getPrototypeOf(value), Object.prototype, `${where}: not a plain object`);
    for (const [key, item] of Object.entries(value)) assertPlainJson(item, `${where}.${key}`);
};

test('the plugin class is still the module export', () => {
    assert.equal(typeof Plugin, 'function');
    assert.equal(typeof Plugin.prototype.onload, 'function');
});

test('descriptor follows the agentinterop v1 subset', async () => {
    const provider = provide('');
    assert.equal(provider.protocol, 'agentinterop');
    assert.equal(provider.protocolVersion, 1);
    const descriptor = await provider.describe();
    assertPlainJson(descriptor);
    assert.deepEqual(descriptor.provider, { id: 'chart-hands', name: 'Chart Hands', version: '0.9.0', description: descriptor.provider.description });
    assert.ok(descriptor.instructions.length <= 2000);
    assert.deepEqual(descriptor.tools.map(tool => [tool.name, tool._meta['dev.agentinterop/effect']]), [['check_chart', 'pure'], ['read_charts', 'read']]);
    for (const tool of descriptor.tools) {
        assert.match(tool.name, /^[a-z][a-z0-9_]{1,40}$/);
        assert.ok(`plg__chart-hands__${tool.name}`.length <= 64);
        assert.ok(tool.description.length <= 1024);
        assert.equal(tool.inputSchema.additionalProperties, false);
        // A host shows a non-core tool only on a keyword match; without keywords it is never shown.
        assert.notEqual(tool._meta['dev.agentinterop/group'], 'core');
        assert.ok(tool._meta['dev.agentinterop/keywords'].length > 0);
    }
});

test('check_chart applies the code block rules', async () => {
    const provider = provide('');
    const good = await provider.callTool('check_chart', { source: '{"data": [{"x": [1, 2, 3], "y": [2, 4, 8], "type": "bar", "name": "sales"}], "layout": {"title": {"text": "Q1"}}, "fit": "fill"}' });
    assert.notEqual(good.isError, true);
    assertPlainJson(good);
    assert.equal(text(good), '문제 없음 · 트레이스 1개(bar "sales" 3점) · 제목 「Q1」');
    assert.deepEqual(good.structuredContent, { valid: true, problems: 0, traces: 1 });

    const bad = await provider.callTool('check_chart', { source: '{"data": {"x": [1]}, "options": {}, "fit": "wide", "layout": []}' });
    assert.notEqual(bad.isError, true, 'a chart with problems is a successful check');
    assert.equal(bad.structuredContent.valid, false);
    assert.equal(bad.structuredContent.problems, 4);
    assert.match(text(bad), /쓸 수 없는 최상위 키: options/);
    assert.match(text(bad), /fit은 off, shrink, fill 중 하나여야 한다/);
    assert.match(text(bad), /data는 트레이스의 배열이어야 한다/);
    assert.match(text(bad), /layout은 객체여야 한다/);

    assert.match(text(await provider.callTool('check_chart', { source: '{"data": [' })), /YAML\/JSON으로 읽을 수 없다/);
    assert.match(text(await provider.callTool('check_chart', { source: '{"layout": {}}' })), /data가 없다/);
    // YAML reads `fit: off` as false; the block processor accepts booleans.
    assert.equal((await provider.callTool('check_chart', { source: '{"data": [{"y": [1]}], "fit": false}' })).structuredContent.valid, true);
});

test('read_charts finds plotly blocks, reports line ranges and pages without gaps', async () => {
    const note = [
        '# note', '',
        '```plotly', '{"data": [{"y": [1, 2]}]}', '```', '',
        '~~~plotly', '{"data": [], "extra": 1}', '~~~', '',
        '```js', 'const plotly = 1', '```', '',
        '```dataviewjs', 'window.renderPlotly(this.container, [], {}, {})', '```', '',
        '```plotly', '{"data": [{"y": [1]}]}'
    ].join('\r\n');
    const result = await provide(note).callTool('read_charts', { path: 'notes/chart.md' });
    assert.notEqual(result.isError, true);
    assertPlainJson(result);
    assert.deepEqual(result._meta, { 'dev.agentinterop/resource': { path: 'notes/chart.md' } });
    assert.deepEqual(result.structuredContent, { charts: 3, from: 1, to: 3, withProblems: 1, dataviewBlocks: 1, complete: true });
    const lines = text(result).split('\n');
    assert.equal(lines[0], '노트 notes/chart.md · plotly 차트 3개 중 1~3 · dataviewjs로 그리는 차트 블록 1개(검사하지 않음)');
    assert.equal(lines[1], '차트 1 · 3~5행 · 트레이스 1개(scatter 2점) · 문제 없음');
    assert.equal(lines[2], '차트 2 · 7~9행 · 트레이스 0개 · 문제 2건');
    assert.equal(lines[5], '차트 3 · 19~20행 · 닫는 울타리 없음 · 트레이스 1개(scatter 1점) · 문제 없음');

    const many = provide(Array.from({ length: 45 }, (_, index) => `\`\`\`plotly\n{"data": [{"y": [${index}]}]}\n\`\`\`\n`).join('\n'));
    let from = 1, seen = 0, pages = 0;
    for (;;) {
        const page = await many.callTool('read_charts', { path: 'notes/chart.md', from });
        assert.notEqual(page.isError, true);
        assert.equal(page.structuredContent.from, from);
        assert.ok(text(page).length <= 8000, 'a page must fit the declared maxResultChars');
        seen += page.structuredContent.to - page.structuredContent.from + 1;
        pages++;
        if (page.structuredContent.complete) break;
        assert.ok(text(page).endsWith(`… 계속: from=${page.structuredContent.nextFrom} (남은 차트 ${45 - page.structuredContent.to}개)`));
        from = page.structuredContent.nextFrom;
    }
    assert.equal(seen, 45);
    assert.equal(pages, 3);
    assert.equal(errorCode(await many.callTool('read_charts', { path: 'notes/chart.md', from: 46 })), 'INVALID_ARGUMENT');

    const empty = await provide('no charts here').callTool('read_charts', { path: 'notes/chart.md' });
    assert.equal(text(empty), '노트 notes/chart.md · plotly 차트 0개');
    assert.equal(empty.structuredContent.complete, true);
});

test('invalid calls return a typed error instead of throwing', async () => {
    const provider = provide('');
    assert.equal(errorCode(await provider.callTool('read_charts', { path: '../outside.md' })), 'INVALID_ARGUMENT');
    assert.equal(errorCode(await provider.callTool('read_charts', { path: 'C:/absolute.md' })), 'INVALID_ARGUMENT');
    assert.equal(errorCode(await provider.callTool('read_charts', { path: 'notes/none.md' })), 'NOT_FOUND');
    assert.equal(errorCode(await provider.callTool('read_charts', { path: 'doc.pdf' })), 'UNSUPPORTED_FORMAT');
    assert.equal(errorCode(await provider.callTool('draw_chart', {})), 'UNKNOWN_TOOL');
    assert.equal(errorCode(await provider.callTool('constructor', {})), 'UNKNOWN_TOOL');
    provider.dispose();
    assert.equal(errorCode(await provider.callTool('check_chart', { source: '{}' })), 'DISPOSED');
});
