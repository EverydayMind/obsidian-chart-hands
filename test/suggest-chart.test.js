'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'obsidian') {
        return {
            Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {}, moment: { locale: () => 'ko' },
            parseYaml: (text) => JSON.parse(text.replace(/^\s*#.*$/gm, '')),
            stringifyYaml: (value) => JSON.stringify(value, null, 2) + '\n'
        };
    }
    return load.call(this, request, ...rest);
};
const bundle = new Module(path.join(__dirname, 'plugin-under-test-suggest.js'), module);
bundle.filename = bundle.id;
bundle.paths = Module._nodeModulePaths(__dirname);
bundle._compile(require('./helpers/build-plugin')(), bundle.filename);
const { createAgentProvider } = bundle.exports;
Module._load = load;

const MANIFEST = { id: 'chart-hands', name: 'Chart Hands', version: '0.10.16' };
const makeProvider = (files, locale = 'ko') => createAgentProvider({
    app: {
        vault: {
            getFiles: () => Object.keys(files).map(p => ({ path: p, extension: p.split('.').pop() })),
            getAbstractFileByPath: (file) => Object.hasOwn(files, file) ? { path: file, extension: file.split('.').pop() } : null,
            cachedRead: async (file) => files[file.path]
        }
    },
    manifest: MANIFEST
}, locale, { now: () => new Date(2026, 10, 23) });

const errorCode = (res) => res._meta?.['dev.agentinterop/error']?.code;

function assertSchemaSubset(schema, where = '$') {
    assert.ok(schema && typeof schema === 'object', `${where}: schema object`);
    for (const forbidden of ['oneOf', 'anyOf', 'allOf', 'if', 'then', 'else', '$ref']) {
        assert.equal(Object.hasOwn(schema, forbidden), false, `${where}: forbidden keyword ${forbidden}`);
    }
    if (schema.type === 'object') {
        assert.equal(schema.additionalProperties, false, `${where}: additionalProperties must be false`);
        for (const [k, v] of Object.entries(schema.properties || {})) assertSchemaSubset(v, `${where}.${k}`);
    }
    if (schema.type === 'array' && schema.items) assertSchemaSubset(schema.items, `${where}[]`);
}

test('S1/S1′/R4: periodKey and columnRole classify all edge cases accurately', async () => {
    const { periodKey } = await import('../src/period.js');
    const { parseDataset } = await import('../src/eda.js');
    const { columnRole, periodHeader } = await import('../src/column-roles.js');
    const { periodColumnKeys } = await import('../src/chart-facts.js');
    const { suggestChart } = await import('../src/suggest.js');

    // S1' periodKey
    assert.equal(periodKey('2026년'), 'Y2026');
    assert.equal(periodKey('2026년도'), 'Y2026');
    assert.equal(periodKey('1900'), 'Y1900');
    assert.equal(periodKey('2100'), 'Y2100');
    assert.equal(periodKey('1899'), 'S:1899');
    assert.equal(periodKey('2101'), 'S:2101');
    assert.equal(periodKey('0001'), 'S:0001');

    // periodHeader
    assert.equal(periodHeader('사업연도'), true);
    assert.equal(periodHeader('집행월'), true);
    assert.equal(periodHeader('연도별집행액'), false);

    const ds = parseDataset([
        '연도별집행액,회차,사업연도,사업연도한글,기준연도,사업코드,금액,분기,빈열',
        '120억원,1,2025,2025년,0001,2024,1950,Q1,',
        '130억원,2,2026,2026년,0002,2025,2000,2025 Q2,',
        '140억원,3,2027,2027년,0003,2026,2050,2025 Q3,'
    ].join('\n'));

    assert.equal(columnRole(ds, 0), 'numeric');  // 연도별집행액=[120억원,130억원]
    assert.equal(columnRole(ds, 1), 'category'); // 회차=[1,2]
    assert.equal(columnRole(ds, 2), 'period');   // 사업연도=[2025,2026]
    assert.equal(columnRole(ds, 3), 'period');   // 사업연도한글=[2025년,2026년]
    assert.equal(columnRole(ds, 4), 'category'); // 기준연도=[0001,0002] (leading zeros)
    assert.equal(columnRole(ds, 5), 'category'); // 사업코드=[2024,2025,2026] (id header)
    assert.equal(columnRole(ds, 6), 'numeric');  // 금액=[1950,2000,2050] (no period header)
    assert.equal(columnRole(ds, 7), 'category'); // 분기=[Q1, 2025 Q2] (mixed year R4)
    assert.equal(columnRole(ds, 8), 'empty');    // 빈열

    // 사업코드 must not produce ordered trend facts
    assert.equal(periodColumnKeys(['2024', '2025', '2026'], '사업코드'), null);

    // Mixed year period column produces no automatic period candidates
    const mixedDs = parseDataset('분기,실적\nQ1,10\n2025 Q2,20');
    const res = suggestChart(mixedDs, { path: 'm.csv', goal: 'trend' }, 'ko');
    assert.equal(res.candidates.length, 0);
    assert.deepEqual(res.needs, ['label']);
    assert.ok(res.cautions.some(c => c.includes('연도')));
});

test('descriptor: 7 tools, suggest_chart metadata, length limits and schema subset', async () => {
    for (const locale of ['ko', 'en']) {
        const provider = makeProvider({}, locale);
        const descriptor = await provider.describe();
        assert.equal(descriptor.tools.length, 7);
        assert.equal(descriptor.tools[6].name, 'suggest_chart');
        const tool = descriptor.tools[6];
        assert.ok(tool.description.length <= 1000, `${locale} description <= 1000`);
        assert.equal(tool._meta['dev.agentinterop/effect'], 'read');
        assert.equal(tool._meta['dev.agentinterop/group'], 'data');
        assert.equal(tool._meta['dev.agentinterop/maxResultChars'], 16000);
        assert.ok(tool._meta['dev.agentinterop/keywords'].length <= 32);
        assert.equal(tool.annotations.readOnlyHint, true);
        assert.deepEqual(tool.inputSchema.required, ['path']);
        assert.equal(tool.inputSchema.properties.goal.enum.length, 9);
        assert.equal(tool.inputSchema.properties.values.maxItems, 12);
        assertSchemaSubset(tool.inputSchema, 'suggest_chart');
    }
    const koDesc = (await makeProvider({}, 'ko').describe()).tools[6].description;
    const enDesc = (await makeProvider({}, 'en').describe()).tools[6].description;
    assert.equal(koDesc, enDesc);

    // Missing both goal and request -> runtime error
    const p = makeProvider({ 'a.csv': 'cat,val\nA,1\nB,2' });
    assert.equal(errorCode(await p.callTool('suggest_chart', { path: 'a.csv' })), 'INVALID_ARGUMENT');
});

test('goal table: every goal cell, failure cases, >200 rows, matrix 13 cols, bubble negative size', async () => {
    const rows205 = ['cat,val', ...Array.from({ length: 205 }, (_, i) => `C${i},${i + 1}`)].join('\n');
    const trend25 = ['month,val', ...Array.from({ length: 25 }, (_, i) => `2025-${String((i % 12) + 1).padStart(2, '0')}-${String(Math.floor(i / 12) + 1).padStart(2, '0')},${i + 1}`)].join('\n');
    const trendDup70 = ['연도,부서,매출', ...Array.from({ length: 70 }, (_, i) => `${2000 + i},A,${i + 1}억원\n${2000 + i},B,${i + 2}억원`)].join('\n');
    const matrix13 = [
        ['부서', ...Array.from({ length: 13 }, (_, i) => `m${i + 1}`)].join(','),
        ['A', ...Array.from({ length: 13 }, (_, i) => `${i + 1}`)].join(','),
        ['B', ...Array.from({ length: 13 }, (_, i) => `${i + 2}`)].join(',')
    ].join('\n');
    const dist22 = ['val', ...Array.from({ length: 22 }, (_, i) => `${i + 1}`)].join('\n');

    const files = {
        'trend4.csv': '연월,매출,비율\n2025-01,100억원,80%\n2025-02,120억원,85%\n2025-03,110억원,82%\n2025-04,130억원,90%',
        'trend3.csv': '연월,매출\n2025-01,100억원\n2025-02,120억원\n2025-03,110억원',
        'trend25.csv': trend25,
        'trend-dup-pct.csv': '연도,부서,집행률\n2025,A,80%\n2025,B,90%\n2026,A,85%\n2026,B,95%',
        'trend-dup-people.csv': '연도,부서,인원\n2025,A,10명\n2025,B,20명\n2026,A,15명\n2026,B,25명',
        'trend-dup-70.csv': trendDup70,
        'trend-mixed-notation.csv': '연월,매출\n2026-01,10\n2026년 1월,20\n2026-02,30',
        'trend-mixed-order.csv': '연월,부서,매출\n2026.2,A,10억원\n2026.2,B,20억원\n2026년 1월,A,30억원\n2026년 1월,B,40억원',
        'compare-short.csv': '부서,실적\n인사,10\n재무,20\n기획,30',
        'compare-long.csv': '부서,실적\n매우긴부서이름하나,10\n매우긴부서이름둘,20\n매우긴부서이름셋,30',
        'rows205.csv': rows205,
        'share-ok.csv': '부서,예산\nA,10\nB,20\nC,30',
        'share-many.csv': '부서,예산\nA,10\nB,20\nC,30\nD,40\nE,50\nF,60',
        'share-neg.csv': '부서,손익\nA,-10\nB,20\nC,30',
        'share-zero.csv': '부서,예산\nA,0\nB,0',
        'dist22.csv': dist22,
        'dist5.csv': 'val\n1\n2\n3\n4\n5',
        'rel.csv': 'x,y,z,negz\n1,2,10,10\n2,4,20,-5\n3,6,30,15',
        'target.csv': '부서,실적,목표,다른단위\nA,80억원,100억원,80%\nB,110억원,100억원,110%',
        'change.csv': '부서,연도,실적,집행률\nA,2025,100억원,80%\nA,2026,120억원,85%\nB,2025,90억원,90%\nB,2026,70억원,88%',
        'matrix13.csv': matrix13,
        'matrix2.csv': '부서,m1,m2\nA,1,2\nB,3,4',
        'no-num.csv': 'a,b\nx,y\np,q',
        'note.md': '| x | y |\n|---|---|\n| 1 | 2 |\n\n| 부서 | 실적 |\n|---|---|\n| A | 10 |\n| B | 20 |'
    };

    const p = makeProvider(files, 'ko');
    const run = async (args) => {
        const res = await p.callTool('suggest_chart', args);
        assert.notEqual(res.isError, true, `${JSON.stringify(args)}: ${res.content[0].text}`);
        // Verify every returned build also passes build_chart directly.
        for (const c of res.structuredContent.candidates) {
            if (c.build) {
                const built = await p.callTool('build_chart', c.build);
                assert.notEqual(built.isError, true, `build failed for ${JSON.stringify(c.build)}: ${built.content[0].text}`);
                assert.equal(built.structuredContent.valid, true);
                assert.ok((built.structuredContent.facts?.scope?.valid ?? 0) >= 1);
            }
        }
        return res.structuredContent;
    };

    // trend
    const t4 = await run({ path: 'trend4.csv', goal: 'trend' });
    assert.deepEqual(t4.candidates.map(c => c.type), ['line', 'bar']);
    const tCombo = await run({ path: 'trend4.csv', goal: 'trend', values: ['매출', '비율'] });
    assert.equal(tCombo.candidates[0].type, 'combo');
    assert.equal(tCombo.candidates[0].build.series[1].secondary, true);
    const t3 = await run({ path: 'trend3.csv', goal: 'trend' });
    assert.deepEqual(t3.candidates.map(c => c.type), ['bar', 'line']);
    const t25 = await run({ path: 'trend25.csv', goal: 'trend' });
    assert.equal(t25.candidates[0].build.range_slider, true);
    const tDupPct = await run({ path: 'trend-dup-pct.csv', goal: 'trend' });
    assert.equal(tDupPct.candidates[0].build.source.analysis.function, 'mean');
    const tDupPeople = await run({ path: 'trend-dup-people.csv', goal: 'trend' });
    assert.equal(tDupPeople.candidates.length, 0);
    assert.deepEqual(tDupPeople.needs, ['function']);
    const tDup70 = await run({ path: 'trend-dup-70.csv', goal: 'trend', filter: [{ column: '매출', op: 'gt', value: '0' }] });
    assert.equal(tDup70.candidates[0].build.source.analysis.limit, 70);
    assert.ok(tDup70.candidates[0].build.source.analysis.filter);
    assert.equal(tDup70.candidates[0].build.source.filter, undefined);
    const tMixNot = await run({ path: 'trend-mixed-notation.csv', goal: 'trend' });
    assert.equal(tMixNot.candidates.length, 0);
    assert.ok(tMixNot.cautions.some(c => c.includes('다른 표기')));
    const tMixOrd = await run({ path: 'trend-mixed-order.csv', goal: 'trend' });
    assert.equal(tMixOrd.candidates.length, 0);
    assert.ok(tMixOrd.cautions.some(c => c.includes('순서를 맞출 수 없습니다')));

    // compare
    const cShort = await run({ path: 'compare-short.csv', goal: 'compare' });
    assert.deepEqual(cShort.candidates.map(c => c.type), ['bar', 'barh']);
    const cLong = await run({ path: 'compare-long.csv', goal: 'compare' });
    assert.deepEqual(cLong.candidates.map(c => c.type), ['barh', 'bar']);
    const c205 = await run({ path: 'rows205.csv', goal: 'compare' });
    assert.equal(c205.candidates.length, 0);
    assert.deepEqual(c205.needs, ['filter']);
    assert.equal(errorCode(await p.callTool('suggest_chart', { path: 'compare-short.csv', goal: 'compare', top: 5 })), 'INVALID_ARGUMENT');

    // rank (>200 rows keeps raw sort + limit per S2')
    const r205 = await run({ path: 'rows205.csv', goal: 'rank', top: 5 });
    assert.equal(r205.candidates[0].type, 'barh');
    assert.equal(r205.candidates[0].build.source.limit, 5);
    assert.equal(r205.candidates[0].build.source.analysis, undefined);

    // share
    assert.deepEqual((await run({ path: 'share-ok.csv', goal: 'share' })).candidates.map(c => c.type), ['donut', 'barh']);
    assert.deepEqual((await run({ path: 'share-many.csv', goal: 'share' })).candidates.map(c => c.type), ['barh']);
    const sNeg = await run({ path: 'share-neg.csv', goal: 'share' });
    assert.deepEqual(sNeg.candidates.map(c => c.type), ['barh']);
    assert.ok(sNeg.candidates[0].cautions.some(c => c.includes('음수')));
    assert.equal((await run({ path: 'share-zero.csv', goal: 'share' })).candidates.length, 0);

    // distribution
    assert.deepEqual((await run({ path: 'dist22.csv', goal: 'distribution' })).candidates.map(c => c.type), ['histogram', 'box']);
    assert.deepEqual((await run({ path: 'dist5.csv', goal: 'distribution' })).candidates.map(c => c.type), ['box']);
    assert.deepEqual((await run({ path: 'no-num.csv', goal: 'distribution' })).needs, ['values']);
    assert.deepEqual((await run({ path: 'rows205.csv', goal: 'distribution' })).needs, ['filter']);

    // relationship
    assert.deepEqual((await run({ path: 'rel.csv', goal: 'relationship', values: ['x', 'y'] })).candidates.map(c => c.type), ['scatter']);
    assert.deepEqual((await run({ path: 'rel.csv', goal: 'relationship', values: ['x', 'y', 'z'] })).candidates.map(c => c.type), ['bubble']);
    const relNeg = await run({ path: 'rel.csv', goal: 'relationship', values: ['x', 'y', 'negz'] });
    assert.deepEqual(relNeg.candidates.map(c => c.type), ['scatter']);
    assert.ok(relNeg.candidates[0].cautions.some(c => c.includes('음수')));

    // target
    const tgRef = await run({ path: 'target.csv', goal: 'target', values: ['실적'], reference: '목표' });
    assert.deepEqual(tgRef.candidates.map(c => c.type), ['combo', 'bar']);
    assert.equal(tgRef.candidates[1].build.target.value, 100);
    assert.equal(errorCode(await p.callTool('suggest_chart', { path: 'target.csv', goal: 'target', values: ['실적'], reference: '다른단위' })), 'INVALID_ARGUMENT');
    const tgNoRef = await run({ path: 'target.csv', goal: 'target', values: ['실적'] });
    assert.deepEqual(tgNoRef.candidates[0].needs, ['target.value', 'reference']);
    assert.deepEqual(tgNoRef.referenceCandidates, ['목표']);
    const tgNoCand = await run({ path: 'compare-short.csv', goal: 'target' });
    assert.deepEqual(tgNoCand.candidates[0].needs, ['target.value']);
    assert.equal(tgNoCand.referenceCandidates, undefined);
    const tgVal = await run({ path: 'target.csv', goal: 'target', values: ['실적'], target_value: 95 });
    assert.equal(tgVal.candidates[0].build.target.value, 95);
    assert.equal(tgVal.candidates[0].needs, undefined);
    assert.equal(tgVal.referenceCandidates, undefined);

    // change
    const chNeeds = await run({ path: 'change.csv', goal: 'change', values: ['실적'] });
    assert.deepEqual(chNeeds.candidates[0].needs, ['period.base', 'period.target']);
    assert.equal(chNeeds.candidates[0].build, undefined);
    const chSum = await run({ path: 'change.csv', goal: 'change', values: ['실적'], period: { column: '연도', base: '2025', target: '2026' } });
    assert.deepEqual(chSum.candidates.map(c => c.type), ['waterfall', 'barh']);
    const chPct = await run({ path: 'change.csv', goal: 'change', values: ['집행률'], period: { column: '연도', base: '2025', target: '2026' } });
    assert.deepEqual(chPct.candidates.map(c => c.type), ['barh']);
    const chHi = await run({ path: 'change.csv', goal: 'change', values: ['실적'], period: { column: '연도', base: '2025', target: '2026' }, highlight: { bottom: 1 } });
    assert.equal(chHi.candidates[0].type, 'barh');
    assert.deepEqual((await run({ path: 'compare-short.csv', goal: 'change' })).needs, ['period.column']);

    // matrix
    const m13 = await run({ path: 'matrix13.csv', goal: 'matrix' });
    assert.equal(m13.candidates[0].type, 'heatmap');
    assert.equal(m13.candidates[0].build.series.length, 12);
    assert.ok(m13.candidates[0].cautions.some(c => c.includes('12')));
    const m2 = await run({ path: 'matrix2.csv', goal: 'matrix' });
    assert.equal(m2.candidates.length, 0);
    assert.ok(m2.cautions.some(c => c.includes('펼쳐야')));

    // Markdown table support
    const mdRes = await run({ path: 'note.md', table: 2, goal: 'compare' });
    assert.equal(mdRes.table.index, 2);
    assert.equal(mdRes.candidates[0].build.source.table, 2);
});

test('R6: 30 request examples evaluated with R1–R3 rules', async () => {
    const baseCsv = [
        '부서,연도,실적',
        'A,2024,90%',
        'A,2025,88%',
        'A,2026,80%',
        'B,2024,85%',
        'B,2025,82%',
        'B,2026,80%',
        'C,2024,70%',
        'C,2025,75%',
        'C,2026,76%'
    ].join('\n');
    const twoPeriodsCsv = [
        '부서,회계연도,사업연도,실적',
        'A,2025,2025,88%',
        'A,2026,2026,80%',
        'B,2025,2025,82%',
        'B,2026,2026,80%'
    ].join('\n');
    const p = makeProvider({ 'base.csv': baseCsv, 'two.csv': twoPeriodsCsv }, 'ko');

    const cases = [
        // [#, file, request, expectedStatuses: { goal, period, 'target.value', highlight }, extraCheck]
        [1, 'base.csv', '월별 집행률 추이를 보여줘.', { goal: 'applied:trend', period: 'unmatched', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [2, 'base.csv', '부서별 집행률을 차트로 보여줘.', { goal: 'unmatched', period: 'unmatched', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [3, 'base.csv', '목표 대비 감소한 부서를 보여줘.', { goal: 'ambiguous', period: 'unmatched', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [4, 'base.csv', '월별 추이는 빼고 부서별로 비교해 줘.', { goal: 'ambiguous', period: 'ambiguous', 'target.value': 'ambiguous', highlight: 'ambiguous' }],
        [5, 'base.csv', '2026과 2025의 부서별 실적 증감을 비교해 줘.', { goal: 'applied:change', period: 'applied:2025->2026', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [6, 'base.csv', '2026을 기준으로 2025의 실적 증감을 비교해 줘.', { goal: 'applied:change', period: 'applied:2026->2025', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [7, 'base.csv', '2025와 2027의 실적 증감을 보여줘.', { goal: 'applied:change', period: 'ambiguous', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [8, 'base.csv', '2024·2025·2026의 실적 증감을 보여줘.', { goal: 'applied:change', period: 'ambiguous', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [9, 'base.csv', '작년 같은 달과 집행액 증감을 보여줘.', { goal: 'applied:change', period: 'unmatched', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [10, 'two.csv', '2025와 2026의 실적 증감을 보여줘.', { goal: 'applied:change', period: 'ambiguous', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [11, 'base.csv', '2025년과 2026년 실적 증감을 보여줘.', { goal: 'applied:change', period: 'applied:2025->2026', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [12, 'base.csv', '집행률 목표는 90%로 표시해 줘.', { goal: 'applied:target', period: 'unmatched', 'target.value': 'applied:90', highlight: 'unmatched' }],
        [13, 'base.csv', '목표는 90% 이상으로 표시해 줘.', { goal: 'applied:target', period: 'unmatched', 'target.value': 'ambiguous', highlight: 'unmatched' }],
        [14, 'base.csv', '집행률 목표는 90%로 잡지 말고 85%로 표시해 줘.', { goal: 'ambiguous', period: 'ambiguous', 'target.value': 'ambiguous', highlight: 'ambiguous' }],
        [15, 'base.csv', '실적 증감에서 감소 폭이 가장 큰 세 곳을 강조해 줘.', { goal: 'applied:change', period: 'unmatched', 'target.value': 'unmatched', highlight: 'applied' }],
        [16, 'base.csv', '상위 3 곳은 강조하지 말아 줘.', { goal: 'ambiguous', period: 'ambiguous', 'target.value': 'ambiguous', highlight: 'ambiguous' }],
        [17, 'base.csv', '상위 3 곳만 따로 표로 주고 전체는 차트로 그려 줘.', { goal: 'unmatched', period: 'unmatched', 'target.value': 'unmatched', highlight: 'ambiguous' }],
        [18, 'base.csv', '상위 3.5%만 강조해 줘.', { goal: 'unmatched', period: 'unmatched', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [19, 'base.csv', '2026년도 대비 2025년의 실적 증감에서 감소 폭이 가장 큰 두 곳을 색으로 표시해 줘.', { goal: 'applied:change', period: 'applied:2026->2025', 'target.value': 'unmatched', highlight: 'applied' }],
        [20, 'base.csv', '2026년도 및 2025년의 실적 증감, 앞 연도를 기준으로 계산해 줘.', { goal: 'applied:change', period: 'ambiguous', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [21, 'base.csv', '전체 기관 차트에서 상위 3 곳을 강조해 줘.', { goal: 'unmatched', period: 'unmatched', 'target.value': 'unmatched', highlight: 'applied' }],
        [22, 'base.csv', '상위 3 곳은 목록으로 표시해 줘.', { goal: 'unmatched', period: 'unmatched', 'target.value': 'unmatched', highlight: 'ambiguous' }],
        [23, 'base.csv', '2025년과 2026년의 실적 증감에서 감소 폭이 가장 큰 두 곳은 표로 표시해 줘.', { goal: 'applied:change', period: 'applied:2025->2026', 'target.value': 'unmatched', highlight: 'ambiguous' }],
        [24, 'base.csv', '전년 동기 대비 집행액 증감을 보여줘.', { goal: 'applied:change', period: 'unmatched', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [25, 'base.csv', '2025년도 및 2026년의 실적 증감을 보여줘.', { goal: 'applied:change', period: 'applied:2025->2026', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [26, 'base.csv', '집행률 목표는 90%로, 달성률 목표는 95%로 표시해 줘.', { goal: 'applied:target', period: 'unmatched', 'target.value': 'ambiguous', highlight: 'unmatched' }],
        [27, 'base.csv', '집행률 목표는 90%로 정했지만 이번 차트에는 적용하지 않습니다.', { goal: 'ambiguous', period: 'ambiguous', 'target.value': 'ambiguous', highlight: 'ambiguous' }],
        [28, 'base.csv', '2026년도는 기준으로, 2025년 실적 증감을 보여줘.', { goal: 'applied:change', period: 'ambiguous', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [29, 'base.csv', '하위 3 곳만 차트에 표시해 줘.', { goal: 'applied:rank', period: 'unmatched', 'target.value': 'unmatched', highlight: 'unmatched' }],
        [30, 'base.csv', '감소 폭이 가장 큰 두 곳을 강조하되 나머지 수치는 목록으로도 표시해 줘.', { goal: 'applied:change', period: 'unmatched', 'target.value': 'unmatched', highlight: 'ambiguous' }]
    ];

    for (const [num, file, req, expected] of cases) {
        const res = await p.callTool('suggest_chart', { path: file, request: req });
        assert.notEqual(res.isError, true, `#${num}: ${res.content[0].text}`);
        const sc = res.structuredContent;
        // Raw request must not appear in structuredContent.
        assert.equal(JSON.stringify(sc).includes(req), false, `#${num}: raw request must not be echoed`);
        const byField = Object.fromEntries(sc.readFromRequest.map(r => [r.field, r]));
        let hasAmbiguous = false;
        for (const [field, spec] of Object.entries(expected)) {
            const [expStatus, expVal] = spec.split(':');
            assert.equal(byField[field].status, expStatus, `#${num} ${field}`);
            if (expStatus === 'ambiguous') hasAmbiguous = true;
            if (expVal !== undefined) {
                if (field === 'period') {
                    const [b, t] = expVal.split('->');
                    assert.equal(byField[field].value.base, b, `#${num} period.base`);
                    assert.equal(byField[field].value.target, t, `#${num} period.target`);
                } else if (field === 'target.value') {
                    assert.equal(byField[field].value, Number(expVal), `#${num} target.value`);
                } else {
                    assert.equal(byField[field].value, expVal, `#${num} ${field}`);
                }
            }
        }
        if (hasAmbiguous) {
            assert.ok(sc.confirm?.length > 0, `#${num}: confirm expected`);
            assert.ok(sc.candidates.every(c => c.build === undefined), `#${num}: build must be withheld when ambiguous`);
        }
        if (num === 19) {
            // 2026 -> 2025: A 80->88 (+8), B 80->82 (+2), C 76->75 (-1) -> only C decreased!
            assert.deepEqual(byField.highlight.value, { labels: ['C'] });
            assert.equal(byField.highlight.selected, 1);
            assert.deepEqual(sc.candidates[0].build.highlight, { labels: ['C'] });
        }
        if (num === 21) {
            assert.deepEqual(byField.highlight.value, { top: 3 });
        }
        if (num === 29) {
            assert.equal(sc.candidates[0].build.source.analysis.sort, 'asc');
            assert.equal(sc.candidates[0].build.source.analysis.limit, 3);
        }
    }

    // #29 on a unique-category dataset uses raw source.sort.order: 'asc' + limit: 3
    const pSingle = makeProvider({ 'single.csv': '부서,실적\nA,90%\nB,80%\nC,70%\nD,60%' }, 'ko');
    const r29Raw = await pSingle.callTool('suggest_chart', { path: 'single.csv', request: '하위 3 곳만 차트에 표시해 줘.' });
    assert.equal(r29Raw.structuredContent.goal, 'rank');
    assert.equal(r29Raw.structuredContent.candidates[0].build.source.sort.order, 'asc');
    assert.equal(r29Raw.structuredContent.candidates[0].build.source.limit, 3);

    // Explicit argument overrides parsed request field -> status: overridden
    const over = await p.callTool('suggest_chart', { path: 'base.csv', goal: 'compare', request: '월별 집행률 추이를 보여줘.' });
    const gEntry = over.structuredContent.readFromRequest.find(r => r.field === 'goal');
    assert.equal(gEntry.status, 'overridden');
    assert.equal(over.structuredContent.goal, 'compare');

    // F11: two explicit periods + prior-period comparison phrase -> chronological applied
    const f11 = await p.callTool('suggest_chart', {
        path: 'base.csv',
        request: '2025년과 2026년 부서별 실적을 비교해 줘. 전년 대비 감소가 가장 큰 세 곳을 강조해 줘'
    });
    assert.notEqual(f11.isError, true);
    const f11ByField = Object.fromEntries(f11.structuredContent.readFromRequest.map(r => [r.field, r]));
    assert.equal(f11ByField.goal.status, 'applied');
    assert.equal(f11ByField.goal.value, 'change');
    assert.equal(f11ByField.period.status, 'applied');
    assert.equal(f11ByField.period.value.base, '2025');
    assert.equal(f11ByField.period.value.target, '2026');
    assert.equal(f11ByField.highlight.status, 'applied');
    assert.deepEqual(f11ByField.highlight.value, { labels: ['A', 'B'] });
    assert.equal(f11.structuredContent.confirm, undefined);
    assert.ok(f11.structuredContent.candidates[0].build);
    for (const phrase of ['전년 동기 대비', '작년 대비', '전월 대비', '전기 대비']) {
        const res = await p.callTool('suggest_chart', { path: 'base.csv', request: `2025년과 2026년 부서별 실적을 ${phrase} 비교해 줘.` });
        const periodEntry = res.structuredContent.readFromRequest.find(r => r.field === 'period');
        assert.equal(periodEntry.status, 'applied', phrase);
        assert.equal(periodEntry.value.base, '2025', phrase);
        assert.equal(periodEntry.value.target, '2026', phrase);
    }
});

test('S3/S3′: failure path, buildOmitted too_long, and RESULT_TOO_LARGE', async () => {
    // 1. Failure path: all values null in filtered rows -> build_chart fails or valid < 1 -> candidate.failure
    const pFail = makeProvider({
        'bad.csv': 'cat,val\nA,1\nA,2\nB,3\nC,4',
        // scatter with 0 valid pairs (x missing when y present, y missing when x present)
        'nopairs.csv': 'x,y\n1,\n,2'
    });
    const noPairsRes = await pFail.callTool('suggest_chart', { path: 'nopairs.csv', goal: 'relationship' });
    assert.notEqual(noPairsRes.isError, true);
    assert.equal(noPairsRes.structuredContent.candidates[0].build, undefined);
    assert.equal(noPairsRes.structuredContent.candidates[0].failure.code, 'NO_VALID_DATA');

    // 2. buildOmitted: 'too_long' (long path + long filter + 2 candidates push total > 15,000 chars, stripping 2nd build brings it under)
    const longPath = `${'folder/'.repeat(500)}data.csv`; // ~3,508 chars
    const pLong = makeProvider({ [longPath]: 'cat,val\nA,10\nB,20\nC,30' });
    const longFilter = Array.from({ length: 4 }, (_, i) => ({ column: 'cat', op: 'ne', value: `${'x'.repeat(1200)}${i}` }));
    const resOmit = await pLong.callTool('suggest_chart', { path: longPath, goal: 'compare', filter: longFilter });
    assert.notEqual(resOmit.isError, true, resOmit.content[0].text);
    assert.ok(resOmit.structuredContent.candidates.some(c => c.buildOmitted === 'too_long'));
    assert.ok(resOmit.structuredContent.candidates[0].build, 'first candidate build preserved');

    // 3. RESULT_TOO_LARGE: even with all builds omitted, result exceeds 15,000 chars
    const pHuge = makeProvider({ 'small.csv': 'cat,val\nA,10\nB,20' });
    const hugeLabels = Array.from({ length: 50 }, (_, i) => `${'z'.repeat(350)}${i}`);
    const resTooLarge = await pHuge.callTool('suggest_chart', { path: 'small.csv', goal: 'compare', request: '비교해줘', highlight: { labels: hugeLabels } });
    assert.equal(resTooLarge.isError, true);
    assert.equal(errorCode(resTooLarge), 'RESULT_TOO_LARGE');
});
