import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify } from 'yaml';
import buildPlugin from './helpers/build-plugin.js';
import { loadHarness } from './helpers/locale-harness.js';
import { chartBlock } from './helpers/chart-block.js';
import { rebuildComment } from '../src/note-charts.js';

const code = buildPlugin();
const note = 'reports/chart.md';
const csv = 'data/raw.csv';
const fence = definition => ['```plotly', typeof definition === 'string' ? definition : JSON.stringify(definition), '```'].join('\n');
const plot = (...data) => fence({ data });
const plain = value => JSON.parse(JSON.stringify(value));
const text = result => result.content[0].text;
const ok = result => {
    assert.ok(!result.isError, text(result));
    return plain(result.structuredContent);
};
const invalid = (result, pattern) => {
    assert.equal(result.structuredContent.code, 'INVALID_ARGUMENT', text(result));
    assert.match(text(result), pattern);
};
const definition = result => parse(chartBlock(result).split('\n').slice(1, -1).join('\n'));

function provider(files, { locale = 'en', plugins, validator } = {}) {
    const { exports } = loadHarness(code, locale, { parse, stringify });
    const entries = Object.keys(files).map(path => ({ path, extension: path.split('.').at(-1) }));
    return exports.createAgentProvider({
        manifest: { id: 'chart-hands', name: 'Chart Hands', version: 'test' },
        app: { plugins, vault: {
            getAbstractFileByPath: path => entries.find(file => file.path === path),
            getFiles: () => entries,
            cachedRead: async file => files[file.path]
        } },
        ...(validator ? { ensureLibraries: async () => ({ validate: validator }) } : {})
    }, locale, { now: () => new Date(2026, 10, 28) });
}

test('H5 compare selects one chart, matches period labels and reports mismatches and both missing directions', async () => {
    const p = provider({
        [note]: [plot({ x: ['skip'], y: [99] }), plot({
            type: 'scatter', name: ' Sales ', x: [' 2026-01 ', '2026-03', '2026(전망)', 'W34'], y: [1, 183.2, 4, 5]
        })].join('\r\n'),
        [csv]: 'period,Sales_(USD),Other\n2026년 1월,1,8\n2026-03,138.2,183.2\n2026,4,3\n2026-W34,5,4'
    });
    const args = { path: note, chart: 2, compare: { path: 'raw.csv', labels: 'period' } };
    const result = await p.callTool('read_charts', args);
    const page = ok(result);
    assert.deepEqual([page.from, page.to, page.complete], [2, 2, true]);
    assert.deepEqual(page.items.map(item => item.chart), [2]);
    assert.equal(page.compare.path, csv);
    assert.deepEqual(page.compare.traces, [{
        trace: 1, column: 'Sales_(USD)', compared: 2, mismatchCount: 1,
        mismatches: [{ label: '2026-03', chart: 183.2, data: 138.2 }],
        chartOnly: { count: 2, labels: ['2026(전망)', 'W34'] },
        dataOnly: { count: 2, labels: ['2026', '2026-W34'] }
    }]);
    assert.match(text(result).split('\n')[0], /original column values/);
    assert.match(text(result).split('\n')[1], /2 compared · 1 different: 2026-03 chart 183.2, data 138.2/);
    assert.deepEqual(plain(result._meta), { 'dev.agentinterop/resource': { path: note, paths: [csv] }, 'dev.agentinterop/evidencePaths': [csv] });
    const tolerant = ok(await p.callTool('read_charts', { ...args, compare: { ...args.compare, tolerance: 45 } }));
    assert.equal(tolerant.compare.traces[0].mismatchCount, 0);
    assert.deepEqual(tolerant.compare.traces[0].mismatches, []);
});

test('H5 compare uses explicit numeric columns for horizontal bars and pies and refuses ambiguous names', async () => {
    const table = 'data/tables.md';
    const p = provider({
        [note]: plot({ type: 'bar', orientation: 'h', name: 'v', y: [' A ', 'B'], x: [1, 2] }, { type: 'pie', labels: ['A', 'B'], values: [4, 5] }),
        [table]: '| ignored | x |\n|---|---|\n| Z | 0 |\n\n| name | v | v_other | text |\n|---|---|---|---|\n| A | 1 | 4 | red |\n| B | 2 | 5 | green |'
    });
    const spec = { path: table, table: 2, labels: 'name' };
    const read = (compare, chart = 1) => p.callTool('read_charts', { path: note, chart, compare });
    const ambiguous = await read(spec);
    invalid(ambiguous, /compare.columns.*Numeric columns: v, v_other/);
    assert.deepEqual(plain(ambiguous._meta['dev.agentinterop/evidencePaths']), [table]);
    invalid(await read({ ...spec, columns: ['v'] }), /one numeric column per trace/);
    invalid(await read({ ...spec, columns: ['v', 'text'] }), /Numeric columns: v, v_other/);
    invalid(await read({ ...spec, columns: ['v', 'v_other'], tolerance: -1 }), /tolerance/);
    invalid(await read(spec, 2), /existing chart/);
    invalid(await p.callTool('read_charts', { path: note, compare: spec }), /requires a chart number/);
    const result = ok(await read({ ...spec, columns: ['v', 'v_other'] }));
    assert.equal(result.compare.table, 2);
    assert.deepEqual(result.compare.traces.map(trace => [trace.compared, trace.mismatchCount]), [[2, 0], [2, 0]]);
});

test('H5 compare caps previews while preserving counts and rejects duplicate dataset labels', async () => {
    const labels = Array.from({ length: 75 }, (_, i) => 'L' + i);
    const chart = { x: [...labels, ...Array.from({ length: 12 }, (_, i) => 'C' + i)], y: Array(87).fill(0) };
    const data = ['label,v', ...labels.map(label => label + ',1'), ...Array.from({ length: 13 }, (_, i) => 'D' + i + ',2')].join('\n');
    const args = { path: note, chart: 1, compare: { path: csv, labels: 'label', columns: ['v'] } };
    const result = ok(await provider({ [note]: plot(chart), [csv]: data }).callTool('read_charts', args));
    const [trace] = result.compare.traces;
    assert.deepEqual([trace.compared, trace.mismatchCount, trace.mismatches.length], [75, 75, 50]);
    assert.deepEqual([trace.chartOnly.count, trace.chartOnly.labels.length, trace.dataOnly.count, trace.dataOnly.labels.length], [12, 10, 13, 10]);
    const duplicate = provider({ [note]: plot(chart), [csv]: data + '\nL0,1' });
    invalid(await duplicate.callTool('read_charts', args), /duplicate labels/);
    const many = provider({ [note]: plot(...Array(12).fill(chart)), [csv]: data });
    const wide = await many.callTool('read_charts', { ...args, compare: { ...args.compare, columns: Array(12).fill('v') } });
    assert.ok(text(wide).length + 1 + JSON.stringify(wide.structuredContent).length <= 8000);
    const traces = ok(wide).compare.traces;
    assert.equal(traces.length, 12);
    assert.ok(traces.every(trace => trace.mismatchCount === 75 && trace.mismatches.length > 0 && trace.mismatches.length < 50));
});

test('H5 rebuild round-trips the same block and snippet and exposes the canonical source', async () => {
    const files = { [csv]: 'month,v\n2026-01,1\n2026-02,7\n2026-03,2' };
    const args = {
        type: 'bar', source: { path: 'raw.csv', labels: 'month' }, series: [{ column: 'v', name: 'V' }],
        style: 'report', title_from: 'facts', target: { value: 3 }, highlight: { top: 1 },
        x_title: 'Month', y_title: 'Quantity', caption: 'Published source'
    };
    const built = await provider(files).callTool('build_chart', args);
    const snippet = ok(built).reportSnippet;
    assert.match(snippet.split('\n')[1], /^# chart-hands source: data\/raw.csv/);
    assert.match(snippet.split('\n')[2], /^# chart-hands build v1: \{/);
    assert.equal(snippet.split('\n').at(-1), 'Source: Published source');
    assert.match(text(built).split('\n')[0], /^Source: data\/raw.csv$/);
    assert.ok(definition(built).layout.annotations.some(annotation => annotation.text === args.caption));
    const p = provider({ ...files, [note]: '# Report\r\n\r\n' + snippet.replaceAll('\n', '\r\n') + '\r\n\r\n- Separate list\r\nProse' });
    const read = await p.callTool('read_charts', { path: note });
    const [item] = ok(read).items;
    assert.equal(item.startLine, 3);
    assert.equal(item.endLine, 2 + chartBlock(built).split('\n').length);
    assert.deepEqual(item.snippet, { startLine: 3, endLine: 2 + snippet.split('\n').length });
    assert.deepEqual(item.rebuild, { ...args, source: { ...args.source, path: csv } });
    assert.deepEqual(plain(read._meta['dev.agentinterop/evidencePaths']), [csv]);
    const rebuilt = await p.callTool('build_chart', item.rebuild);
    assert.equal(ok(rebuilt).reportSnippet, snippet);
});

test('H5 rebuild accepts 600 JSON characters and omits larger recipes and rejects malformed or newer comments', async () => {
    const short = { type: 'bar', source: { path: csv, labels: 'label' }, series: [{ column: 'v' }], title: '', caption: '', x_title: '', y_title: '' };
    const padding = 600 - JSON.stringify(short).length;
    const sized = { ...short, title: 'T'.repeat(200), caption: 'C'.repeat(200), x_title: 'X'.repeat(padding - 400) };
    assert.equal(JSON.stringify(sized).length, 600);
    assert.match(rebuildComment(sized), /^# chart-hands build v1: /);
    assert.equal(rebuildComment({ ...sized, y_title: 'Y' }), '');
    const files = { [csv]: 'label,v\nA,1\nB,2' };
    const large = await provider(files).callTool('build_chart', { ...sized, y_title: 'Y' });
    assert.equal(ok(large).valid, true);
    assert.doesNotMatch(chartBlock(large), /# chart-hands build/);
    const body = '{"data":[{"x":["A"],"y":[1]}]}';
    const charts = [
        fence('# chart-hands build v1: {broken}\n' + body),
        fence('# chart-hands build v2: {}\n' + body),
        fence('# chart-hands build v1: {"type":"bar","source":{"path":"../bad.csv"},"series":[{}]}\n' + body),
        fence(body) + '\n\n자료: 설명\n\nMore text',
        chartBlock(large) + '\n\n\n- Separate list',
        fence('# chart-hands build v1\n' + body)
    ].join('\n\n');
    const result = ok(await provider({ [note]: charts }).callTool('read_charts', { path: note }));
    assert.deepEqual(result.items.map(item => item.rebuild), Array(6).fill(null));
    assert.match(result.items[0].rebuildReason, /JSON/);
    assert.match(result.items[1].rebuildReason, /version/);
    assert.match(result.items[2].rebuildReason, /arguments/);
    assert.equal(result.items[3].snippet.endLine, result.items[3].endLine + 2);
    assert.equal(result.items[4].rebuildReason, undefined);
    assert.equal(result.items[4].snippet.endLine, result.items[4].endLine);
    assert.match(result.items[5].rebuildReason, /JSON/);
});

test('H5 from_chart preserves Plotly data and custom layout while applying print, target and caption', async () => {
    const original = {
        data: [
            { type: 'bar', orientation: 'h', y: ['A', 'B'], x: [3, 1], customdata: [{ id: 1 }, { id: 2 }], marker: { color: ['#ff0000', 'blue'], opacity: 0.5 } },
            { type: 'bar', orientation: 'h', y: ['A', 'B'], x: [4, 8], marker: { color: [100, 200], colorscale: 'Viridis' } }
        ],
        layout: { title: { text: 'Old', subtitle: { text: 'Keep' } }, barmode: 'stack', xaxis: { range: [0, 10] },
            annotations: [{ x: 4, y: 'A', text: 'Keep this note' }], shapes: [{ type: 'rect', x0: 0, x1: 1 }] },
        config: { displayModeBar: false }, fit: 'fill'
    };
    const files = { [note]: '# Report\n' + fence(original) + '\n\n- Old facts' };
    const checks = [];
    const p = provider(files, { validator: (data, layout) => checks.push({ data, layout }) && [] });
    const args = { type: 'pie', from_chart: { path: note, chart: 1 }, style: 'print', title: 'New', caption: 'A caption', target: { value: 5 }, stacked: true };
    const result = await p.callTool('build_chart', args);
    const built = ok(result);
    assert.equal(built.valid, true);
    assert.deepEqual(built.ignoredArgs, ['type', 'stacked']);
    assert.deepEqual(built.replaces, { startLine: 2, endLine: 4 });
    assert.equal(built.facts[0].series[0].max.value, 3);
    assert.equal(checks.length, 1);
    const edited = definition(result);
    const isGray = color => /^#([0-9a-f]{2})\1\1$/i.test(color);
    assert.ok(edited.layout.colorway.every(isGray));
    assert.ok(edited.data[0].marker.color.every(isGray));
    assert.ok(edited.data[1].marker.colorscale.every(([, color]) => isGray(color)));
    assert.deepEqual(edited.data[1].marker.color, [100, 200]);
    assert.deepEqual(edited.data.map(({ marker, ...data }) => data), original.data.map(({ marker, ...data }) => data));
    assert.equal(edited.data[0].marker.opacity, 0.5);
    assert.deepEqual(edited.config, original.config);
    assert.equal(edited.fit, original.fit);
    assert.equal(edited.layout.title.text, 'New');
    assert.deepEqual(edited.layout.title.subtitle, original.layout.title.subtitle);
    assert.deepEqual(edited.layout.xaxis.range, [0, 10]);
    assert.deepEqual(edited.layout.shapes[0], original.layout.shapes[0]);
    assert.deepEqual(edited.layout.annotations[0], original.layout.annotations[0]);
    assert.equal(edited.layout.shapes[1].xref, 'x');
    assert.equal(edited.layout.shapes[1].x0, 5);
    assert.equal(edited.layout.annotations.at(-1).text, 'A caption');
});

test('H5 from_chart rejects data overrides, secondary axes, excess traces and open fences', async () => {
    const files = {
        [note]: [
            plot({ y: [1] }), fence({ data: [{ y: [1] }], layout: { xaxis2: {} } }),
            plot({ y: [1], yaxis: 'y2' }), plot(...Array(13).fill({ y: [1] })),
            '```plotly\n{"data":[{"y":[1]}]}'
        ].join('\n\n')
    };
    const p = provider(files);
    const edit = (chart, args = {}) => p.callTool('build_chart', { type: 'bar', from_chart: { path: note, chart }, ...args });
    for (const args of [{ source: { path: csv } }, { labels: [] }, { series: [{ values: [1] }] }]) invalid(await edit(1, args), /cannot be combined/);
    for (const index of [2, 3]) invalid(await edit(index), /secondary axes/);
    invalid(await edit(4), /more than 12/);
    invalid(await edit(5), /Close the chart fence/);
    invalid(await edit(6), /existing chart/);
    invalid(await edit(1, { style: 'plain' }), /report, print or slides/);
    invalid(await edit(1, { target: { value: 4, series: 1 } }), /Invalid target/);
    invalid(await edit(1, { caption: 'line\nline' }), /one line/);
    invalid(await p.callTool('build_chart', { type: 'bar' }), /Without source each series requires a numeric values array/);
    invalid(await p.callTool('build_chart', { type: 'bar', source: { path: csv } }), /With source provide at least one series/);
    const twelve = provider({ [note]: plot(...Array(12).fill({ y: [1] })) });
    assert.equal(ok(await twelve.callTool('build_chart', { type: 'bar', from_chart: { path: note, chart: 1 }, title: 'Allowed' })).valid, true);
});

test('H5 non-Cartesian charts allow title and caption edits and retain numeric facts', async () => {
    const pie = { type: 'pie', labels: ['A', 'B'], values: [2, 3] };
    const heatmap = { type: 'heatmap', x: ['A', 'B'], y: ['Y'], z: [[10, 20]] };
    const p = provider({ [note]: [plot(pie), plot(heatmap), fence('data: [')].join('\n') });
    const edit = (chart, args) => p.callTool('build_chart', { type: 'line', from_chart: { path: note, chart }, ...args });
    for (const [i, trace] of [pie, heatmap].entries()) {
        const chart = i + 1;
        invalid(await edit(chart, { style: 'report' }), /title and caption edits only/);
        invalid(await edit(chart, { target: { value: 3 } }), /title and caption edits only/);
        const result = await edit(chart, { title: 'Title', caption: 'Caption' });
        assert.ok(ok(result).facts.length);
        assert.deepEqual(definition(result).data[0], trace);
    }
    invalid(await edit(3, { title: 'Title' }), /Run check_chart/);
});

test('H6 hints use body lines for syntax failures, respect block scalars and stop at eight', async () => {
    const yaml = [
        'layout:', '  title:', '    text: |', '      color: #abcdef',
        '  annotations:', '    - text: >-', '        color: #abcdef',
        '      showarrow: false', '  paper_bgcolor: #abcdef',
        'style: print', '\tother: [',
        'data: ['
    ].join('\r\n');
    const p = provider({ [note]: 'preamble\n' + fence(yaml) });
    const checked = ok(await p.callTool('check_chart', { source: fence(yaml) }));
    assert.deepEqual(checked.hints.map(({ line, code }) => [line, code]), [[9, 'UNQUOTED_HEX'], [10, 'UNKNOWN_TOP_LEVEL_KEY'], [11, 'TAB_INDENT']]);
    const read = ok(await p.callTool('read_charts', { path: note, chart: 1 }));
    assert.deepEqual(read.items[0].hints, checked.hints);
    const capped = ok(await p.callTool('check_chart', { source: Array.from({ length: 10 }, (_, i) => 'unknown' + i + ': null').join('\n') + '\ndata: [' }));
    assert.equal(capped.hints.length, 8);
    const structure = ok(await p.callTool('check_chart', { source: 'data: []\nstyle: print' }));
    assert.equal(structure.valid, false);
    assert.equal(structure.hints, undefined);
    const scalar = ok(await p.callTool('check_chart', { source: 'data: [{y: [1]}]\nlayout:\n  title:\n    text: |\n      color: #abcdef' }));
    assert.equal(scalar.valid, true);
    assert.equal(scalar.hints, undefined);
    const brokenJson = ok(await p.callTool('check_chart', { source: '{\n"style":"report",\n"layout": {"title":{"text":"color: #abcdef\n"data":[' }));
    assert.deepEqual(brokenJson.hints.map(({ line, code }) => [line, code]), [[2, 'UNKNOWN_TOP_LEVEL_KEY']]);
});

test('H7 check and read treat empty fit as defaults and still reject unknown keys', async () => {
    const p = provider({ [note]: fence('data: [{y: [1]}]\nfit: {}') });
    for (const fit of ['{}', '""']) {
        const result = ok(await p.callTool('check_chart', { source: 'data: [{y: [1]}]\nfit: ' + fit }));
        assert.equal(result.valid, true);
        assert.ok(result.advice.includes('Remove the empty fit value.'));
    }
    for (const fit of ['[]', '{mode: fill}', '" "']) {
        const result = ok(await p.callTool('check_chart', { source: 'data: [{y: [1]}]\nfit: ' + fit }));
        assert.equal(result.valid, false);
    }
    const nullFit = ok(await p.callTool('check_chart', { source: 'data: [{y: [1]}]\nfit: null' }));
    assert.equal(nullFit.valid, true);
    assert.ok(!nullFit.advice.includes('Remove the empty fit value.'));
    const unknown = ok(await p.callTool('check_chart', { source: 'data: [{y: [1]}]\nfit: ""\nframes: []' }));
    assert.equal(unknown.valid, false);
    const read = ok(await p.callTool('read_charts', { path: note }));
    assert.ok(read.items[0].advice.includes('Remove the empty fit value.'));
});

test('H11 Dataview guide prefixes live status in both languages and leaves other topics unchanged', async () => {
    for (const [locale, enabled, setting, expected, prefix] of [
        ['en', true, false, false, 'Current status: Dataview on · JavaScript queries off — dataviewjs blocks appear as code.'],
        ['en', true, true, true, 'Current status: Dataview on · JavaScript queries on'],
        ['en', false, 'true', null, 'Current status: Dataview off · JavaScript queries unknown — dataviewjs blocks appear as code.'],
        ['ko', true, false, false, '지금 상태: Dataview 켜짐 · JavaScript 쿼리 꺼짐 — dataviewjs 블록은 코드로만 보입니다.'],
        ['ko', false, undefined, null, '지금 상태: Dataview 꺼짐 · JavaScript 쿼리 확인할 수 없음 — dataviewjs 블록은 코드로만 보입니다.']
    ]) {
        const plugins = { enabledPlugins: new Set(enabled ? ['dataview'] : []), plugins: { dataview: { settings: { enableDataviewJs: setting } } } };
        const p = provider({}, { locale, plugins });
        const result = await p.callTool('get_chart_guide', { topic: 'dataviewjs' });
        assert.deepEqual(ok(result).dataview, { enabled, javascript: expected });
        assert.equal(text(result).split('\n')[0], prefix);
        const basics = await p.callTool('get_chart_guide', { topic: 'basics' });
        assert.equal(ok(basics).dataview, undefined);
        assert.doesNotMatch(text(basics), /Current status|지금 상태/);
    }
    const plugins = { plugins: { dataview: { get settings() { throw new Error('Reloading'); } } } };
    const result = await provider({}, { locale: 'en', plugins }).callTool('get_chart_guide', { topic: 'dataviewjs' });
    assert.deepEqual(ok(result).dataview, { enabled: true, javascript: null });
});
