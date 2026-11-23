'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'obsidian') {
        return {
            Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {}, moment: { locale: () => 'en' },
            parseYaml: (text) => JSON.parse(text.replace(/^\s*#.*$/gm, '')),
            stringifyYaml: (value) => JSON.stringify(value, null, 2) + '\n'
        };
    }
    return load.call(this, request, ...rest);
};
const bundle = new Module(path.join(__dirname, 'plugin-under-test-suggest-en.js'), module);
bundle.filename = bundle.id;
bundle.paths = Module._nodeModulePaths(__dirname);
bundle._compile(require('./helpers/build-plugin')(), bundle.filename);
const { createAgentProvider } = bundle.exports;
Module._load = load;

const MANIFEST = { id: 'chart-hands', name: 'Chart Hands', version: '0.11.3' };
const makeProvider = (files, locale = 'en') => createAgentProvider({
    app: {
        vault: {
            getFiles: () => Object.keys(files).map(p => ({ path: p, extension: p.split('.').pop() })),
            getAbstractFileByPath: (file) => Object.hasOwn(files, file) ? { path: file, extension: file.split('.').pop() } : null,
            cachedRead: async (file) => files[file.path]
        }
    },
    manifest: MANIFEST
}, locale, { now: () => new Date(2026, 10, 23) });

const DEPT_CSV = [
    'department,year,amount',
    'Sales,2025,100',
    'Sales,2026,130',
    'Design,2025,90',
    'Design,2026,110',
    'Product,2025,120',
    'Product,2026,125',
    'HR,2025,80',
    'HR,2026,60',
    'Finance,2025,70',
    'Finance,2026,55',
    'Ops,2025,60',
    'Ops,2026,50'
].join('\n');

const MONTHLY_CSV = [
    'month,amount',
    'Jan 2025,100',
    'Feb 2025,110',
    'Mar 2025,105',
    'Apr 2025,120',
    'May 2025,130',
    'Jun 2025,140'
].join('\n');

test('E1-E5 & E7-E8: 22 English request examples from §15.4', async () => {
    const { parseDataset } = await import('../src/eda.js');
    const { inspectColumn } = await import('../src/column-roles.js');
    const { parseRequest } = await import('../src/suggest.js');

    const deptDs = parseDataset(DEPT_CSV);
    const deptCols = deptDs.headers.map((_, i) => inspectColumn(deptDs, i));
    const p = makeProvider({ 'dept.csv': DEPT_CSV, 'monthly.csv': MONTHLY_CSV }, 'en');

    const ask = async (args) => {
        const res = await p.callTool('suggest_chart', args);
        assert.notEqual(res.isError, true, `${JSON.stringify(args)}: ${res.content[0].text}`);
        const sc = res.structuredContent;
        if (args.request) {
            assert.equal(JSON.stringify(sc).includes(args.request), false, `raw request must not be echoed: ${args.request}`);
        }
        const byField = Object.fromEntries(sc.readFromRequest.map(r => [r.field, r]));
        return { sc, byField };
    };

    // #1: period applied 2025→2026, highlight applied {kind:'decrease',count:3}, goal applied change
    {
        const req = 'Compare 2025 and 2026 by department and highlight the three largest declines.';
        const parsed = parseRequest(req, deptCols, {}, 'en');
        assert.deepEqual(parsed.entries.highlight.value, { kind: 'decrease', count: 3 });
        const { sc, byField } = await ask({ path: 'dept.csv', request: req });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, '2025');
        assert.equal(byField.period.value.target, '2026');
        assert.equal(byField.highlight.status, 'applied');
        assert.deepEqual(byField.highlight.value, { labels: ['HR', 'Finance', 'Ops'] });
        assert.equal(byField.highlight.selected, 3);
        assert.equal(byField.goal.status, 'applied');
        assert.equal(byField.goal.value, 'change');
        assert.ok(sc.candidates[0].build);
    }

    // #2: period unmatched, highlight applied {top:3}
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Highlight the top 3 departments in 2026.' });
        assert.equal(byField.period.status, 'unmatched');
        assert.equal(byField.highlight.status, 'applied');
        assert.deepEqual(byField.highlight.value, { top: 3 });
    }

    // #3: rankOverride top 5 desc (goal applied rank)
    {
        const { sc, byField } = await ask({ path: 'dept.csv', request: 'Show only the top 5 departments.' });
        assert.equal(byField.goal.status, 'applied');
        assert.equal(byField.goal.value, 'rank');
        assert.equal(byField.highlight.status, 'unmatched');
        assert.equal(sc.candidates[0].build.source.analysis.sort, 'desc');
        assert.equal(sc.candidates[0].build.source.analysis.limit, 5);
    }

    // #4: rankOverride top 3 asc
    {
        const { sc, byField } = await ask({ path: 'dept.csv', request: 'Show only the bottom 3 departments.' });
        assert.equal(byField.goal.status, 'applied');
        assert.equal(byField.goal.value, 'rank');
        assert.equal(byField.highlight.status, 'unmatched');
        assert.equal(sc.candidates[0].build.source.analysis.sort, 'asc');
        assert.equal(sc.candidates[0].build.source.analysis.limit, 3);
    }

    // #5: period applied 2025→2026, highlight applied {bottom:2}
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Compare 2026 with 2025 and highlight the bottom 2.' });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, '2025');
        assert.equal(byField.period.value.target, '2026');
        assert.equal(byField.highlight.status, 'applied');
        assert.deepEqual(byField.highlight.value, { bottom: 2 });
    }

    // #6: period applied base 2025, target 2026
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Show 2026 compared with 2025.' });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, '2025');
        assert.equal(byField.period.value.target, '2026');
    }

    // #7: period applied base 2026, target 2025
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Show 2025 compared to 2026.' });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, '2026');
        assert.equal(byField.period.value.target, '2025');
    }

    // #8: period applied base 2026, target 2025
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Show the change from 2026 to 2025.' });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, '2026');
        assert.equal(byField.period.value.target, '2025');
    }

    // #9: period applied base 2026, target 2025
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Use 2026 as the baseline and compare 2025.' });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, '2026');
        assert.equal(byField.period.value.target, '2025');
    }

    // #10: period applied 2025→2026
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Compare 2025 and 2026 year over year.' });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, '2025');
        assert.equal(byField.period.value.target, '2026');
    }

    // #11: period applied base 2025, target 2026
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'How did 2026 do against 2025?' });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, '2025');
        assert.equal(byField.period.value.target, '2026');
    }

    // #12: period ambiguous, confirm two directions
    {
        const { sc, byField } = await ask({ path: 'dept.csv', request: 'Compare 2025 and 2026, earlier year as the target.' });
        assert.equal(byField.period.status, 'ambiguous');
        const periodConfirm = sc.confirm.find(c => c.field === 'period');
        assert.deepEqual(periodConfirm.candidates, ['2025→2026', '2026→2025']);
        assert.ok(sc.candidates.every(c => c.build === undefined));
    }

    // #13: negation -> all non-overridden fields ambiguous
    {
        const { sc, byField } = await ask({ path: 'dept.csv', request: 'Compare all departments except 2025.' });
        for (const field of ['goal', 'period', 'target.value', 'highlight']) {
            assert.equal(byField[field].status, 'ambiguous', field);
        }
        assert.ok(sc.confirm.length === 4);
    }

    // #14: target.value applied 100
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Show amount by department with a target of 100.' });
        assert.equal(byField['target.value'].status, 'applied');
        assert.equal(byField['target.value'].value, 100);
    }

    // #15: target.value applied 90 (same format as Korean 목표 90%)
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Draw a 90% target line.' });
        assert.equal(byField['target.value'].status, 'applied');
        assert.equal(byField['target.value'].value, 90);
    }

    // #16: period applied 2025→2026, highlight applied {kind:'increase',count:3}
    {
        const req = 'Highlight the 3 largest increases in 2026 vs 2025.';
        const parsed = parseRequest(req, deptCols, {}, 'en');
        assert.deepEqual(parsed.entries.highlight.value, { kind: 'increase', count: 3 });
        const { byField } = await ask({ path: 'dept.csv', request: req });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, '2025');
        assert.equal(byField.period.value.target, '2026');
        assert.equal(byField.highlight.status, 'applied');
        assert.deepEqual(byField.highlight.value, { labels: ['Sales', 'Design', 'Product'] });
        assert.equal(byField.highlight.selected, 3);
    }

    // #17: highlight unmatched (no highlight word)
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'Show the three departments with the biggest drop.' });
        assert.equal(byField.highlight.status, 'unmatched');
    }

    // #18: highlight ambiguous (highlight word + only)
    {
        const { sc, byField } = await ask({ path: 'dept.csv', request: 'Emphasize only the five largest declines.' });
        assert.equal(byField.highlight.status, 'ambiguous');
        assert.ok(sc.confirm.some(c => c.field === 'highlight'));
    }

    // #19: highlight ambiguous (as a table)
    {
        const { sc, byField } = await ask({ path: 'dept.csv', request: 'Show the top 3 as a table.' });
        assert.equal(byField.highlight.status, 'ambiguous');
        assert.ok(sc.confirm.some(c => c.field === 'highlight'));
    }

    // #20: period unmatched ('may' is not a period), highlight applied {top:2}
    {
        const { byField } = await ask({ path: 'dept.csv', request: 'You may highlight the top 2.' });
        assert.equal(byField.period.status, 'unmatched');
        assert.equal(byField.highlight.status, 'applied');
        assert.deepEqual(byField.highlight.value, { top: 2 });
    }

    // #21: monthly data Jan 2025..Jun 2025 -> period applied Jan 2025→Jun 2025
    {
        const { byField } = await ask({ path: 'monthly.csv', request: 'Compare Jan 2025 and Jun 2025.' });
        assert.equal(byField.period.status, 'applied');
        assert.equal(byField.period.value.base, 'Jan 2025');
        assert.equal(byField.period.value.target, 'Jun 2025');
    }

    // #22: goal:'compare' with two periods -> E8 compare period bar candidate, builds valid:true
    {
        const { sc } = await ask({ path: 'dept.csv', goal: 'compare', request: 'Compare 2025 and 2026 by department.' });
        assert.equal(sc.candidates.length, 3);
        const first = sc.candidates[0];
        assert.equal(first.type, 'bar');
        assert.equal(first.why, 'Compares 2025 and 2026 side by side for each category.');
        assert.deepEqual(first.build.source.analysis, {
            type: 'compare',
            columns: ['department', 'amount'],
            period: { column: 'year', base: '2025', target: '2026' },
            function: 'mean'
        });
        assert.deepEqual(first.build.series, [
            { column: 'base', name: '2025' },
            { column: 'target', name: '2026' }
        ]);
        const built = await p.callTool('build_chart', first.build);
        assert.notEqual(built.isError, true, built.content[0].text);
        assert.equal(built.structuredContent.valid, true);
    }
});

test('coordinator review: "from" without "to" and a year before "target" are not read as direction or target', async () => {
    const p = makeProvider({ 'dept.csv': DEPT_CSV }, 'en');
    const read = async (request) => Object.fromEntries((await p.callTool('suggest_chart', { path: 'dept.csv', request })).structuredContent.readFromRequest.map(r => [r.field, r]));
    const fromData = await read('Compare 2025 and 2026 from the sales data.');
    assert.equal(fromData.period.status, 'applied');
    assert.deepEqual([fromData.period.value.base, fromData.period.value.target], ['2025', '2026']);
    const fromTo = await read('Show the change from 2026 to 2025.');
    assert.deepEqual([fromTo.period.value.base, fromTo.period.value.target], ['2026', '2025']);
    const yearTarget = await read('Show the 2026 target by department.');
    assert.notEqual(yearTarget['target.value'].status, 'applied');
    const percentTarget = await read('Draw a 90% target line.');
    assert.equal(percentTarget['target.value'].status, 'applied');
});

test('E7 & E8 edge cases: month-name period role, compare without period caution, barh for long categories', async () => {
    const { parseDataset } = await import('../src/eda.js');
    const { columnRole } = await import('../src/column-roles.js');

    // Month-name column is classified as period even without a period header
    const mDs = parseDataset('label,amount\nJan 2025,10\nFeb 2025,20\nMar 2025,30');
    assert.equal(columnRole(mDs, 0), 'period');
    const mOnlyDs = parseDataset('month,amount\nJan,10\nFeb,20\nMar,30');
    assert.equal(columnRole(mOnlyDs, 0), 'period');
    const hDs = parseDataset('half,amount\nH1 2025,10\nH2 2025,20');
    assert.equal(columnRole(hDs, 0), 'period');

    const longDeptCsv = [
        'department,year,amount',
        'Engineering,2025,100 USD',
        'Engineering,2026,120 USD',
        'Marketing,2025,80 USD',
        'Marketing,2026,95 USD'
    ].join('\n');
    const pEn = makeProvider({ 'dept.csv': DEPT_CSV, 'long.csv': longDeptCsv }, 'en');
    const pKo = makeProvider({ 'dept.csv': DEPT_CSV, 'long.csv': longDeptCsv }, 'ko');

    // E8 without period: caution about combining periods
    const noPeriodEn = (await pEn.callTool('suggest_chart', { path: 'dept.csv', goal: 'compare' })).structuredContent;
    assert.ok(noPeriodEn.candidates[0].cautions.includes('Period column year is present, so the aggregate combines periods (mean). Pass period to compare periods.'));
    const noPeriodKo = (await pKo.callTool('suggest_chart', { path: 'dept.csv', goal: 'compare' })).structuredContent;
    assert.ok(noPeriodKo.candidates[0].cautions.includes('기간 열 year이 있어 집계가 여러 기간을 합칩니다(mean). 기간별로 비교하려면 period를 주세요.'));

    // E8 with explicit args.period and long category names -> barh + sum + valid build_chart
    const longRes = (await pEn.callTool('suggest_chart', {
        path: 'long.csv',
        goal: 'compare',
        period: { column: 'year', base: '2025', target: '2026' }
    })).structuredContent;
    assert.equal(longRes.candidates[0].type, 'barh');
    assert.equal(longRes.candidates[0].build.source.analysis.function, 'sum');
    const builtLong = await pEn.callTool('build_chart', longRes.candidates[0].build);
    assert.notEqual(builtLong.isError, true, builtLong.content[0].text);
    assert.equal(builtLong.structuredContent.valid, true);

    // Korean wording for E8 with period applied
    const koRes = (await pKo.callTool('suggest_chart', {
        path: 'dept.csv',
        goal: 'compare',
        period: { column: 'year', base: '2025', target: '2026' }
    })).structuredContent;
    assert.equal(koRes.candidates[0].why, '2025·2026 두 기간을 범주별로 나란히 비교합니다.');

    // Number-first English rank quantity + pp mean aggregation
    const ppCsv = 'department,year,margin\nSales,2025,10 pp\nSales,2026,12 pp\nOps,2025,8 pp\nOps,2026,9 pp';
    const pExtra = makeProvider({ 'pp.csv': ppCsv }, 'en');
    const ppRes = (await pExtra.callTool('suggest_chart', { path: 'pp.csv', request: 'Highlight the 2 lowest departments.' })).structuredContent;
    const hi = ppRes.readFromRequest.find(r => r.field === 'highlight');
    assert.equal(hi.status, 'applied');
    assert.deepEqual(hi.value, { bottom: 2 });
    const ppCompare = (await pExtra.callTool('suggest_chart', { path: 'pp.csv', goal: 'compare' })).structuredContent;
    assert.equal(ppCompare.candidates[0].build.source.analysis.function, 'mean');
});
