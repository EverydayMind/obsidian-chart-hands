// Run: node --test test/chart-advice.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { adviseChart } from '../src/chart-advice.js';

const require = createRequire(import.meta.url);
const { loadHarness } = require('./helpers/locale-harness');
const code = require('./helpers/build-plugin')();

const provide = (files = {}, locale = 'ko') => loadHarness(code, locale).exports.createAgentProvider({
    manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' },
    app: {
        vault: {
            getAbstractFileByPath: p => Object.hasOwn(files, p) ? { path: p, extension: p.split('.').pop() } : null,
            cachedRead: async file => files[file.path]
        }
    }
}, locale, { now: () => new Date(2026, 10, 23) });

const plain = value => JSON.parse(JSON.stringify(value));
const text = result => result.content.map(part => part.text).join('\n');
const baseLayout = (extra = {}) => ({ title: { text: '매출 현황' }, yaxis: { title: { text: '매출(억원)' } }, ...extra });

test('A1 flags non-zero bar, histogram and area baselines and skips log, autorange and zero/negative ranges', () => {
    // Triggers: vertical bar, horizontal bar (x axis), reversed range, histogram, area scatter (fill / stackgroup).
    const barPos = adviseChart({ data: [{ type: 'bar', x: ['A'], y: [20] }], layout: baseLayout({ yaxis: { title: { text: '값' }, range: [10, 30] } }) }, 'ko');
    assert.deepEqual(barPos, ['막대·면적 값 축이 0이 아닌 10에서 시작합니다. 차이가 실제보다 커 보일 수 있습니다.']);

    const barhPos = adviseChart({ data: [{ type: 'bar', orientation: 'h', x: [20], y: ['A'] }], layout: { title: { text: 'T' }, xaxis: { title: { text: '값' }, range: [5, 50] } } }, 'ko');
    assert.equal(barhPos.length, 1);
    assert.match(barhPos[0], /0이 아닌 5에서/);

    const reversed = adviseChart({ data: [{ type: 'bar', x: ['A'], y: [20] }], layout: baseLayout({ yaxis: { title: { text: '값' }, range: [100, 15] } }) }, 'ko');
    assert.match(reversed[0], /0이 아닌 15에서/);

    const histH = adviseChart({ data: [{ type: 'histogram', orientation: 'h', y: [1, 2, 2] }], layout: { title: { text: 'T' }, xaxis: { title: { text: '빈도' }, range: [2, 10] } } }, 'ko');
    assert.match(histH[0], /0이 아닌 2에서/);

    const areaFill = adviseChart({ data: [{ type: 'scatter', x: [1, 2], y: [20, 30], fill: 'tozeroy' }], layout: baseLayout({ yaxis: { title: { text: '값' }, range: [5, 40] } }) }, 'en');
    assert.match(areaFill[0], /starts at 5 instead of 0/);

    const areaStack = adviseChart({ data: [{ type: 'scatter', x: [1, 2], y: [20, 30], stackgroup: 'one' }], layout: baseLayout({ yaxis: { title: { text: '값' }, range: [3, 40] } }) }, 'ko');
    assert.match(areaStack[0], /0이 아닌 3에서/);

    // Non-triggers: log axis, autorange: true, range starting at 0 or negative, plain line scatter.
    assert.deepEqual(adviseChart({ data: [{ type: 'bar', x: ['A'], y: [20] }], layout: baseLayout({ yaxis: { title: { text: '값' }, type: 'log', range: [1, 3] } }) }, 'ko'), []);
    assert.deepEqual(adviseChart({ data: [{ type: 'bar', x: ['A'], y: [20] }], layout: baseLayout({ yaxis: { title: { text: '값' }, autorange: true, range: [10, 30] } }) }, 'ko'), []);
    assert.deepEqual(adviseChart({ data: [{ type: 'bar', x: ['A'], y: [20] }], layout: baseLayout({ yaxis: { title: { text: '값' }, range: [0, 30] } }) }, 'ko'), []);
    assert.deepEqual(adviseChart({ data: [{ type: 'bar', x: ['A'], y: [20] }], layout: baseLayout({ yaxis: { title: { text: '값' }, range: [-5, 30] } }) }, 'ko'), []);
    assert.deepEqual(adviseChart({ data: [{ type: 'scatter', mode: 'lines', x: [1, 2], y: [20, 30] }], layout: baseLayout({ yaxis: { title: { text: '값' }, range: [10, 30] } }) }, 'ko'), []);
});

test('A2 flags pie charts with more than 6 slices and allows 6 slices', () => {
    const six = adviseChart({ data: [{ type: 'pie', labels: ['A', 'B', 'C', 'D', 'E', 'F'], values: [1, 1, 1, 1, 1, 1] }], layout: { title: { text: '비중' } } }, 'ko');
    assert.deepEqual(six, []);
    const seven = adviseChart({ data: [{ type: 'pie', labels: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], values: [1, 1, 1, 1, 1, 0, null] }], layout: { title: { text: '비중' } } }, 'ko');
    assert.deepEqual(seven, ['원형 조각이 7개입니다. 7개 이상이면 정렬된 가로 막대가 비교하기 쉽습니다.']);
    const sevenEn = adviseChart({ data: [{ type: 'pie', labels: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], values: [1, 1, 1, 1, 1, 1, 1] }], layout: { title: { text: 'Share' } } }, 'en');
    assert.match(sevenEn[0], /7 slices/);
});

test('A3 flags summary labels in pie, treemap and sunburst including bold markdown', () => {
    const plain = adviseChart({ data: [{ type: 'pie', labels: ['서울', '합계'], values: [10, 10] }], layout: { title: { text: '비중' } } }, 'ko');
    assert.deepEqual(plain, ["'합계' 조각이 있습니다. 합계 행이면 다른 조각과 함께 세어집니다."]);

    const bold = adviseChart({ data: [{ type: 'treemap', labels: ['전체', '서울', '**합계**'], parents: ['', '전체', '전체'], values: [20, 10, 10] }], layout: { title: { text: '구성' } } }, 'ko');
    assert.deepEqual(bold, ["'**합계**' 조각이 있습니다. 합계 행이면 다른 조각과 함께 세어집니다."]);

    const sunburstEn = adviseChart({ data: [{ type: 'sunburst', labels: ['Root', 'Grand Total'], parents: ['', 'Root'], values: [10, 10] }], layout: { title: { text: 'Mix' } } }, 'en');
    assert.match(sunburstEn[0], /'Grand Total'.*summary row/);

    const clean = adviseChart({ data: [{ type: 'pie', labels: ['서울', '부산'], values: [10, 20] }], layout: { title: { text: '비중' } } }, 'ko');
    assert.deepEqual(clean, []);
});

test('A4 checks value axis titles, respects horizontal bars and excludes funnel, heatmap and axis-less types', () => {
    assert.deepEqual(adviseChart({ data: [{ type: 'bar', x: ['A'], y: [1] }], layout: { title: { text: 'T' } } }, 'ko'), ['값 축 제목(단위)이 없습니다.']);
    // Plain string axis title is treated as missing (already reported in problems).
    assert.deepEqual(adviseChart({ data: [{ type: 'bar', x: ['A'], y: [1] }], layout: { title: { text: 'T' }, yaxis: { title: '매출' } } }, 'ko'), ['값 축 제목(단위)이 없습니다.']);
    // Horizontal bar requires xaxis title, not yaxis title.
    assert.deepEqual(adviseChart({ data: [{ type: 'bar', orientation: 'h', x: [1], y: ['A'] }], layout: { title: { text: 'T' }, yaxis: { title: { text: '부서' } } } }, 'ko'), ['값 축 제목(단위)이 없습니다.']);
    assert.deepEqual(adviseChart({ data: [{ type: 'bar', orientation: 'h', x: [1], y: ['A'] }], layout: { title: { text: 'T' }, xaxis: { title: { text: '매출(억원)' } } } }, 'ko'), []);
    // Markers-only scatter requires both x and y titles.
    assert.deepEqual(adviseChart({ data: [{ type: 'scatter', mode: 'markers', x: [1, 2], y: [3, 4] }], layout: { title: { text: 'T' }, yaxis: { title: { text: 'Y' } } } }, 'ko'), ['값 축 제목(단위)이 없습니다.']);
    assert.deepEqual(adviseChart({ data: [{ type: 'scatter', mode: 'markers', x: [1, 2], y: [3, 4] }], layout: { title: { text: 'T' }, xaxis: { title: { text: 'X' } }, yaxis: { title: { text: 'Y' } } } }, 'ko'), []);
    // Excluded types: funnel, heatmap, pie, treemap, sunburst, scatterpolar, indicator.
    for (const trace of [
        { type: 'funnel', x: [10, 5], y: ['A', 'B'] },
        { type: 'heatmap', x: ['A'], y: ['R'], z: [[1]] },
        { type: 'pie', labels: ['A'], values: [1] },
        { type: 'treemap', labels: ['A'], parents: [''], values: [1] },
        { type: 'sunburst', labels: ['A'], parents: [''], values: [1] },
        { type: 'scatterpolar', r: [1, 2, 3], theta: ['A', 'B', 'C'] },
        { type: 'indicator', value: 42 }
    ]) {
        assert.deepEqual(adviseChart({ data: [trace], layout: { title: { text: 'T' } } }, 'ko'), [], trace.type);
    }
});

test('A5 flags missing or blank chart titles', () => {
    assert.deepEqual(adviseChart({ data: [{ type: 'pie', labels: ['A'], values: [1] }], layout: {} }, 'ko'), ['제목이 없습니다.']);
    assert.deepEqual(adviseChart({ data: [{ type: 'pie', labels: ['A'], values: [1] }], layout: { title: { text: '   ' } } }, 'en'), ['Chart title is missing.']);
    assert.deepEqual(adviseChart({ data: [{ type: 'pie', labels: ['A'], values: [1] }], layout: { title: { text: 'OK' } } }, 'ko'), []);
});

test('A6 flags more than 6 traces on one axis pair and allows 7 traces split across two axes', () => {
    const sevenSame = Array.from({ length: 7 }, (_, i) => ({ type: 'scatter', mode: 'lines', x: ['A'], y: [i] }));
    assert.deepEqual(adviseChart({ data: sevenSame, layout: baseLayout() }, 'ko'), ['한 축에 계열이 7개입니다. 구분이 어려울 수 있습니다.']);

    const sixSame = sevenSame.slice(0, 6);
    assert.deepEqual(adviseChart({ data: sixSame, layout: baseLayout() }, 'ko'), []);

    const splitSeven = [
        ...Array.from({ length: 4 }, (_, i) => ({ type: 'scatter', mode: 'lines', x: ['A'], y: [i] })),
        ...Array.from({ length: 3 }, (_, i) => ({ type: 'scatter', mode: 'lines', x: ['A'], y: [i], yaxis: 'y2' }))
    ];
    assert.deepEqual(adviseChart({ data: splitSeven, layout: baseLayout({ yaxis2: { title: { text: '비율(%)' } } }) }, 'ko'), []);
});

test('A7 flags negative values in stack or relative bar charts and caps total advice at 6', () => {
    const relative = adviseChart({
        data: [{ type: 'bar', x: ['A', 'B'], y: [10, -5] }],
        layout: baseLayout({ barmode: 'relative' })
    }, 'ko');
    assert.deepEqual(relative, ['음수가 있는 누적 막대입니다. 합계를 읽기 어려울 수 있습니다.']);

    const stackPos = adviseChart({
        data: [{ type: 'bar', x: ['A', 'B'], y: [10, 5] }],
        layout: baseLayout({ barmode: 'stack' })
    }, 'ko');
    assert.deepEqual(stackPos, []);

    const groupNeg = adviseChart({
        data: [{ type: 'bar', x: ['A', 'B'], y: [10, -5] }],
        layout: baseLayout({ barmode: 'group' })
    }, 'ko');
    assert.deepEqual(groupNeg, []);

    // Trigger all 7 rules together; result must be capped at 6.
    const allSeven = adviseChart({
        data: [
            ...Array.from({ length: 7 }, () => ({ type: 'bar', x: ['A'], y: [-1] })),
            { type: 'pie', labels: ['합계', 'B', 'C', 'D', 'E', 'F', 'G'], values: [1, 1, 1, 1, 1, 1, 1] }
        ],
        layout: { barmode: 'stack', yaxis: { range: [5, 50] } }
    }, 'ko');
    assert.equal(allSeven.length, 6);
});

test('check_chart keeps output unchanged when there is no advice and adds optional advice otherwise', async () => {
    const pKo = provide({}, 'ko');
    const clean = await pKo.callTool('check_chart', {
        source: '{"data": [{"x": [1, 2], "y": [3, 4], "type": "bar", "name": "sales"}], "layout": {"title": {"text": "Q1"}, "yaxis": {"title": {"text": "KRW"}}}}'
    });
    assert.equal(text(clean), 'No problems · traces: 1(bar "sales" 2 points) · title "Q1"');
    assert.deepEqual(plain(clean.structuredContent), { valid: true, problems: 0, traces: 1 });
    assert.equal(Object.hasOwn(clean.structuredContent, 'advice'), false);

    const notedKo = await pKo.callTool('check_chart', { source: '{"data": [{"type": "bar", "x": ["A"], "y": [1]}]}' });
    assert.equal(notedKo.structuredContent.valid, true);
    assert.equal(notedKo.structuredContent.problems, 0);
    assert.deepEqual(plain(notedKo.structuredContent.advice), ['값 축 제목(단위)이 없습니다.', '제목이 없습니다.']);
    assert.match(text(notedKo), /참고\(사용자에게 알릴 선택 사항입니다\. 차트는 완성됐으니 이것만을 위해 다시 만들거나 다시 검사하지 마세요\):/);

    const pEn = provide({}, 'en');
    const notedEn = await pEn.callTool('check_chart', { source: '{"data": [{"type": "pie", "labels": ["A"], "values": [1]}]}' });
    assert.equal(notedEn.structuredContent.valid, true);
    assert.deepEqual(plain(notedEn.structuredContent.advice), ['Chart title is missing.']);
    assert.match(text(notedEn), /Advice \(optional notes for the user; the chart is complete — do not rebuild or re-check just to clear them\):/);
});

test('read_charts extracts provenance sources with 120-char clipping and reports advice counts', async () => {
    const longSource = `sales.csv · rows 10 of 50 · filter region eq ${'서울특별시강남구'.repeat(16)} · built 2026-11-23`;
    assert.ok(longSource.length > 120);
    const note = [
        '```plotly',
        `# chart-hands source: ${longSource}`,
        '{"data": [{"type": "bar", "x": ["A"], "y": [1]}], "layout": {"title": {"text": "Q1"}, "yaxis": {"title": {"text": "KRW"}}}}',
        '```',
        '',
        '```plotly',
        '{"data": [{"type": "bar", "x": ["A"], "y": [1]}]}',
        '```'
    ].join('\n');
    const result = await provide({ 'notes/report.md': note }, 'ko').callTool('read_charts', { path: 'notes/report.md' });
    assert.notEqual(result.isError, true);
    const lines = text(result).split('\n');
    assert.match(lines[1], / · source "sales\.csv[^"]{100,}…" · no problems$/);
    assert.equal(lines[1].match(/ · source "([^"]+)"/)[1].length, 120);
    assert.match(lines[2], / · no problems · 2 advice$/);
    assert.deepEqual(plain(result.structuredContent.sources), [{ chart: 1, source: longSource }]);
    assert.deepEqual(plain(result.structuredContent.advice), [{ chart: 2, count: 2 }]);

    const cleanNote = '```plotly\n{"data": [{"type": "pie", "labels": ["A"], "values": [1]}], "layout": {"title": {"text": "Clean"}}}\n```';
    const clean = await provide({ 'notes/clean.md': cleanNote }, 'ko').callTool('read_charts', { path: 'notes/clean.md' });
    assert.equal(Object.hasOwn(clean.structuredContent, 'sources'), false);
    assert.equal(Object.hasOwn(clean.structuredContent, 'advice'), false);
});

test('build_chart includes advice in text and structuredContent for untitled report charts', async () => {
    const p = provide({ 'data.csv': '부서,매출\n서울,120억원\n부산,80억원' }, 'ko');
    const untitled = await p.callTool('build_chart', {
        type: 'bar',
        style: 'report',
        source: { path: 'data.csv', labels: '부서' },
        series: [{ column: '매출' }]
    });
    assert.equal(untitled.structuredContent.valid, true);
    assert.deepEqual(plain(untitled.structuredContent.advice), ['제목이 없습니다.']);
    assert.match(text(untitled), /참고\(사용자에게 알릴 선택 사항입니다/);
    assert.match(text(untitled), /제목이 없습니다\./);

    const titled = await p.callTool('build_chart', {
        type: 'bar',
        style: 'report',
        title: '서울이 120억원으로 가장 큼',
        source: { path: 'data.csv', labels: '부서' },
        series: [{ column: '매출' }]
    });
    assert.equal(Object.hasOwn(titled.structuredContent, 'advice'), false);
});
