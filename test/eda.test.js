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
test('summarizes multiple columns independently and preserves the single-column shape', async () => {
    const columns = ['중국', '홍콩', '대만', '베트남', '미국', '일본', '기타'];
    const p = provider(`${columns.join(',')},기간\n1,2,3,4,5,6,7,2025\n3,bad,,4,5,6,7,2025\n9,9,9,9,9,9,9,2024`);
    const call = async analysis => (await p.callTool('eda_analyze', { path: 'data.csv', analysis })).structuredContent;
    const filter = [{ column: '기간', op: 'eq', value: '2025' }];
    const result = await call({ type: 'summary', columns, filter });
    assert.equal(result.totalRows, 3); assert.equal(result.filteredRows, 2); assert.deepEqual(result.filter, filter);
    assert.equal(result.sumTotal, 53);
    assert.deepEqual(result.shares[0], { column: '중국', sum: 4, share: 4 / 53 });
    assert.equal(result.perColumn[1].excludedRows, 1); assert.equal(result.perColumn[2].excludedRows, 1);
    assert.equal(result.perColumn[1].statistics.sum, 2);
    const single = await call({ type: 'summary', columns: ['중국'], filter });
    assert.deepEqual(single, { type: 'summary', columns: ['중국'], totalRows: 3, excludedRows: 0,
        statistics: { count: 2, min: 1, q1: 1.5, median: 2, q3: 2.5, max: 3, mean: 2, stddevSample: Math.SQRT2, sum: 4 }, filter, filteredRows: 2 });
    const zero = await call({ type: 'summary', columns: ['중국', '홍콩'], filter: [{ column: '기간', op: 'eq', value: 'none' }] });
    assert.equal(zero.sumTotal, 0); assert.deepEqual(zero.shares.map(item => item.share), [null, null]);
});
test('sorts rows before pagination with stable ties and blanks last', async () => {
    const p = provider('연월,네온_달러kg,문자\na,10,banana\nb,2,apple\nc,10,apple\nd,,\ne,3,cherry');
    const call = async analysis => p.callTool('eda_analyze', { path: 'data.csv', analysis });
    const top = (await call({ type: 'rows', columns: ['연월', '네온_달러kg'], sort_by: '네온_달러kg', sort: 'desc', limit: 1 })).structuredContent;
    assert.deepEqual(top.rows[0].values, ['a', '10']); assert.equal(top.sortedBy, '네온_달러kg'); assert.equal(top.sort, 'desc');
    assert.equal(top.order, 'descending (largest first)');
    const numeric = (await call({ type: 'rows', columns: ['연월'], sort_by: '네온_달러kg' })).structuredContent;
    assert.deepEqual(numeric.rows.map(row => row.rowNumber), [2, 5, 1, 3, 4]);
    assert.equal(numeric.order, 'ascending (smallest first)');
    const text = (await call({ type: 'rows', columns: ['연월'], sort_by: '문자', sort: 'desc' })).structuredContent;
    assert.deepEqual(text.rows.map(row => row.rowNumber), [5, 1, 2, 3, 4]);
    for (const sort of ['desc', 'asc']) {
        const error = await call({ type: 'rows', columns: ['연월', '네온_달러kg'], sort, limit: 1 });
        assert.ok(error.content[0].text.includes(`rows에서 sort를 쓰려면 sort_by에 열 이름을 함께 줄 것. 예: "sort_by":"네온_달러kg","sort":"${sort}" (sort는 그대로 두고 sort_by를 더한다)`));
    }
    assert.match((await call({ type: 'rows', columns: ['연월'], sort_by: '없음' })).content[0].text, /Unknown column/);
    for (const sort of ['label', 'original']) assert.match((await call({ type: 'rows', columns: ['연월'], sort_by: '문자', sort })).content[0].text, /asc or desc/);
    assert.match((await call({ type: 'rows', columns: ['연월'], sort: 'invalid' })).content[0].text, /rows sort must be asc or desc/);
});
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

test('filters dates for summary and returns paginated original rows with bounded cells', async () => {
    const long = '가'.repeat(201);
    const csv = `연월,주차,경보단계,값,설명\n2025-01,2026-W45,경계,100,첫째\n2025-12,2026-W45,경계,200,${long}\n2026-01,2026-W45,주의,900,셋째\n`;
    const p = provider(csv);
    const call = async analysis => (await p.callTool('eda_analyze', { path: 'data.csv', analysis })).structuredContent;
    const filter = [{ column: '연월', op: 'gte', value: '2025-01' }, { column: '연월', op: 'lte', value: '2025-12' }];
    const summary = await call({ type: 'summary', columns: ['값'], filter });
    assert.equal(summary.statistics.mean, 150); assert.equal(summary.statistics.sum, 300);
    assert.equal(summary.totalRows, 3); assert.equal(summary.filteredRows, 2); assert.deepEqual(summary.filter, filter);
    const conditions = [{ column: '주차', op: 'eq', value: '2026-W45' }, { column: '경보단계', op: 'eq', value: '경계' }];
    const first = await call({ type: 'rows', columns: ['설명'], filter: conditions, limit: 1 });
    assert.equal(first.totalRows, 3); assert.equal(first.filteredRows, 2); assert.equal(first.matchedRows, 2); assert.equal(first.truncated, true); assert.equal(first.nextOffset, 1);
    assert.deepEqual(first.rows[0], { rowNumber: 1, values: ['첫째'] });
    const second = await call({ type: 'rows', columns: ['설명'], filter: conditions, limit: 1, offset: first.nextOffset });
    assert.deepEqual(second.rows[0], { rowNumber: 2, values: [long.slice(0, 200)], truncatedColumns: ['설명'] });
    assert.equal(second.truncated, false); assert.equal(second.nextOffset, null);
    const empty = await call({ type: 'summary', columns: ['값'], filter: [{ column: '주차', op: 'eq', value: 'none' }] });
    assert.equal(empty.filteredRows, 0); assert.deepEqual(empty.statistics, { count: 0 });
    for (const type of ['histogram', 'correlation', 'aggregate', 'rows']) {
        const result = await call({ type, columns: type === 'correlation' ? ['값', '값'] : ['값'], filter: [{ column: '주차', op: 'eq', value: 'none' }] });
        assert.equal(result.filteredRows, 0); assert.equal(result.totalRows, 3);
        if (type === 'rows') assert.equal(result.matchedRows, 0);
    }
    const all = await call({ type: 'rows', columns: ['값'] });
    assert.equal(all.totalRows, 3); assert.equal(all.matchedRows, 3); assert.equal(all.filteredRows, undefined);
});

test('analysis errors identify invalid keys and explain accepted values', async () => {
    const p = provider('x,y\n1,2');
    const error = async analysis => (await p.callTool('eda_analyze', { path: 'data.csv', analysis })).content[0].text;
    for (const [analysis, patterns] of [
        [{ type: 'bad', columns: ['x'] }, [/summary/, /rows/]],
        [{ type: 'summary', columns: ['x'], offset: 1 }, [/offset/, /summary/, /type, columns, filter/]],
        [{ type: 'correlation', columns: ['x'] }, [/correlation/, /2/]],
        [{ type: 'rows', columns: ['x'], limit: 0 }, [/limit/, /1 to 100/]],
        [{ type: 'rows', columns: ['x'], offset: -1 }, [/offset/, /0 to/]],
        [{ type: 'rows', columns: ['x'], filter: [{ column: 'x', op: 'eq', value: '1' }, { column: 'x', op: 'eq', value: '1', typo: 1 }] }, [/condition 2/, /typo/]],
        [{ type: 'rows', columns: ['x'], filter: [{ column: 'x', op: 'bad', value: '1' }] }, [/condition 1/, /bad/, /prefix/, /contains/]],
        [{ type: 'rows', columns: ['x'], filter: [{ column: 'x', op: 'eq', value: 1 }] }, [/condition 1/, /value must be a string/]],
        [{ type: 'rows', columns: ['x'], filter: [{ column: 'absent', op: 'eq', value: '1' }] }, [/condition 1/, /absent/]]
    ]) {
        const result = await error(analysis);
        for (const pattern of patterns) assert.match(JSON.stringify(result), pattern);
    }
});

test('filter operators handle numbers, text and blank cells and reject invalid arguments', async () => {
    const p = provider('x,y\n001,alpha\n1,alphabet\n2,beta\n,blank\n');
    const call = async analysis => p.callTool('eda_analyze', { path: 'data.csv', analysis });
    for (const [column, op, value, expected] of [
        ['x', 'eq', '1', [1, 2]], ['x', 'ne', '1', [3, 4]], ['x', 'gt', '1', [3]],
        ['x', 'gte', '1', [1, 2, 3]], ['x', 'lt', '2', [1, 2]], ['x', 'lte', '1', [1, 2]],
        ['y', 'prefix', 'alpha', [1, 2]], ['y', 'contains', 'pha', [1, 2]],
        ['x', 'eq', '', []], ['x', 'ne', '', [1, 2, 3, 4]]
    ]) {
        const result = await call({ type: 'rows', columns: ['x'], filter: [{ column, op, value }] });
        assert.deepEqual(result.structuredContent.rows.map(row => row.rowNumber), expected, op);
    }
    for (const analysis of [
        { type: 'rows', columns: ['x'], filter: [{ column: 'missing', op: 'eq', value: '1' }] },
        { type: 'rows', columns: ['x'], filter: [{ column: 'x', op: 'bad', value: '1' }] },
        { type: 'rows', columns: ['x'], filter: [{ column: 'x', op: 'eq', value: '1', extra: true }] },
        { type: 'rows', columns: ['x'], extra: true }, { type: 'rows', columns: ['x'], offset: -1 },
        { type: 'summary', columns: ['x'], limit: 1 }, { type: 'aggregate', columns: ['x'], offset: 1 },
        { type: 'rows', columns: Array(9).fill('x') }, { type: 'rows', columns: ['x'], filter: Array(5).fill({ column: 'x', op: 'eq', value: '1' }) }
    ]) assert.equal((await call(analysis)).isError, true, JSON.stringify(analysis));
});
