import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDataset, resolveChartSource } from '../src/eda.js';
import { buildChartDefinition } from '../src/chart-builder.js';
import { parseStaticChart } from '../src/static-chart.js';
import { createRequire } from 'node:module';
import Module from 'node:module';

const data = parseDataset('부서,실적,목표,연도\nA,95억원,100억원,2025\nA,100억원,100억원,2026\nB,50억원,100억원,2025\nB,60억원,100억원,2026');
const aggregate = { type: 'aggregate', columns: ['부서', '실적'] };
const period = { type: 'compare', columns: ['부서', '실적'], period: { column: '연도', base: '2025', target: '2026' } };
const reference = { type: 'compare', columns: ['부서', '실적', '목표'], filter: [{ column: '연도', op: 'eq', value: '2025' }] };
const resolve = (analysis, type = 'bar', series = [{ column: 'value' }], extra = {}) => resolveChartSource(data, { type, source: { path: 'data.csv', analysis }, series, ...extra }, 'en');

test('aggregate fields, units, shares and invalid fields', () => {
    assert.deepEqual(resolve(aggregate).series[0].values, [195, 110]);
    const share = resolve(aggregate, 'donut', [{ column: 'share' }]);
    assert.equal(share.unit, '%'); assert.equal(share.series[0].quantity, 'share');
    assert.equal(share.series[0].values[0], 195 / 305 * 100);
    assert.throws(() => resolve({ ...aggregate, function: 'mean' }, 'bar', [{ column: 'share' }]), /value/);
    assert.equal(resolve({ ...aggregate, function: 'count' }).unit, undefined);
    const count = resolve({ type: 'aggregate', columns: ['부서'], function: 'count' });
    assert.equal(count.series[0].name, 'Count');
    assert.equal(count.y_title, 'Count');
    assert.throws(() => resolve(aggregate, 'scatter'), /chart type/);
    assert.throws(() => resolve(aggregate, 'bar', [{ column: 'other' }]), /value, share/);
});

test('compare coordinates, axes, waterfall constraints and duplicate labels', () => {
    const combo = resolve(period, 'combo', [{ column: 'base' }, { column: 'target' }]);
    assert.deepEqual(combo.series[0].values, [50, 95]);
    assert.deepEqual(resolve(period, 'barh', [{ column: 'difference' }]).series[0].values, [10, 5]);
    assert.equal(resolve(reference, 'bar', [{ column: 'ratio' }]).series[0].values[0], 95);
    const withTarget = resolve(reference, 'bar', [{ column: 'ratio' }], { target: { value: 95 } });
    assert.equal(buildChartDefinition(withTarget).layout.shapes[0].y0, withTarget.series[0].values[0]);
    assert.throws(() => resolve(reference, 'bar', [{ column: 'value' }, { column: 'ratio' }]), /different units/);
    assert.doesNotThrow(() => resolve(reference, 'bar', [{ column: 'value' }, { column: 'ratio', secondary: true }]));
    assert.doesNotThrow(() => resolve(period, 'waterfall', [{ column: 'difference' }]));
    for (const [spec, field, extra] of [[{ ...period, function: 'mean' }, 'difference', {}], [{ ...period, limit: 1 }, 'difference', {}], [period, 'rate', {}], [period, 'difference', { measure: ['relative', 'relative'] }], [reference, 'difference', {}]]) assert.throws(() => resolve(spec, 'waterfall', [{ column: field }], extra), /waterfall/);
    assert.throws(() => resolveChartSource(data, { type: 'donut', source: { path: 'x', labels: '부서' }, series: [{ column: '실적' }] }, 'en'), /Duplicate/);
    assert.throws(() => buildChartDefinition({ type: 'pie', labels: ['A', 'A'], series: [{ values: [1, 2] }] }, { locale: 'en' }), /Duplicate/);
    assert.doesNotThrow(() => buildChartDefinition({ type: 'scatter', labels: ['A', 'A'], series: [{ x: [1, 2], values: [1, 2] }] }, { locale: 'en' }));
    const long = parseDataset(`g,v\n${'a'.repeat(100)}x,1\n${'a'.repeat(100)}y,2`);
    assert.throws(() => resolveChartSource(long, { type: 'bar', source: { path: 'x', analysis: { type: 'aggregate', columns: ['g', 'v'] } }, series: [{ column: 'value' }] }, 'en'), /Duplicate/);
});

test('source conflicts, empty groups, percent differences and static quantities', () => {
    for (const key of ['labels', 'sort', 'limit', 'filter']) assert.throws(() => resolveChartSource(data, { type: 'bar', source: { path: 'x', analysis: aggregate, [key]: 'x' }, series: [{ column: 'value' }] }, 'en'), /inside analysis/);
    assert.throws(() => resolve({ ...aggregate, filter: [{ column: '부서', op: 'eq', value: 'missing' }] }), /no groups/);
    const pct = parseDataset('g,v,p\nA,10%,2025\nA,20%,2026');
    const args = { type: 'barh', source: { path: 'x', analysis: { type: 'compare', columns: ['g', 'v'], period: { column: 'p', base: '2025', target: '2026' } } }, series: [{ column: 'difference' }] };
    assert.equal(resolveChartSource(pct, args, 'en').unit, '%p');
    assert.throws(() => resolveChartSource(pct, { ...args, type: 'waterfall' }, 'en'), /waterfall/);
    const s = resolve(aggregate); assert.doesNotThrow(() => parseStaticChart(JSON.stringify(s)));
    s.series[0].quantity = 'wrong'; assert.throws(() => parseStaticChart(JSON.stringify(s)));
});

test('handler reports analysis provenance and renders a Markdown table static block', async () => {
    const require = createRequire(import.meta.url), load = Module._load;
    const { chartBlock } = require('./helpers/chart-block');
    const yaml = require('yaml');
    Module._load = function (request, ...rest) {
        if (request === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {}, moment: { locale: () => 'en' }, parseYaml: yaml.parse, stringifyYaml: yaml.stringify };
        return load.call(this, request, ...rest);
    };
    const bundle = new Module(require.resolve('./helpers/build-plugin.js'));
    bundle.filename = require.resolve('./helpers/build-plugin.js'); bundle.paths = Module._nodeModulePaths(process.cwd());
    bundle._compile(require('./helpers/build-plugin.js')(), bundle.filename); Module._load = load;
    const p = bundle.exports.createAgentProvider({ manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' }, app: { vault: {
        getAbstractFileByPath: path => ({ path, extension: 'md' }), cachedRead: async () => '| group | value |\n|---|---|\n| A | 95 |\n| B | 5 |'
    } } }, 'en', { now: () => new Date(2026, 10, 23) });
    const result = await p.callTool('build_chart', { type: 'donut', source: { path: 'data.md', analysis: { type: 'aggregate', columns: ['group', 'value'] } }, series: [{ column: 'share' }] });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent.source.analysis, { type: 'aggregate', columns: ['group', 'value'], function: 'sum' });
    assert.equal(result.structuredContent.source.groupCount, 2);
    assert.match(chartBlock(result), /analysis aggregate group value sum/);
    const frozen = JSON.parse(result.structuredContent.staticBlock.replace(/^```chart-hands-static\n|\n```$/g, ''));
    assert.equal(frozen.series[0].quantity, 'share');
    assert.deepEqual(parseStaticChart(JSON.stringify(frozen)).data[0].values, [95, 5]);
});
