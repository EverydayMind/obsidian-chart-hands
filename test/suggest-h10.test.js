'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const FIXTURES = path.join(__dirname, 'fixtures');
const loadCsv = async (name) => {
    const { parseDataset } = await import('../src/eda.js');
    return parseDataset(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
};

function loadProviderFactory() {
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
    const bundle = new Module(path.join(__dirname, 'plugin-under-test-h10.js'), module);
    bundle.filename = bundle.id;
    bundle.paths = Module._nodeModulePaths(__dirname);
    bundle._compile(require('./helpers/build-plugin')(), bundle.filename);
    Module._load = load;
    return bundle.exports.createAgentProvider;
}

test('H10 scenarios 1-14: shape words, column selection, summary drop, order, masking, filter, count and overview', async () => {
    const { suggestChart } = await import('../src/suggest.js');

    // 1. Stacked bar with 3 named series (summary column excluded)
    {
        const ds = await loadCsv('h10-capex.csv');
        const res = suggestChart(ds, { path: 'h10-capex.csv', request: '연도별 메모리·파운드리·소부장 투자를 누적 막대 차트로 만들어 줘' }, 'ko');
        assert.equal(res.candidates[0].type, 'bar');
        assert.equal(res.candidates[0].build.stacked, true);
        assert.equal(res.candidates[0].build.source.labels, '연도');
        assert.deepEqual(res.candidates[0].build.series, [
            { column: '메모리_조원' },
            { column: '파운드리·시스템_조원' },
            { column: '소부장_조원' }
        ]);
    }

    // 2. Wide-table share donut via summary source with 2026-01~2026-10 filter
    {
        const ds = await loadCsv('h10-export-country.csv');
        const res = suggestChart(ds, { path: 'h10-export-country.csv', request: '2026년 1~10월 누계 기준 국가별 수출 비중을 도넛 차트로' }, 'ko');
        assert.equal(res.confirm, undefined);
        assert.equal(res.candidates[0].type, 'donut');
        assert.deepEqual(res.candidates[0].build.source.analysis, {
            type: 'summary',
            columns: ['중국', '홍콩', '대만', '베트남', '미국', '일본', '기타'],
            function: 'sum',
            filter: [
                { column: '연월', op: 'gte', value: '2026-01' },
                { column: '연월', op: 'lte', value: '2026-10' }
            ]
        });
        assert.deepEqual(res.candidates[0].build.series, [{ column: 'value' }]);
    }

    // 3. Combo with per-series kind (bar, bar, line)
    {
        const ds = await loadCsv('h10-power.csv');
        const res = suggestChart(ds, { path: 'h10-power.csv', request: '필요전력과 확보전력은 막대로, 부족 전력은 선으로 겹친 차트' }, 'ko');
        assert.equal(res.candidates[0].type, 'combo');
        assert.equal(res.candidates[0].build.source.labels, '연도');
        assert.deepEqual(res.candidates[0].build.series, [
            { column: '필요전력_GW', kind: 'bar' },
            { column: '확보전력_GW', kind: 'bar' },
            { column: '부족_GW', kind: 'line' }
        ]);
    }

    // 4. Multi-series line trend since 2022 with range_slider
    {
        const ds = await loadCsv('h10-gas-price.csv');
        const res = suggestChart(ds, { path: 'h10-gas-price.csv', request: '2022년부터 네온·크립톤·제논 단가 추이를 한 차트에 그리고 기간을 좁혀 볼 수 있게' }, 'ko');
        assert.equal(res.confirm, undefined);
        assert.equal(res.candidates[0].type, 'line');
        assert.equal(res.candidates[0].build.range_slider, true);
        assert.deepEqual(res.candidates[0].build.series, [
            { column: '네온_달러kg' },
            { column: '크립톤_달러kg' },
            { column: '제논_달러kg' }
        ]);
        assert.deepEqual(res.candidates[0].build.source.filter, [
            { column: '연월', op: 'gte', value: '2022-01' }
        ]);
    }

    // 5. Long-table heatmap via pivot [주차, 품목, 재고일수]
    {
        const ds = await loadCsv('h10-inventory-weekly.csv');
        const res = suggestChart(ds, { path: 'h10-inventory-weekly.csv', request: '품목별·주차별 재고일수를 히트맵으로' }, 'ko');
        assert.equal(res.confirm, undefined);
        assert.equal(res.candidates[0].type, 'heatmap');
        assert.deepEqual(res.candidates[0].build.source.analysis, {
            type: 'pivot',
            columns: ['주차', '품목', '재고일수'],
            function: 'mean'
        });
        assert.deepEqual(res.candidates[0].build.series, [{ column: 'value' }]);
    }

    // 6. Stacked area with 3 named series on 주차
    {
        const ds = await loadCsv('h10-alert-summary.csv');
        const res = suggestChart(ds, { path: 'h10-alert-summary.csv', request: '주차별 관심·주의·경계 품목 수 변화를 누적 영역 차트로' }, 'ko');
        assert.equal(res.candidates[0].type, 'area');
        assert.equal(res.candidates[0].build.stacked, true);
        assert.equal(res.candidates[0].build.source.labels, '주차');
        assert.deepEqual(res.candidates[0].build.series, [
            { column: '관심' },
            { column: '주의' },
            { column: '경계' }
        ]);
    }

    // 7. Scatter with column head masking (최대국비중_% does not trigger share), x, y, and point labels
    {
        const ds = await loadCsv('h10-items.csv');
        const res = suggestChart(ds, { path: 'h10-items.csv', request: '최대국 비중과 국산화율의 관계를 산점도로, 점마다 품목 이름' }, 'ko');
        assert.equal(res.goal, 'relationship');
        assert.equal(res.confirm, undefined);
        assert.equal(res.candidates[0].type, 'scatter');
        assert.equal(res.candidates[0].build.source.x, '최대국비중_%');
        assert.equal(res.candidates[0].build.source.labels, '품목');
        assert.deepEqual(res.candidates[0].build.series, [{ column: '국산화율_%' }]);
    }

    // 8. Bottom 5 horizontal bar chart with print style
    {
        const ds = await loadCsv('h10-items.csv');
        const res = suggestChart(ds, { path: 'h10-items.csv', request: '업계 재고일수가 가장 적은 5개 품목을 흑백 인쇄용 가로 막대 차트로' }, 'ko');
        assert.equal(res.goal, 'rank');
        assert.equal(res.candidates[0].type, 'barh');
        assert.deepEqual(res.candidates[0].build.source.sort, { column: '재고일수', order: 'asc' });
        assert.equal(res.candidates[0].build.source.limit, 5);
        assert.equal(res.candidates[0].build.style, 'print');
    }

    // 9. ISO week eq filter + aggregate count bar chart
    {
        const ds = await loadCsv('h10-inventory-weekly.csv');
        const res = suggestChart(ds, { path: 'h10-inventory-weekly.csv', request: '2026-W45 주의 경보단계별 품목 수를 막대 차트로' }, 'ko');
        assert.equal(res.confirm, undefined);
        assert.equal(res.candidates[0].type, 'bar');
        assert.deepEqual(res.candidates[0].build.source.analysis, {
            type: 'aggregate',
            columns: ['경보단계'],
            function: 'count',
            sort: 'desc',
            filter: [{ column: '주차', op: 'eq', value: '2026-W45' }]
        });
        assert.deepEqual(res.candidates[0].build.series, [{ column: 'value' }]);
    }

    // 10. English report chart largest first (with explicit value on Korean headers, and automatic on English headers)
    {
        const dsKo = await loadCsv('h10-workforce.csv');
        const resKo = suggestChart(dsKo, {
            path: 'h10-workforce.csv',
            values: ['부족_명'],
            request: 'a report chart of the shortage by job role, largest first'
        }, 'en');
        assert.equal(resKo.goal, 'rank');
        assert.ok(['barh', 'bar'].includes(resKo.candidates[0].type));
        assert.equal(resKo.candidates[0].build.source.analysis.sort, 'desc');
        assert.deepEqual(resKo.candidates[0].build.source.analysis.columns, ['직무', '부족_명']);
        assert.equal(resKo.candidates[0].build.style, 'report');

        const dsEn = await loadCsv('h10-workforce-en.csv');
        const resEn = suggestChart(dsEn, {
            path: 'h10-workforce-en.csv',
            request: 'a report chart of the shortage by job role, largest first'
        }, 'en');
        assert.equal(resEn.goal, 'rank');
        assert.ok(['barh', 'bar'].includes(resEn.candidates[0].type));
        assert.equal(resEn.candidates[0].build.source.analysis.sort, 'desc');
        assert.deepEqual(resEn.candidates[0].build.source.analysis.columns, ['job_role', 'shortage']);
        assert.equal(resEn.candidates[0].build.style, 'report');
    }

    // 11. Korean rank desc ("많은 순")
    {
        const ds = await loadCsv('h10-workforce.csv');
        const res = suggestChart(ds, { path: 'h10-workforce.csv', request: '직무별 부족 인원을 많은 순으로 차트로' }, 'ko');
        assert.equal(res.goal, 'rank');
        assert.equal(res.candidates[0].type, 'barh');
        assert.equal(res.candidates[0].build.source.analysis.sort, 'desc');
        assert.deepEqual(res.candidates[0].build.source.analysis.columns, ['직무', '부족_명']);
    }

    // 12. Overview when goal is unset and no confirm
    {
        const ds = await loadCsv('h10-items.csv');
        const res = suggestChart(ds, { path: 'h10-items.csv', request: '보고서에 쓸 만한 차트를 세 가지 추천해 줘' }, 'ko');
        assert.equal(res.goal, null);
        assert.equal(res.overview, true);
        assert.equal(res.needs, undefined);
        assert.equal(res.candidates.length, 3);
        assert.ok(res.notes.some(n => n.includes('목적을 몰라')));
    }

    // 13. Monthly semiconductor export trend for approval report
    {
        const ds = await loadCsv('h10-semicon-export.csv');
        const res = suggestChart(ds, { path: 'h10-semicon-export.csv', request: '월별 반도체 수출 추이를 결재용 차트로' }, 'ko');
        assert.equal(res.goal, 'trend');
        assert.equal(res.candidates[0].type, 'line');
        assert.equal(res.candidates[0].build.style, 'report');
        assert.deepEqual(res.candidates[0].build.series, [{ column: '반도체수출_억달러' }]);
    }

    // 14. Distribution shape word (histogram)
    {
        const ds = await loadCsv('h10-items.csv');
        const res = suggestChart(ds, { path: 'h10-items.csv', request: '국산화율 분포를 히스토그램으로 보여줘' }, 'ko');
        assert.equal(res.goal, 'distribution');
        assert.equal(res.candidates[0].type, 'histogram');
        assert.deepEqual(res.candidates[0].build.series, [{ column: '국산화율_%' }]);
    }
});

test('H10 rules: summary column exclusion, unsupported shape guide, exact column head masking, category eq filter and English overview', async () => {
    const { parseDataset } = await import('../src/eda.js');
    const { suggestChart } = await import('../src/suggest.js');

    // Summary column dropped with caution when paired with component columns
    const capex = await loadCsv('h10-capex.csv');
    const capexAll = suggestChart(capex, { path: 'h10-capex.csv', request: '연도별 투자를 누적 막대 차트로' }, 'ko');
    assert.equal(capexAll.candidates[0].type, 'bar');
    assert.equal(capexAll.candidates[0].build.stacked, true);
    assert.deepEqual(capexAll.candidates[0].build.series.map(s => s.column), ['메모리_조원', '파운드리·시스템_조원', '소부장_조원']);
    assert.ok(capexAll.candidates[0].cautions.some(c => c.includes('합계_조원')));

    // Unsupported shape produces no candidates and cites get_chart_guide topic
    const sankeyKo = suggestChart(capex, { path: 'h10-capex.csv', request: '연도별 투자를 산키 차트로 그려 줘' }, 'ko');
    assert.equal(sankeyKo.candidates.length, 0);
    assert.equal(sankeyKo.overview, undefined);
    assert.ok(sankeyKo.cautions.some(c => c.includes('get_chart_guide') && c.includes('hierarchy')));

    const mapEn = suggestChart(capex, { path: 'h10-capex.csv', request: 'Plot this as a choropleth map' }, 'en');
    assert.equal(mapEn.candidates.length, 0);
    assert.ok(mapEn.cautions.some(c => c.includes('get_chart_guide') && c.includes('maps')));

    // Column head equal to goal keyword ("목표") is NOT masked
    const targetDs = parseDataset('부서,실적,목표\nA,80,100\nB,110,100');
    const targetRes = suggestChart(targetDs, { path: 't.csv', request: '목표는 95로 표시해 줘' }, 'ko');
    assert.equal(targetRes.goal, 'target');
    assert.equal(targetRes.candidates[0].build.target.value, 95);

    // Exact single category value mention -> eq filter; two values -> no filter
    const items = await loadCsv('h10-items.csv');
    const oneCat = suggestChart(items, { path: 'h10-items.csv', request: '노광 품목별 재고일수를 막대 차트로' }, 'ko');
    assert.deepEqual(oneCat.candidates[0].build.source.filter, [{ column: '분야', op: 'eq', value: '노광' }]);
    const twoCats = suggestChart(items, { path: 'h10-items.csv', request: '노광과 식각 품목별 재고일수를 막대 차트로' }, 'ko');
    assert.equal(twoCats.candidates[0].build.source.filter, undefined);

    // English shape + order + overview + highlight preservation
    const enWorkforce = await loadCsv('h10-workforce-en.csv');
    const enOverview = suggestChart(enWorkforce, { path: 'h10-workforce-en.csv', request: 'Recommend three charts for my report.' }, 'en');
    assert.equal(enOverview.goal, null);
    assert.equal(enOverview.overview, true);
    assert.equal(enOverview.needs, undefined);
    assert.ok(enOverview.candidates.length >= 2 && enOverview.candidates.length <= 3);
    assert.ok(enOverview.notes[0].includes('data shape'));

    const enLowest = suggestChart(enWorkforce, { path: 'h10-workforce-en.csv', request: 'Show the 2 lowest shortage by job role as a printable horizontal bar chart.' }, 'en');
    assert.equal(enLowest.goal, 'rank');
    assert.equal(enLowest.candidates[0].type, 'barh');
    assert.equal(enLowest.candidates[0].build.source.analysis.sort, 'asc');
    assert.equal(enLowest.candidates[0].build.source.analysis.limit, 2);
    assert.equal(enLowest.candidates[0].build.style, 'print');

    // Explicit highlight preserved on overview candidates
    const withHi = suggestChart(items, { path: 'h10-items.csv', request: '차트를 추천해 줘', highlight: { top: 2 } }, 'ko');
    assert.equal(withHi.overview, true);
    const barCand = withHi.candidates.find(c => c.type === 'bar' || c.type === 'barh');
    assert.deepEqual(barCand.build.highlight, { top: 2 });

    // Gauge indicator shape word
    const gaugeRes = suggestChart(items, { path: 'h10-items.csv', request: '국산화율을 게이지로, 목표는 30' }, 'ko');
    assert.equal(gaugeRes.candidates[0].type, 'indicator');
    assert.equal(gaugeRes.candidates[0].build.gauge, true);
    assert.deepEqual(gaugeRes.candidates[0].build.target, { value: 30 });

    // Provider summary text reflects overview (ko & en)
    const createAgentProvider = loadProviderFactory();
    const files = { 'items.csv': fs.readFileSync(path.join(FIXTURES, 'h10-items.csv'), 'utf8') };
    const makeP = (locale) => createAgentProvider({
        app: {
            vault: {
                getFiles: () => [{ path: 'items.csv', extension: 'csv' }],
                getAbstractFileByPath: (p) => Object.hasOwn(files, p) ? { path: p, extension: 'csv' } : null,
                cachedRead: async (f) => files[f.path]
            }
        },
        manifest: { id: 'chart-hands', name: 'Chart Hands', version: '0.11.5' }
    }, locale);
    const pKo = await makeP('ko').callTool('suggest_chart', { path: 'items.csv', request: '차트를 추천해 줘' });
    assert.equal(pKo.structuredContent.overview, true);
    assert.ok(pKo.content[0].text.includes('목적을 몰라'));
    const pEn = await makeP('en').callTool('suggest_chart', { path: 'items.csv', request: 'Recommend charts for this data.' });
    assert.equal(pEn.structuredContent.overview, true);
    assert.ok(pEn.content[0].text.includes('data shape'));
});
