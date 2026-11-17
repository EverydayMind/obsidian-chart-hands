'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildHead, captureExtended, loadHarness } = require('./helpers/locale-harness');
const buildPlugin = require('./helpers/build-plugin');
const golden = path.join(__dirname, 'fixtures', 'locale-ko-coverage.json');
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hangul = /[가-힣ᄀ-ᇿ㄰-㆏ꥠ-꥿ힰ-퟿]/u;
// No authored English output needs a Korean literal. User content is outside this check.
const allowances = [];
function assertPure(producer, value) {
    let text = JSON.stringify(value);
    for (const entry of allowances.filter(item => item.producer === producer)) {
        assert.ok(entry.literal && entry.reason && text.includes(entry.literal), `unused allowance: ${producer}`);
        text = text.split(entry.literal).join('');
    }
    assert.doesNotMatch(text, hangul, producer);
}

test('expanded Korean golden matches HEAD and current runtime without normalization', async () => {
    const expected = fs.readFileSync(golden);
    const { headSource } = require('./helpers/locale-harness');
    // Keep each full snapshot paired with its own capture cases, including after a future commit.
    const filename = path.join(__dirname, 'helpers', 'locale-harness.js');
    const baseline = new Module(filename, module);
    baseline.filename = filename;
    baseline.paths = Module._nodeModulePaths(path.dirname(filename));
    baseline._compile(headSource('test/helpers/locale-harness.js'), filename);
    assert.deepEqual(bytes(await baseline.exports.captureExtended(await buildHead(), 'ko')), Buffer.from(headSource('test/fixtures/locale-ko-coverage.json')), 'HEAD baseline');
    assert.deepEqual(bytes(await captureExtended(buildPlugin(), 'ko')), expected, 'current Korean output');
});

test('English checks all guide topics, chart types, analysis families, empty results, errors and rendered UI', async () => {
    const en = await captureExtended(buildPlugin(), 'en');
    assertPure('descriptor', en.descriptor);
    for (const [i, call] of en.calls.entries()) assertPure(`call[${i}].${call.name}`, call.result);
    for (const [i, item] of en.ui.entries()) assertPure(`ui[${i}].${item.kind}`, item.values);
    // Ensure fixture mistakes cannot silently replace successful paths with errors.
    for (const tool of en.descriptor.tools) assert.ok(en.calls.some(c => c.name === tool.name && !c.result.isError), tool.name);
    const built = en.calls.filter(c => c.name === 'build_chart' && !c.result.isError);
    const types = en.descriptor.tools.find(t => t.name === 'build_chart').inputSchema.properties.type.enum;
    assert.deepEqual(built.slice(0, types.length - 1).map(c => c.args.type), Array.from(types).filter(type => type !== 'radar'));
    // The golden's two-axis radar deliberately records its validation error.
    const h = loadHarness(buildPlugin(), 'en');
    const radar = await h.exports.createAgentProvider({ manifest: en.descriptor.provider, app: {} }, 'en').callTool('build_chart', {
        type: 'radar', labels: ['A', 'B', 'C'], series: [{ values: [1, 2, 3] }]
    });
    assert.ok(!radar.isError);
    assertPure('build_chart.radar', radar);
    assert.equal(en.calls.filter(c => c.name === 'eda_analyze' && c.args.path === 'empty.csv' && !c.result.isError).length, 5);
    assert.ok(en.calls.some(c => c.name === 'read_charts' && c.result.structuredContent.charts === 0));
    assert.equal(en.ui.filter(item => item.kind === 'command').length, 2);
    assert.equal(en.ui.filter(item => item.kind === 'name').length, 3);
    assert.ok(en.ui.some(item => item.kind === 'notice' && item.values[0].includes('could not load')));
    assert.ok(en.ui.some(item => item.kind === 'render-error'));
});

test('every authored Korean source literal is exercised by the Korean output fixtures', async () => {
    const ts = require('typescript');
    const ko = await captureExtended(buildPlugin(), 'ko');
    const strings = [];
    function collect(value) {
        if (typeof value === 'string') strings.push(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    }
    collect(ko);
    const dir = path.join(__dirname, '..', 'src');
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
        const source = ts.createSourceFile(file, fs.readFileSync(path.join(dir, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        function visit(node) {
            if ((ts.isStringLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isNoSubstitutionTemplateLiteral(node)) && hangul.test(node.text)) {
                assert.ok(strings.some(value => value.includes(node.text)), `${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: unexercised Korean literal ${node.text}`);
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
    }
});

test('locale remains pinned across language changes and providers keep independent languages', async () => {
    const h = loadHarness(buildPlugin(), 'en');
    assert.equal(h.exports.getLocale(), 'en');
    h.setLanguage('ko');
    assert.equal(h.exports.getLocale(), 'en');
    const plugin = { manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' }, app: {} };
    const ko = h.exports.createAgentProvider(plugin, 'ko');
    const en = h.exports.createAgentProvider(plugin, 'en');
    const before = bytes(await ko.describe());
    await en.describe();
    assert.deepEqual(bytes(await ko.describe()), before);
    const same = await h.exports.createAgentProvider(plugin).describe();
    assert.equal(same.tools[1].description, (await en.describe()).tools[1].description);
});

test('language resolution handles unavailable APIs and valid regional language tags', () => {
    const h = loadHarness(buildPlugin(), 'en');
    h.setNavigator({ language: 'ko-KR' });
    for (const app of ['en', 'en-US', 'fr', 'ja', 'zh-TW']) {
        h.setLanguage(app); assert.equal(h.exports.resolveLocale(), 'en', app);
    }
    for (const app of ['ko', 'KO-kr', ' ko-KR ']) {
        h.setLanguage(app); assert.equal(h.exports.resolveLocale(), 'ko', app);
    }
    for (const app of ['', null, 42, 'invalid!', new Error('API unavailable')]) {
        h.setLanguage(app); assert.equal(h.exports.resolveLocale(), 'ko');
    }
    h.setNavigator({ language: 'de-DE' }); assert.equal(h.exports.resolveLocale(), 'en');
    h.setNavigator({ language: 'invalid!' }); assert.equal(h.exports.resolveLocale(), 'en');
    h.setNavigator(undefined); assert.equal(h.exports.resolveLocale(), 'en');
});

test('English output preserves Korean user file names, column names and document text', async () => {
    const h = loadHarness(buildPlugin(), 'en');
    const p = h.exports.createAgentProvider({ manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' }, app: { vault: {
        getAbstractFileByPath: name => ({ path: name, extension: name.endsWith('.csv') ? 'csv' : 'md' }),
        cachedRead: async file => file.path.endsWith('.csv') ? '사용자 열\n1\n2' : '```plotly\n{"data":[{"y":[1]}],"layout":{"title":{"text":"사용자 제목"}}}\n```'
    } } }, 'en');
    const note = await p.callTool('read_charts', { path: '자료.md' });
    assert.ok(!note.isError);
    assert.match(note.content[0].text, /자료.md/);
    assert.match(note.content[0].text, /사용자 제목/);
    const csv = await p.callTool('eda_profile', { path: '자료.csv' });
    assert.ok(!csv.isError);
    assert.match(csv.structuredContent.columns[0].name, /사용자 열/);
});
