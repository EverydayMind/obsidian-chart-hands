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

test('E6 English units: parseCell, mixed-unit rejection, profile, display spacing and additive sums', async () => {
    const { joinUnit, displayGroup, chartFacts } = await import('../src/chart-facts.js');
    const { buildChartDefinition } = await import('../src/chart-builder.js');

    for (const [input, value, unit, notation] of [
        ['1.2K', 1.2, 'K'], ['3k', 3, 'k'], ['2.5M', 2.5, 'M'], ['1B', 1, 'B'],
        ['4 bn', 4, 'bn'], ['5 mn', 5, 'mn'], ['3 million', 3, 'million'],
        ['10 thousand', 10, 'thousand'], ['2 billion', 2, 'billion'],
        ['USD 1,200', 1200, 'USD'], ['EUR 900', 900, 'EUR'], ['1,200 USD', 1200, 'USD'],
        ['500 KRW', 500, 'KRW'], ['100 JPY', 100, 'JPY'], ['80 GBP', 80, 'GBP'],
        ['12 pp', 12, 'pp'], ['50 pcs', 50, 'pcs'], ['10 units', 10, 'units'],
        ['20 people', 20, 'people'], ['5 cases', 5, 'cases'], ['8 items', 8, 'items'],
        ['(1.2K)', -1.2, 'K', '()'], ['(USD 1,200)', -1200, 'USD', '()'],
        ['USD (1,200)', -1200, 'USD', '()'], ['(1,200 USD)', -1200, 'USD', '()'],
        ['$120K', 120, '$K'], ['€2.5M', 2.5, '€M'], ['$3 million', 3, '$ million'], ['£4bn', 4, '£bn'],
        ['($1.2K)', -1.2, '$K', '()'], ['-$5K', -5, '$K']
    ]) {
        assert.deepEqual(parseCell(input), { value, unit, ...(notation ? { notation } : {}) }, input);
    }

    // Mixed English units are rejected
    const mixed = parseDataset('g,v\na,1.2K\nb,2M');
    assert.equal(profile(mixed).columns[1].type, 'text');
    assert.deepEqual(profile(mixed).columns[1].mixedUnits, ['K', 'M']);
    assert.throws(() => analyze(mixed, { type: 'summary', columns: ['v'] }, 'en'), /mixed units/);

    // eda_profile detects E6 columns as numeric with unit
    const prof = profile(parseDataset('m,rev,share_chg\nJan 2025,"USD 1,200",12 pp\nFeb 2025,"USD 1,500",14 pp')).columns;
    assert.equal(prof[1].type, 'number');
    assert.equal(prof[1].unit, 'USD');
    assert.equal(prof[2].type, 'number');
    assert.equal(prof[2].unit, 'pp');

    // Display spacing: 2+ letter English units get a space; 1-letter and kg/km do not
    assert.equal(joinUnit('3', 'million'), '3 million');
    assert.equal(joinUnit('1,200', 'USD'), '1,200 USD');
    assert.equal(joinUnit('1.2', 'K'), '1.2K');
    assert.equal(joinUnit('12', 'pp'), '12 pp');
    assert.equal(joinUnit('10', 'kg'), '10kg');
    assert.equal(joinUnit('5', 'km'), '5km');
    assert.deepEqual(displayGroup([3], { unit: 'million' }).strings, ['3 million']);
    assert.deepEqual(displayGroup([1200], { unit: 'USD' }).strings, ['1,200 USD']);
    assert.deepEqual(displayGroup([1.2], { unit: 'K' }).strings, ['1.2K']);
    assert.deepEqual(displayGroup([12], { unit: 'pp' }).strings, ['12 pp']);
    assert.deepEqual(displayGroup([5], { unit: 'pp', quantity: 'difference' }).strings, ['+5 pp']);

    // build_chart uses the same spacing rule for target annotation and indicator suffix
    assert.equal(buildChartDefinition({ type: 'bar', labels: ['A'], series: [{ values: [1] }], unit: 'USD', target: { value: 100 } }, { locale: 'en' }).layout.annotations[0].text, 'Target 100 USD');
    assert.equal(buildChartDefinition({ type: 'bar', labels: ['A'], series: [{ values: [1] }], unit: 'K', target: { value: 1.2 } }, { locale: 'en' }).layout.annotations[0].text, 'Target 1.2K');
    assert.equal(buildChartDefinition({ type: 'indicator', series: [{ values: [1200] }], unit: 'USD' }, { locale: 'en' }).data[0].number.suffix, ' USD');
    assert.equal(buildChartDefinition({ type: 'indicator', series: [{ values: [1.2] }], unit: 'K' }, { locale: 'en' }).data[0].number.suffix, 'K');

    // Additive units sum in chartFacts; pp does not
    assert.equal(chartFacts({ type: 'bar', labels: ['A', 'B'], series: [{ values: [1, 2] }], unit: 'USD' }, { beforeLimit: 2 }).series[0].sumOfShown, 3);
    assert.equal(chartFacts({ type: 'bar', labels: ['A', 'B'], series: [{ values: [1, 2] }], unit: 'people' }, { beforeLimit: 2 }).series[0].sumOfShown, 3);
    assert.equal(chartFacts({ type: 'bar', labels: ['A', 'B'], series: [{ values: [1, 2] }], unit: 'pp' }, { beforeLimit: 2 }).series[0].sumOfShown, undefined);
});

test('currency symbol with a scale suffix: one unit, prefix display, additive, mixed refused', async () => {
    const { joinUnit, displayGroup } = await import('../src/chart-facts.js');
    const { buildChartDefinition } = await import('../src/chart-builder.js');
    assert.equal(joinUnit('120', '$K'), '$120K');
    assert.equal(joinUnit('3', '$ million'), '$3 million');
    assert.deepEqual(displayGroup([120, 96], { unit: '$K' }).strings, ['$120K', '$96K']);
    // Same sign placement as a bare "$" unit ("$−24").
    assert.deepEqual(displayGroup([-24, 26], { unit: '$K', quantity: 'difference' }).strings, ['$−24K', '$+26K']);
    const ds = parseDataset('g,v\nA,$120K\nB,$96K');
    assert.equal(analyze(ds, { type: 'aggregate', columns: ['g', 'v'], function: 'sum' }).unit, '$K');
    assert.throws(() => analyze(parseDataset('g,v\nA,$120K\nB,96K'), { type: 'aggregate', columns: ['g', 'v'], function: 'sum' }), /mixed units|단위가 섞여/);
    const indicator = buildChartDefinition({ type: 'indicator', series: [{ values: [120] }], unit: '$K' });
    assert.equal(indicator.data[0].number.prefix, '$');
    assert.equal(indicator.data[0].number.suffix, 'K');
});

test('tie-breaks and label sorts use one fixed collation, not the machine locale', () => {
    const fs = require('node:fs');
    for (const file of fs.readdirSync(path.join(__dirname, '..', 'src')).filter(f => f.endsWith('.js'))) {
        const text = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
        assert.equal(/\.localeCompare\(/.test(text), false, `${file} uses locale-dependent localeCompare`);
    }
    const ds = parseDataset('label\ngrand total\n계\nsum\n소계\nB\nA');
    const groups = analyze(ds, { type: 'aggregate', columns: ['label'], function: 'count', sort: 'desc' }).groups.map(g => g.group);
    assert.deepEqual(groups, ['계', '소계', 'A', 'B', 'grand total', 'sum']);
});
