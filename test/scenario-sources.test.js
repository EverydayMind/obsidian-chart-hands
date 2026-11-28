import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { analyze, parseDataset, resolveChartSource } from '../src/eda.js';
import { buildChartDefinition } from '../src/chart-builder.js';
import { chartFacts, chartDisplay, displayGroup } from '../src/chart-facts.js';
import { parseStaticChart } from '../src/static-chart.js';
import { chartBlock } from './helpers/chart-block.js';
import buildPlugin from './helpers/build-plugin.js';
import { loadHarness } from './helpers/locale-harness.js';

const pluginCode = buildPlugin();
function provider(files, locale = 'en') {
    const { exports } = loadHarness(pluginCode, locale);
    const entries = Object.keys(files).map(path => ({ path, extension: path.split('.').at(-1) }));
    return exports.createAgentProvider({ manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' }, app: { vault: {
        getAbstractFileByPath: path => entries.find(file => file.path === path),
        getFiles: () => entries,
        cachedRead: async file => files[file.path]
    } } }, locale, { now: () => new Date(2026, 10, 28) });
}

const valueSeries = [{ column: 'value' }];
const matrixArgs = (path, analysis, type, extra = {}) => ({ type, source: { path, analysis }, series: valueSeries, ...extra });
const definition = result => parse(chartBlock(result).split('\n').slice(1, -1).join('\n'));
const frozen = result => result.structuredContent.staticBlock.split('\n')[1];
const message = result => result.content.map(item => item.text).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
const checks = result => { assert.ok(!result.isError, message(result)); assert.equal(result.structuredContent.valid, true); };

test('H1 summary charts reduce wide columns, keep shares fractional in EDA and freeze treemap inputs', async () => {
    const path = 'wide.csv';
    const csv = 'month,A,B,C,D,E,F,G,H,I\n2026-01,10kg,20kg,30kg,1kg,2kg,3kg,4kg,5kg,6kg\n2026-01,20kg,10kg,30kg,1kg,2kg,3kg,4kg,5kg,6kg\n2026-02,200kg,100kg,300kg,1kg,2kg,3kg,4kg,5kg,6kg';
    const dataset = parseDataset(csv);
    const filter = [{ column: 'month', op: 'eq', value: '2026-01' }];
    const spec = { type: 'summary', columns: ['A', 'B', 'C'], filter };
    const p = provider({ [path]: csv, 'mixed.csv': 'A,B\n10kg,20%' });
    const a = (await p.callTool('eda_analyze', { path, analysis: { ...spec, function: 'mean' } })).structuredContent;
    assert.equal(a.shares[0].share, 0.25);
    assert.equal(a.perColumn[0].statistics.sum, 30);
    assert.deepEqual(plain(a.chartArgs.source.analysis), { ...spec, function: 'mean' });
    const automatic = await p.callTool('build_chart', a.chartArgs);
    checks(automatic);
    assert.deepEqual(definition(automatic).data[0].y, [15, 15, 30]);
    const donut = await p.callTool('build_chart', matrixArgs(path, spec, 'donut', { series: [{ column: 'share' }] }));
    checks(donut);
    assert.deepEqual(definition(donut).data[0].values, [25, 25, 50]);
    assert.match(chartBlock(donut), /analysis summary A B C sum · filter month eq 2026-01/);
    assert.equal(donut.structuredContent.facts.scope.beforeLimit, undefined);
    const tree = await p.callTool('build_chart', matrixArgs(path, spec, 'treemap'));
    checks(tree);
    assert.deepEqual(JSON.parse(frozen(tree)).parents, ['', '', '']);
    assert.deepEqual(parseStaticChart(frozen(tree)).data[0].values, [30, 30, 60]);
    for (const [fn, value] of Object.entries({ sum: 30, mean: 15, min: 10, max: 20, median: 15, count: 2 })) {
        assert.equal(resolveChartSource(dataset, matrixArgs(path, { ...spec, function: fn }, 'funnel'), 'en').series[0].values[0], value);
    }
    const eight = Array.from('ABCDEFGH');
    assert.equal(resolveChartSource(dataset, matrixArgs(path, { ...spec, columns: eight }, 'pie'), 'en').labels.length, 8);
    assert.throws(() => resolveChartSource(dataset, matrixArgs(path, { ...spec, columns: [...eight, 'I'] }, 'pie'), 'en'), /source\.analysis\.columns.*2–8/);
    assert.throws(() => resolveChartSource(dataset, matrixArgs(path, { ...spec, columns: ['A'] }, 'bar'), 'en'), /2–8/);
    assert.throws(() => resolveChartSource(dataset, matrixArgs(path, spec, 'line'), 'en'), /chart type/);
    const mixed = { type: 'summary', columns: ['A', 'B'], function: 'count' };
    assert.equal((await p.callTool('eda_analyze', { path: 'mixed.csv', analysis: mixed })).structuredContent.unitMismatch.length, 2);
    assert.match(message(await p.callTool('build_chart', matrixArgs('mixed.csv', mixed, 'bar'))), /source\.analysis\.columns.*different units/);
    const noData = { type: 'summary', columns: ['A'], filter: [{ column: 'month', op: 'eq', value: '2027-01' }] };
    assert.equal((await p.callTool('eda_analyze', { path, analysis: noData })).structuredContent.chartArgs, undefined);
    const count = (await p.callTool('eda_analyze', { path, analysis: { ...noData, function: 'count' } })).structuredContent;
    assert.equal(definition(await p.callTool('build_chart', count.chartArgs)).data[0].value, 0);
});

test('H1 pivot groups repeated rows, orders periods, and preserves gaps and zeroes', async () => {
    const path = 'long.csv';
    const csv = 'week,product,rate,include\n2026-W10,Z,10%,yes\n2026-W2,가,0%,yes\n2026-W10,Z,20%,yes\n2026-W2,Z,,yes\n2026-W10,가,80%,no';
    const dataset = parseDataset(csv);
    const spec = { type: 'pivot', columns: ['week', 'product', 'rate'], filter: [{ column: 'include', op: 'eq', value: 'yes' }] };
    const p = provider({ [path]: csv });
    const a = await p.callTool('eda_analyze', { path, analysis: spec });
    assert.ok(!a.isError, message(a));
    const result = a.structuredContent;
    assert.equal(result.function, 'mean');
    assert.deepEqual(plain(result.chart), { labels: ['2026-W2', '2026-W10'], series: [{ name: '가', values: [0, null] }, { name: 'Z', values: [null, 15] }] });
    const counted = analyze(dataset, { ...spec, columns: ['week', 'product'], function: 'count' }, 'en');
    assert.deepEqual(counted.chart.series.map(s => s.values), [[1, null], [1, 2]]);
    assert.throws(() => analyze(dataset, { ...spec, columns: ['week', 'product'] }, 'en'), /analysis\.function: count/);
    assert.throws(() => analyze(dataset, { ...spec, limit: 1 }, 'en'), /inapplicable analysis key: limit/);
    assert.throws(() => analyze(parseDataset('week,product,distance\n2026-W2,A,1km\n2026-W2,A,2km'), { type: 'pivot', columns: ['week', 'product', 'distance'] }), /analysis\.function/);
    const heatmap = await p.callTool('build_chart', result.chartArgs);
    checks(heatmap);
    assert.deepEqual(definition(heatmap).data[0].z, [[0, null], [null, 15]]);
    assert.match(chartBlock(heatmap), /analysis pivot week product rate mean · filter include eq yes/);
    assert.deepEqual(parseStaticChart(frozen(heatmap)).data[0].z, [[0, null], [null, 15]]);
    const stacked = await p.callTool('build_chart', matrixArgs(path, spec, 'bar', { stacked: true }));
    checks(stacked);
    assert.equal(definition(stacked).layout.barmode, 'stack');
    assert.equal(definition(await p.callTool('build_chart', matrixArgs(path, spec, 'area', { stacked: true }))).data[0].stackgroup, 'one');
    const one = { ...spec, filter: [{ column: 'product', op: 'eq', value: 'Z' }] };
    assert.match(message(await p.callTool('build_chart', matrixArgs(path, one, 'bar', { stacked: true }))), /stacked/);
});

test('H1 pivot enforces series, cell, result character and static format boundaries', async () => {
    const path = 'pivot.csv';
    const grid = (width, height, value = () => '1') => 'x,series,v\n' + Array.from({ length: width * height }, (_, i) => ['x' + i % width, 'S' + Math.floor(i / width), value(i)].join(',')).join('\n');
    const spec = { type: 'pivot', columns: ['x', 'series', 'v'], function: 'sum' };
    const build = (csv, type, filter) => provider({ [path]: csv }).callTool('build_chart', matrixArgs(path, { ...spec, ...(filter ? { filter } : {}) }, type));
    for (const type of ['bar', 'barh', 'line', 'area']) {
        checks(await build(grid(2, 12), type));
        assert.match(message(await build(grid(2, 13), type)), /source\.analysis\.filter/);
    }
    const edge = await build(grid(50, 30), 'heatmap');
    checks(edge);
    assert.equal(definition(edge).data[0].z.flat().length, 1500);
    assert.equal(edge.structuredContent.staticBlockMissing, 'too_long');
    const unsupported = await build(grid(1, 13), 'heatmap');
    checks(unsupported);
    assert.equal(unsupported.structuredContent.staticBlockMissing, 'unsupported');
    for (const csv of [grid(1, 31), grid(51, 30), grid(50, 30, i => String(100000000000000 + i))]) {
        const result = await build(csv, 'heatmap');
        assert.equal(result.isError, true);
        assert.match(message(result), /source\.analysis\.filter/);
        assert.doesNotMatch(message(result), /analysis\.limit/);
    }
    const tooBig = provider({ [path]: grid(50, 30, i => String(100000000000000 + i)) });
    const analysis = await tooBig.callTool('eda_analyze', { path, analysis: spec });
    assert.equal(analysis.isError, true);
    assert.match(message(analysis), /analysis\.filter/);
    checks(await build(grid(1, 31), 'heatmap', [{ column: 'series', op: 'ne', value: 'S0' }]));
});

test('H2 summary indicator resolves one reference and freezes the number and absolute percentage-point delta', async () => {
    const path = 'kpi.csv';
    const p = provider({ [path]: 'rate\n14.3%' }, 'ko');
    const spec = { type: 'summary', columns: ['rate'] };
    const result = await p.callTool('build_chart', matrixArgs(path, spec, 'indicator', { target: { value: 30 }, gauge: true }));
    checks(result);
    const built = definition(result);
    assert.equal(built.data[0].mode, 'gauge+number+delta');
    assert.deepEqual(built.data[0].gauge, { axis: { range: [0, 100] }, threshold: { value: 30 } });
    assert.equal(built.data[0].delta.relative, false);
    assert.equal(built.data[0].delta.suffix, '%p');
    assert.equal(built.layout.shapes, undefined);
    assert.match(result.structuredContent.factLines.join('\n'), /−15\.7%p/);
    const staticInput = JSON.parse(frozen(result));
    assert.equal(staticInput.gauge, undefined);
    assert.equal(staticInput.target, undefined);
    assert.deepEqual(staticInput.series[0].values, [14.3, 30]);
    assert.equal(parseStaticChart(frozen(result)).data[0].mode, 'number+delta');
    const direct = { type: 'indicator', series: [{ values: [4, 2] }], target: { value: 2 } };
    assert.equal(buildChartDefinition(direct).data[0].delta.relative, true);
    assert.equal(buildChartDefinition({ ...direct, unit: '%p' }).data[0].delta.relative, false);
    assert.throws(() => buildChartDefinition({ ...direct, target: { value: 3 } }), /target\.value.*series\[0\]\.values\[1\]/);
    assert.throws(() => buildChartDefinition({ type: 'pie', gauge: true, labels: ['A'], series: [{ values: [2] }] }), /gauge/);
});

test('H2 gauge ranges include zero, both endpoints and finite extreme values', () => {
    const range = (values, unit) => buildChartDefinition({ type: 'indicator', series: [{ values }], unit, gauge: true }).data[0].gauge.axis.range;
    assert.deepEqual(range([-17, 81]), [-20, 100]);
    assert.deepEqual(range([-7]), [-10, 0]);
    assert.deepEqual(range([0, 0]), [0, 1]);
    assert.deepEqual(range([0, 0], '%'), [0, 100]);
    assert.deepEqual(range([101, 100], '%'), [0, 200]);
    assert.deepEqual(range([0.003, -0.001]), [-0.001, 0.005]);
    assert.deepEqual(range([Number.MAX_VALUE, -Number.MIN_VALUE]), [-Number.MIN_VALUE, Number.MAX_VALUE]);
});

test('H3 point labels follow filtered and sorted points, explicit text and the 30-point boundary', async () => {
    const path = 'points.csv';
    const rows = ['removed,0,99,1,no', 'A,1,10,2,yes', ',2,20,3,yes', ['Z'.repeat(105), 3, 30, 4, 'yes'].join(',')];
    const csv = 'label,x,y,size,include\n' + rows.join('\n');
    const p = provider({ [path]: csv });
    const source = { path, x: 'x', labels: 'label', sort: { column: 'y' }, filter: [{ column: 'include', op: 'eq', value: 'yes' }] };
    for (const type of ['scatter', 'bubble']) {
        const series = [{ column: 'y', ...(type === 'bubble' ? { sizeColumn: 'size' } : {}) }];
        const result = await p.callTool('build_chart', { type, source, series });
        checks(result);
        const [trace] = definition(result).data;
        assert.deepEqual(trace.x, [3, 2, 1]);
        assert.deepEqual(trace.text, ['Z'.repeat(100), '', 'A']);
        assert.equal(trace.mode, 'markers+text');
        assert.equal(trace.textposition, 'top center');
        assert.ok(!result.structuredContent.ignoredArgs?.some(arg => arg.includes('labels')));
        const explicit = await p.callTool('build_chart', { type, source, series: [{ ...series[0], text: ['one', 'two', 'three'] }] });
        assert.deepEqual(definition(explicit).data[0].text, ['one', 'two', 'three']);
    }
    for (const size of [30, 31]) {
        const data = parseDataset('label,x,y\n' + Array.from({ length: size }, (_, i) => ['p' + i, i, i + 1].join(',')).join('\n'));
        const chart = resolveChartSource(data, { type: 'scatter', source: { path, x: 'x', labels: 'label' }, series: [{ column: 'y' }] });
        assert.equal(buildChartDefinition(chart).data[0].mode, size === 30 ? 'markers+text' : 'markers');
    }
    assert.match(message(await p.callTool('build_chart', { type: 'scatter', source: { ...source, labels: 'absent' }, series: [{ column: 'y' }] })), /source\.labels.*label/);
});

test('H4 source aliases, dataset-specific repairs, period ordering and early series conflicts', async () => {
    const path = 'series.csv';
    const p = provider({ [path]: 'month,team,amount\n2026-10,Z,172.4\n2026-2,A,107.2\n2026-1,B,101.3' });
    const source = { path, x: 'month', sort: { column: 'month' } };
    const args = { type: 'line', source, series: [{ column: 'amount' }] };
    const result = await p.callTool('build_chart', args);
    checks(result);
    assert.deepEqual(plain(result.structuredContent.normalizedArgs), ['source.x → source.labels']);
    assert.deepEqual(definition(result).data[0].x, ['2026-1', '2026-2', '2026-10']);
    assert.equal(result.structuredContent.facts.series[0].last.display, '172.4');
    assert.match(chartBlock(result), /sort month asc/);
    assert.deepEqual(definition(await p.callTool('build_chart', { ...args, source: { ...source, sort: { column: 'month', order: 'desc' } } })).data[0].x, ['2026-10', '2026-2', '2026-1']);
    assert.match(message(await p.callTool('build_chart', { ...args, source: { path } })), /source\.labels.*month.*"labels":"month"/);
    assert.match(message(await p.callTool('build_chart', { ...args, source: { ...source, sort: { column: 'team' } } })), /source\.sort\.column team.*numeric column.*period column.*"column":"month"/);
    for (const given of [{}, { source: { ...source, path: 'missing.csv' } }]) {
        const conflict = await p.callTool('build_chart', { type: 'indicator', ...given, series: [{ column: 'amount', values: [1] }] });
        assert.match(message(conflict), /series\[0\].*remove values.*remove column/);
    }
});

test('H4 unique basenames use the same canonical vault path for provenance, caption and resource metadata', async () => {
    const path = 'reports/nested/Sales.CSV';
    const data = 'group,value\nA,7\nB,2';
    const p = provider({ [path]: data });
    const result = await p.callTool('build_chart', { type: 'bar', style: 'report', source: { path: 'sales.csv', labels: 'group' }, series: valueSeries });
    checks(result);
    assert.equal(message(result).split('\n')[0], 'Source: ' + path);
    assert.equal(result.structuredContent.source.path, path);
    assert.equal(result._meta['dev.agentinterop/resource'].path, path);
    assert.ok(chartBlock(result).includes('# chart-hands source: ' + path));
    assert.ok(definition(result).layout.annotations[0].text.includes(path));
    assert.ok(result.structuredContent.reportSnippet.split('\n').at(-1).includes(path));
    const eda = await p.callTool('eda_analyze', { path: 'SALES.csv', analysis: { type: 'summary', columns: ['value'] } });
    assert.ok(message(eda).startsWith('CSV ' + path));
    assert.equal(eda.structuredContent.chartArgs.source.path, path);
    const ambiguous = await provider({ [path]: data, 'else/sales.csv': data }).callTool('eda_profile', { path: 'sales.csv' });
    assert.equal(ambiguous.isError, true);
    assert.ok(message(ambiguous).includes(path) && message(ambiguous).includes('else/sales.csv'));
});

test('H8 both precision paths use raw decimals and keep calculated values on the previous rules', () => {
    const values = [172.4, 117.4, 200.30000000000004];
    for (const large of [false, true]) {
        const raw = large ? [...values, ...Array.from({ length: 24 }, (_, i) => i + 300)] : values;
        const args = { type: 'bar', labels: raw.map((_, i) => 'L' + i), series: [{ values: raw }] };
        assert.deepEqual(chartDisplay(args)[0].strings, displayGroup(raw).strings);
        assert.deepEqual(buildChartDefinition(args).data[0].text.slice(0, 3), ['172.4', '117.4', '200.3']);
        assert.equal(chartFacts(args).series[0].min.display, '117.4');
    }
    const tiny = [0.124, 0.201];
    const tinyArgs = { type: 'bar', labels: ['A', 'B'], series: [{ values: tiny }] };
    assert.deepEqual(chartDisplay(tinyArgs)[0].strings, ['0.124', '0.201']);
    assert.deepEqual(chartDisplay({ ...tinyArgs, series: [{ values: [172.4, 117.4] }], calculatedValues: true })[0].strings, ['172', '117']);
    const raw = { ...tinyArgs, series: [{ values: [172.42, 117.4] }] };
    assert.deepEqual(chartDisplay(raw)[0].strings, ['172.42', '117.40']);
    assert.deepEqual(parseStaticChart(JSON.stringify(raw)).data[0].text, ['172.42', '117.40']);
    const calc = { ...raw, series: [{ quantity: 'value', values: [172.42, 117.4] }] };
    assert.deepEqual(parseStaticChart(JSON.stringify(calc)).data[0].text, ['172', '117']);
});

test('H9 horizontal resolved order is shared with static charts for all ordered sources', async () => {
    const path = 'ranks.csv';
    const p = provider({ [path]: 'category,series,a,b\nA,X,3,1\nB,X,7,1\nC,X,5,4' });
    const base = { type: 'barh', source: { path, labels: 'category' }, series: [{ column: 'a' }] };
    for (const [args, labels, values] of [
        [{ ...base, highlight: { top: 1 } }, ['A', 'B', 'C'], [3, 7, 5]],
        [{ ...base, source: { ...base.source, sort: { column: 'a' } } }, ['A', 'C', 'B'], [3, 5, 7]],
        [matrixArgs(path, { type: 'aggregate', columns: ['category', 'a'] }, 'barh'), ['A', 'C', 'B'], [3, 5, 7]],
        [matrixArgs(path, { type: 'aggregate', columns: ['category', 'a'], sort: 'original' }, 'barh'), ['A', 'B', 'C'], [3, 7, 5]],
        [matrixArgs(path, { type: 'compare', columns: ['category', 'a', 'b'] }, 'barh', { series: [{ column: 'difference' }] }), ['C', 'A', 'B'], [1, 2, 6]],
        [matrixArgs(path, { type: 'summary', columns: ['a', 'b'], function: 'sum' }, 'barh'), ['b', 'a'], [6, 15]],
        [matrixArgs(path, { type: 'pivot', columns: ['category', 'series', 'a'] }, 'barh'), ['C', 'B', 'A'], [5, 7, 3]]
    ]) {
        const result = await p.callTool('build_chart', args);
        checks(result);
        for (const chart of [definition(result), parseStaticChart(frozen(result))]) {
            assert.deepEqual(chart.data[0].y, labels);
            assert.deepEqual(chart.data[0].x, values);
        }
    }
    const sameValue = provider({ [path]: 'category,a\nA,7\nB,7\nC,5' });
    const tied = await sameValue.callTool('build_chart', { ...base, source: { ...base.source, sort: { column: 'a' } }, highlight: { top: 1 } });
    checks(tied);
    assert.deepEqual(plain(tied.structuredContent.facts.highlighted), ['A']);
    assert.equal(tied.structuredContent.facts.highlight, 'top');
    assert.deepEqual(JSON.parse(frozen(tied)).highlight, { labels: ['A'] });
    const trace = definition(tied).data[0];
    assert.equal(trace.marker.color[0], trace.marker.color[1]);
    assert.notEqual(trace.marker.color[1], trace.marker.color[2]);
});
