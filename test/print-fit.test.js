'use strict';
// Run: node --test test/print-fit.test.js
// Plotly and the DOM are stubbed: this checks how the plugin prepares a chart for printing,
// not how the browser lays it out. Check Export to PDF in Obsidian for that.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const buildPlugin = require('./helpers/build-plugin');

const code = buildPlugin();
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Just enough of an element for PlotlyChart: inline styles, classes, attributes and a fixed
// answer to the two selectors syncPrintBox asks for.
class FakeElement {
    constructor(className = '') {
        this.className = className;
        this.children = [];
        this.attributes = {};
        this.style = { setProperty(name, value) { this[name] = value; } };
        this.classList = { toggle: (name, on) => {
            const names = new Set(this.className.split(' ').filter(Boolean));
            if (on) names.add(name); else names.delete(name);
            this.className = [...names].join(' ');
        } };
        this.clientWidth = 0;
    }
    get ownerDocument() { return { createElement: () => new FakeElement() }; }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = value; }
    querySelectorAll(selector) {
        const all = [];
        const walk = el => el.children.forEach(child => { all.push(child); walk(child); });
        walk(this);
        const has = (el, name) => el.className.split(' ').includes(name);
        if (selector === '.svg-container > .main-svg') return all.filter(el => has(el, 'main-svg'));
        if (selector === '.svg-container, .svg-container .gl-canvas') return all.filter(el => has(el, 'svg-container') || has(el, 'gl-canvas'));
        throw new Error(`unexpected selector ${selector}`);
    }
}

// Draws the way Plotly does as far as sizes go: plain px values as inline styles on the
// container and WebGL canvases, width/height attributes on the SVG layers.
const drawSize = (gd, width, height) => {
    gd._fullLayout = { width, height };
    if (!gd.children.length) {
        const container = gd.appendChild(new FakeElement('svg-container'));
        container.appendChild(new FakeElement('main-svg'));
        container.appendChild(new FakeElement('gl-container')).appendChild(new FakeElement('gl-canvas gl-canvas-context'));
        container.appendChild(new FakeElement('main-svg'));
    }
    const [container] = gd.children;
    Object.assign(container.style, { width: `${width}px`, height: `${height}px` });
    const canvas = container.children[1].children[0];
    Object.assign(canvas.style, { width: `${width}px`, height: `${height}px` });
    container.children.filter(el => el.className === 'main-svg').forEach(svg => Object.assign(svg.attributes, { width, height }));
};
const Plotly = {
    newPlot(gd, data, layout) {
        drawSize(gd, layout.width || 700, layout.height || 450);
        gd.on = (event, fn) => { if (event === 'plotly_afterplot') gd.afterplot = fn; };
        return gd;
    },
    relayout(gd, update) {
        drawSize(gd, update.width, update.height);
        gd.afterplot();
        return Promise.resolve(gd);
    },
    purge() {}
};

async function setup(saved = {}) {
    const window = { setTimeout: fn => fn(), clearTimeout() {} };
    const obsidian = {
        Plugin: class {
            async loadData() { return saved; }
            registerMarkdownCodeBlockProcessor() {}
            addCommand() {}
            addSettingTab() {}
        },
        PluginSettingTab: class {}, Setting: class {}, MarkdownRenderChild: class {},
        Notice: class { hide() {} },
        parseYaml: JSON.parse,
        stringifyYaml: JSON.stringify
    };
    const stubs = { obsidian, d3: {}, 'plotly.js-dist-min': Plotly };
    const module = { exports: {} };
    const context = vm.createContext({ window, document: {}, console, module, exports: module.exports,
        require: name => stubs[name], WeakRef, structuredClone, Promise,
        ResizeObserver: class { observe() {} disconnect() {} } });
    vm.runInContext('Array.prototype.contains = Array.prototype.includes;', context);
    vm.runInContext(code, context);
    const plugin = new module.exports.default();
    plugin.manifest = { id: 'chart-hands', name: 'Chart Hands', version: '0' };
    plugin.app = { workspace: { onLayoutReady(fn) { fn(); }, trigger() {} } };
    await plugin.onload();
    return { plugin, window };
}

test('styles.css passes the community plugin CSS lint', () => {
    assert.doesNotMatch(css, /!important/);
    // break-inside and column-* count as the partly supported "multicolumn" feature.
    assert.doesNotMatch(css, /(?<![\w-])(break-(inside|before|after)|columns?(-[a-z]+)?)\s*:/);
    // The CSS 2.1 alias is fully supported, and keeps a printed chart on one page.
    assert.match(css, /\.chart-hands-chart \{\s*page-break-inside: avoid;/);
});

test('print rules define the variables that main.js puts in inline sizes', () => {
    for (const name of ['--chart-hands-print-width', '--chart-hands-print-height', '--chart-hands-width', '--chart-hands-aspect']) {
        assert.ok(css.includes(name), `${name} missing from styles.css`);
    }
    assert.match(code, /--chart-hands-print-\$\{prop\}/);
});

test('a drawn chart keeps its screen size but leaves the print size to styles.css', async () => {
    const h = await setup();
    const el = new FakeElement();
    const gd = await h.window.renderPlotly(el, [{ y: [1, 2] }], { width: 640, height: 400 });
    const [container] = gd.children;
    const canvas = container.children[1].children[0];
    const svgs = container.children.filter(child => child.className === 'main-svg');
    assert.match(gd.className, /\bchart-hands-print-fit\b/);
    assert.equal(gd.style['--chart-hands-width'], '640px');
    assert.equal(gd.style['--chart-hands-aspect'], '640 / 400');
    assert.equal(container.style.width, 'var(--chart-hands-print-width, 640px)');
    assert.equal(container.style.height, 'var(--chart-hands-print-height, 400px)');
    assert.equal(canvas.style.width, 'var(--chart-hands-print-width, 640px)');
    assert.equal(canvas.style.height, 'var(--chart-hands-print-height, 400px)');
    svgs.forEach(svg => assert.equal(svg.attributes.viewBox, '0 0 640 400'));
    h.plugin.onunload();
});

test('a redraw at a new size is wrapped again, not twice', async () => {
    const h = await setup();
    const gd = await h.window.renderPlotly(new FakeElement(), [{ y: [1] }], {});
    await h.window.Plotly.relayout(gd, { width: 320, height: 206 });
    gd.afterplot();
    const [container] = gd.children;
    assert.equal(container.style.width, 'var(--chart-hands-print-width, 320px)');
    assert.equal(container.style.height, 'var(--chart-hands-print-height, 206px)');
    assert.equal(container.children[1].children[0].style.width, 'var(--chart-hands-print-width, 320px)');
    assert.equal(gd.style['--chart-hands-aspect'], '320 / 206');
    h.plugin.onunload();
});

test('a responsive chart keeps its 100% width the same way', async () => {
    const h = await setup();
    const gd = await h.window.renderPlotly(new FakeElement(), [{ y: [1] }], {});
    const [container] = gd.children;
    container.style.width = '100%';
    gd.afterplot();
    assert.equal(container.style.width, 'var(--chart-hands-print-width, 100%)');
    h.plugin.onunload();
});

test('with print fitting turned off the chart gets no print-fit class', async () => {
    const h = await setup({ printFit: false });
    const gd = await h.window.renderPlotly(new FakeElement(), [{ y: [1] }], {});
    assert.doesNotMatch(gd.className, /chart-hands-print-fit/);
    // The wrapped sizes still fall back to Plotly's values, because only
    // .chart-hands-print-fit defines the print variables.
    assert.equal(gd.children[0].style.width, 'var(--chart-hands-print-width, 700px)');
    h.plugin.onunload();
});
