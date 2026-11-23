'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', '..');
const headSource = file => execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8' });

// Read HEAD directly into memory. Never stash, check out, or write another repository.
async function buildHead() {
    const result = await require('esbuild').build({
        entryPoints: [path.join(root, 'src', 'main.js')], bundle: true, write: false,
        format: 'cjs', platform: 'node', target: 'es2021',
        external: ['obsidian', 'plotly.js-dist-min', 'd3'], logLevel: 'silent',
        plugins: [{ name: 'read-head', setup(build) {
            build.onLoad({ filter: /[\\/]src[\\/].*\.js$/ }, args => ({
                contents: headSource(path.relative(root, args.path).replaceAll('\\', '/')), loader: 'js'
            }));
        } }]
    });
    return result.outputFiles[0].text.replace(/import\((["'][^"']+["'])\)/g, 'Promise.resolve().then(() => require($1))');
}

function loadHarness(code, locale) {
    const ui = [], processors = {}, commands = [];
    let appLanguage = locale;
    const record = (kind, ...values) => ui.push({ kind, values });
    const makeEl = () => ({
        empty() {},
        createEl(tag, opts, cb) {
            const text = typeof opts === 'string' ? opts : opts?.text;
            if (text) record('text', text);
            const child = makeEl();
            if (typeof cb === 'function') cb(child);
            return child;
        },
        createDiv(opts, cb) {
            const text = typeof opts === 'string' ? opts : opts?.text;
            if (text) record('text', text);
            const child = makeEl();
            if (typeof cb === 'function') cb(child);
            return child;
        }
    });
    const component = {
        addOption(...v) { record('option', ...v); return this; },
        setValue() { return this; }, onChange() { return this; }
    };
    const obsidian = {
        moment: { locale: () => { if (appLanguage instanceof Error) throw appLanguage; return appLanguage; } },
        Plugin: class {
            async loadData() { return {}; }
            registerMarkdownCodeBlockProcessor(name, fn) { processors[name] = fn; }
            addCommand(command) { commands.push(command); record('command', command.id, command.name); }
            addSettingTab(tab) { tab.display(); }
            registerEvent() {}
        },
        PluginSettingTab: class { constructor() { this.containerEl = makeEl(); } },
        getIcon: () => ({}),
        Setting: class {
            setName(value) { record('name', value); return this; }
            setDesc(value) { record('description', value); return this; }
            addDropdown(fn) { fn(component); return this; }
            addToggle(fn) { fn(component); return this; }
        },
        Notice: class { constructor(...values) { record('notice', ...values); } hide() {} },
        MarkdownRenderChild: class {},
        parseYaml: text => JSON.parse(text.replace(/^\s*#.*$/gm, '')), stringifyYaml: value => JSON.stringify(value, null, 2) + '\n'
    };
    const module = { exports: {} };
    const context = vm.createContext({ module, exports: module.exports, window: { setTimeout: fn => fn() },
        document: { createElement: () => ({ style: {}, classList: { add() {} } }) }, WeakRef, structuredClone, console,
        require(name) {
            if (name === 'obsidian') return obsidian;
            if (name === 'plotly.js-dist-min') throw new Error('Synthetic loader failure');
            if (name === 'd3') return {};
            throw new Error(`Unexpected dependency: ${name}`);
        }
    });
    vm.runInContext('Array.prototype.contains = Array.prototype.includes;', context);
    vm.runInContext(code, context);
    // Ordinary tests are pinned to ko by build-plugin; locale tests exercise detection itself.
    module.exports.setLocaleForTests?.(undefined);
    return { exports: module.exports, ui, processors, commands,
        setLanguage(value) { appLanguage = value; },
        setNavigator(value) { context.window.navigator = value; } };
}

const fixtureFiles = {
    'data.csv': 'month,value,other\n2025-01,2,3\n2025-02,4,6',
    'empty.csv': 'month,value,other\n',
    'bad.csv': 'duplicate,duplicate\n1,2',
    'units.csv': 'label,value\na,$1\nb,€2',
    'unit-mismatch.csv': 'label,value\na,1\nb,$2',
    'compare-units.csv': 'label,value,reference\na,$1,2kg',
    'compare.md': '| label | value | reference |\n|---|---|---|\n| total | 1 | 2 |',
    'period.csv': 'group,value,year\nA,1,2025\nA,2,2026',
    'nopairs.csv': 'x,y\n1,\n,2',
    'facts.csv': 'group,value,year\nA,$1,2025\nA,$2,2026\nB,$3,2025\nC,$4,2026\nC,n/a,2026',
    'note.md': '```plotly\n{"data":[{"y":[1,2]}]}\n```',
    'empty.md': '', 'file.pdf': 'synthetic',
    'large.csv': 'name,value\n' + Array.from({ length: 100 }, (_, i) => `${'a'.repeat(25)}${i},${i}`).join('\n'),
    'table.md': '| amount | label |\n|---|---|\n' + ['합계', '총계', '소계', '계', '합', '총합', 'total', 'subtotal', 'grand total', 'sum'].map((v, i) => `| ${i % 2 ? '1원' : '2명'} | ${v} |`).join('\n'),
    'invalid.md': '| x | x |\n|---|---|',
    'many.md': Array(1001).fill('| x |\n|---|\n').join('\n'),
    'long.md': '| x |\n|---|\n' + '| 1 |\n'.repeat(100001),
    'leading-zero.csv': 'code,value\n01,10\n02,20',
    'mixed-year.csv': 'period,group,value\n2025-Q1,A,10\nQ2,B,20',
    'mixed-notation.csv': 'period,value\n2025-Q1,10\n2025 Q1,20',
    'period-order.csv': 'period,value\n2026-Q1,10\n2026-Q1,20\nQ4 2025,30',
    'trend-dup.csv': 'month,a,b\n2025-01,10,1\n2025-01,20,2\n2025-02,30,3\n2025-03,40,4\n2025-04,50,5',
    'trend-101-dup.csv': 'month,value\n' + Array.from({ length: 101 }, (_, i) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')},${i + 1}`).join('\n') + '\n2000-01,1',
    'trend-km.csv': 'month,dist\n2025-01,10km\n2025-01,20km\n2025-02,30km',
    'trend-combo.csv': 'month,rev,rate\n2025-01,$10,50%\n2025-02,$20,60%\n2025-03,$30,70%\n2025-04,$40,80%',
    'rows201.csv': 'month,cat,a,b\n' + Array.from({ length: 201 }, (_, i) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')},C${i},${i + 1},${i + 2}`).join('\n'),
    'cat-dup.csv': 'cat,a,b\nA,10,1\nA,20,2\nB,30,3',
    'cat-dup-long.csv': 'cat,value\nLongCategoryName,10\nLongCategoryName,20\nShort,30',
    'cat101-dup.csv': 'cat,value\n' + Array.from({ length: 101 }, (_, i) => `C${i},${i + 1}`).join('\n') + '\nC0,1',
    'zero.csv': 'cat,value\nA,0\nB,0',
    'neg.csv': 'cat,value\nA,10\nB,-5',
    'bubble-neg.csv': 'x,y,size\n1,2,-3\n4,5,6',
    'bubble-pos.csv': 'x,y,size\n1,2,3\n4,5,6',
    'two-periods.csv': 'cat,year,month,val\nA,2025,2025-01,10\nA,2026,2026-01,20',
    'period-dec.csv': 'group,value,year\nA,2,2025\nA,1,2026',
    'period-pct.csv': 'group,rate,year\nA,10%,2025\nA,20%,2026',
    'matrix-units.csv': 'cat,a,b,c\nA,$1,$2,3kg\nB,$4,$5,6kg',
    'matrix-dup.csv': 'cat,a,b,c\nA,1,2,3\nA,4,5,6',
    'wide13.csv': 'cat,' + Array.from({ length: 13 }, (_, i) => `v${i + 1}`).join(',') + '\nA,' + Array.from({ length: 13 }, (_, i) => i + 1).join(',') + '\nB,' + Array.from({ length: 13 }, (_, i) => i + 2).join(','),
    'wide99-too-large.csv': 'cat,' + Array.from({ length: 99 }, (_, i) => `m${String(i).padStart(2, '0')}_${'x'.repeat(90)}`).join(',') + '\nA,' + Array(99).fill('1').join(',') + '\nA,' + Array(99).fill('').join(',')
};
async function captureExtended(code, locale) {
    const files = { ...fixtureFiles, ...(locale === 'en' ? { 'table.md': '| amount | label |\n|---|---|\n| 1 | total |' } : {}) };
    if (locale === 'ko') {
        const units = ['천원', '만원', '백만원', '억원', '조원', '달러', '회', '곳', '개소', '톤'];
        files['facts-ko.csv'] = `부서,${units.map((_, i) => `value${i}`).join(',')}\nA,${units.map(unit => `1${unit}`).join(',')}`;
    }
    const h = loadHarness(code, locale);
    const events = {};
    const plugin = new h.exports.default();
    plugin.manifest = { id: 'chart-hands', name: 'Chart Hands', version: 'test' };
    plugin.app = { workspace: { onLayoutReady(fn) { fn(); }, trigger() {},
        on(name, fn) { (events[name] ??= []).push(fn); return { name, fn }; } }, vault: {
        getFiles: () => Object.keys(files).map(path => ({ path, extension: path.split('.').pop() })),
        getAbstractFileByPath: p => Object.hasOwn(files, p) ? { path: p, extension: p.split('.').pop() } : null,
        cachedRead: async file => files[file.path]
    } };
    await plugin.onload();
    const menu = {
        addItem(fn) {
            const item = {
                setTitle(value) { h.ui.push({ kind: 'menu', values: [value] }); return this; },
                setIcon() { return this; },
                onClick() { return this; }
            };
            fn(item);
            return this;
        }
    };
    for (const handler of events['editor-menu'] ?? []) handler(menu, {});
    const dvCommand = h.commands.find(c => c.id === 'add-plotly-dataviewjs-example');
    if (dvCommand) {
        dvCommand.editorCallback({
            getDoc: () => ({ getCursor: () => ({ line: 0, ch: 0 }), replaceRange() {} }),
            getLine: () => '', lineCount: () => 1, setCursor() {}
        });
    }
    // Capture both real Notice paths, including the newline in the failure Notice.
    try { await plugin.ensureLibraries(); } catch { /* Synthetic failure is intentional. */ }
    const el = { children: [], appendChild(child) { this.children.push(child); },
        ownerDocument: { createElement: () => ({ style: {} }) } };
    await h.processors.plotly('{}', el, { addChild() {} });
    plugin.ensureLibraries = async () => ({});
    for (const source of ['null', '{"other":1}']) await h.processors.plotly(source, el, { addChild() {} });
    for (const child of el.children) if (child.textContent) h.ui.push({ kind: 'render-error', values: [child.textContent] });
    const p = h.exports.createAgentProvider({ manifest: plugin.manifest, app: plugin.app }, locale, { now: () => new Date(2026, 10, 23) });
    const descriptor = await p.describe();
    const calls = [];
    const call = async (name, args, ctx) => {
        const result = await p.callTool(name, args, ctx);
        calls.push({ name, args, result });
    };
    for (const args of [{ path: 'data.csv' }, { path: 'empty.csv' }, { path: 'bad.csv' }, { path: 'missing.csv' }, { path: 'file.pdf' }, { path: 'data.csv', from: 20 }]) await call('eda_profile', args);
    for (const args of [{ path: 'table.md' }, { path: 'table.md', table: 2 }, { path: 'empty.md' }, { path: 'invalid.md' }, { path: 'many.md' }, { path: 'long.md' }, { path: 'data.csv', table: 2 }]) await call('eda_profile', args);
    await call('eda_analyze', { path: 'table.md', analysis: { type: 'rows', columns: ['label'] } });
    for (const analysis of [
        { type: 'compare', columns: ['month', 'value'] },
        { type: 'compare', columns: ['month', 'value', 'other'], extra: true },
        { type: 'compare', columns: ['month', 'value'], period: {} },
        { type: 'compare', columns: ['month', 'value'], period: { column: 'month', base: '2025-01', target: '2025-01' } },
        { type: 'compare', columns: ['month', 'value'], period: { column: 'month', base: '2020', target: '2025-01' } },
        ...[{ function: 'count' }, { sort: 'bad' }, { limit: 0 }, { rank_by: 'bad' }, { sort: 'label', rank_by: 'rate' }].map(extra => ({ type: 'compare', columns: ['month', 'value', 'other'], ...extra })),
        { type: 'compare', columns: ['month', 'value', 'other'] }
    ]) await call('eda_analyze', { path: 'data.csv', analysis });
    await call('eda_analyze', { path: 'units.csv', analysis: { type: 'compare', columns: ['label', 'value', 'label'] } });
    await call('eda_analyze', { path: 'compare-units.csv', analysis: { type: 'compare', columns: ['label', 'value', 'reference'] } });
    await call('eda_analyze', { path: 'table.md', analysis: { type: 'aggregate', columns: ['label'] } });
    await call('eda_analyze', { path: 'compare.md', analysis: { type: 'compare', columns: ['label', 'value', 'reference'] } });
    if (locale === 'ko') await call('eda_analyze', { path: 'data.csv', analysis: { type: 'compare', columns: ['month', 'value'], period: { column: 'month', base: '상반기', target: '하반기' } } });
    for (const type of ['summary', 'histogram', 'correlation', 'aggregate', 'rows']) {
        const columns = type === 'correlation' ? ['value', 'other'] : type === 'aggregate' ? ['month', 'value'] : ['value'];
        for (const path of ['data.csv', 'empty.csv']) await call('eda_analyze', { path, analysis: { type, columns } });
        await call('eda_analyze', { path: 'data.csv', analysis: { type, columns: ['unknown'] } });
    }
    for (const analysis of [
        { type: 'rows', columns: ['value'], sort: 'asc' },
        { type: 'rows', columns: ['value'], offset: 20 },
        { type: 'summary', columns: ['value'], function: 'sum' },
        { type: 'rows', columns: ['value'], filter: [{ column: 'month', op: 'eq', value: 'none' }] }
    ]) await call('eda_analyze', { path: 'data.csv', analysis });
    for (const analysis of [
        { type: 'summary', columns: ['value'] },
        { type: 'summary', columns: ['label', 'value'] },
        { type: 'rows', columns: ['label'], sort_by: 'value' },
        { type: 'rows', columns: ['label'], filter: [{ column: 'value', op: 'eq', value: '$1' }] }
    ]) await call('eda_analyze', { path: 'units.csv', analysis });
    await call('eda_analyze', { path: 'unit-mismatch.csv', analysis: { type: 'rows', columns: ['label'], filter: [{ column: 'value', op: 'eq', value: '$1' }] } });
    await call('eda_analyze', { path: 'unit-mismatch.csv', analysis: { type: 'summary', columns: ['label', 'value'], filter: [{ column: 'label', op: 'eq', value: 'b' }] } });
    for (const source of [
        '{"data":[{"y":[1,2]}]}', '{"data":[]}', '{}', '{', '{"data":[{"type":"sankey"}]}',
        '{"data":[{"type":"bar","x":["A"],"y":[-1]},{"type":"pie","labels":["total","B","C","D","E","F","G"],"values":[1,1,1,1,1,1,1]}],"layout":{"barmode":"stack","yaxis":{"range":[5,50]}}}',
        JSON.stringify({ data: Array.from({ length: 7 }, (_, i) => ({ type: 'bar', x: ['A'], y: [i + 1] })), layout: { title: { text: 'T' }, yaxis: { title: { text: 'Y' } } } })
    ]) await call('check_chart', { source });
    for (const args of [{ path: 'note.md' }, { path: 'empty.md' }, { path: 'missing.md' }, { path: 'file.pdf' }, { path: 'note.md', from: 20 }]) await call('read_charts', args);
    const topics = descriptor.tools.find(t => t.name === 'get_chart_guide').inputSchema.properties.topic.enum;
    for (const topic of [...topics, 'invalid', '']) await call('get_chart_guide', { topic });
    const types = descriptor.tools.find(t => t.name === 'build_chart').inputSchema.properties.type.enum;
    for (const type of types) {
        const args = { type, labels: ['A', 'B'], series: [{ name: 'Series', values: [1, 2] }] };
        if (['scatter', 'bubble'].includes(type)) args.series[0].x = [1, 2];
        if (type === 'bubble') args.series[0].size = [2, 3];
        if (['treemap', 'sunburst'].includes(type)) args.parents = ['', 'A'];
        await call('build_chart', args);
    }
    for (const args of [{ type: 'bar', labels: [], series: [] }, { type: 'invalid', series: [] },
        { type: 'bar', labels: ['A'], series: [{ values: [] }] },
        { type: 'pie', labels: ['A'], series: [{ values: [1] }, { values: [2] }] }]) await call('build_chart', args);
    {
        const bar = { type: 'bar', labels: ['A'], series: [{ values: [1] }] };
        for (const args of [
            { ...bar, bins: 2 }, { ...bar, target: {} }, { ...bar, highlight: {} }, { ...bar, highlight: { labels: ['missing'] } },
            { type: 'combo', labels: ['A'], series: [{ values: [1] }, { values: [2], secondary: true }], target: { value: 1, series: 1 }, highlight: { below_target: true } },
            { ...bar, y2_title: 'unused' }, { ...bar, style: 'report', target: { value: 1 } },
            { ...bar, caption: 'a'.repeat(199), labels: Array.from({ length: 200 }, (_, i) => `long category name ${i}`), series: [{ values: Array(200).fill(1) }] },
            { ...bar, labels: Array.from({ length: 55 }, (_, i) => `${'a'.repeat(37)}${i}`), series: [{ values: Array(55).fill(1) }] },
            { type: 'bar', source: { path: 'large.csv', labels: 'name' }, series: [{ column: 'value' }] },
            { ...bar, title: 'a'.repeat(201) },
            { type: 'bar', source: { path: 'data.csv', labels: 'month', x: 'value' }, series: [{ column: 'value' }] },
            { type: 'bar', source: { path: 'data.csv', labels: 'month' }, series: [{ column: 'value', sizeColumn: 'other' }] },
            { type: 'bar', source: { path: 'compare-units.csv', labels: 'label' }, series: [{ column: 'value' }, { column: 'reference' }] },
            { type: 'bar', unit: 'wrong', source: { path: 'compare-units.csv', labels: 'label' }, series: [{ column: 'value' }] },
            { type: 'bar', style: 'report', source: { path: 'data.csv', labels: 'month', filter: [{ column: 'value', op: 'gt', value: '0' }] }, series: [{ column: 'value' }] }
        ]) await call('build_chart', args);
    }
    {
        const source = { path: 'data.csv', analysis: { type: 'aggregate', columns: ['month', 'value'] } };
        const series = [{ column: 'value' }];
        for (const args of [
            { type: 'bar', source, series },
            { type: 'bar', source: { ...source, labels: 'month' }, series },
            { type: 'bar', source: { ...source, analysis: { type: 'summary', columns: ['value'] } }, series },
            { type: 'scatter', source, series },
            { type: 'bar', source: { ...source, analysis: { ...source.analysis, filter: [{ column: 'month', op: 'eq', value: 'missing' }] } }, series },
            { type: 'bar', source, series: [{ column: 'bad' }] },
            { type: 'waterfall', source, series },
            { type: 'bar', source: { path: 'compare.md', analysis: { type: 'compare', columns: ['label', 'value', 'reference'] } }, series: [{ column: 'value' }, { column: 'ratio' }] },
            { type: 'bar', unit: 'bad', source, series: [{ column: 'share' }] },
            { type: 'bar', labels: ['A', 'A'], series: [{ values: [1, 2] }] },
            ...['share', 'difference', 'ratio'].map(column => ({ type: 'bar', source: { path: 'compare.md', analysis: column === 'share' ? { type: 'aggregate', columns: ['label', 'value'] } : { type: 'compare', columns: ['label', 'value', 'reference'] } }, series: [{ column }] })),
            { type: 'bar', source: { path: 'period.csv', analysis: { type: 'compare', columns: ['group', 'value'], period: { column: 'year', base: '2025', target: '2026' } } }, series: [{ column: 'rate' }] }
        ]) await call('build_chart', args);
        if (locale === 'ko') {
            await call('eda_profile', { path: 'facts-ko.csv', from: 2 });
            await call('build_chart', { type: 'bar', source: { path: 'facts-ko.csv', labels: '부서' }, series: [{ column: 'value3' }] });
        }
    }
    {
        await call('eda_profile', { path: 'absent/xy.csv' });
        await call('eda_analyze', { path: 'data.csv', analysis: { type: 'rows', columns: ['value'], limit: 200 } });
        const base = { type: 'bar', source: { path: 'data.csv', labels: 'month' }, series: [{ column: 'value' }] };
        for (const args of [base,
            { ...base, source: { ...base.source, extra: 1 } },
            { ...base, source: { ...base.source, sort: {} } },
            { ...base, source: { ...base.source, limit: 0 } },
            { ...base, labels: ['A'] },
            { ...base, source: { ...base.source, filter: [{ column: 'month', op: 'eq', value: 'none' }] } },
            { ...base, series: [{}] },
            { ...base, series: [{ column: 'month' }] },
            { type: 'bar', labels: ['A'], series: [{ column: 'value' }] }
        ]) await call('build_chart', args);
    }
    {
        const bar = { type: 'bar', labels: ['A', 'B', 'C'], series: [{ values: [1, 2, 3] }] };
        const source = { path: 'facts.csv', analysis: { type: 'aggregate', columns: ['group', 'value'] } };
        const compare = { type: 'compare', columns: ['group', 'value'], period: { column: 'year', base: '2025', target: '2026' } };
        await call('eda_analyze', { path: 'facts.csv', analysis: compare });
        for (const args of [
            { ...bar, title_from: 'facts', title: 'Manual' },
            { ...bar, title_from: 'invalid' },
            { ...bar, title_from: 'facts', series: [{ values: [null, null, null] }] },
            { ...bar, highlight: { bottom: 2 }, title_from: 'facts' },
            { ...bar, highlight: { top: 2 } },
            { ...bar, highlight: { labels: ['A', 'B'] } },
            { ...bar, series: [{ values: [1, 2, 3] }, { values: [3, 2, 1] }], highlight: { top: 1 } },
            { ...bar, highlight: { top: 1, bottom: 1 } },
            { ...bar, highlight: { labels: ['A'], bottom: 1 } },
            { ...bar, type: 'line', highlight: { bottom: 1 } },
            { type: 'bar', source, series: [{ column: 'value' }] },
            { type: 'bar', source: { ...source, analysis: { type: 'aggregate', columns: ['group'], function: 'count' } }, series: [{ column: 'value' }] },
            { type: 'bar', source: { ...source, path: 'large.csv', analysis: { ...source.analysis, columns: ['name', 'value'], limit: 100 } }, series: [{ column: 'value' }] },
            { type: 'bar', source: { ...source, analysis: compare }, series: [{ column: 'difference' }] },
            { type: 'bar', unit: '%', source: { path: 'data.csv', labels: 'month' }, series: [{ column: 'value' }], target: { value: 5 } }
        ]) await call('build_chart', args);
    }
    {
        for (const args of [
            { path: 'data.csv' },
            { path: 'data.csv', goal: 'trend' },
            { path: 'data.csv', goal: 'compare', top: 3 },
            // The request is user text and comes back in readFromRequest.matched, so each locale asks in its own language.
            { path: 'period.csv', request: locale === 'ko' ? '2025년과 2026년 실적 증감을 보여줘.' : 'Show the change between 2025 and 2026.' },
            { path: 'period.csv', request: locale === 'ko' ? '월별 추이는 빼고 부서별로 비교해 줘.' : 'Compare by department, not the monthly trend.' },
            { path: 'nopairs.csv', goal: 'relationship' },
            { path: 'compare.md', goal: 'target', reference: 'reference' },
            { path: 'compare.md', goal: 'matrix' },
            { path: 'facts.csv', goal: 'change', period: { column: 'year', base: '2025', target: '2026' } },
            { path: 'compare-units.csv', request: locale === 'ko' ? '목표 100원 비교해 줘' : 'Compare with target 100%.' },
            { path: 'data.csv', goal: 'invalid' },
            { path: 'data.csv', request: 'a'.repeat(501) },
            { path: 'data.csv', goal: 'compare', label: 'missing' },
            { path: 'data.csv', goal: 'distribution', label: 'month' },
            { path: 'data.csv', goal: 'compare', values: [] },
            { path: 'data.csv', goal: 'compare', values: ['value', 'value'] },
            { path: 'data.csv', goal: 'compare', values: ['missing'] },
            { path: 'data.csv', goal: 'compare', label: 'value', values: ['value'] },
            { path: 'data.csv', goal: 'compare', values: ['month'] },
            { path: 'data.csv', goal: 'compare', reference: 'other' },
            { path: 'data.csv', goal: 'target', reference: 'missing' },
            { path: 'data.csv', goal: 'target', reference: 'month' },
            { path: 'data.csv', goal: 'target', values: ['value'], reference: 'value' },
            { path: 'data.csv', goal: 'rank', top: 0 },
            { path: 'data.csv', goal: 'rank', period: { base: '2025-01', target: '2025-02' } },
            { path: 'period.csv', goal: 'compare', period: { column: 'year', base: '2025', target: '2026' } },
            { path: 'period.csv', goal: 'compare' },
            { path: 'data.csv', goal: 'change', period: {} },
            { path: 'data.csv', goal: 'change', period: { column: 'missing', base: '2025-01', target: '2025-02' } },
            { path: 'data.csv', goal: 'target', target_value: 'bad' },
            { path: 'data.csv', goal: 'share', target_value: 10 },
            { path: 'data.csv', goal: 'trend', filter: [{ column: 'month', op: 'eq', value: 'none' }] },
            { path: 'mixed-year.csv', goal: 'trend' },
            { path: 'mixed-notation.csv', goal: 'trend' },
            { path: 'period-order.csv', goal: 'trend' },
            { path: 'trend-dup.csv', goal: 'trend', values: ['a', 'b'] },
            { path: 'trend-dup.csv', goal: 'trend', values: ['a'] },
            { path: 'trend-101-dup.csv', goal: 'trend' },
            { path: 'trend-km.csv', goal: 'trend' },
            { path: 'rows201.csv', goal: 'trend' },
            { path: 'trend-combo.csv', goal: 'trend', values: ['rev', 'rate'] },
            { path: 'trend-combo.csv', goal: 'trend', values: ['rev'] },
            { path: 'wide13.csv', goal: 'compare', values: ['v1', 'v2', 'v3', 'v4'] },
            { path: 'compare-units.csv', goal: 'compare', values: ['value', 'reference'] },
            { path: 'cat-dup.csv', goal: 'compare', values: ['a', 'b'] },
            { path: 'cat-dup.csv', goal: 'compare', values: ['a'] },
            { path: 'cat101-dup.csv', goal: 'compare' },
            { path: 'cat-dup-long.csv', goal: 'compare' },
            { path: 'leading-zero.csv', goal: 'compare' },
            { path: 'large.csv', goal: 'compare' },
            { path: 'cat-dup.csv', goal: 'rank' },
            { path: 'large.csv', goal: 'rank' },
            { path: 'zero.csv', goal: 'share' },
            { path: 'neg.csv', goal: 'share' },
            { path: 'leading-zero.csv', goal: 'share' },
            { path: 'large.csv', goal: 'share' },
            { path: 'large.csv', goal: 'distribution' },
            { path: 'data.csv', goal: 'distribution' },
            { path: 'wide13.csv', goal: 'relationship', values: ['v1', 'v2', 'v3', 'v4'] },
            { path: 'bubble-neg.csv', goal: 'relationship', values: ['x', 'y', 'size'] },
            { path: 'bubble-pos.csv', goal: 'relationship', values: ['x', 'y', 'size'] },
            { path: 'cat-dup.csv', goal: 'target', values: ['a'], reference: 'b' },
            { path: 'cat-dup.csv', goal: 'target', values: ['a'] },
            { path: 'cat-dup.csv', goal: 'target', values: ['a'], target_value: 25 },
            { path: 'leading-zero.csv', goal: 'target' },
            { path: 'two-periods.csv', goal: 'change' },
            { path: 'period.csv', goal: 'change' },
            { path: 'period.csv', request: locale === 'ko' ? '2025년과 2026년 증감에서 감소 폭이 가장 큰 1곳을 강조해 줘' : 'Show the change between 2025 and 2026.' },
            { path: 'period-dec.csv', request: locale === 'ko' ? '2025년과 2026년 증감에서 증가 폭이 가장 큰 1곳을 강조해 줘' : 'Show the change between 2025 and 2026.' },
            { path: 'period.csv', goal: 'change', period: { column: 'year', base: '2025', target: '2026' }, highlight: { top: 1 } },
            { path: 'period-pct.csv', goal: 'change', period: { column: 'year', base: '2025', target: '2026' } },
            { path: 'matrix-units.csv', goal: 'matrix', values: ['a', 'b', 'c'] },
            { path: 'matrix-dup.csv', goal: 'matrix' },
            { path: 'wide13.csv', goal: 'matrix' },
            { path: 'wide99-too-large.csv', goal: 'matrix' }
        ]) await call('suggest_chart', args);
    }
    await call('unknown', {});
    await call('read_charts', { path: '../outside.md' });
    await call('get_chart_guide', {}, { signal: { aborted: true } });
    p.dispose();
    await call('get_chart_guide', {});
    plugin.onunload();
    return { descriptor, calls, ui: h.ui };
}
module.exports = { headSource, buildHead, loadHarness, captureExtended };
