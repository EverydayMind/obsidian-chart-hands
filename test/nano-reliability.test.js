import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { analyze, parseDataset, profile, resolveChartSource } from '../src/eda.js';
import { parseStaticChart } from '../src/static-chart.js';

const require = createRequire(import.meta.url);
const { chartBlock } = require('./helpers/chart-block');
const { loadHarness } = require('./helpers/locale-harness');
const code = require('./helpers/build-plugin')();
const csv = 'month,x,value,size,other\n2026-01,1,"1,234",4,8\n2026-02,2,,9,10\n2026-10,3,57,16,12';
function provider(files = { 'data.csv': csv }, locale = 'en') {
    const h = loadHarness(code, locale);
    return h.exports.createAgentProvider({ manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' }, app: { vault: {
        getFiles: () => Object.keys(files).map(path => ({ path, extension: path.split('.').pop() })),
        getAbstractFileByPath: path => Object.hasOwn(files, path) ? { path, extension: path.split('.').pop() } : null,
        cachedRead: async file => files[file.path]
    } } }, locale);
}
const plain = value => JSON.parse(JSON.stringify(value));
const definition = result => JSON.parse(chartBlock(result).split('\n').slice(1, -1).filter(line => !/^\s*#/.test(line)).join('\n'));

test('CH7 ranks distinct normalized name fragments in both scopes', async () => {
    const files = Object.fromEntries([...Array.from({ length: 10 }, (_, i) => `dir/a${i}.csv`), 'dir/SALES-report.csv', 'else/sales-re.csv', 'else/sales.csv', 'else/unrelated.csv', 'else/école.csv', 'else/aaaa.csv', 'else/aaab.csv'].map(path => [path, 'x\n1']));
    const p = provider(files);
    const nearby = (await p.callTool('eda_profile', { path: 'dir/sales-report-missing.csv' })).content[0].text;
    assert.ok(nearby.indexOf('dir/SALES-report.csv') < nearby.indexOf('dir/a0.csv'));
    const fallback = (await p.callTool('eda_profile', { path: 'missing/SALES.csv' })).content[0].text;
    assert.ok(fallback.indexOf('else/sales-re.csv') < fallback.indexOf('else/sales.csv'));
    assert.ok(!fallback.includes('unrelated.csv'));
    assert.match((await p.callTool('eda_profile', { path: 'missing/E\u0301COLE.csv' })).content[0].text, /école.csv/);
    const repeated = (await p.callTool('eda_profile', { path: 'missing/aaaaab.csv' })).content[0].text;
    assert.ok(repeated.indexOf('else/aaab.csv') < repeated.indexOf('else/aaaa.csv'));
});

test('CH8 sorts filtered rows stably with gaps last and applies limit', async () => {
    const p = provider({ 'data.csv': 'label,value,group\na,2,yes\nb,,yes\nc,5,yes\nd,2,yes\ne,9,no' });
    const base = { type: 'bar', source: { path: 'data.csv', labels: 'label', filter: [{ column: 'group', op: 'eq', value: 'yes' }] }, series: [{ column: 'value' }] };
    for (const [sort, expected] of [[{ column: 'value' }, ['c', 'a', 'd', 'b']], [{ column: 'value', order: 'asc' }, ['a', 'd', 'c', 'b']]]) {
        const result = await p.callTool('build_chart', { ...base, source: { ...base.source, sort } });
        assert.deepEqual(definition(result).data[0].x, expected);
        assert.deepEqual(plain(result.structuredContent.source.sort), sort);
    }
    const top = await p.callTool('build_chart', { ...base, source: { ...base.source, sort: { column: 'value' }, limit: 2 } });
    assert.deepEqual(definition(top).data[0].x, ['c', 'a']);
    assert.equal(top.structuredContent.source.limit, 2);
    assert.deepEqual(definition(await p.callTool('build_chart', { ...base, source: { ...base.source, limit: 2 } })).data[0].x, ['a', 'b']);
    const many = provider({ 'data.csv': 'label,value\n' + Array.from({ length: 201 }, (_, i) => `r${i},${i}`).join('\n') });
    const args = { type: 'bar', source: { path: 'data.csv', labels: 'label' }, series: [{ column: 'value' }] };
    assert.ok((await many.callTool('build_chart', args)).isError);
    assert.equal((await many.callTool('build_chart', { ...args, source: { ...args.source, limit: 200 } })).structuredContent.source.rows, 200);
    assert.ok((await p.callTool('build_chart', { ...base, source: { ...base.source, sort: { column: 'group' } } })).isError);
    const bad = provider({ 'data.csv': 'label,value\na,1\nb,bad' });
    assert.ok(!(await bad.callTool('build_chart', { ...args, source: { ...args.source, filter: [{ column: 'label', op: 'eq', value: 'a' }], sort: { column: 'value' } } })).isError);
    assert.ok((await bad.callTool('build_chart', { ...args, source: { ...args.source, limit: 1 } })).isError);
    for (const limit of [0, 201, 1.5]) assert.ok((await p.callTool('build_chart', { ...base, source: { ...base.source, limit } })).isError);
});

test('CH9 missing column examples produce valid calls for each chart type and locale', async () => {
    for (const locale of ['ko', 'en']) {
        const p = provider({ 'data.csv': 'month,x,y,value,size\na,1,2,3,4' }, locale);
        for (const args of [{ type: 'bar', source: { path: 'data.csv' }, series: [{ column: 'value' }] }, { type: 'scatter', source: { path: 'data.csv' }, series: [{ column: 'y' }] }, ...['bar', 'scatter', 'bubble'].map(type => ({ type, source: { path: 'data.csv', ...(type === 'bar' ? { labels: 'month' } : { x: 'x' }) }, series: [{}] })), { type: 'bubble', source: { path: 'data.csv', x: 'x' }, series: [{ column: 'y' }] }]) {
            const error = await p.callTool('build_chart', args);
            const example = error.content[0].text.split(locale === 'ko' ? '예: ' : 'Example: ')[1];
            assert.ok(example, JSON.stringify(error));
            const fixed = Function(`return ({${example}})`)();
            assert.ok(!(await p.callTool('build_chart', { type: args.type, ...fixed })).isError, example);
        }
    }
});

test('CH1 CSV values, gaps, row order, shared filters and frozen HWPX source', async () => {
    const p = provider();
    const filter = [{ column: 'month', op: 'prefix', value: '2026-0' }];
    const result = await p.callTool('build_chart', { type: 'bar', source: { path: './data.csv', labels: 'month', filter }, series: [{ name: 'Values', column: 'value' }] });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.deepEqual(definition(result).data[0].y, [1234, null]);
    assert.deepEqual(definition(result).data[0].x, ['2026-01', '2026-02']);
    assert.deepEqual(plain(result.structuredContent.source), { path: 'data.csv', rows: 2, labels: { first: '2026-01', last: '2026-02' } });
    assert.deepEqual(plain(result._meta['dev.agentinterop/resource']), { path: 'data.csv' });
    const frozen = result.structuredContent.staticBlock.split('\n').slice(1, -1).join('\n');
    assert.deepEqual(parseStaticChart(frozen).data[0].y, [1234, null]);
    assert.ok(!Object.hasOwn(JSON.parse(frozen), 'source'));
    const rows = await p.callTool('eda_analyze', { path: 'data.csv', analysis: { type: 'rows', columns: ['month'], filter } });
    assert.deepEqual(plain(rows.structuredContent.rows.map(r => r.values[0])), definition(result).data[0].x);
    for (const type of ['scatter', 'bubble']) {
        const points = await p.callTool('build_chart', { type, source: { path: 'data.csv', x: 'x' }, series: [{ column: 'value', ...(type === 'bubble' ? { sizeColumn: 'size' } : {}) }] });
        assert.ok(!points.isError, JSON.stringify(points));
        assert.deepEqual(definition(points).data[0].x, [1, 2, 3]);
        assert.deepEqual(definition(points).data[0].y, [1234, null, 57]);
        if (type === 'bubble') assert.deepEqual(definition(points).data[0].marker.size, [4, 9, 16]);
    }
});

test('CH1 rejects ambiguous, incomplete, nonnumeric, empty and oversized CSV calls', async () => {
    for (const locale of ['ko', 'en']) {
        const p = provider(undefined, locale);
        const base = { type: 'bar', source: { path: 'data.csv', labels: 'month' }, series: [{ column: 'value' }] };
        for (const args of [
            { ...base, labels: ['invented'] }, { ...base, series: [{ column: 'value', values: [7] }] },
            { ...base, series: [{ column: 'value', x: [1] }] }, { ...base, series: [{ column: 'value', size: [1] }] },
            { ...base, series: [{}] }, { ...base, source: { path: 'data.csv' } },
            { ...base, source: { ...base.source, filter: [{ column: 'month', op: 'eq', value: 'none' }] } },
            { ...base, series: [{ column: 'month' }] }, { ...base, source: { ...base.source, extra: 1 } },
            { ...base, series: [{ column: 'absent' }] },
            { ...base, source: null }, { ...base, source: {} }, { ...base, source: [] }, { ...base, series: [] },
            { type: 'scatter', source: { path: 'data.csv' }, series: [{ column: 'value' }] },
            { type: 'bubble', source: { path: 'data.csv', x: 'x' }, series: [{ column: 'value' }] },
            { type: 'bar', labels: ['A'], series: [{ column: 'value' }] },
            { type: 'bar', labels: ['A'], series: [{}] },
            { type: 'bar', labels: ['A'], series: {} }, { type: 'bar', series: null }
        ]) {
            const error = await p.callTool('build_chart', args);
            assert.equal(error.structuredContent.code, 'INVALID_ARGUMENT', JSON.stringify(args));
            if (locale === 'en') assert.doesNotMatch(error.content[0].text, /[가-힣]/u);
        }
    }
    const rows = Array.from({ length: 201 }, (_, i) => `r${i},${i}`).join('\n');
    const p = provider({ 'data.csv': `label,value\n${rows}` });
    const args = { type: 'bar', source: { path: 'data.csv', labels: 'label' }, series: [{ column: 'value' }] };
    assert.match((await p.callTool('build_chart', args)).content[0].text, /source.filter/);
    const result = await p.callTool('build_chart', { ...args, source: { ...args.source, filter: [{ column: 'value', op: 'lt', value: '200' }] } });
    assert.equal(result.structuredContent.source.rows, 200);
    assert.equal(definition(result).data[0].y[199], 199); // No EDA rows 100-row truncation.
    const long = 'L'.repeat(201);
    assert.equal(resolveChartSource(parseDataset(`label,value\n${long},1`), { ...args, source: { path: 'data.csv', labels: 'label' } }).labels[0], long);
    assert.deepEqual(resolveChartSource(parseDataset('label,value\na,1\nb,bad'), { ...args, source: { ...args.source, filter: [{ column: 'label', op: 'eq', value: 'a' }] } }).series[0].values, [1]);
    assert.throws(() => resolveChartSource(parseDataset('label,value\na,1\nb,bad'), { ...args, source: { ...args.source, limit: 1 } }), /value/);
    const gaps = await provider({ 'data.csv': 'x,y,size\n,2,3\n1,4,' }).callTool('build_chart', { type: 'bubble', source: { path: 'data.csv', x: 'x' }, series: [{ column: 'y', sizeColumn: 'size' }] });
    assert.deepEqual(definition(gaps).data[0].x, [null, 1]);
    assert.deepEqual(definition(gaps).data[0].marker.size, [3, null]);
});

test('CH1 descriptor uses host-compatible schemas and declares CSV reads', async () => {
    for (const locale of ['ko', 'en']) {
        const d = await provider(undefined, locale).describe();
        const t = d.tools.find(t => t.name === 'build_chart');
        assert.equal(t._meta['dev.agentinterop/effect'], 'read');
        assert.deepEqual(plain(t._meta['dev.agentinterop/resourceTypes']), ['.csv']);
        assert.ok(!t.inputSchema.properties.series.items.required?.includes('values'));
        assert.match(t.description, locale === 'ko' ? /^CSV의 값을 그릴 때는 값을 옮겨 적지 말고 source와 series\[\].column을 준다\./ : /^To plot values from a CSV, pass source and series\[\].column instead of copying the numbers\./);
        for (const tool of d.tools) assert.ok(tool.description.length <= 1000, tool.name);
        const check = value => {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
                assert.ok(!['oneOf', 'anyOf', 'if', 'then', 'dependentRequired'].includes(key), key);
                check(child);
            }
        };
        d.tools.forEach(tool => check(tool.inputSchema));
    }
});

test('CH2 EDA sends JSON only in structuredContent; failures remain readable', async () => {
    for (const locale of ['ko', 'en']) {
        const p = provider(undefined, locale);
        for (const [name, args] of [['eda_profile', { path: 'data.csv' }], ['eda_analyze', { path: 'data.csv', analysis: { type: 'summary', columns: ['value'] } }]]) {
            const result = await p.callTool(name, args);
            assert.ok(!result.isError);
            assert.ok(result.structuredContent);
            assert.match(result.content[0].text, /data.csv/);
            assert.ok(result.content[0].text.length < 200);
            assert.ok(!result.content[0].text.includes(JSON.stringify(result.structuredContent)));
            assert.throws(() => JSON.parse(result.content[0].text));
        }
        assert.equal((await p.callTool('eda_profile', { path: 'missing.csv' })).isError, true);
    }
});

test('CH3 caps only rows at 100, exposes continuation and keeps aggregate rejection', async () => {
    const dataset = parseDataset('label,value\n' + Array.from({ length: 205 }, (_, i) => `r${i},${i}`).join('\n'));
    for (const locale of ['ko', 'en']) {
        for (const limit of [101, 200, 1000]) {
            const a = analyze(dataset, { type: 'rows', columns: ['value'], limit }, locale);
            assert.equal(a.rows.length, 100); assert.equal(a.limitApplied, 100); assert.equal(a.nextOffset, 100);
            assert.match(a.note, /offset/);
            const b = analyze(dataset, { type: 'rows', columns: ['value'], limit, offset: a.nextOffset }, locale);
            assert.equal(b.rows[0].rowNumber, 101); assert.equal(b.nextOffset, 200);
            const c = analyze(dataset, { type: 'rows', columns: ['value'], limit, offset: b.nextOffset }, locale);
            assert.equal(c.rows.length, 5); assert.equal(c.nextOffset, null);
        }
    }
    for (const limit of [0, -1, 1.5, 1001]) assert.throws(() => analyze(dataset, { type: 'rows', columns: ['value'], limit }), /1 to 1000/);
    for (const limit of [1, 50, 100]) assert.equal(analyze(dataset, { type: 'rows', columns: ['value'], limit }).limitApplied, undefined);
    assert.throws(() => analyze(dataset, { type: 'aggregate', columns: ['label'], limit: 101 }), /1 to 100/);
    const d = await provider().describe();
    assert.equal(d.tools.find(t => t.name === 'eda_analyze').inputSchema.properties.analysis.properties.limit.maximum, 1000);
});

test('CH4 matched covers full original CSV order before sorting, pagination and grouping', () => {
    const dataset = parseDataset('month,group,value,other,bad,empty\n2026-09,a,1,2,3,\n2026-01,a,4,5,no,\n2026-10,b,6,7,8,');
    const filter = [{ column: 'month', op: 'prefix', value: '2026-0' }, { column: 'value', op: 'gte', value: '1' }];
    for (const type of ['summary', 'aggregate', 'rows']) {
        const args = { type, columns: type === 'aggregate' ? ['group', 'value'] : ['value'], filter,
            ...(type === 'rows' ? { sort_by: 'value', sort: 'desc', limit: 1, offset: 1 } : type === 'aggregate' ? { limit: 1 } : {}) };
        const result = analyze(dataset, args);
        assert.deepEqual(result.matched, { month: { first: '2026-09', last: '2026-01', rows: 2 }, value: { first: '1', last: '4', rows: 2 } });
        const empty = analyze(dataset, { ...args, filter: [{ column: 'month', op: 'eq', value: 'none' }] });
        assert.deepEqual(empty.matched, { month: { rows: 0 } });
        assert.equal(analyze(dataset, { ...args, filter: undefined }).matched, undefined);
    }
    for (const columns of [['value'], ['value', 'other']]) {
        const r = analyze(dataset, { type: 'summary', columns, filter: [{ column: 'month', op: 'eq', value: '2026-09' }] });
        assert.deepEqual(r.unlistedNumericColumns, columns.length === 1 ? ['other'] : []); // bad is numeric in this row only.
        assert.equal(r.shareOf, 'sum of the listed columns');
    }
});

test('CH5 CSV errors offer scoped and bounded candidates and column names', async () => {
    const files = { 'dir/note.md': '', 'else/sales-extra.csv': 'x\n1', 'else/unrelated.csv': 'x\n1',
        ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`dir/${6 - i}.csv`, 'x\n1'])) };
    for (const locale of ['ko', 'en']) {
        const p = provider(files, locale);
        for (const path of ['dir/absent.csv', 'dir/note.md']) {
            const result = await p.callTool('eda_profile', { path });
            assert.equal(result.isError, true);
            for (let i = 0; i < 5; i++) assert.ok(result.content[0].text.includes(`dir/${i}.csv`));
            assert.ok(!result.content[0].text.includes('dir/5.csv'));
            assert.ok(!result.content[0].text.includes('else/'));
            assert.match(result.content[0].text, /path/);
        }
        const fallback = await p.callTool('eda_profile', { path: 'missing/sales.csv' });
        assert.ok(fallback.content[0].text.includes('else/sales-extra.csv'));
        assert.ok(!fallback.content[0].text.includes('unrelated'));
        const none = await p.callTool('eda_profile', { path: 'missing/xy.csv' });
        assert.ok(!none.content[0].text.includes('else/sales-extra.csv'));
        const cols = Array.from({ length: 31 }, (_, i) => `col${i}`);
        const wide = provider({ 'wide.csv': `${cols.join(',')}\n${cols.map(() => 1).join(',')}` }, locale);
        for (const analysis of [{ type: 'summary', columns: ['absent'] }, { type: 'rows', columns: ['col0'], filter: [{ column: 'absent', op: 'eq', value: '1' }] }, { type: 'rows', columns: ['col0'], sort_by: 'absent' }]) {
            const result = await wide.callTool('eda_analyze', { path: 'wide.csv', analysis });
            assert.ok(result.content[0].text.includes('col0, col1'));
            assert.ok(result.content[0].text.includes('col29'));
            assert.ok(!result.content[0].text.includes('col30'));
        }
        assert.ok(!(await wide.callTool('eda_profile', { path: 'wide.csv' })).isError);
    }
});

test('CH6 profiles ten columns without skipping the next page and rejects invalid from', async () => {
    for (const n of [7, 10, 11, 21]) {
        const dataset = parseDataset(`${Array.from({ length: n }, (_, i) => `c${i}`).join(',')}\n${Array(n).fill('1').join(',')}`);
        const all = [];
        for (let from = 0; from < n; from += 10) {
            const page = profile(dataset, from);
            assert.ok(page.columns.length <= 10);
            all.push(...page.columns.map(c => c.name));
        }
        assert.deepEqual(all, dataset.headers);
    }
    for (const from of [0, -1, 1.5, 11]) {
        const p = provider({ 'data.csv': 'a,b,c,d,e,f,g,h,i,j\n1,2,3,4,5,6,7,8,9,10' });
        assert.equal((await p.callTool('eda_profile', { path: 'data.csv', from })).structuredContent.code, 'INVALID_ARGUMENT');
    }
});
