'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const bundle = new Module(path.join(__dirname, 'units-plugin.js'), module);
bundle.filename = bundle.id; bundle.paths = Module._nodeModulePaths(__dirname);
bundle._compile(require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'eda.js')], bundle: true, write: false, format: 'cjs', platform: 'node' }).outputFiles[0].text, bundle.filename);
const { parseCell, columnFacts, parseDataset, profile, analyze, resolveChartSource } = bundle.exports;
const { loadHarness } = require('./helpers/locale-harness');
const code = require('./helpers/build-plugin')();

test('C1 numeric grammar accepts only specified forms', () => {
    for (const [input, value, unit, notation] of [
        ['△ 1,234원', -1234, '원', '△'], ['(1,234)원', -1234, '원', '()'],
        ['(1,234원)', -1234, '원', '()'], ['(₩1,234)', -1234, '₩', '()'],
        ['₩ 1,000', 1000, '₩'], ['12.5%p', 12.5, '%p'], ['1e3', 1000, ''], ['−5', -5, '']
    ]) assert.deepEqual(parseCell(input), { value, unit, ...(notation ? { notation } : {}) }, input);
    for (const input of ['1,234e3', '△1e3', '$1e3', '1e3원', '₩1,000원', '-(1)', '△-1', '(△1)', '(1e3)']) assert.equal(parseCell(input), null, input);
    assert.ok(Object.is(parseCell('△0').value, 0));
});

test('column facts apply zero, empty and profile rules', () => {
    const d = parseDataset('a,b,c,d\n0,,00123,△2원\n2원,,00456,(3원)');
    assert.equal(columnFacts(d.rows, 0), columnFacts(d.rows, 0));
    assert.deepEqual(columnFacts(d.rows, 0).units, ['원']);
    assert.equal(columnFacts(d.rows, 1).strictNumeric, false);
    const p = profile(d).columns;
    assert.equal(p[1].type, 'empty'); assert.equal(p[2].leadingZeros, true);
    assert.equal(p[3].unit, '원'); assert.deepEqual(p[3].notation, ['△', '()']);
    const mixed = profile(parseDataset('v\n1원\n2천원')).columns[0];
    assert.equal(mixed.type, 'text'); assert.deepEqual(mixed.mixedUnits, ['원', '천원']);
    assert.deepEqual(columnFacts([['0'], ['0']], 0).units, ['']);
    assert.deepEqual(columnFacts([['0'], ['0원'], ['5원']], 0).units, ['원']);
    assert.equal(columnFacts([['0'], ['5원'], ['3']], 0).units.length, 2);
});

test('selected rows, unit checks and summaries', () => {
    const d = parseDataset('g,v,w\na,1원,2명\nb,2천원,4명');
    const filter = [{ column: 'g', op: 'eq', value: 'a' }];
    for (const type of ['aggregate', 'summary']) assert.throws(() => analyze(d, { type, columns: type === 'aggregate' ? ['g', 'v'] : ['v'] }, 'en'), /mixed units/);
    assert.equal(analyze(d, { type: 'aggregate', columns: ['g', 'v'], filter }, 'en').unit, '원');
    assert.equal(analyze(d, { type: 'aggregate', columns: ['g', 'v'], function: 'count' }, 'en').total, 2);
    assert.throws(() => analyze(d, { type: 'rows', columns: ['g'], filter: [{ column: 'v', op: 'eq', value: '1원' }, ...filter] }, 'en'), /filter condition 1/);
    assert.equal(analyze(d, { type: 'rows', columns: ['g'], filter: [{ column: 'v', op: 'gt', value: '1' }] }, 'en').matchedRows, 1);
    const multi = analyze(d, { type: 'summary', columns: ['v', 'w'], filter }, 'en');
    assert.equal(multi.sumTotal, null); assert.equal(multi.shares, null); assert.deepEqual(multi.unitMismatch, ['v(원)', 'w(명)']);
    assert.equal(analyze(parseDataset('x,y\n1원,2명\n2원,4명'), { type: 'correlation', columns: ['x', 'y'] }, 'en').correlation, 1);
    const args = { type: 'bar', source: { path: 'data.csv', labels: 'g' }, series: [{ column: 'v' }] };
    assert.throws(() => resolveChartSource(d, { ...args, source: { ...args.source, limit: 1 } }, 'en'), /mixed units/);
    assert.deepEqual(resolveChartSource(d, { ...args, source: { ...args.source, filter } }, 'en').series[0].values, [1]);
});

test('build_chart reports source units', async () => {
    const h = loadHarness(code, 'en');
    const p = h.exports.createAgentProvider({ manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' }, app: { vault: {
        getAbstractFileByPath: path => ({ path, extension: 'csv' }), cachedRead: async () => 'g,v\na,1원\nb,0'
    } } }, 'en');
    const result = await p.callTool('build_chart', { type: 'bar', source: { path: 'data.csv', labels: 'g' }, series: [{ column: 'v' }] });
    assert.deepEqual(JSON.parse(JSON.stringify(result.structuredContent.source.units)), { v: '원' });
});
