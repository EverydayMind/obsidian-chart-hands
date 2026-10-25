'use strict';
// Run: node --test test/new-chart-command.test.js
// Parses with the yaml package, which rejects tab indentation with the same error Obsidian's
// parseYaml gives. Plotly is stubbed to record what it is asked to draw.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');
const YAML = require('yaml');
const buildPlugin = require('./helpers/build-plugin');

const code = buildPlugin();
// What the New Plotly chart command inserted up to 0.9.6.
const OLD_TEMPLATE = 'data:\n\t- x: [0,1,2]\n\t  y: [0,1,0]\n';

async function setup() {
    const commands = {}, drawn = [];
    let processor;
    const obsidian = {
        Plugin: class {
            async loadData() { return {}; }
            registerMarkdownCodeBlockProcessor(name, fn) { processor = fn; }
            addCommand(command) { commands[command.name] = command; }
            addSettingTab() {}
        },
        PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {},
        Notice: class { hide() {} },
        parseYaml: YAML.parse,
        stringifyYaml: YAML.stringify
    };
    const Plotly = {
        newPlot(gd, data) { drawn.push(data); gd.on = () => {}; return gd; },
        validate() { return []; },
        purge() {}
    };
    const stubs = { obsidian, d3: {}, 'plotly.js-dist-min': Plotly };
    const module = { exports: {} };
    const context = vm.createContext({ window: { setTimeout: fn => fn(), clearTimeout() {} },
        document: { createElement: () => ({}) }, console, module, exports: module.exports,
        require: name => stubs[name], WeakRef, structuredClone, Promise,
        ResizeObserver: class { observe() {} disconnect() {} } });
    vm.runInContext('Array.prototype.contains = Array.prototype.includes;', context);
    vm.runInContext(code, context);
    const plugin = new module.exports.default();
    plugin.manifest = { id: 'chart-hands', name: 'Chart Hands', version: '0' };
    plugin.app = { workspace: { onLayoutReady(fn) { fn(); }, trigger() {} } };
    await plugin.onload();
    // Draws a block the way Obsidian calls the processor and returns what was drawn or shown.
    const render = async (content) => {
        const el = { children: [], appendChild(child) { this.children.push(child); return child; },
            ownerDocument: { createElement: () => ({ clientWidth: 0, style: {} }) } };
        const before = drawn.length;
        await processor(content, el, { addChild() {} });
        return { data: drawn.slice(before)[0], errors: el.children.map(child => child.textContent).filter(Boolean) };
    };
    const insert = (name) => {
        let inserted;
        commands[name].editorCallback({ getDoc: () => ({ getCursor: () => 0, replaceRange: text => { inserted = text; } }) });
        return inserted;
    };
    return { plugin, render, insert };
}

test('New Plotly chart inserts a block that parses and draws', async () => {
    const h = await setup();
    const inserted = h.insert('New Plotly chart');
    const [, body] = inserted.match(/^```plotly\n([\s\S]*?)^```/m);
    assert.doesNotMatch(body, /^ *\t/m);
    assert.deepEqual(YAML.parse(body), { data: [{ x: [0, 1, 2], y: [0, 1, 0] }] });
    const result = await h.render(body);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.data, [{ x: [0, 1, 2], y: [0, 1, 0] }]);
    h.plugin.onunload();
});

test('a block indented with tabs by an earlier template still draws', async () => {
    const h = await setup();
    assert.throws(() => YAML.parse(OLD_TEMPLATE), /Tabs are not allowed as indentation/);
    const result = await h.render(OLD_TEMPLATE);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.data, [{ x: [0, 1, 2], y: [0, 1, 0] }]);
    const provider = h.plugin[Symbol.for('dev.agentinterop.capability-provider')];
    const checked = await provider.callTool('check_chart', { source: OLD_TEMPLATE });
    assert.equal(checked.structuredContent.valid, true, checked.content[0].text);
    h.plugin.onunload();
});

test('a tab-indented block with another mistake still shows the error', async () => {
    const h = await setup();
    const result = await h.render('data:\n\t- x: [0, 1\n');
    assert.equal(result.data, undefined);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^Couldn't render plot:/);
    h.plugin.onunload();
});
