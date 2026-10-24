'use strict';
// Run: node --test test/lazy-loading.test.js
// Plotly and D3 are stubbed: this checks when the plugin loads them, not that charts draw.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');
const buildPlugin = require('./helpers/build-plugin');

const code = buildPlugin();

async function setup({ failPlotly = 0 } = {}) {
    const notices = [], readyCallbacks = [], required = [];
    let plotlyFailures = failPlotly;
    const timers = new Map();
    let timerId = 0;
    const window = {
        setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { timers.delete(id); }
    };
    const obsidian = {
        Plugin: class {
            async loadData() { return {}; }
            registerMarkdownCodeBlockProcessor(name, fn) { this.processor = fn; }
            addCommand() {}
            addSettingTab() {}
        },
        PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {},
        Notice: class {
            constructor(message, duration) { Object.assign(this, { message, duration }); notices.push(this); }
            hide() { this.hidden = true; }
        },
        parseYaml: JSON.parse
    };
    const stubs = {
        obsidian,
        d3: { version: 'test' },
        'plotly.js-dist-min': { newPlot() {}, validate() { return [{ msg: 'schema issue' }]; } }
    };
    const require = (name) => {
        required.push(name);
        if (name === 'plotly.js-dist-min' && plotlyFailures > 0) { plotlyFailures--; throw new Error('boom'); }
        return stubs[name];
    };
    const module = { exports: {} };
    const context = vm.createContext({ window, document: {}, console: { log() {} }, module, exports: module.exports,
        require, WeakRef, structuredClone, Promise });
    vm.runInContext('Array.prototype.contains = Array.prototype.includes;', context);
    vm.runInContext(code, context);
    const plugin = new module.exports.default();
    plugin.manifest = { id: 'chart-hands', name: 'Chart Hands', version: '0.9.0' };
    plugin.app = { workspace: { onLayoutReady(fn) { readyCallbacks.push(fn); }, trigger() {} } };
    await plugin.onload();
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const tick = async ms => {
        for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); }
        await flush();
    };
    const ready = async () => { readyCallbacks.forEach(fn => fn()); await flush(); await tick(0); };
    return { plugin, window, notices, required, timers, flush, ready };
}

test('startup registers APIs without loading libraries; concurrent demand loads once after layout ready', async () => {
    const h = await setup();
    assert.equal(h.required.includes('plotly.js-dist-min'), false);
    assert.equal(typeof h.plugin.processor, 'function');
    assert.equal(typeof h.window.renderPlotly, 'function');
    const first = h.window.loadPlotlyLibraries();
    assert.equal(first, h.window.loadPlotlyLibraries());
    await h.flush();
    assert.equal(h.required.includes('plotly.js-dist-min'), false);
    await h.ready();
    const result = await first;
    assert.equal(result.Plotly, h.plugin.Plotly);
    assert.equal(h.window.d3.version, 'test');
    assert.equal(h.required.filter(name => name === 'plotly.js-dist-min').length, 1);
    assert.equal(h.required.filter(name => name === 'd3').length, 1);
    await h.window.loadPlotlyLibraries();
    assert.equal(h.required.filter(name => name === 'plotly.js-dist-min').length, 1);
    assert.equal(h.notices.length, 2);
    assert.equal(h.notices[0].duration, 0);
    assert.equal(h.notices[0].hidden, true);
    h.plugin.onunload();
});

test('load failure hides notice and allows retry', async () => {
    const h = await setup({ failPlotly: 1 });
    const first = h.plugin.ensureLibraries();
    const rejected = assert.rejects(first, /boom/);
    await h.ready();
    await rejected;
    assert.equal(h.notices[0].hidden, true);
    assert.match(h.notices.at(-1).message, /retry/);
    const retry = h.plugin.ensureLibraries();
    await h.flush(); await h.ready(); await retry;
    h.plugin.onunload();
});

test('unload before layout readiness settles pending callers without loading', async () => {
    const h = await setup();
    const cancelled = assert.rejects(h.plugin.ensureLibraries(), /unloaded/);
    h.plugin.onunload(); await cancelled; await h.ready();
    assert.equal(h.required.includes('plotly.js-dist-min'), false);
    assert.equal(h.notices.length, 0);
    assert.equal(h.window.renderPlotly, undefined);
    assert.equal(h.window.loadPlotlyLibraries, undefined);
});

test('closed markdown blocks are not rendered after loading completes', async () => {
    const h = await setup();
    const children = [];
    const rendered = h.plugin.processor('{"data":[]}', {}, { addChild(c) { children.push(c); } });
    children[0].onunload();
    await h.ready(); await rendered;
    assert.equal(children.length, 1);
    h.plugin.onunload();
});

test('agent checks await libraries and perform Plotly schema validation on first use', async () => {
    const h = await setup();
    const checked = h.plugin.agentProvider.callTool('check_chart', { source: '{"data":[{"y":[1]}]}' });
    await h.ready();
    const result = await checked;
    assert.equal(result.structuredContent.valid, false);
    assert.match(result.content[0].text, /schema issue/);
    h.plugin.onunload();
});
