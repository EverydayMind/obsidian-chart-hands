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
        },
        PluginSettingTab: class { constructor() { this.containerEl = { empty() {} }; } },
        Setting: class {
            setName(value) { record('name', value); return this; }
            setDesc(value) { record('description', value); return this; }
            addDropdown(fn) { fn(component); return this; }
            addToggle(fn) { fn(component); return this; }
        },
        Notice: class { constructor(...values) { record('notice', ...values); } hide() {} },
        MarkdownRenderChild: class {},
        parseYaml: JSON.parse, stringifyYaml: value => JSON.stringify(value, null, 2) + '\n'
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

const files = {
    'data.csv': 'month,value,other\n2025-01,2,3\n2025-02,4,6',
    'empty.csv': 'month,value,other\n',
    'bad.csv': 'duplicate,duplicate\n1,2',
    'note.md': '```plotly\n{"data":[{"y":[1,2]}]}\n```',
    'empty.md': '', 'file.pdf': 'synthetic'
};
async function captureExtended(code, locale) {
    const h = loadHarness(code, locale);
    const plugin = new h.exports.default();
    plugin.manifest = { id: 'chart-hands', name: 'Chart Hands', version: 'test' };
    plugin.app = { workspace: { onLayoutReady(fn) { fn(); }, trigger() {} }, vault: {
        getFiles: () => Object.keys(files).map(path => ({ path, extension: path.split('.').pop() })),
        getAbstractFileByPath: p => Object.hasOwn(files, p) ? { path: p, extension: p.split('.').pop() } : null,
        cachedRead: async file => files[file.path]
    } };
    await plugin.onload();
    // Capture both real Notice paths, including the newline in the failure Notice.
    try { await plugin.ensureLibraries(); } catch { /* Synthetic failure is intentional. */ }
    const el = { children: [], appendChild(child) { this.children.push(child); },
        ownerDocument: { createElement: () => ({ style: {} }) } };
    await h.processors.plotly('{}', el, { addChild() {} });
    plugin.ensureLibraries = async () => ({});
    for (const source of ['null', '{"other":1}']) await h.processors.plotly(source, el, { addChild() {} });
    for (const child of el.children) if (child.textContent) h.ui.push({ kind: 'render-error', values: [child.textContent] });
    const p = h.exports.createAgentProvider({ manifest: plugin.manifest, app: plugin.app }, locale);
    const descriptor = await p.describe();
    const calls = [];
    const call = async (name, args, ctx) => {
        const result = await p.callTool(name, args, ctx);
        calls.push({ name, args, result });
    };
    for (const args of [{ path: 'data.csv' }, { path: 'empty.csv' }, { path: 'bad.csv' }, { path: 'missing.csv' }, { path: 'file.pdf' }, { path: 'data.csv', from: 20 }]) await call('eda_profile', args);
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
    for (const source of ['{"data":[{"y":[1,2]}]}', '{"data":[]}', '{}', '{', '{"data":[{"type":"sankey"}]}']) await call('check_chart', { source });
    for (const args of [{ path: 'note.md' }, { path: 'empty.md' }, { path: 'missing.md' }, { path: 'file.pdf' }, { path: 'note.md', from: 20 }]) await call('read_charts', args);
    const topics = descriptor.tools.find(t => t.name === 'get_chart_guide').inputSchema.properties.topic.enum;
    for (const topic of [...topics, 'invalid', '']) await call('get_chart_guide', { topic });
    const types = descriptor.tools.find(t => t.name === 'build_chart').inputSchema.properties.type.enum;
    for (const type of types) {
        const args = { type, labels: ['A', 'B'], series: [{ name: 'Series', values: [1, 2], x: [1, 2], size: [2, 3] }] };
        if (['treemap', 'sunburst'].includes(type)) args.parents = ['', 'A'];
        await call('build_chart', args);
    }
    for (const args of [{ type: 'bar', labels: [], series: [] }, { type: 'invalid', series: [] },
        { type: 'bar', labels: ['A'], series: [{ values: [] }] },
        { type: 'pie', labels: ['A'], series: [{ values: [1] }, { values: [2] }] }]) await call('build_chart', args);
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
    await call('unknown', {});
    await call('read_charts', { path: '../outside.md' });
    await call('get_chart_guide', {}, { signal: { aborted: true } });
    p.dispose();
    await call('get_chart_guide', {});
    plugin.onunload();
    return { descriptor, calls, ui: h.ui };
}
module.exports = { headSource, buildHead, loadHarness, captureExtended };
