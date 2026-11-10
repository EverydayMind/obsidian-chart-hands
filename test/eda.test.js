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
test('aggregate groups rows, reports shares, exclusions and changes, and reads grouped thousands', async () => {
    const csv = 'region,quarter,amount\n서울,Q1,"1,200"\n부산,Q1,300\n서울,Q2,"1,500"\n부산,Q2,n/a\n,Q2,10\n대구,Q3,"12,34"\n';
    const total = await provider(csv).callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'aggregate', columns: ['region', 'amount'] } });
    assert.equal(total.isError, undefined);
    assert.deepEqual(total.structuredContent, { type: 'aggregate', columns: ['region', 'amount'], function: 'sum', sort: 'desc', totalRows: 6, validRows: 3,
        excludedRows: 2, missingGroupRows: 1, groupCount: 2, truncated: false, total: 3000,
        groups: [{ group: '서울', rows: 2, value: 2700, share: 0.9 }, { group: '부산', rows: 1, value: 300, share: 0.1 }],
        chart: { labels: ['서울', '부산'], values: [2700, 300] } });
    const trend = await provider(csv).callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'aggregate', columns: ['quarter', 'amount'], function: 'sum', sort: 'label', limit: 1 } });
    assert.deepEqual(trend.structuredContent.groups, [{ group: 'Q1', rows: 2, value: 1500, share: 1500 / 3010, change: null, changeRate: null }]);
    assert.equal(trend.structuredContent.truncated, true);
    assert.equal(trend.structuredContent.returnedGroups, 1);
    assert.equal(trend.structuredContent.limit, 1);
    assert.equal(trend.structuredContent.maxLimit, 100);
    assert.match(trend.structuredContent.note, /analysis\.limit to 2/);
    const changes = await provider(csv).callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'aggregate', columns: ['quarter', 'amount'], function: 'mean', sort: 'original' } });
    assert.deepEqual(changes.structuredContent.groups.map(g => [g.group, g.value, g.change, g.changeRate]), [['Q1', 750, null, null], ['Q2', 755, 5, 5 / 750]]);
    assert.equal(changes.structuredContent.total, undefined);
    const count = await provider(csv).callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'aggregate', columns: ['quarter'] } });
    assert.deepEqual(count.structuredContent.chart, { labels: ['Q2', 'Q1', 'Q3'], values: [3, 2, 1] });
    for (const analysis of [{ type: 'aggregate', columns: ['region'], function: 'sum' }, { type: 'aggregate', columns: ['region', 'amount'], sort: 'random' },
        { type: 'aggregate', columns: ['region', 'amount'], limit: 0 }, { type: 'summary', columns: ['amount'], function: 'sum' }]) {
        const res = await provider(csv).callTool('eda_analyze', { path: 'data.csv', analysis });
        assert.equal(res.isError, true, JSON.stringify(analysis));
    }
});

test('aggregate defaults to 60 groups and explains truncation at and above the maximum', async () => {
    const csv = 'period,value\n' + Array.from({ length: 101 }, (_, i) => `month${i + 1},${i + 1}`).join('\n');
    const p = provider(csv);
    for (const sort of ['original', 'label']) {
        const analysis = { type: 'aggregate', columns: ['period', 'value'], function: 'mean', sort };
        const result = (await p.callTool('eda_analyze', { path: 'data.csv', analysis })).structuredContent;
        assert.equal(result.groupCount, 101);
        assert.equal(result.returnedGroups, 60);
        assert.equal(result.limit, 60);
        assert.equal(result.maxLimit, 100);
        assert.match(result.note, /smaller CSV/);
        assert.equal(result.chart.labels.length, 60);
        const max = (await p.callTool('eda_analyze', { path: 'data.csv', analysis: { ...analysis, limit: 100 } })).structuredContent;
        assert.equal(max.returnedGroups, 100);
        assert.equal(max.truncated, true);
    }
    for (const count of [57, 60, 100]) {
        const subset = provider('period,value\n' + Array.from({ length: count }, (_, i) => `month${i + 1},${i}`).join('\n'));
        const analysis = { type: 'aggregate', columns: ['period', 'value'], sort: 'original', ...(count === 100 ? { limit: 100 } : {}) };
        const complete = (await subset.callTool('eda_analyze', { path: 'data.csv', analysis })).structuredContent;
        assert.equal(complete.truncated, false);
        assert.equal(complete.groups.length, count);
        assert.equal(complete.note, undefined);
    }
    const invalid = await p.callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'aggregate', columns: ['period'], limit: 101 } });
    assert.equal(invalid.isError, true);
});
