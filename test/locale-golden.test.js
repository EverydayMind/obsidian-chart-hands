'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const load = Module._load;
let appLanguage = 'ko';
Module._load = function (name, ...args) {
    if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {},
        moment: { locale: () => appLanguage }, parseYaml: JSON.parse, stringifyYaml: value => JSON.stringify(value, null, 2) + '\n' };
    return load.call(this, name, ...args);
};
const bundle = new Module(path.join(__dirname, 'locale-plugin.js'), module);
bundle.filename = bundle.id; bundle.paths = Module._nodeModulePaths(__dirname);
bundle._compile(require('./helpers/build-plugin')(), bundle.filename);
Module._load = load;
const { createAgentProvider, getLocale, resolveLocale, setLocaleForTests } = bundle.exports;
const golden = path.join(__dirname, 'fixtures', 'locale-ko.json');

async function capture(locale = 'ko', factory = createAgentProvider, originalSource) {
    const p = factory({ manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' }, app: { vault: {
        getAbstractFileByPath: p => p === 'data.csv' ? { path: p, extension: 'csv' } : p === 'note.md' ? { path: p, extension: 'md' } : null,
        cachedRead: async file => file.path === 'data.csv' ? 'month,value\n2025-01,2\n2025-02,4' : '```plotly\n{"data":[{"y":[1,2]}]}\n```'
    } } }, locale);
    const descriptor = await p.describe();
    const cases = [
        ['eda_profile', { path: 'data.csv' }], ['eda_profile', { path: 'missing.csv' }],
        ['eda_analyze', { path: 'data.csv', analysis: { type: 'summary', columns: ['value'] } }],
        ['eda_analyze', { path: 'data.csv', analysis: { type: 'rows', columns: ['value'], sort: 'asc' } }],
        ['eda_analyze', { path: 'data.csv', analysis: { type: 'rows', columns: ['value'], filter: [{ column: 'month', op: 'eq', value: 'none' }] } }],
        ['check_chart', { source: '{"data":[{"y":[1,2]}]}' }], ['check_chart', { source: '{}' }],
        ['read_charts', { path: 'note.md' }], ['read_charts', { path: 'missing.md' }],
        ['get_chart_guide', {}], ['get_chart_guide', { topic: 'invalid' }],
        ['build_chart', { type: 'bar', labels: ['A'], series: [{ values: [1] }] }], ['build_chart', { type: 'invalid', series: [] }]
    ];
    const results = [];
    for (const [name, args] of cases) results.push({ name, args, result: await p.callTool(name, args) });
    const source = originalSource ?? fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const ui = locale === 'en'
        ? (await require('./helpers/locale-harness').captureExtended(require('./helpers/build-plugin')(), locale)).ui
        : source.match(/\.(?:setName|setDesc|addOption)\([^\n]+|new obsidian\.Notice\([^\n]+|const NEW_PLOTLY_CHART[^\n]+/g);
    return { descriptor, digest: crypto.createHash('sha256').update(JSON.stringify(descriptor)).digest('hex'), results, ui };
}
test('Korean output remains byte-identical to the original snapshot', async () => {
    const actual = Buffer.from(JSON.stringify(await capture(), null, 2) + '\n');
    if (process.env.UPDATE_LOCALE_GOLDEN === '1') fs.writeFileSync(golden, actual);
    else assert.deepEqual(actual, fs.readFileSync(golden));
});
test('the existing Korean golden also matches unmodified HEAD execution', async () => {
    const { buildHead, loadHarness, headSource } = require('./helpers/locale-harness');
    const h = loadHarness(await buildHead(), 'ko');
    const actual = Buffer.from(JSON.stringify(await capture('ko', h.exports.createAgentProvider, headSource('src/main.js')), null, 2) + '\n');
    assert.deepEqual(actual, Buffer.from(headSource('test/fixtures/locale-ko.json')));
});
test('app locale takes precedence and fallback accepts only valid language tags', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'ko-KR' } });
    try {
        appLanguage = 'en'; assert.equal(resolveLocale(), 'en');
        appLanguage = 'ko-KR'; assert.equal(resolveLocale(), 'ko');
        appLanguage = ''; assert.equal(resolveLocale(), 'ko');
        appLanguage = 'invalid!'; globalThis.navigator.language = 'fr'; assert.equal(resolveLocale(), 'en');
        globalThis.navigator.language = ''; assert.equal(resolveLocale(), 'en');
        setLocaleForTests('ko'); assert.equal(getLocale(), 'ko');
        setLocaleForTests('en'); assert.equal(getLocale(), 'en'); setLocaleForTests(undefined);
    } finally {
        appLanguage = 'ko';
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else delete globalThis.navigator;
    }
});
test('English descriptor and generated results contain no Hangul and meet host limits', async () => {
    const ko = await capture('ko');
    const en = await capture('en');
    const koAgain = await capture('ko');
    assert.deepEqual(koAgain.descriptor, ko.descriptor);
    assert.notDeepEqual(en.descriptor, ko.descriptor);
    assert.ok(en.descriptor.instructions.length <= 2000);
    for (const tool of en.descriptor.tools) {
        assert.ok(tool.description.length <= 1024, tool.name);
        assert.ok(tool._meta['dev.agentinterop/keywords'].length <= 32, tool.name);
    }
    // No exceptions are necessary: these fixtures contain no user-authored Korean.
    const allowances = [];
    const outputs = { descriptor: en.descriptor, results: en.results, ui: en.ui };
    for (const [producer, value] of Object.entries(outputs)) {
        let text = JSON.stringify(value);
        for (const item of allowances.filter(entry => entry.producer === producer)) {
            assert.ok(text.includes(item.literal), `unused allowance: ${item.literal}`);
            text = text.split(item.literal).join('');
        }
        assert.doesNotMatch(text, /[가-힣ᄀ-ᇿ㄰-㆏ꥠ-꥿ힰ-퟿]/u, producer);
    }
});
