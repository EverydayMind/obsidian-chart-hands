import test from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { buildChartDefinition, validateBuildArgs } from '../src/chart-builder.js';
import { parseStaticChart } from '../src/static-chart.js';
import { parseDataset, resolveChartSource } from '../src/eda.js';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const { chartBlock } = require('./helpers/chart-block');
const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {}, moment: { locale: () => 'ko' }, parseYaml, stringifyYaml };
    return load.call(this, request, ...rest);
};
const bundle = new Module(require.resolve('./helpers/build-plugin.js'));
bundle.filename = require.resolve('./helpers/build-plugin.js');
bundle.paths = Module._nodeModulePaths(process.cwd());
bundle._compile(require('./helpers/build-plugin.js')(), bundle.filename);
const { createAgentProvider } = bundle.exports;
Module._load = load;
const provider = (contents, locale = 'en') => createAgentProvider({ app: { vault: { getAbstractFileByPath: path => ({ path, extension: path.endsWith('.md') ? 'md' : 'csv' }), cachedRead: async () => contents } }, manifest: { id: 'chart-hands', name: 'Chart Hands', version: '0.9.3' } }, locale, { now: () => new Date(2026, 10, 23) });
const resultText = result => result.content.map(part => part.text).join('\n');
const blockData = result => parseYaml(chartBlock(result).replace(/^```plotly\n|\n```$/g, ''));

const base = { type: 'bar', labels: ['A', 'B', 'C'], series: [{ values: [2, 2, null] }] };
test('strict arguments, stacking and legacy static compatibility', () => {
    assert.throws(() => buildChartDefinition({ ...base, series: [{ values: [1, 2, 3], x: [1, 2, 3] }] }));
    assert.deepEqual(validateBuildArgs({ ...base, y2_title: 'unused', range_slider: false }), ['y2_title']);
    assert.throws(() => buildChartDefinition({ ...base, stacked: true }));
    assert.doesNotThrow(() => buildChartDefinition({ ...base, stacked: true, series: [...base.series, ...base.series] }));
    assert.doesNotThrow(() => buildChartDefinition({ ...base, type: 'area', stacked: true }));
    const old = { ...base, series: [{ ...base.series[0], x: [1, 2, 3] }] };
    assert.doesNotThrow(() => parseStaticChart(JSON.stringify(old)));
    assert.throws(() => parseStaticChart(JSON.stringify({ ...old, caption: 'new' })));
});
test('target, highlighting, styles and units', () => {
    const result = buildChartDefinition({ ...base, style: 'plain', target: { value: 2 }, highlight: { above_target: true }, unit: '%' });
    assert.equal(result.layout.shapes[0].y0, 2);
    assert.equal(result.data[0].marker.color[0], result.data[0].marker.color[1]);
    assert.notEqual(result.data[0].marker.color[1], result.data[0].marker.color[2]);
    assert.throws(() => buildChartDefinition({ ...base, highlight: {} }));
    assert.throws(() => buildChartDefinition({ ...base, highlight: { top: 0 } }));
    assert.throws(() => buildChartDefinition({ ...base, highlight: { labels: ['missing'] } }));
    assert.equal(buildChartDefinition({ ...base, type: 'barh', target: { value: 2 } }).layout.shapes[0].xref, 'x');
    assert.equal(buildChartDefinition({ ...base, style: 'slides', title: 'Title' }).layout.title.font.size, 26);
    assert.equal(buildChartDefinition({ ...base, style: 'print' }).layout.paper_bgcolor, '#FFFFFF');
    assert.deepEqual(buildChartDefinition({ ...base, unit: '%' }).data[0].text, ['2%', '2%', null]);
    assert.equal(buildChartDefinition({ type: 'indicator', series: [{ values: [3] }], unit: '₩' }).data[0].number.prefix, '₩');
    const literal = parseStaticChart(JSON.stringify({ ...base, labels: ['R&D', 'B', 'C'], highlight: { labels: ['R&D'] } }));
    assert.equal(literal.data[0].x[0], 'R&amp;D');
});
test('source units and YAML comments', () => {
    const dataset = parseDataset('name,value\nA,2억원\nB,3억원', 'data.csv');
    const args = resolveChartSource(dataset, { type: 'bar', style: 'report', source: { path: 'data.csv', labels: 'name' }, series: [{ column: 'value' }] }, 'en');
    assert.equal(args.unit, '억원');
    // English axis titles separate the unit (0.11.3); Korean keeps 값(억원).
    assert.equal(args.y_title, 'value (억원)');
    assert.equal(resolveChartSource(dataset, { type: 'bar', style: 'report', source: { path: 'data.csv', labels: 'name' }, series: [{ column: 'value' }] }, 'ko').y_title, 'value(억원)');
    assert.match(args.caption, /^Source:/);
    const definition = buildChartDefinition(args);
    assert.deepEqual(parseYaml(`# chart-hands source: data.csv · built 2026-11-23\n${stringifyYaml(definition)}`), definition);
});

test('print palette and currency target annotation', () => {
    const gray = ['#111827', '#4B5563', '#9CA3AF', '#D1D5DB', '#6B7280'];
    const line = buildChartDefinition({ ...base, type: 'line', style: 'print', series: [base.series[0], base.series[0]] });
    for (const trace of line.data) { assert.ok(gray.includes(trace.line.color)); assert.ok(gray.includes(trace.marker.color)); }
    const pie = buildChartDefinition({ ...base, type: 'pie', style: 'print' });
    assert.ok(pie.data[0].marker.colors.every(color => gray.includes(color)));
    const waterfall = buildChartDefinition({ ...base, type: 'waterfall', style: 'print' }).data[0];
    for (const key of ['increasing', 'decreasing', 'totals']) assert.ok(gray.includes(waterfall[key].marker.color));
    assert.deepEqual(buildChartDefinition({ ...base, type: 'heatmap', style: 'print' }).data[0].colorscale, [[0, '#F9FAFB'], [1, '#111827']]);
    assert.equal(buildChartDefinition({ ...base, unit: '₩', target: { value: 5 } }).layout.annotations[0].text, '목표 ₩5');
});

test('target and highlight boundaries, stacking and legacy blocks', () => {
    const secondary = { ...base, type: 'line', series: [base.series[0], { ...base.series[0], secondary: true }] };
    assert.throws(() => buildChartDefinition({ ...secondary, target: { value: 2 } }));
    assert.throws(() => buildChartDefinition({ ...secondary, target: { value: 2, series: 2 } }));
    assert.equal(buildChartDefinition({ ...secondary, target: { value: 2, series: 1 } }).layout.shapes[0].yref, 'y2');
    for (const highlight of [{ top: 1, bottom: 1 }, { below_target: false }, { top: 51 }, { below_target: true }]) assert.throws(() => buildChartDefinition({ ...base, highlight }));
    assert.throws(() => buildChartDefinition({ ...base, series: [base.series[0], base.series[0]], highlight: { top: 1 } }), /여러 계열이면 highlight\.labels로 범주를 지정하세요\./);
    assert.throws(() => buildChartDefinition({ ...base, series: [base.series[0], base.series[0]], highlight: { top: 1 } }, { locale: 'en' }), /With several series, use highlight\.labels to pick categories\./);
    // G2/G3 (0.11.2): two rank selectors name what was received; a non-bar type is told to change type.
    assert.throws(() => buildChartDefinition({ ...base, highlight: { top: 3, bottom: 3 } }), /highlight에는 선택자를 하나만 주세요\(받은 것: top, bottom\)/);
    assert.throws(() => buildChartDefinition({ ...base, highlight: { top: 3, bottom: 3 } }, { locale: 'en' }), /Give highlight only one selector \(received: top, bottom\)/);
    assert.throws(() => buildChartDefinition({ ...base, type: 'line', highlight: { bottom: 1 } }), /지금 type: line\)\. type을 bar나 barh로 바꾸거나 highlight를 빼세요\./);
    assert.throws(() => buildChartDefinition({ ...base, type: 'line', highlight: { labels: ['A'] } }, { locale: 'en' }), /type is line\); change type to bar or barh, or omit highlight\./);
    // G1 (0.11.2): with several bar series each series keeps its own colour on the chosen categories.
    const kept = buildChartDefinition({ ...base, style: 'report', series: [base.series[0], { values: [5, 6, 7] }], highlight: { labels: ['B'] } });
    assert.notEqual(kept.data[0].marker.color[1], kept.data[1].marker.color[1]);
    assert.notEqual(kept.data[0].marker.color[0], kept.data[1].marker.color[0]);
    assert.equal(buildChartDefinition({ ...base, style: 'report', highlight: { labels: ['B'] } }).data[0].marker.color[0], '#CBD5E1');
    for (const style of ['plain', 'print']) {
        const multi = buildChartDefinition({ ...base, style, series: [base.series[0], { values: [5, 6, 7] }], highlight: { labels: ['B'] } });
        assert.notEqual(multi.data[0].marker.color[1], multi.data[1].marker.color[1]);
        assert.notEqual(multi.data[0].marker.color[0], multi.data[0].marker.color[1]);
        if (style === 'print') assert.ok(multi.data.every(trace => trace.marker.pattern));
    }
    const twoBars = buildChartDefinition({ ...base, type: 'combo', series: [{ values: [1, 2, 3], kind: 'bar' }, { values: [4, 5, 6], kind: 'bar' }, { values: [7, 8, 9], kind: 'line' }], highlight: { labels: ['A'] } });
    assert.notEqual(twoBars.data[0].marker.color[0], twoBars.data[1].marker.color[0]);
    assert.throws(() => buildChartDefinition({ ...base, type: 'combo', series: [{ values: [1, 2, 3], kind: 'line' }, { values: [4, 5, 6], kind: 'line' }], highlight: { labels: ['A'] } }), /지금 type: combo\)/);
    // F10: highlight.labels allowed on multi-series bar, barh, combo and static-chart
    for (const type of ['bar', 'barh']) {
        const multi = buildChartDefinition({ ...base, type, series: [base.series[0], { values: [5, 6, 7] }], highlight: { labels: ['B'] } });
        assert.equal(multi.data.length, 2);
        for (const trace of multi.data) {
            assert.notEqual(trace.marker.color[1], trace.marker.color[0]);
            assert.equal(trace.marker.color[0], trace.marker.color[2]);
        }
    }
    const comboMulti = buildChartDefinition({ ...base, type: 'combo', series: [{ values: [1, 2, 3], kind: 'bar' }, { values: [4, 5, 6], kind: 'bar' }, { values: [7, 8, 9], kind: 'line' }], highlight: { labels: ['A'] } });
    assert.notEqual(comboMulti.data[0].marker.color[0], comboMulti.data[0].marker.color[1]);
    assert.notEqual(comboMulti.data[1].marker.color[0], comboMulti.data[1].marker.color[1]);
    assert.equal(typeof comboMulti.data[2].marker.color, 'string');
    const staticMulti = parseStaticChart(JSON.stringify({ ...base, series: [base.series[0], { values: [5, 6, 7] }], highlight: { labels: ['B'] } }));
    assert.notEqual(staticMulti.data[0].marker.color[1], staticMulti.data[0].marker.color[0]);
    assert.notEqual(staticMulti.data[1].marker.color[1], staticMulti.data[1].marker.color[0]);
    for (const key of ['top', 'bottom']) {
        const colors = buildChartDefinition({ ...base, highlight: { [key]: 1 } }).data[0].marker.color;
        assert.notEqual(colors[0], colors[1]); assert.equal(colors[1], colors[2]);
    }
    const colors = buildChartDefinition({ ...base, target: { value: 2 }, highlight: { above_target: true } }).data[0].marker.color;
    assert.equal(colors[0], colors[1]); assert.notEqual(colors[1], colors[2]);
    assert.throws(() => buildChartDefinition({ ...base, type: 'combo', series: [base.series[0], { ...base.series[0], kind: 'line' }], target: { value: 2, series: 1 }, highlight: { above_target: true } }));
    assert.doesNotThrow(() => buildChartDefinition({ ...base, type: 'combo', stacked: true, series: [base.series[0], { ...base.series[0], kind: 'area' }] }));
    assert.throws(() => buildChartDefinition({ ...base, type: 'histogram', stacked: true }));
    assert.throws(() => buildChartDefinition({ ...base, stacked: true }));
    assert.equal(parseStaticChart(JSON.stringify({ ...base, type: 'barh', stacked: true, series: [base.series[0], base.series[0]] })).data.length, 2);
    assert.equal(parseStaticChart(JSON.stringify({ ...base, series: [{ ...base.series[0], x: [1, 2, 3] }] })).data[0].type, 'bar');
    const plain = buildChartDefinition({ ...base, style: 'plain', caption: 'caption', target: { value: 2 }, highlight: { top: 1 } });
    assert.ok(plain.layout.shapes.length && plain.data[0].marker.color && plain.layout.annotations.some(a => a.text === 'caption'));
    assert.equal(plain.data[0].texttemplate, undefined);
});

test('source unit and automatic text limits', () => {
    const dataset = parseDataset('name,value,other\nA,2억원,3%\nB,3억원,4%', 'data.csv');
    const source = { path: 'data.csv', labels: 'name' };
    assert.throws(() => resolveChartSource(dataset, { type: 'bar', source, series: [{ column: 'value' }, { column: 'other' }] }));
    assert.throws(() => resolveChartSource(dataset, { type: 'bar', source, series: [{ column: 'value' }], unit: '%' }));
    const args = resolveChartSource(dataset, { type: 'bar', source, series: [{ column: 'value' }] });
    assert.match(buildChartDefinition(args).data[0].text[0], /억원$/);
    assert.match(buildChartDefinition({ ...base, type: 'funnel', unit: '억원' }).data[0].texttemplate, /%\{percentInitial\}/);
    for (const style of ['report', 'print', 'slides', 'clean']) {
        const resolved = resolveChartSource(dataset, { type: 'bar', style, source, series: [{ column: 'value' }] });
        assert.equal(Boolean(resolved.caption), style !== 'clean');
    }
    const name = '가'.repeat(99), longDataset = parseDataset(`name,${name}\nA,1억원`, 'data.csv');
    const longArgs = resolveChartSource(longDataset, { type: 'bar', style: 'report', source: { path: `${'가'.repeat(220)}.csv`, labels: 'name' }, series: [{ column: name }] });
    assert.equal(longArgs.caption.length, 200); assert.ok(longArgs.caption.endsWith('…'));
    assert.equal(longArgs.y_title.length, 100); assert.ok(longArgs.y_title.endsWith('…'));
});

test('handler resolves source highlights and emits provenance and real YAML', async () => {
    const p = provider('name,value\nA,1\nB,2\nC,3');
    const args = { type: 'bar', source: { path: 'data.csv', labels: 'name', filter: [{ column: 'value', op: 'gte', value: '2' }], sort: { column: 'value', order: 'asc' }, limit: 2 }, series: [{ column: 'value' }], highlight: { labels: ['B'] } };
    const result = await p.callTool('build_chart', args);
    assert.equal(result.structuredContent.valid, true, resultText(result));
    assert.equal(chartBlock(result).split('\n')[1], '# chart-hands source: data.csv · rows 2 of 3 · filter value gte 2 · sort value asc · limit 2 · built 2026-11-23');
    const parsed = blockData(result), expected = buildChartDefinition(resolveChartSource(parseDataset('name,value\nA,1\nB,2\nC,3', 'data.csv'), args, 'en'), { locale: 'en' });
    assert.deepEqual(parsed.data, expected.data); assert.deepEqual(parsed.layout, expected.layout);
    const bad = await p.callTool('build_chart', { ...args, highlight: { labels: ['missing'] } });
    assert.match(resultText(bad), /B, C/);
    const md = provider('| name | value |\n|---|---|\n| A | 1 |\n\n| name | value |\n|---|---|\n| B | 2 |');
    const table = await md.callTool('build_chart', { type: 'bar', source: { path: 'note.md', table: 2, labels: 'name' }, series: [{ column: 'value' }] });
    assert.match(chartBlock(table).split('\n')[1], /note\.md table 2 · rows 1 of 1 · built 2026-11-23/);
    const longPath = `${'x'.repeat(310)}.csv`;
    const long = await p.callTool('build_chart', { type: 'bar', source: { path: longPath, labels: 'name' }, series: [{ column: 'value' }] });
    const provenance = chartBlock(long).split('\n')[1];
    assert.equal(provenance, `${(`# chart-hands source: ${longPath} · rows 3 of 3 · built 2026-11-23`).slice(0, 299)}…`);
    const control = await p.callTool('build_chart', { type: 'bar', source: { path: 'a\u0085.csv', labels: 'name' }, series: [{ column: 'value' }] });
    assert.match(chartBlock(control).split('\n')[1], /a \.csv/);
    // F6: empty filter array omitted from provenance and automatic caption
    const emptyFilter = await p.callTool('build_chart', { type: 'bar', style: 'report', source: { path: 'data.csv', labels: 'name', filter: [] }, series: [{ column: 'value' }] });
    assert.doesNotMatch(chartBlock(emptyFilter).split('\n')[1], /filter/);
    assert.doesNotMatch(blockData(emptyFilter).layout.annotations[0].text, /filter|조건/);
    const emptyAnalysisFilter = await p.callTool('build_chart', { type: 'bar', style: 'report', source: { path: 'data.csv', analysis: { type: 'aggregate', columns: ['name', 'value'], filter: [] } }, series: [{ column: 'value' }] });
    assert.doesNotMatch(chartBlock(emptyAnalysisFilter).split('\n')[1], /filter/);
    assert.doesNotMatch(blockData(emptyAnalysisFilter).layout.annotations[0].text, /filter|조건/);
});

test('handler reports omitted static blocks and ignored arguments', async () => {
    const csv = `name,value\n${Array.from({ length: 75 }, (_, i) => `${'a'.repeat(25)}${i},${i}`).join('\n')}`;
    const p = provider(csv);
    for (const locale of ['en', 'ko']) {
        const handler = locale === 'en' ? p : provider(csv, locale);
        const source = await handler.callTool('build_chart', { type: 'bar', source: { path: 'data.csv', labels: 'name' }, series: [{ column: 'value' }] });
        assert.equal(source.structuredContent.staticBlockMissing, 'too_long'); assert.match(resultText(source), /source\.limit/);
        const direct = await handler.callTool('build_chart', { type: 'bar', labels: Array.from({ length: 75 }, (_, i) => `${'a'.repeat(23)}${String(i).padStart(2, '0')}`), series: [{ values: Array(75).fill(1) }] });
        assert.equal(direct.structuredContent.staticBlockMissing, 'too_long'); assert.match(resultText(direct), locale === 'ko' ? /labels·series 값 개수/ : /number of labels and series values/);
        const unsupported = await handler.callTool('build_chart', { ...base, title: 'x'.repeat(201) });
        assert.equal(unsupported.structuredContent.staticBlockMissing, 'unsupported');
    }
    for (const [args, ignored] of [[{ ...base, type: 'pie', x_title: 'x' }, 'x_title'], [{ type: 'scatter', labels: ['x'], series: [{ x: [1], values: [2] }] }, 'labels'], [{ ...base, y2_title: 'right' }, 'y2_title']]) {
        const result = await p.callTool('build_chart', args);
        assert.ok(result.structuredContent.ignoredArgs.includes(ignored)); assert.match(resultText(result), new RegExp(`Ignored unused arguments:.*${ignored}`));
    }
});
