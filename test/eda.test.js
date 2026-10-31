'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const path = require('node:path');
const load = Module._load;
Module._load = function (name, ...args) {
    if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {} };
    return load.call(this, name, ...args);
};
const bundle = new Module(path.join(__dirname, 'eda-plugin.js'), module);
bundle.filename = bundle.id; bundle.paths = Module._nodeModulePaths(__dirname);
bundle._compile(require('./helpers/build-plugin')(), bundle.filename);
Module._load = load;
const { createAgentProvider } = bundle.exports;
function provider(csv) {
    return createAgentProvider({ manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' },
        ensureLibraries() { throw new Error('EDA must not load Plotly'); },
        app: { vault: { getAbstractFileByPath: p => p === 'data.csv' ? { path: p, extension: 'csv' } : null, cachedRead: async () => csv } } });
}
test('profiles quoted CSV, missing values, numeric summaries and categories', async () => {
    const p = provider('age,score,name\r\n20,5,"a,b"\r\n30,,"a,b"\r\n40,15,"line\nbreak"\r\n');
    const result = await p.callTool('eda_profile', { path: 'data.csv' });
    assert.equal(result.isError, undefined);
    const d = result.structuredContent;
    assert.equal(d.rowCount, 3); assert.equal(d.columns[1].missingRate, 1 / 3);
    assert.equal(d.columns[0].statistics.median, 30);
    assert.deepEqual(d.columns[2].top[0], { value: 'a,b', count: 2 });
    assert.deepEqual(result._meta['dev.agentinterop/resource'], { path: 'data.csv' });
});
test('correlation uses complete numeric pairs and reports exclusions and undefined values', async () => {
    const p = provider('x,y\n1,2\n2,4\n3,missing\n,8\n');
    const result = await p.callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'correlation', columns: ['x', 'y'], method: 'pearson' } });
    assert.deepEqual(result.structuredContent, { type: 'correlation', columns: ['x', 'y'], method: 'pearson', totalRows: 4, validPairs: 2, excludedRows: 2, correlation: 1 });
    const constant = await provider('x,y\n1,2\n1,3').callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'correlation', columns: ['x', 'y'] } });
    assert.equal(constant.structuredContent.correlation, null);
});
test('rejects malformed CSV, invalid paths and unknown columns and pages profiles', async () => {
    for (const csv of ['a,b\n1', 'a,a\n1,2', 'a\n"oops']) {
        const res = await provider(csv).callTool('eda_profile', { path: 'data.csv' });
        assert.equal(res.structuredContent.code, 'INVALID_ARGUMENT');
    }
    const p = provider('a,b,c,d,e,f\n1,2,3,4,5,6');
    const first = await p.callTool('eda_profile', { path: 'data.csv' });
    assert.equal(first.structuredContent.nextFrom, 6);
    const last = await p.callTool('eda_profile', { path: 'data.csv', from: 6 });
    assert.equal(last.structuredContent.columns[0].name, 'f'); assert.equal(last.structuredContent.complete, true);
    assert.equal((await p.callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'summary', columns: ['z'] } })).structuredContent.code, 'INVALID_ARGUMENT');
    assert.equal((await p.callTool('eda_profile', { path: '../data.csv' })).structuredContent.code, 'INVALID_ARGUMENT');
});

test('histogram includes endpoints and excludes invalid values', async () => {
    const p = provider('x\n0\n1\n2\n3\n4\nNA');
    const d = (await p.callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'histogram', columns: ['x'], bins: 2 } })).structuredContent;
    assert.deepEqual(d.bins, [{ lower: 0, upper: 2, count: 2 }, { lower: 2, upper: 4, count: 3 }]);
    assert.equal(d.excludedRows, 1);
});
