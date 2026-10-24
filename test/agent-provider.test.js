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
            // An unquoted # starts a YAML comment, which leaves the value null.
            parseYaml: (text) => JSON.parse(text.replace(/#[0-9a-fA-F]{3,8}/g, 'null')),
            stringifyYaml: (value) => JSON.stringify(value, null, 2) + '\n'
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

const MANIFEST = { id: 'chart-hands', name: 'Chart Hands', version: '0.9.2' };
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
    assert.deepEqual(descriptor.provider, { id: 'chart-hands', name: 'Chart Hands', version: '0.9.2', description: descriptor.provider.description });
    assert.ok(descriptor.instructions.length <= 2000);
    assert.deepEqual(descriptor.tools.map(tool => [tool.name, tool._meta['dev.agentinterop/effect']]), [['check_chart', 'pure'], ['read_charts', 'read'], ['get_chart_guide', 'pure'], ['build_chart', 'pure']]);
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
    assert.equal(text(good), 'No problems · traces: 1(bar "sales" 3 points) · title "Q1"');
    assert.deepEqual(good.structuredContent, { valid: true, problems: 0, traces: 1 });

    const bad = await provider.callTool('check_chart', { source: '{"data": {"x": [1]}, "options": {}, "fit": "wide", "layout": []}' });
    assert.notEqual(bad.isError, true, 'a chart with problems is a successful check');
    assert.equal(bad.structuredContent.valid, false);
    assert.equal(bad.structuredContent.problems, 4);
    assert.match(text(bad), /Unsupported top-level keys: options/);
    assert.match(text(bad), /fit must be one of: off, shrink, fill/);
    assert.match(text(bad), /data must be a list of traces/);
    assert.match(text(bad), /layout must be an object/);

    assert.match(text(await provider.callTool('check_chart', { source: '{"data": [' })), /Cannot parse as YAML\/JSON/);
    assert.match(text(await provider.callTool('check_chart', { source: '{"layout": {}}' })), /data is missing/);
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
    assert.equal(lines[0], 'Note notes/chart.md · 3 plotly chart(s) · showing 1-3 · 1 dataviewjs chart block(s), not checked');
    assert.equal(lines[1], 'Chart 1 · lines 3-5 · traces: 1(scatter 2 points) · no problems');
    assert.equal(lines[2], 'Chart 2 · lines 7-9 · traces: 0 · 2 problem(s)');
    assert.equal(lines[5], 'Chart 3 · lines 19-20 · no closing fence · traces: 1(scatter 1 points) · no problems');

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
        assert.ok(text(page).endsWith(`… continue with from=${page.structuredContent.nextFrom} (${45 - page.structuredContent.to} more chart(s))`));
        from = page.structuredContent.nextFrom;
    }
    assert.equal(seen, 45);
    assert.equal(pages, 3);
    assert.equal(errorCode(await many.callTool('read_charts', { path: 'notes/chart.md', from: 46 })), 'INVALID_ARGUMENT');

    const empty = await provide('no charts here').callTool('read_charts', { path: 'notes/chart.md' });
    assert.equal(text(empty), 'Note notes/chart.md · 0 plotly chart(s)');
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

test('check_chart catches mistakes that parse but draw nothing useful', async () => {
    const provider = provide('');
    const unquoted = await provider.callTool('check_chart', { source: '{"data": [{"y": [1], "line": {\n"color": #2563EB}}]}' });
    assert.match(text(unquoted), /Line 2: unquoted colour/);
    const quoted = await provider.callTool('check_chart', { source: '{"data": [{"y": [1], "line": {"color": "#2563EB"}}]}' });
    assert.equal(quoted.structuredContent.valid, true);
    const nullColour = await provider.callTool('check_chart', { source: '{"data": [{"y": [1], "marker": {"color": null}}]}' });
    assert.match(text(nullColour), /marker\.color is empty/);
    const script = await provider.callTool('check_chart', { source: '{"data": [{"y": [1], "name": "${series}"}]}' });
    assert.match(text(script), /looks like JavaScript/);
    const mismatch = await provider.callTool('check_chart', { source: '{"data": [{"x": [1, 2, 3], "y": [1, 2]}], "layout": {"barmode": "group"}}' });
    assert.match(text(mismatch), /x has 3 points but y has 2/);
    assert.match(text(mismatch), /barmode only affects bar/);
});

test('get_chart_guide returns each topic and rejects unknown ones', async () => {
    const provider = provide('');
    const descriptor = await provider.describe();
    const tool = descriptor.tools.find(item => item.name === 'get_chart_guide');
    for (const topic of tool.inputSchema.properties.topic.enum) {
        const result = await provider.callTool('get_chart_guide', { topic });
        assert.notEqual(result.isError, true, topic);
        assertPlainJson(result);
        assert.ok(text(result).length > 200 && text(result).length <= 8000, `${topic} fits one result`);
        assert.equal(result.structuredContent.topic, topic);
    }
    assert.match(text(await provider.callTool('get_chart_guide', {})), /top-level keys/);
    assert.equal(errorCode(await provider.callTool('get_chart_guide', { topic: 'nope' })), 'INVALID_ARGUMENT');
});

test('build_chart makes checked blocks for every chart type', async () => {
    const provider = provide('');
    const labels = ['Jan', 'Feb', 'Mar'];
    const cases = [
        { type: 'line', labels, series: [{ name: 'A', values: [1, 2, 3] }, { name: 'B', values: [3, 2, 1] }], title: 'Trend', x_title: 'Month', y_title: 'Sales (KRW)' },
        { type: 'bar', labels, series: [{ values: [1, 2, 3] }] },
        { type: 'bar', labels, series: [{ values: [1, 2, 3] }, { values: [3, 2, 1] }], stacked: true },
        { type: 'barh', labels, series: [{ values: [1, 2, 3] }], y_title: 'Category', x_title: 'Amount' },
        { type: 'pie', labels, series: [{ values: [1, 2, 3] }] },
        { type: 'scatter', series: [{ name: 'S', x: [1, 2], values: [3, 4] }] },
        { type: 'line', labels, series: [{ values: [1, 2, 3] }], style: 'plain' }
    ];
    for (const args of cases) {
        const result = await provider.callTool('build_chart', args);
        assert.notEqual(result.isError, true, JSON.stringify(args));
        assertPlainJson(result);
        assert.equal(result.structuredContent.valid, true, text(result));
        assert.match(result.structuredContent.block, /^```plotly\n[\s\S]+\n```$/);
        const body = JSON.parse(result.structuredContent.block.split('\n').slice(1, -1).join('\n'));
        assert.deepEqual(Object.keys(body).filter(key => !['data', 'layout', 'config'].includes(key)), []);
    }
    const stacked = JSON.parse((await provider.callTool('build_chart', cases[2])).structuredContent.block.split('\n').slice(1, -1).join('\n'));
    assert.equal(stacked.layout.barmode, 'stack');
    const horizontal = JSON.parse((await provider.callTool('build_chart', cases[3])).structuredContent.block.split('\n').slice(1, -1).join('\n'));
    assert.equal(horizontal.data[0].orientation, 'h');
    assert.equal(horizontal.layout.yaxis.title.text, 'Category');
    const plain = JSON.parse((await provider.callTool('build_chart', cases[6])).structuredContent.block.split('\n').slice(1, -1).join('\n'));
    assert.equal(plain.data[0].marker, undefined);
});

test('build_chart rejects data that does not fit the chart type', async () => {
    const provider = provide('');
    const labels = ['a', 'b'];
    assert.equal(errorCode(await provider.callTool('build_chart', { type: 'bar', series: [{ values: [1, 2] }] })), 'INVALID_ARGUMENT');
    assert.equal(errorCode(await provider.callTool('build_chart', { type: 'bar', labels, series: [{ values: [1, 2, 3] }] })), 'INVALID_ARGUMENT');
    assert.equal(errorCode(await provider.callTool('build_chart', { type: 'scatter', series: [{ values: [1, 2] }] })), 'INVALID_ARGUMENT');
    assert.equal(errorCode(await provider.callTool('build_chart', { type: 'donut', labels, series: [{ values: [1, 2] }] })), 'INVALID_ARGUMENT');
    assert.equal(errorCode(await provider.callTool('build_chart', { type: 'bar', labels, series: [] })), 'INVALID_ARGUMENT');
});
