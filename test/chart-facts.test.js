import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { formatNumber, displayGroup, chartDisplay, chartFacts, titleDraft, factLines, isPeriodHeader } from '../src/chart-facts.js';
import { buildChartDefinition } from '../src/chart-builder.js';
import { parseStaticChart } from '../src/static-chart.js';

const require = createRequire(import.meta.url);
const { chartBlock } = require('./helpers/chart-block');
const { loadHarness } = require('./helpers/locale-harness');
const code = require('./helpers/build-plugin')();
const { DATA_RESULT_CHARS } = loadHarness(code, 'ko').exports;
const plain = value => JSON.parse(JSON.stringify(value));
const mergedLength = ({ content, structuredContent }) => [...content.map(item => item.text), JSON.stringify(structuredContent)].join('\n').length;
const trace = result => JSON.parse(chartBlock(result).split('\n').slice(1, -1).filter(line => !line.startsWith('#')).join('\n')).data[0];
const provider = (csv = '', locale = 'ko') => loadHarness(code, locale).exports.createAgentProvider({
    manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' },
    app: { vault: { getAbstractFileByPath: path => ({ path, extension: 'csv' }), cachedRead: async () => csv } }
}, locale, { now: () => new Date(2026, 10, 23) });
const bar = (labels, values, extra = {}) => ({ type: 'bar', labels, series: [{ values }], ...extra });
const raw = (labels, extra = {}) => ({ type: 'bar', source: { path: 'data.csv', labels, ...extra }, series: [{ column: 'value' }] });
const analysisChart = (analysis, column = 'value') => ({ type: 'bar', source: { path: 'data.csv', analysis }, series: [{ column }] });
const aggregate = { type: 'aggregate', columns: ['group', 'value'] };
const period = { type: 'compare', columns: ['group', 'value'], period: { column: 'year', base: '2025', target: '2026' } };

test('formatNumber rounds half away from zero and groups digits', () => {
    assert.equal(formatNumber(2.135, 2), '2.14');
    assert.equal(formatNumber(1.125, 2), '1.13');
    assert.equal(formatNumber(-1.125, 2), '−1.13');
    assert.equal(formatNumber(-0.04, 1), '0.0');
    assert.equal(formatNumber(1234567, 0), '1,234,567');
});

test('displayGroup resolves collisions independent of chart order', () => {
    const target = displayGroup([89.96], { unit: '%', target: 90 });
    assert.equal(target.strings[0], '89.96%');
    assert.equal(target.targetString, '90.00%');
    const group = displayGroup([99.96, 150, 100.04]);
    assert.notEqual(group.strings[0], group.strings[2]);
    assert.deepEqual(displayGroup([100.00001, 100.00002]).strings, ['100.00001', '100.00002']);
});

test('displayGroup chooses shared precision by maximum magnitude', () => {
    for (const [values, decimals, strings] of [
        [[100, 12.34], 0, ['100', '12']],
        [[1, 0.42], 1, ['1.0', '0.4']],
        [[0.125, 0.42], 3, ['0.125', '0.420']],
        [[1, 2], 0, ['1', '2']]
    ]) {
        assert.deepEqual(displayGroup(values), { decimals, strings });
    }
});

test('large grouped displays use three decimals when every value has magnitude below one', () => {
    const values = Array.from({ length: 25 }, (_, i) => (i + 1) / 100);
    const [{ strings }] = chartDisplay({ type: 'bar', series: [{ values }] });
    assert.equal(strings.length, 25);
    assert.equal(strings[0], '0.010');
    assert.equal(strings[24], '0.250');
    assert.ok(strings.every(s => /^0\.\d{3}$/.test(s)));
});

test('source and compare scope distinguish displayed, valid and whole populations', async () => {
    const csv = 'group,value,subset\n' + Array.from({ length: 30 }, (_, i) => `A${i},${i === 3 ? '' : i},${i < 25 ? 'yes' : 'no'}`).join('\n');
    const result = await provider(csv).callTool('build_chart', raw('group', { limit: 10, filter: [{ column: 'subset', op: 'eq', value: 'yes' }] }));
    assert.deepEqual(plain(result.structuredContent.facts.series[0].scope), { shown: 10, valid: 9, beforeLimit: 25 });
    const pairs = 'group,value,year\n' + Array.from({ length: 12 }, (_, i) => `A${i},1,2025\nA${i},2,2026`).join('\n');
    const compared = await provider(pairs).callTool('build_chart', analysisChart({ ...period, limit: 10 }, 'difference'));
    const facts = plain(compared.structuredContent.facts);
    assert.deepEqual(facts.series[0].scope, { shown: 10, valid: 10, beforeLimit: 12, common: 12 });
    assert.equal(facts.compare.overall.scope, 'common');
    assert.equal(facts.compare.overall.difference, 12);
    assert.match(compared.structuredContent.titleDraft, /양 기간 공통 12항목/);
});

test('scatter, bubble and heatmap count only valid pairs, triples and cells', () => {
    const series = [{ x: [1, null, 4, 8], values: [3, 4, null, 9], size: [null, 2, 4, 5] }];
    const scatter = chartFacts({ type: 'scatter', series });
    assert.deepEqual(scatter.scope, { shown: 4, valid: 2 });
    assert.deepEqual(scatter.series[0].x, { min: 1, max: 8, display: { min: '1', max: '8' } });
    const bubble = chartFacts({ type: 'bubble', series });
    assert.deepEqual(bubble.scope, { shown: 4, valid: 1 });
    assert.equal(bubble.series[0].y.max, 9);
    const heatmap = { type: 'heatmap', labels: ['A', 'B'], series: [{ name: 'First', values: [1, null] }, { name: 'Second', values: [1, -2] }] };
    const heat = chartFacts(heatmap);
    assert.deepEqual(heat.scope, { shown: 2, cells: 4, valid: 3 });
    assert.deepEqual(heat.max, { row: 'First', label: 'A', value: 1, display: '1' });
    assert.equal(heat.min.row, 'Second');
    assert.deepEqual(buildChartDefinition(heatmap).data[0].text, [['1', null], ['1', '−2']]);
    const big = { type: 'heatmap', labels: Array.from({ length: 151 }, (_, i) => `A${i}`), series: [{ values: Array(151).fill(1) }] };
    assert.equal(buildChartDefinition(big).data[0].text, undefined);
});

test('period facts require chronological keys and count interior and trailing nulls', async () => {
    assert.equal(isPeriodHeader('기준 연월 '), true);
    assert.equal(isPeriodHeader('연도별집행액'), false);
    const cases = [
        ['연월', ['2026-01', '2026-02', '2026-03'], [10, 20, 30], true],
        ['연월', ['2026-03', '2026-02', '2026-01'], [30, 20, 10], false],
        ['사업코드', ['2024', '2025', '2026'], [10, 20, 30], false],
        ['연월', ['202601', '202602', '202603', '202604'], [10, null, 30, null], true],
        ['label', ['202601', '202602', '202603'], [10, 20, 30], false]
    ];
    for (const [header, labels, values, ordered] of cases) {
        const csv = `${header},value\n${labels.map((label, i) => `${label},${values[i] ?? ''}`).join('\n')}`;
        const built = await provider(csv).callTool('build_chart', raw(header));
        const facts = plain(built.structuredContent.facts.series[0]);
        assert.equal(Boolean(facts.change), ordered, header);
        if (values.includes(null) && ordered) {
            assert.deepEqual(facts.last, { label: '202603', value: 30, display: '30' });
            assert.deepEqual(facts.change, { from: '202601', to: '202603', value: 20, display: '+20', skippedNulls: 2, skippedNullsDisplay: '2' });
        }
    }
    const sorted = await provider('month,value\n2026-01,1\n2026-02,2').callTool('build_chart', raw('month', { sort: { column: 'value', order: 'asc' } }));
    assert.equal(sorted.structuredContent.facts.series[0].change, undefined);
});

test('shown totals require an additive value unit and raw or sum/count aggregation', async () => {
    for (const [unit, expected] of [['억원', 3], ['명', undefined], ['%', undefined], ['', undefined]]) {
        const result = await provider(`group,value\nA,1${unit}\nB,2${unit}`).callTool('build_chart', raw('group'));
        assert.equal(result.structuredContent.facts.series[0].sumOfShown, expected);
    }
    const p = provider('group,value,year\nA,1억원,2025\nA,2억원,2026\nB,5억원,2026');
    for (const [analysis, column, expected] of [[aggregate, 'value', 8], [{ ...aggregate, function: 'mean' }, 'value', undefined], [period, 'difference', undefined]]) {
        const result = await p.callTool('build_chart', analysisChart(analysis, column));
        assert.equal(result.structuredContent.facts.series[0].sumOfShown, expected);
    }
    assert.equal(chartFacts(bar(['A', 'B'], [1, 2], { unit: '억원' })).series[0].sumOfShown, undefined);
});

test('facts titles prioritize the target series, comparisons, actual highlights and maximum', async () => {
    const p = provider('연월,집행액,집행률\n2026-01,80억원,91%\n2026-02,80억원,92%');
    const built = await p.callTool('build_chart', { type: 'combo', source: { path: 'data.csv', labels: '연월' }, series: [{ column: '집행액' }, { column: '집행률', secondary: true }], target: { value: 95, series: 1 } });
    const { titleDraft: title, factLines: lines, facts } = built.structuredContent;
    assert.match(title, /92%.*95%.*−3%p/);
    assert.match(lines[0], /92%.*−3%p/);
    assert.deepEqual(plain(facts.series[1].target.lastGap), { value: -3, display: '−3%p' });
    assert.doesNotMatch(title, /80억원/);
    const ref = await provider('부서,value,reference\nA,120,100').callTool('build_chart', analysisChart({ type: 'compare', columns: ['부서', 'value', 'reference'] }, 'ratio'));
    assert.match(ref.structuredContent.titleDraft, /기준 대비 120\.0%.*공통 1곳/);
    assert.doesNotMatch(ref.structuredContent.titleDraft, /달성/);
    const highlighted = chartFacts(bar(['A', 'B', 'C', 'D'], [4, 1, 2, 3], { highlight: { bottom: 3 } }), { labelColumn: '지역' });
    assert.deepEqual(highlighted.highlighted, ['B', 'C', 'D']);
    assert.match(titleDraft(highlighted), /B, C, D 하위 3곳.*실제 강조 3곳/);
    assert.match(titleDraft(chartFacts(bar(['A', 'B'], [4, 4]))), /A 4로 가장 큼.*2항목/);
    assert.match(titleDraft(chartFacts(bar(['서울', '부산'], [120, 80], { unit: '억원' }))), /서울 120억원으로 가장 큼/);
    assert.match(titleDraft(chartFacts(bar(['서울', '부산'], [84, 70], { unit: '%' }))), /서울 84%로 가장 큼/);
    assert.match(titleDraft(chartFacts(bar(['A', 'B'], [3, 1]))), /A 3으로 가장 큼/);
    assert.match(titleDraft(chartFacts(bar(['A', 'B'], [7, 2]))), /A 7로 가장 큼/);
});

test('title_from applies only an available draft and freezes the normalized title', async () => {
    const p = provider();
    const args = bar(['A', 'B'], [1, 2]);
    const built = await p.callTool('build_chart', { ...args, title_from: 'facts' });
    const { staticBlock, titleDraft: draft } = built.structuredContent;
    const frozen = JSON.parse(staticBlock.split('\n')[1]);
    assert.equal(frozen.title, draft);
    assert.equal(Object.hasOwn(frozen, 'title_from'), false);
    assert.deepEqual(frozen.series, args.series);
    assert.equal(parseStaticChart(JSON.stringify(frozen)).layout.title.text, draft);
    assert.equal((await p.callTool('build_chart', { ...args, title: 'Manual', title_from: 'facts' })).structuredContent.code, 'INVALID_ARGUMENT');
    const empty = await p.callTool('build_chart', bar(['A'], [null], { title_from: 'facts' }));
    assert.equal(empty.structuredContent.code, 'INVALID_ARGUMENT');
    assert.match(empty.content[0].text, /유효한 값이 없습니다/);
    const long = bar(['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)], [1, 2, 3], { highlight: { top: 3 }, title_from: 'facts' });
    const clipped = await p.callTool('build_chart', long);
    assert.equal(JSON.parse(clipped.structuredContent.staticBlock.split('\n')[1]).title.length, 200);
    const control = await p.callTool('build_chart', bar(['A\tB'], [2], { title_from: 'facts' }));
    const definition = JSON.parse(chartBlock(control).split('\n').slice(1, -1).join('\n'));
    assert.match(definition.layout.title.text, /^A B/);
    assert.doesNotMatch(definition.layout.title.text, /\p{Cc}/u);
});

test('interactive and static value labels reuse the same fact strings without hover templates', async () => {
    const args = bar(['A', 'B'], [89.96, 90], { unit: '%', target: { value: 90 } });
    const result = await provider().callTool('build_chart', args);
    const data = trace(result), { facts, staticBlock } = result.structuredContent;
    assert.deepEqual(data.text, ['89.96%', '90.00%']);
    assert.equal(data.texttemplate, '%{text}');
    assert.equal(data.hovertemplate, undefined);
    assert.ok(factLines(facts).some(line => line.includes(data.text[0])));
    const frozen = staticBlock.split('\n')[1];
    assert.doesNotMatch(frozen, /89\.96%/);
    assert.deepEqual(parseStaticChart(frozen).data[0].text, data.text);
    assert.equal(buildChartDefinition({ ...args, style: 'plain' }).data[0].text, undefined);
});

test('single-series bar and barh show value labels through 40 bars', () => {
    for (const type of ['bar', 'barh']) {
        const labels = Array.from({ length: 41 }, (_, i) => `A${i}`);
        const values = labels.map((_, i) => i);
        const atLimit = buildChartDefinition({ type, labels: labels.slice(0, 40), series: [{ values: values.slice(0, 40) }] }).data[0];
        assert.equal(atLimit.texttemplate, '%{text}');
        assert.equal(atLimit.text.length, 40);
        const overLimit = buildChartDefinition({ type, labels, series: [{ values }] }).data[0];
        assert.equal(overLimit.texttemplate, undefined);
        assert.equal(overLimit.text, undefined);
    }
});

test('observation and indicator facts report displayed statistics and undefined ratios', () => {
    for (const type of ['histogram', 'box', 'violin']) {
        const facts = chartFacts({ type, series: [{ values: [3, 1, null, 2, 8] }] });
        const { count, min, max, median, mean } = facts.series[0];
        assert.deepEqual([count, min, max, median, mean], [4, 1, 8, 2.5, 3.5]);
        assert.match(factLines(facts, 'en')[0], /median 2\.5/);
    }
    const indicator = chartFacts({ type: 'indicator', unit: '%', series: [{ values: [5, 0] }] });
    assert.deepEqual([indicator.value, indicator.reference, indicator.difference, indicator.ratio], [5, 0, 5, null]);
    assert.equal(indicator.display.difference, '+5%p');
    assert.equal(chartFacts({ type: 'indicator', series: [{ values: [5] }] }).reference, undefined);
});

test('K10 puts the provenance block only in the report snippet when it fits', async () => {
    const result = await provider('group,value\nA,2억원\nB,1억원').callTool('build_chart', { ...raw('group'), style: 'report' });
    const { reportSnippet, block, factLines } = result.structuredContent;
    assert.equal(block, undefined);
    assert.doesNotMatch(result.content[0].text, /```/);
    assert.match(reportSnippet, /^```plotly\n# chart-hands source:/);
    assert.ok(reportSnippet.endsWith('\n\n자료: data.csv · 2행'));
    assert.ok(reportSnippet.includes(`\n\n${factLines.map(line => `- ${line}`).join('\n')}\n\n`));
    assert.ok(mergedLength(result) <= DATA_RESULT_CHARS);
});

test('K10 uses block fallback when the snippet exceeds the host merge budget', async () => {
    const base = 'x'.repeat(1200), target = 'y'.repeat(1200);
    const analysis = { ...period, period: { ...period.period, base, target } };
    const p = provider(`group,value,year\nA,1,${base}\nA,2,${target}`);
    const result = await p.callTool('build_chart', { ...analysisChart(analysis, 'difference'), style: 'plain' });
    const { block, snippetOmitted, reportSnippet, ...fields } = result.structuredContent;
    assert.equal(snippetOmitted, 'too_long');
    assert.equal(reportSnippet, undefined);
    assert.ok(result.content[0].text.endsWith(`\n${block}`));
    assert.ok(mergedLength(result) <= DATA_RESULT_CHARS);
    const caption = `자료: data.csv · 2행 · compare group value sum ${base}→${target}`;
    const snippet = `${block}\n\n${fields.factLines.map(line => `- ${line}`).join('\n')}\n\n${caption.slice(0, 199)}…`;
    const full = { content: [{ type: 'text', text: result.content[0].text.slice(0, -block.length - 1) }], structuredContent: { ...fields, reportSnippet: snippet } };
    assert.ok(mergedLength(full) > DATA_RESULT_CHARS);
});

test('K10 rejects both oversized forms with the applicable limit and true merged length', async () => {
    const labels = Array.from({ length: 160 }, (_, i) => `${'x'.repeat(94)}${i}`);
    const p = provider(`group,value\n${labels.map((label, i) => `${label},${i}`).join('\n')}`);
    const bigAnalysis = { type: 'bar', source: { path: 'data.csv', analysis: { ...aggregate, limit: 100 } }, series: [{ column: 'value' }, { column: 'share', secondary: true }] };
    const cases = [[raw('group'), /source\.limit을/], [bigAnalysis, /source\.analysis\.limit을/], [bar(labels, labels.map((_, i) => i)), /labels·series 값 개수를/]];
    for (const [args, advice] of cases) {
        const result = await p.callTool('build_chart', args);
        assert.equal(result.structuredContent.code, 'RESULT_TOO_LARGE');
        assert.match(result.content[0].text, advice);
        assert.ok(Number(result.content[0].text.match(/^\d+/)[0]) > DATA_RESULT_CHARS);
    }
    const direct = bar(['A\\B', 'C'], [1, 2], { style: 'plain' });
    const small = await p.callTool('build_chart', direct);
    const { reportSnippet, staticBlock, ...rest } = small.structuredContent;
    assert.ok(reportSnippet.includes('A\\\\B'));
    assert.ok(mergedLength(small) > small.content[0].text.length + reportSnippet.length + staticBlock.length + JSON.stringify(rest).length);
    const large = bar(labels.map(label => `${label}\\`), labels.map((_, i) => i), { style: 'plain', title: 'T', y_title: 'Y' });
    const rejected = await p.callTool('build_chart', large);
    const block = `\`\`\`plotly\n${JSON.stringify(buildChartDefinition(large), null, 2)}\n\`\`\``;
    const facts = chartFacts(large);
    const lines = factLines(facts);
    const content = [{ type: 'text', text: [
        'Built a plotly block. Basic checks found no problems; call check_chart for full Plotly schema validation.',
        'HWPX·PPTX로 내보낼 때만 정적 블록이 필요합니다: JSON이 2,000자를 넘습니다. labels·series 값 개수를 줄이세요.',
        ...lines, block
    ].join('\n') }];
    const structuredContent = { valid: true, problems: 0, staticBlockMissing: 'too_long', facts, titleDraft: titleDraft(facts), factLines: lines, block, snippetOmitted: 'too_long' };
    assert.equal(Number(rejected.content[0].text.match(/^\d+/)[0]), mergedLength({ content, structuredContent }));
});

test('EDA compare and aggregate expose display arrays and scoped facts, with analysis.limit guidance', async () => {
    const p = provider('group,value,reference,year\nA,90%,75%,2025\nA,95%,75%,2026\nB,50%,100%,2025\nC,60%,100%,2026');
    const compared = (await p.callTool('eda_analyze', { path: 'data.csv', analysis: period })).structuredContent;
    assert.deepEqual(plain(compared.display), { base: ['90%'], target: ['95%'], difference: ['+5%p'], rate: ['+5.6%'] });
    assert.match(compared.factLines[0], /2026 95%.*2025 대비 \+5%p.*양 기간 공통 1항목/);
    assert.ok(compared.factLines.length <= 5);
    assert.equal(compared.reportSnippet, undefined);
    const grouped = (await p.callTool('eda_analyze', { path: 'data.csv', analysis: { ...aggregate, function: 'mean' } })).structuredContent;
    assert.equal(grouped.display.value[0], '92.5%');
    assert.match(grouped.factLines[0], /92\.5%/);
    const large = provider('group,value\n' + Array.from({ length: 100 }, (_, i) => `${'x'.repeat(95)}${i},${i}`).join('\n'));
    const oversized = await large.callTool('eda_analyze', { path: 'data.csv', analysis: { ...aggregate, sort: 'original', limit: 100 } });
    assert.match(oversized.content[0].text, /analysis\.limit/);
    const retried = await large.callTool('eda_analyze', { path: 'data.csv', analysis: { ...aggregate, limit: 3 } });
    assert.equal(retried.structuredContent.returnedGroups, 3);
    assert.match(retried.structuredContent.note, /analysis\.limit/);
});

test('EDA size policy omits only display when a compare chart still fits', async () => {
    const rows = Array.from({ length: 88 }, (_, i) => `${'g'.repeat(20)}${i},${i + 1},${i + 2}`);
    const p = provider(`group,value,reference\n${rows.join('\n')}`, 'en');
    const result = await p.callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'compare', columns: ['group', 'value', 'reference'], limit: 88 } });
    const fields = result.structuredContent;
    assert.equal(fields.displayOmitted, 'too_long');
    assert.equal(fields.display, undefined);
    assert.equal(fields.chartOmitted, undefined);
    assert.equal(fields.chart.labels.length, 88);
    assert.ok(fields.factLines.length);
    assert.ok(mergedLength(result) <= DATA_RESULT_CHARS);
});

test('EDA size policy omits display and chart from a 100-group sum', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => `${'m'.repeat(55)}${i + 1},${i + 1}`);
    const p = provider(`period,value\n${rows.join('\n')}`, 'en');
    const result = await p.callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'aggregate', columns: ['period', 'value'], function: 'sum', limit: 100 } });
    const fields = result.structuredContent;
    assert.equal(fields.returnedGroups, 100);
    assert.equal(fields.groups.length, 100);
    assert.equal(fields.truncated, true);
    assert.equal(fields.displayOmitted, 'too_long');
    assert.equal(fields.chartOmitted, 'too_long');
    assert.equal(fields.display, undefined);
    assert.equal(fields.chart, undefined);
    assert.ok(fields.factLines.length);
    assert.ok(mergedLength(result) <= DATA_RESULT_CHARS);
});

test('EDA size policy rejects an oversized group table with analysis.limit guidance', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => `${'x'.repeat(95)}${i},${i}`);
    const p = provider(`group,value\n${rows.join('\n')}`, 'en');
    const result = await p.callTool('eda_analyze', { path: 'data.csv', analysis: { ...aggregate, sort: 'original', limit: 100 } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'RESULT_TOO_LARGE');
    assert.match(result.content[0].text, /analysis\.limit/);
});
