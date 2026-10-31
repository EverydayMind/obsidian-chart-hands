import * as obsidian from 'obsidian';
import { parseDataset, profile, analyze } from './eda.js';
import { GUIDE_TOPICS } from './chart-guide.js';
import { CHART_TYPES, SINGLE_SERIES_TYPES, buildChartDefinition } from './chart-builder.js';
import { STATIC_CHART_API, parseStaticChart, renderStaticChart } from './static-chart.js';

// Plotly.js and D3 are bundled into main.js by esbuild, but each import() below becomes a lazy
// module: its code only runs on the first call, so the vault opens without evaluating either.
let Plotly;
const loadD3 = async (plugin) => {
    if (plugin.unloaded) {
        throw new Error('Chart Hands is unloaded.');
    }
    if (typeof window.d3 === 'undefined') {
        window.d3 = await import('d3');
    }
    return window.d3;
};
const loadPlotly = async (plugin) => {
    if (plugin.unloaded) {
        throw new Error('Chart Hands is unloaded.');
    }
    if (!Plotly) {
        const loaded = await import('plotly.js-dist-min');
        Plotly = window.Plotly = loaded.default || loaded;
    }
    if (typeof Plotly.newPlot !== 'function') {
        throw new Error('Plotly.js loaded, but Plotly.newPlot is unavailable.');
    }
    return Plotly;
};

/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

// Width fitting: "shrink" narrows only charts wider than the note, "fill" always uses the
// note width, "off" keeps layout.width (or Plotly's 700px default) whatever the note width.
const FIT_MODES = ['off', 'shrink', 'fill'];
const DEFAULT_SETTINGS = {
    fitWidth: 'shrink',
    keepAspectRatio: true,
    printFit: true
};
// Plotly's values for an unset layout.width / layout.height, and its minimum size.
const PLOTLY_DEFAULT_WIDTH = 700;
const PLOTLY_DEFAULT_HEIGHT = 450;
const PLOTLY_MIN_SIZE = 10;
const RESIZE_DEBOUNCE_MS = 100;
const CHART_CLASS = 'chart-hands-chart';
const PRINT_FIT_CLASS = 'chart-hands-print-fit';
const PLOTLY_STYLE_COPY_ID = 'chart-hands-copied-styles';
let settings = Object.assign({}, DEFAULT_SETTINGS);
// Weak references, so charts drawn through window.renderPlotly (which get no unload hook)
// can still be garbage collected.
const liveCharts = new Set();

const normalizeFit = (fit) => {
    if (fit === undefined || fit === null) {
        return null;
    }
    // YAML 1.1 parsers read `fit: off` as false.
    if (fit === false) {
        return 'off';
    }
    if (fit === true) {
        return 'fill';
    }
    if (typeof fit === 'string' && FIT_MODES.contains(fit.toLowerCase())) {
        return fit.toLowerCase();
    }
    throw `fit must be one of: ${FIT_MODES.join(', ')}.`;
};
// Plotly writes computed values back into the layout it is given, so every draw gets a copy.
const cloneLayout = (layout) => {
    if (!layout) {
        return {};
    }
    try {
        return structuredClone(layout);
    }
    catch {
        // Layouts built in dataviewjs may hold values structuredClone rejects, such as functions.
        return Object.assign({}, layout);
    }
};
// Returns the size to draw the chart at for the available width, or null to leave it to Plotly.
const computeFitSize = (layout, config, mode, available) => {
    // autosize or a responsive config without a width already asks for the container width.
    const autoWidth = !layout.width && (layout.autosize === true || config.responsive === true);
    const naturalWidth = layout.width || PLOTLY_DEFAULT_WIDTH;
    const naturalHeight = layout.height || PLOTLY_DEFAULT_HEIGHT;
    if (mode === 'off') {
        // Plotly would otherwise autosize to the container now that it is attached before
        // drawing; keep the fixed size charts had before width fitting existed.
        return autoWidth ? null : { width: naturalWidth, height: naturalHeight };
    }
    if (!(available > 0)) {
        return null;
    }
    const width = (mode === 'fill' || autoWidth) ? available : Math.min(naturalWidth, available);
    let height = naturalHeight;
    if (settings.keepAspectRatio && !autoWidth && width < naturalWidth) {
        height = naturalHeight * width / naturalWidth;
    }
    return {
        width: Math.max(PLOTLY_MIN_SIZE, Math.floor(width)),
        height: Math.max(PLOTLY_MIN_SIZE, Math.round(height))
    };
};
// Plotly adds its CSS to the main window with insertRule, but Obsidian copies only the text of
// <style> tags into other windows, including the hidden one "Export to PDF" renders in.
const ensurePlotlyStyles = (doc) => {
    if (!doc || doc === document || !doc.head) {
        return;
    }
    const rules = [];
    document.querySelectorAll('style[id^="plotly.js-style"]').forEach(style => {
        if (style.sheet) {
            Array.from(style.sheet.cssRules).forEach(rule => rules.push(rule.cssText));
        }
    });
    let copy = doc.getElementById(PLOTLY_STYLE_COPY_ID);
    if (!copy) {
        copy = doc.createElement('style');
        copy.id = PLOTLY_STYLE_COPY_ID;
        doc.head.appendChild(copy);
    }
    copy.textContent = rules.join('\n');
};
// Plotly sets the size of the SVG container and the WebGL canvases as inline styles, which a
// stylesheet can only override with !important. Writing them as var(--chart-hands-print-width,
// 700px) keeps the same size on screen, where the variable is unset, and lets the print rules
// in styles.css replace it by defining the variable. Plotly writes plain values again on every
// draw, and syncPrintBox wraps them again after it.
const wrapPrintSize = (el) => {
    ['width', 'height'].forEach(prop => {
        const value = el.style[prop];
        if (value && !value.startsWith('var(')) {
            el.style[prop] = `var(--chart-hands-print-${prop}, ${value})`;
        }
    });
};
const rerenderCharts = () => {
    liveCharts.forEach(ref => {
        const chart = ref.deref();
        if (chart) {
            chart.render().catch(error => console.error(error));
        }
        else {
            liveCharts.delete(ref);
        }
    });
};

class PlotlyChart {
    constructor(el, data, layout, config, fit) {
        this.fit = normalizeFit(fit);
        this.data = data;
        this.layout = cloneLayout(layout);
        // Plotly 4 shows an "Upload to Cloud" button by default; keep it hidden unless asked for.
        this.config = Object.assign({ showSendToCloud: false }, config);
        this.gd = el.ownerDocument.createElement('div');
        this.gd.className = CHART_CLASS;
        el.appendChild(this.gd);
        this.lastWidth = 0;
        this.resizeTimer = null;
        this.observer = null;
        this.stopWatchingWindow = null;
        this.syncPrintBox = this.syncPrintBox.bind(this);
        this.ref = new WeakRef(this);
        liveCharts.add(this.ref);
        this.observe();
    }
    get mode() {
        return this.fit || settings.fitWidth;
    }
    render() {
        const gd = this.gd;
        const layout = cloneLayout(this.layout);
        this.lastWidth = gd.clientWidth;
        const size = computeFitSize(this.layout, this.config, this.mode, this.lastWidth);
        if (size) {
            Object.assign(layout, size);
        }
        return new Promise(resolve => resolve(Plotly.newPlot(gd, this.data, layout, this.config)))
            .then(() => {
                // newPlot drops earlier listeners, so this is attached again on every draw.
                gd.on('plotly_afterplot', this.syncPrintBox);
                this.syncPrintBox();
                ensurePlotlyStyles(gd.ownerDocument);
                return gd;
            });
    }
    // Refit after the note's width changed (pane resize, sidebar toggle, ...).
    update() {
        const gd = this.gd;
        const width = gd.clientWidth;
        if (!width || width === this.lastWidth || !gd._fullLayout) {
            return;
        }
        this.lastWidth = width;
        const size = computeFitSize(this.layout, this.config, this.mode, width);
        if (size && (size.width !== gd._fullLayout.width || size.height !== gd._fullLayout.height)) {
            Plotly.relayout(gd, size).catch(error => console.error(error));
        }
    }
    scheduleUpdate() {
        window.clearTimeout(this.resizeTimer);
        // Fit at once when the chart first gets a width, debounce while a pane is being dragged.
        this.resizeTimer = window.setTimeout(() => this.update(), this.lastWidth ? RESIZE_DEBOUNCE_MS : 0);
    }
    observe() {
        const watch = (win) => {
            if (this.observer) {
                this.observer.disconnect();
            }
            const Observer = (win && win.ResizeObserver) || ResizeObserver;
            this.observer = new Observer(() => this.scheduleUpdate());
            this.observer.observe(this.gd);
        };
        watch(this.gd.win);
        // A note can be moved into a popout window; the observer and Plotly's CSS must follow it.
        if (typeof this.gd.onWindowMigrated === 'function') {
            this.stopWatchingWindow = this.gd.onWindowMigrated(win => {
                watch(win);
                ensurePlotlyStyles(win.document);
            });
        }
    }
    // Give each SVG layer a viewBox equal to its drawn size. That changes nothing on screen, but
    // lets styles.css scale the chart down to the page width when printing instead of clipping it.
    syncPrintBox() {
        const gd = this.gd;
        const fullLayout = gd._fullLayout;
        if (!fullLayout) {
            return;
        }
        const { width, height } = fullLayout;
        gd.style.setProperty('--chart-hands-width', `${width}px`);
        gd.style.setProperty('--chart-hands-aspect', `${width} / ${height}`);
        gd.querySelectorAll('.svg-container > .main-svg').forEach(svg => {
            svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        });
        gd.querySelectorAll('.svg-container, .svg-container .gl-canvas').forEach(wrapPrintSize);
        gd.classList.toggle(PRINT_FIT_CLASS, settings.printFit);
    }
    destroy() {
        liveCharts.delete(this.ref);
        window.clearTimeout(this.resizeTimer);
        if (this.observer) {
            this.observer.disconnect();
        }
        if (typeof this.stopWatchingWindow === 'function') {
            this.stopWatchingWindow();
        }
        Plotly.purge(this.gd);
    }
}

const showError = (el, error) => {
    let errorDiv = document.createElement('div');
    errorDiv.textContent = "Couldn't render plot:" + error;
    el.appendChild(errorDiv);
};
// YAML forbids tabs as indentation, but the New Plotly chart template up to 0.9.6 (and
// obsidian-plotly's) indented with them. Such a block is read again with each leading tab as
// two spaces, so charts already in notes keep drawing.
const parseChartYaml = (content) => {
    try {
        return obsidian.parseYaml(content);
    }
    catch (error) {
        if (!/^ *\t/m.test(content)) {
            throw error;
        }
        return obsidian.parseYaml(content.replace(/^[ \t]+/gm, indent => indent.replace(/\t/g, '  ')));
    }
};
const preprocessor = (content, el, ctx) => {
    let json;
    try {
        json = parseChartYaml(content);
        validate(json, el);
        const chart = new PlotlyChart(el, json.data, json.layout, json.config, json.fit);
        const child = new obsidian.MarkdownRenderChild(el);
        child.onunload = () => chart.destroy();
        ctx.addChild(child);
        // Obsidian waits for this promise before "Export to PDF" prints the page.
        return chart.render().catch(error => showError(el, error));
    }
    catch (error) {
        showError(el, error);
    }
};
const allowValues = ["data", "layout", "config", "fit"];
const validate = (json, el) => {
    if (!json) {
        throw "There should be a valid JSON in this block.";
    }
    Object.keys(json).forEach(key => {
        if (!allowValues.contains(key)) {
            throw "The only valid keys are data, layout, config and fit.";
        }
    });
};
// Exposed as window.renderPlotly for dataviewjs. Each call adds a chart to el; the optional
// fit argument overrides the plugin setting. Resolves with the chart div, like Plotly.newPlot.
const renderPlotly = (el, data, layout, config, fit) => {
    return new PlotlyChart(el, data, layout, config, fit).render();
};

const basicPlotlyChart = [
    '```plotly',
    'data:',
    '  - x: [0, 1, 2]',
    '    y: [0, 1, 0]',
    '```\n'
].join('\n');
const NEW_PLOTLY_CHART_NAME = "New Plotly chart";
const newPlotlyChart = (editor) => {
    let doc = editor.getDoc();
    let cursor = doc.getCursor();
    doc.replaceRange(basicPlotlyChart, cursor);
};
const dataviewjsPlotlyChart = [
    '```dataviewjs',
    '// Load the bundled libraries before using D3 or Plotly directly.',
    'const { d3 } = await window.loadPlotlyLibraries();',
    '',
    '//Replace this block with any example from plotly.com',
    '//NOTE: `Plotly.newPlot` won\'t work here, use `window.renderPlotly` instead',
    'var data = [',
    '{x:[0,1,2,3,4,5,6,7,8,9],y:[4,4,2,2,3,3,2,2,4,4]},',
    '{x:[0,1,2,3,4,5,6,7,8,9],y:[3,3,1,1,2,2,1,1,3,3]}',
    '];',
    'var layout = {};',
    'var config = {};',
    '',
    'window.renderPlotly(this.container, data, layout, config)',
    '```'
].join('\n');
const NEW_PLOTLY_CHART_BY_DATAVIEWJS_NAME = "New Plotly chart (Dataviewjs)";
const newPlotlyChartByDataviewjs = (editor) => {
    let doc = editor.getDoc();
    let cursor = doc.getCursor();
    doc.replaceRange(dataviewjsPlotlyChart, cursor);
};
// Agent facade (agentinterop v1). An agent host discovers this object on the plugin instance under
// AGENT_CAPABILITY_PROVIDER and calls describe()/callTool(). It knows nothing about any particular
// host. The tools only inspect chart definitions: they never draw into a note or change a file.
const AGENT_CAPABILITY_PROVIDER = Symbol.for('dev.agentinterop.capability-provider');
const PROVIDERS_CHANGED_EVENT = 'agentinterop:providers-changed';
const AGENT_MAX_RESULT_CHARS = 8000;
const AGENT_PAGE_CHARS = 6000;
const AGENT_MAX_CHARTS = 20;
const AGENT_MAX_PROBLEMS = 12;
// Notes are .md, like most of a vault, so no tool is in the core group: a host shows them
// only when the request mentions one of these.
const AGENT_KEYWORDS = ['plotly', 'chart', 'graph', 'plot', 'visuali', 'diagram', 'histogram', 'heatmap', 'treemap', 'sankey', 'dashboard',
    '차트', '그래프', '도표', '시각화', '파이', '막대', '분포', '히트맵', '산점도', '대시보드'];
const agentMeta = (effect) => ({
    'dev.agentinterop/effect': effect,
    'dev.agentinterop/group': 'chart',
    'dev.agentinterop/resourceTypes': ['.md'],
    'dev.agentinterop/keywords': AGENT_KEYWORDS,
    'dev.agentinterop/maxResultChars': AGENT_MAX_RESULT_CHARS
});
const edaMeta = () => ({ ...agentMeta('read'), 'dev.agentinterop/group': 'data', 'dev.agentinterop/resourceTypes': ['.csv'], 'dev.agentinterop/keywords': [...AGENT_KEYWORDS, 'eda', 'data', 'csv', 'statistics', 'correlation', 'dataset', '??', '???', '??', '??', '??'] });
const GUIDE_TOPIC_NAMES = Object.keys(GUIDE_TOPICS);
const AGENT_TOOLS = [
    {
        name: 'eda_profile', title: 'Profile a CSV dataset',
        description: 'Read a vault CSV and infer columns, missing rates, distinct counts, frequent values and numeric descriptive statistics. Blank or whitespace-only cells are missing; all nonblank values must be numeric for a numeric column. Returns five columns per page. CSV must have unique headers and at most 100000 rows, 100 columns and 5 MiB. Does not modify files or load Plotly.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Vault-relative CSV path.' },
            from: { type: 'integer', minimum: 1, description: '1-based column number; defaults to 1.' }
        } }, annotations: { readOnlyHint: true }, _meta: edaMeta()
    },
    {
        name: 'eda_analyze', title: 'Analyze a CSV dataset',
        description: 'Analyze a vault CSV using a renderer-independent analysis specification. summary and histogram take one numeric column; correlation takes two and computes Pearson correlation using complete numeric pairs. Reports excluded rows and null correlation when undefined. Does not modify files or load Plotly.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'analysis'], properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Vault-relative CSV path.' },
            analysis: { type: 'object', additionalProperties: false, required: ['type', 'columns'], properties: {
                type: { type: 'string', enum: ['summary', 'histogram', 'correlation'] },
                columns: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
                method: { type: 'string', enum: ['pearson'] },
                bins: { type: 'integer', minimum: 1, maximum: 50, description: 'Histogram bin count, default 10; intervals are left-closed, right-open except the last.' }
            } }
        } }, annotations: { readOnlyHint: true }, _meta: edaMeta()
    },

    {
        name: 'check_chart',
        title: 'Check a Plotly chart',
        description: 'Check the content of a plotly code block (YAML or JSON): that it parses, that the top-level keys are only data, layout, config and fit, that trace and layout attributes and values suit Plotly, and common mistakes such as unquoted colours. Returns a list of problems. Call it before writing a chart block into a note. Does not change any note.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['source'],
            properties: {
                source: { type: 'string', minLength: 1, maxLength: 20000, description: 'The content that goes inside a plotly code block, without the opening and closing fence lines.' }
            }
        },
        annotations: { readOnlyHint: true },
        _meta: agentMeta('pure')
    },
    {
        name: 'read_charts',
        title: 'Read the Plotly charts in a note',
        description: 'Find the plotly code blocks in a note and return, for each chart, its line range, trace types and point counts, title, and the problems found by the check. Returns at most 20 charts per call and gives the next from value when there are more. Charts drawn with dataviewjs are counted but not checked.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['path'],
            properties: {
                path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Vault-relative path of a Markdown note.' },
                from: { type: 'integer', minimum: 1, maximum: 100000, description: 'Start reading at this chart number. Defaults to 1.' }
            }
        },
        annotations: { readOnlyHint: true },
        _meta: agentMeta('read')
    },
    {
        name: 'get_chart_guide',
        title: 'Plotly chart writing guide',
        description: 'Return guidance for writing Plotly chart blocks for Chart Hands. Topics: basics (block format, YAML rules, which chart type fits which question, workflow), style (polished look: palette, margins, labels, annotations), examples (line, bar and pie blocks), statistical (histogram, box, violin, correlation heatmap, density, splom, error bars), hierarchy (treemap, sunburst, icicle, sankey, waterfall, funnel, parcats), timeseries (date axes, range slider and buttons, candlestick, event shading, KPI indicator and gauge), scientific (contour, 3D surface, polar, wind rose, ternary, parallel coordinates, table), maps (choropleth, scattergeo, tile maps), layout (subplots, secondary axis, rich hover, reference lines, buttons, sliders), dataviewjs (dynamic charts), errors (fixing charts that do not render). Read basics before writing a chart by hand.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                topic: { type: 'string', enum: GUIDE_TOPIC_NAMES, description: 'Guide topic. Defaults to basics.' }
            }
        },
        annotations: { readOnlyHint: true },
        _meta: agentMeta('pure')
    },
    {
        name: 'build_chart',
        title: 'Build a Plotly chart block',
        description: 'Build a ready-to-insert plotly code block from plain data, apply the Chart Hands palette (style clean) and run basic checks on it; use check_chart for full Plotly schema validation. Per-label types need labels and one values array per series: line, area, bar, barh, combo (bars plus lines, series kind), funnel, radar, heatmap (each series is a row named by its name). pie, donut, waterfall (optional measure), treemap and sunburst (parents required) use labels and the first series. scatter and bubble need x and values per series (bubble also size). histogram, box and violin take raw observations in values. indicator takes values [value] or [value, reference]. series secondary puts a series on a right-hand y axis. Returns the fenced block; for compatible compact inputs also returns staticBlock for HWPX export. Insert with the host\'s note-editing tools. Does not change any note.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'series'],
            properties: {
                type: { type: 'string', enum: CHART_TYPES, description: 'Chart type.' },
                title: { type: 'string', maxLength: 200, description: 'Chart title.' },
                labels: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 100 }, description: 'Category names (x axis; y axis for barh and funnel stages), slice or node names (pie, donut, treemap, sunburst), heatmap columns or radar axes. Not used by scatter, bubble, histogram, box, violin or indicator.' },
                parents: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 100 }, description: 'treemap and sunburst: the parent label of each label, "" for a top-level item.' },
                measure: { type: 'array', maxItems: 200, items: { type: 'string', enum: ['relative', 'total', 'absolute'] }, description: 'waterfall: per label, relative (a change, the default), total (running total; its value is ignored) or absolute (sets the level).' },
                series: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 12,
                    description: 'Data series.',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['values'],
                        properties: {
                            name: { type: 'string', maxLength: 100, description: 'Series name, shown in the legend.' },
                            values: { type: 'array', minItems: 1, maxItems: 2000, items: { type: 'number' }, description: 'One number per label (per x for scatter and bubble), or raw observations for histogram, box and violin.' },
                            x: { type: 'array', maxItems: 2000, items: { type: 'number' }, description: 'scatter and bubble: the x value of each point.' },
                            size: { type: 'array', maxItems: 2000, items: { type: 'number', minimum: 0 }, description: 'bubble: the size measure of each point (drawn as area).' },
                            text: { type: 'array', maxItems: 2000, items: { type: 'string', maxLength: 100 }, description: 'scatter and bubble: a hover label for each point.' },
                            kind: { type: 'string', enum: ['bar', 'line', 'area'], description: 'combo: how to draw this series. Defaults to bar for the first series and line for the others.' },
                            secondary: { type: 'boolean', description: 'line, area, bar, combo: draw this series against a right-hand y axis (a different unit).' }
                        }
                    }
                },
                x_title: { type: 'string', maxLength: 100, description: 'Horizontal axis title. Include the unit.' },
                y_title: { type: 'string', maxLength: 100, description: 'Vertical axis title. Include the unit.' },
                y2_title: { type: 'string', maxLength: 100, description: 'Right-hand axis title, for series with secondary. Include the unit.' },
                stacked: { type: 'boolean', description: 'Stack several bar, area or histogram series instead of grouping or overlaying them.' },
                bins: { type: 'integer', minimum: 1, maximum: 200, description: 'histogram: the maximum number of bins.' },
                range_slider: { type: 'boolean', description: 'line, area, bar, combo, scatter, bubble: add a range slider under the x axis for long series.' },
                style: { type: 'string', enum: ['clean', 'plain'], description: 'clean (default) applies the palette and tidy layout; plain adds nothing beyond the data.' }
            }
        },
        annotations: { readOnlyHint: true },
        _meta: agentMeta('pure')
    }
];
const AGENT_INSTRUCTIONS = 'For CSV exploration use eda_profile to inspect schema and missingness, then eda_analyze for numeric summary, histogram or Pearson correlation. Interpret excluded rows and undefined correlations. Use results to choose charts; these tools never edit data. Tools for Plotly charts in Obsidian notes (Chart Hands). A chart is a fenced code block with language plotly. Its content is YAML or JSON whose only top-level keys are data (list of traces), layout, config and fit. Quote colours ("#2563EB") and date-like strings; use no functions or variables. Write titles as objects: title: {text: "..."}. Choose the chart from the question it answers (get_chart_guide basics): trend, comparison, share, distribution, relationship, matrix, hierarchy, flow, stages, profile or KPI, and use Plotly\'s advanced types (heatmap, box, violin, treemap, sunburst, sankey, waterfall, funnel, candlestick, polar, contour, 3D, maps, subplots, buttons) when the data has that shape. Workflow: call get_chart_guide when unsure (topics: basics, style, examples, statistical, hierarchy, timeseries, scientific, maps, layout, dataviewjs, errors). Use build_chart for its 19 types, or write the block yourself from the topic examples. Run check_chart on the block content (without the fence lines) before writing it into a note, and fix every problem it reports. Insert the block with the host\'s note-editing tools: none of these tools edits a note or draws a chart. read_charts lists and checks the plotly blocks already in a note. The check verifies the definition against Plotly\'s rules, not how the chart looks on screen.';

class AgentToolError extends Error {
    constructor(code, message, retryable) {
        super(message);
        this.code = code;
        this.retryable = retryable === true;
    }
}
const agentClip = (value, max) => {
    const text = String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};
const TRACE_LENGTH_KEYS = ['x', 'y', 'z', 'values', 'labels', 'r', 'theta', 'a', 'lat', 'lon', 'locations', 'open', 'dimensions'];
const describeTrace = (trace) => {
    if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
        return '(not an object)';
    }
    const type = typeof trace.type === 'string' ? trace.type : 'scatter';
    const key = TRACE_LENGTH_KEYS.find(name => Array.isArray(trace[name]));
    const name = typeof trace.name === 'string' && trace.name ? ` "${agentClip(trace.name, 30)}"` : '';
    return `${type}${name}${key ? ` ${trace[key].length} points` : ''}`;
};
const REMOVED_TRACE_TYPES = {
    scattermapbox: 'scattermap', choroplethmapbox: 'choroplethmap', densitymapbox: 'densitymap', heatmapgl: 'heatmap', pointcloud: 'scattergl'
};
const sameLength = (arrays) => arrays.every(array => Array.isArray(array) && array.length === arrays[0].length);
// Data shapes that the advanced trace types need and Plotly.validate does not check.
const lintTrace = (trace, where, add) => {
    const type = trace.type;
    if (Object.prototype.hasOwnProperty.call(REMOVED_TRACE_TYPES, type)) {
        add(`${where}: type ${type} does not exist in this Plotly version; use ${REMOVED_TRACE_TYPES[type]}${type.endsWith('mapbox') ? ' with layout.map instead of layout.mapbox' : ''}.`);
    }
    if ((type === 'treemap' || type === 'sunburst' || type === 'icicle') && !trace.ids) {
        if (!Array.isArray(trace.labels) || !Array.isArray(trace.parents) || trace.labels.length !== trace.parents.length) {
            add(`${where}: a ${type} needs labels and parents arrays of the same length ("" for a top-level item).`);
        }
        else if (trace.parents.some(parent => parent !== '' && !trace.labels.includes(parent))) {
            add(`${where}: every parent must be one of the labels or "".`);
        }
    }
    if (type === 'sankey') {
        const link = trace.link || {};
        const nodes = trace.node && Array.isArray(trace.node.label) ? trace.node.label.length : 0;
        if (!sameLength([link.source, link.target, link.value])) {
            add(`${where}: a sankey needs link.source, link.target and link.value arrays of the same length.`);
        }
        else if (nodes && [...link.source, ...link.target].some(node => !Number.isInteger(node) || node < 0 || node >= nodes)) {
            add(`${where}: link.source and link.target must be 0-based indexes into node.label (0 to ${nodes - 1}).`);
        }
    }
    if ((type === 'candlestick' || type === 'ohlc') && !sameLength([trace.open, trace.high, trace.low, trace.close])) {
        add(`${where}: a ${type} needs open, high, low and close arrays of the same length.`);
    }
    if (type === 'waterfall' && Array.isArray(trace.measure)) {
        const values = trace.orientation === 'h' ? trace.x : trace.y;
        if (Array.isArray(values) && values.length !== trace.measure.length) {
            add(`${where}: measure has ${trace.measure.length} items but there are ${values.length} values.`);
        }
    }
    if (['heatmap', 'contour', 'surface'].includes(type) && Array.isArray(trace.z) && trace.z.length && !Array.isArray(trace.z[0])
        && (type === 'surface' || !Array.isArray(trace.x) || !Array.isArray(trace.y))) {
        add(`${where}: z must be a list of rows (a list of lists).`);
    }
};
// Mistakes that parse fine but draw nothing useful, found from the source text and parsed value.
const LINT_MAX_FINDINGS = 8;
const UNQUOTED_HEX = /(?::|-|\[|,)\s*#[0-9a-fA-F]{3,8}\s*(?:[,\]}]|$)/;
const looksLikeScript = (text) => /\$\{|=>|^\s*function\b/.test(text);
const lintChart = (source, json, problems) => {
    const findings = [];
    const add = (message) => {
        if (findings.length < LINT_MAX_FINDINGS) {
            findings.push(message);
        }
    };
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
        if (UNQUOTED_HEX.test(line)) {
            add(`Line ${index + 1}: unquoted colour. YAML reads # as a comment, so the value becomes null. Write it in quotes, e.g. color: "#2563EB".`);
        }
    });
    const hexFound = findings.length > 0;
    const walk = (value, path, depth) => {
        if (depth > 12 || findings.length >= LINT_MAX_FINDINGS) {
            return;
        }
        if (value instanceof Date) {
            add(`${path} is a Date value. Quote date-like strings so they stay strings.`);
        }
        else if (typeof value === 'string') {
            if (looksLikeScript(value)) {
                add(`${path} looks like JavaScript. Only static values are allowed.`);
            }
        }
        else if (Array.isArray(value)) {
            value.slice(0, 500).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
        }
        else if (value && typeof value === 'object') {
            Object.keys(value).forEach(key => {
                if (value[key] === null && /colou?r$/i.test(key) && !hexFound) {
                    add(`${path}.${key} is empty (null). Was a colour written without quotes?`);
                }
                walk(value[key], `${path}.${key}`, depth + 1);
            });
        }
    };
    walk(json, '$', 0);
    if (Array.isArray(json.data)) {
        const traces = json.data.filter(trace => trace && typeof trace === 'object');
        traces.forEach((trace, index) => {
            // With a grid z (heatmap, contour, surface) x labels the columns and y the rows.
            const grid = Array.isArray(trace.z) && Array.isArray(trace.z[0]);
            if (!grid && Array.isArray(trace.x) && Array.isArray(trace.y) && trace.x.length !== trace.y.length) {
                add(`Trace ${index + 1}: x has ${trace.x.length} points but y has ${trace.y.length}.`);
            }
            if (trace.type === 'pie' && (!Array.isArray(trace.values) || !Array.isArray(trace.labels))) {
                add(`Trace ${index + 1}: a pie needs both labels and values arrays.`);
            }
            lintTrace(trace, `Trace ${index + 1}`, add);
        });
        const layout = json.layout && typeof json.layout === 'object' ? json.layout : null;
        if (layout) {
            Object.keys(layout).filter(key => key === 'title' || /^(?:[xy]axis\d*|scene\d*|polar\d*|ternary\d*)$/.test(key)).forEach(key => {
                const owner = key === 'title' ? layout : layout[key];
                if (owner && typeof owner.title === 'string') {
                    add(`layout.${key === 'title' ? '' : `${key}.`}title is a plain string, which this Plotly version does not show. Write title: {text: "..."}.`);
                }
            });
        }
        if (layout && layout.barmode && traces.length && !traces.some(trace => trace.type === 'bar' || trace.type === 'histogram')) {
            add('layout.barmode only affects bar and histogram traces, and there are none.');
        }
    }
    problems.push(...findings);
};
// Plotly.validate reports every args value of a button or slider step as reset, although Plotly
// uses those values as written.
const isMenuArgsIssue = (issue) => Boolean(issue && issue.code === 'dynamic' && Array.isArray(issue.path)
    && (issue.path[0] === 'updatemenus' || issue.path[0] === 'sliders') && issue.path[4] === 'args');
// The same rules the code block processor applies, plus Plotly's own schema check.
const analyzeChart = (source) => {
    const result = { problems: [], traces: [], title: '' };
    let json;
    try {
        json = parseChartYaml(source);
    }
    catch (error) {
        result.problems.push(`Cannot parse as YAML/JSON: ${agentClip(error && error.message ? error.message : error, 300)}`);
        return result;
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        result.problems.push('The block content must be an object with the keys data, layout, config and fit.');
        return result;
    }
    const unknown = Object.keys(json).filter(key => !allowValues.includes(key));
    if (unknown.length) {
        result.problems.push(`Unsupported top-level keys: ${unknown.map(key => agentClip(key, 40)).join(', ')}. Only data, layout, config and fit are allowed; any other key stops the chart from drawing.${unknown.includes('frames') ? ' Animations (frames) are not available; use layout.sliders or layout.updatemenus.' : ''}`);
    }
    if (json.fit !== undefined && json.fit !== null && typeof json.fit !== 'boolean'
        && !(typeof json.fit === 'string' && FIT_MODES.includes(json.fit.toLowerCase()))) {
        result.problems.push(`fit must be one of: ${FIT_MODES.join(', ')}.`);
    }
    if (json.data === undefined || json.data === null) {
        result.problems.push('data is missing. Put the list of traces in data.');
    }
    else if (!Array.isArray(json.data)) {
        result.problems.push('data must be a list of traces.');
    }
    else {
        result.traces = json.data.map(describeTrace);
        if (!json.data.length) {
            result.problems.push('data is empty.');
        }
    }
    if (json.layout !== undefined && json.layout !== null && (typeof json.layout !== 'object' || Array.isArray(json.layout))) {
        result.problems.push('layout must be an object.');
    }
    else if (json.layout && json.layout.title) {
        result.title = agentClip(typeof json.layout.title === 'string' ? json.layout.title : json.layout.title.text, 80);
    }
    lintChart(source, json, result.problems);
    if (Plotly && typeof Plotly.validate === 'function' && Array.isArray(json.data)
        && (!json.layout || (typeof json.layout === 'object' && !Array.isArray(json.layout)))) {
        try {
            // Plotly.validate returns undefined when there is nothing to report.
            const issues = (Plotly.validate(json.data, json.layout || {}) || []).filter(issue => !isMenuArgsIssue(issue));
            issues.forEach(issue => result.problems.push(agentClip(issue && issue.msg ? issue.msg : issue, 300)));
        }
        catch (error) {
            result.problems.push(`Plotly check failed: ${agentClip(error && error.message ? error.message : error, 200)}`);
        }
    }
    return result;
};
const problemLines = (problems) => {
    const lines = problems.slice(0, AGENT_MAX_PROBLEMS).map(problem => `  - ${problem}`);
    if (problems.length > AGENT_MAX_PROBLEMS) {
        lines.push(`  - … ${problems.length - AGENT_MAX_PROBLEMS} more problems`);
    }
    return lines;
};
// Fenced blocks whose language is exactly "plotly", with the 1-based line range of the fence.
const findChartBlocks = (markdown) => {
    const lines = markdown.split(/\r?\n/);
    const charts = [];
    let dataview = 0;
    for (let index = 0; index < lines.length; index++) {
        const open = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/.exec(lines[index]);
        if (!open) {
            continue;
        }
        const fence = open[1];
        const language = open[2].toLowerCase();
        const body = [];
        const startLine = index + 1;
        let closed = false;
        for (index++; index < lines.length; index++) {
            const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[index]);
            if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
                closed = true;
                break;
            }
            body.push(lines[index]);
        }
        if (language === 'plotly') {
            charts.push({ startLine, endLine: Math.min(index + 1, lines.length), closed, source: body.join('\n') });
        }
        else if (language === 'dataviewjs' && body.some(line => line.includes('renderPlotly'))) {
            dataview++;
        }
    }
    return { charts, dataview };
};
const normalizeAgentPath = (value) => {
    const raw = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
    const parts = raw.split('/');
    if (!raw || /^(?:[A-Za-z]:|\/)/.test(raw) || [...raw].some(char => char.charCodeAt(0) < 32) || parts.includes('..')) {
        throw new AgentToolError('INVALID_ARGUMENT', 'path must be a vault-relative path.', true);
    }
    return parts.filter(part => part && part !== '.').join('/');
};
const createAgentProvider = (plugin) => {
    const descriptor = {
        provider: {
            id: plugin.manifest.id,
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            description: 'Analyze CSV data and build, check and read Plotly charts'
        },
        instructions: AGENT_INSTRUCTIONS,
        tools: AGENT_TOOLS
    };
    let disposed = false;
    const readDataset = async (rawPath) => {
        const path = normalizeAgentPath(rawPath);
        const file = plugin.app.vault.getAbstractFileByPath(path);
        if (!file || !file.extension) throw new AgentToolError('NOT_FOUND', `File not found in the vault: ${path}`, true);
        if (file.extension.toLowerCase() !== 'csv') throw new AgentToolError('UNSUPPORTED_FORMAT', 'Only CSV files (.csv) can be analyzed.');
        if (file.stat && file.stat.size > 5 * 1024 * 1024) throw new AgentToolError('INVALID_ARGUMENT', 'CSV must be at most 5 MiB.', true);
        try { return { path, dataset: parseDataset(await plugin.app.vault.cachedRead(file)) }; }
        catch (error) { throw new AgentToolError('INVALID_ARGUMENT', error.message, true); }
    };
    const handlers = {
        eda_profile: async (args) => {
            const { path, dataset } = await readDataset(args.path);
            const from = args.from === undefined ? 1 : args.from;
            if (!Number.isInteger(from) || from < 1 || from > dataset.headers.length) throw new AgentToolError('INVALID_ARGUMENT', 'from must identify a column, starting at 1.', true);
            const result = profile(dataset, from - 1);
            result.from = from;
            result.to = from + result.columns.length - 1;
            result.complete = result.to === result.columnCount;
            if (!result.complete) result.nextFrom = result.to + 1;
            return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, _meta: { 'dev.agentinterop/resource': { path } } };
        },
        eda_analyze: async (args) => {
            const { path, dataset } = await readDataset(args.path);
            let result;
            try { result = analyze(dataset, args.analysis); }
            catch (error) { throw new AgentToolError('INVALID_ARGUMENT', error.message, true); }
            return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, _meta: { 'dev.agentinterop/resource': { path } } };
        },
        get_chart_guide: (args) => {
            const topic = args.topic === undefined ? 'basics' : args.topic;
            if (!Object.prototype.hasOwnProperty.call(GUIDE_TOPICS, topic)) {
                throw new AgentToolError('INVALID_ARGUMENT', `topic must be one of: ${GUIDE_TOPIC_NAMES.join(', ')}.`, true);
            }
            const others = GUIDE_TOPIC_NAMES.filter(name => name !== topic).join(', ');
            return Promise.resolve({
                content: [{ type: 'text', text: `${GUIDE_TOPICS[topic]}\n\nOther topics: ${others}.` }],
                structuredContent: { topic, topics: GUIDE_TOPIC_NAMES }
            });
        },
        build_chart: async (args) => {
            let definition;
            try {
                definition = buildChartDefinition(args);
            }
            catch (error) {
                throw new AgentToolError('INVALID_ARGUMENT', error.message, true);
            }
            const yaml = obsidian.stringifyYaml(definition).trimEnd();
            const chart = analyzeChart(yaml);
            const staticSource = JSON.stringify(args);
            let staticBlock;
            try {
                if (staticSource.length <= 2000) {
                    parseStaticChart(staticSource);
                    staticBlock = `\`\`\`chart-hands-static\n${staticSource}\n\`\`\``;
                }
            }
            catch { /* The interactive chart can support inputs that the static renderer cannot. */ }
            const notes = [];
            if (SINGLE_SERIES_TYPES.includes(args.type) && Array.isArray(args.series) && args.series.length > 1) {
                notes.push(`A ${args.type} chart shows one series; only the first was used.`);
            }
            const text = [
                chart.problems.length ? `${chart.problems.length} problem(s) found in the built chart:` : 'Built a plotly block. Basic checks found no problems; call check_chart for full Plotly schema validation.',
                ...problemLines(chart.problems),
                ...notes,
                '```plotly',
                yaml,
                '```'
            ].join('\n');
            return {
                content: [{ type: 'text', text }],
                structuredContent: { valid: chart.problems.length === 0, problems: chart.problems.length, block: `\`\`\`plotly\n${yaml}\n\`\`\``, ...(staticBlock ? { staticBlock } : {}) }
            };
        },
        check_chart: (args) => __awaiter(void 0, void 0, void 0, function* () {
            if (plugin.ensureLibraries) yield plugin.ensureLibraries();
            const chart = analyzeChart(String(args.source));
            const summary = `traces: ${chart.traces.length}${chart.traces.length ? `(${agentClip(chart.traces.join(', '), 400)})` : ''}${chart.title ? ` · title "${chart.title}"` : ''}`;
            const lines = chart.problems.length
                ? [`${chart.problems.length} problem(s) · ${summary}`, ...problemLines(chart.problems)]
                : [`No problems · ${summary}`];
            return {
                content: [{ type: 'text', text: lines.join('\n') }],
                structuredContent: { valid: chart.problems.length === 0, problems: chart.problems.length, traces: chart.traces.length }
            };
        }),
        read_charts: (args) => __awaiter(void 0, void 0, void 0, function* () {
            const path = normalizeAgentPath(args.path);
            const file = plugin.app.vault.getAbstractFileByPath(path);
            if (!file || typeof file.extension !== 'string') {
                throw new AgentToolError('NOT_FOUND', `Note not found in the vault: ${path}`, true);
            }
            if (file.extension.toLowerCase() !== 'md') {
                throw new AgentToolError('UNSUPPORTED_FORMAT', 'Only Markdown notes (.md) can be read.');
            }
            const found = findChartBlocks(yield plugin.app.vault.cachedRead(file));
            if (found.charts.length && plugin.ensureLibraries) yield plugin.ensureLibraries();
            const total = found.charts.length;
            const from = typeof args.from === 'number' ? args.from : 1;
            if (from > Math.max(total, 1)) {
                throw new AgentToolError('INVALID_ARGUMENT', `from must be between 1 and ${Math.max(total, 1)}.`, true);
            }
            const lines = [];
            let size = 0;
            let next = from;
            let withProblems = 0;
            while (next <= total && next - from < AGENT_MAX_CHARTS) {
                const block = found.charts[next - 1];
                const chart = analyzeChart(block.source);
                const entry = [
                    `Chart ${next} · lines ${block.startLine}-${block.endLine}${block.closed ? '' : ' · no closing fence'} · traces: ${chart.traces.length}${chart.traces.length ? `(${agentClip(chart.traces.join(', '), 200)})` : ''}${chart.title ? ` · title "${chart.title}"` : ''} · ${chart.problems.length ? `${chart.problems.length} problem(s)` : 'no problems'}`,
                    ...problemLines(chart.problems)
                ].join('\n');
                // Stop before the page budget so the host never cuts a chart in half; always return one.
                if (next > from && size + entry.length > AGENT_PAGE_CHARS) {
                    break;
                }
                lines.push(entry);
                size += entry.length + 1;
                if (chart.problems.length) {
                    withProblems++;
                }
                next++;
            }
            const complete = next > total;
            const text = [
                `Note ${path} · ${total} plotly chart(s)${total ? ` · showing ${from}-${next - 1}` : ''}${found.dataview ? ` · ${found.dataview} dataviewjs chart block(s), not checked` : ''}`,
                ...lines,
                ...(complete ? [] : [`… continue with from=${next} (${total - next + 1} more chart(s))`])
            ].join('\n');
            return {
                content: [{ type: 'text', text }],
                structuredContent: Object.assign({ charts: total, from, to: next - 1, withProblems, dataviewBlocks: found.dataview, complete }, complete ? {} : { nextFrom: next }),
                _meta: { 'dev.agentinterop/resource': { path } }
            };
        })
    };
    return {
        protocol: 'agentinterop',
        protocolVersion: 1,
        describe: () => Promise.resolve(descriptor),
        callTool: (name, args, ctx) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                if (disposed) {
                    throw new AgentToolError('DISPOSED', 'The plugin has been unloaded.');
                }
                if (!Object.prototype.hasOwnProperty.call(handlers, name)) {
                    throw new AgentToolError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
                }
                const result = yield handlers[name](args || {});
                if (ctx && ctx.signal && ctx.signal.aborted) {
                    throw new AgentToolError('CANCELLED', 'The call was cancelled.');
                }
                return result;
            }
            catch (error) {
                const known = error instanceof AgentToolError;
                const code = known ? error.code : 'INTERNAL';
                const retryable = known && error.retryable;
                return {
                    isError: true,
                    content: [{ type: 'text', text: known ? error.message : `Tool error: ${error && error.message ? error.message : error}` }],
                    structuredContent: { code, retryable },
                    _meta: { 'dev.agentinterop/error': { code, retryable } }
                };
            }
        }),
        dispose: () => { disposed = true; }
    };
};

class ChartHandsSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        new obsidian.Setting(containerEl)
            .setName('Fit chart width')
            .setDesc('Fit charts to the note width. Add "fit: off", "fit: shrink" or "fit: fill" to a code block to override this for that chart.')
            .addDropdown(dropdown => dropdown
            .addOption('shrink', 'Shrink only when wider')
            .addOption('fill', 'Always fill the width')
            .addOption('off', 'Off (original size)')
            .setValue(settings.fitWidth)
            .onChange(value => this.plugin.updateSetting('fitWidth', value)));
        new obsidian.Setting(containerEl)
            .setName('Keep aspect ratio when shrinking')
            .setDesc('Scale the height along with the width. When off, the height stays as set.')
            .addToggle(toggle => toggle
            .setValue(settings.keepAspectRatio)
            .onChange(value => this.plugin.updateSetting('keepAspectRatio', value)));
        new obsidian.Setting(containerEl)
            .setName('Fit the page width when exporting to PDF')
            .setDesc('Scale charts wider than the page down to the page width when exporting to PDF or printing, so they are not clipped.')
            .addToggle(toggle => toggle
            .setValue(settings.printFit)
            .onChange(value => this.plugin.updateSetting('printFit', value)));
    }
}
class ChartHandsPlugin extends obsidian.Plugin {
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            this.unloaded = false;
                        this.librariesPromise = null;
            this.layoutReady = new Promise(resolve => {
                this.resolveLayoutReady = resolve;
                this.app.workspace.onLayoutReady(resolve);
            });
            yield this.loadSettings();
            this.loadLibrariesApi = () => {
                if (!this.bothLibrariesPromise) {
                    this.bothLibrariesPromise = Promise.all([this.ensureLibraries(), loadD3(this)])
                        .then(([plotly, d3]) => ({ Plotly: plotly, d3 }))
                        .catch(error => { this.bothLibrariesPromise = null; throw error; });
                }
                return this.bothLibrariesPromise;
            };
            window.loadPlotlyLibraries = this.loadLibrariesApi;
            this.renderApi = async (...args) => {
                await this.ensureLibraries();
                return renderPlotly(...args);
            };
            window.renderPlotly = this.renderApi;
            this.registerMarkdownCodeBlockProcessor('chart-hands-static', async (content, el, ctx) => {
                let cancelled = false;
                const child = new obsidian.MarkdownRenderChild(el);
                let chart;
                child.onunload = () => { cancelled = true; chart?.destroy(); };
                ctx.addChild(child);
                try {
                    const definition = parseStaticChart(content);
                    await this.ensureLibraries();
                    if (cancelled || this.unloaded) return;
                    chart = new PlotlyChart(el, definition.data, definition.layout, definition.config);
                    await chart.render();
                }
                catch (error) { if (!cancelled && !this.unloaded) showError(el, error); }
            });
                        this.registerMarkdownCodeBlockProcessor('plotly', async (content, el, ctx) => {
                // A note may close while the libraries are loading.
                let cancelled = false;
                const child = new obsidian.MarkdownRenderChild(el);
                child.onunload = () => { cancelled = true; };
                ctx.addChild(child);
                try {
                    await this.ensureLibraries();
                    if (!cancelled) return preprocessor(content, el, ctx);
                }
                catch (error) {
                    if (!cancelled && !this.unloaded) showError(el, error);
                }
            });
            this.addCommand({
                id: "add-plotly-example",
                name: NEW_PLOTLY_CHART_NAME,
                editorCallback: (editor, view) => newPlotlyChart(editor)
            });
            this.addCommand({
                id: "add-plotly-dataviewjs-example",
                name: NEW_PLOTLY_CHART_BY_DATAVIEWJS_NAME,
                editorCallback: (editor, view) => newPlotlyChartByDataviewjs(editor)
            });
            this.addSettingTab(new ChartHandsSettingTab(this.app, this));
            // Self-exposed chart tools (agentinterop v1). An agent host finds the provider under the Symbol.
            this.agentProvider = createAgentProvider(this);
            Object.defineProperty(this, AGENT_CAPABILITY_PROVIDER, { value: this.agentProvider, configurable: true, enumerable: false, writable: false });
            Object.defineProperty(this, STATIC_CHART_API, { value: Object.freeze({
                protocol: 'chart-hands-static', version: 1,
                render: (source, signal) => renderStaticChart(source, { document, loadPlotly: () => loadPlotly(this), signal })
            }), configurable: true, enumerable: false, writable: false });
            this.app.workspace.onLayoutReady(() => {
                if (!this.unloaded) this.app.workspace.trigger(PROVIDERS_CHANGED_EVENT);
            });
        });
    }
    ensureLibraries() {
        if (this.unloaded) return Promise.reject(new Error('Chart Hands is unloaded.'));
        if (!this.librariesPromise) {
            this.librariesPromise = (async () => {
                await this.layoutReady;
                if (this.unloaded) throw new Error('Chart Hands is unloaded.');
                const notice = new obsidian.Notice('Chart Hands: loading Plotly and D3…', 0);
                this.loadingNotice = notice;
                try {
                    // Yield once so the ready layout and loading notice can be painted.
                    await new Promise(resolve => window.setTimeout(resolve, 0));
                    await loadPlotly(this);
                    if (this.unloaded) throw new Error('Chart Hands is unloaded.');
                    this.Plotly = Plotly;
                    new obsidian.Notice('Chart Hands: Plotly loaded', 3000);
                    return Plotly;
                }
                catch (error) {
                    if (!this.unloaded) new obsidian.Notice(`Chart Hands: could not load Plotly. It will retry on next use.
${error.message}`, 8000);
                    throw error;
                }
                finally {
                    notice.hide();
                    this.loadingNotice = null;
                }
            })().catch(error => {
                this.librariesPromise = null;
                throw error;
            });
        }
        return this.librariesPromise;
    }
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
            if (!FIT_MODES.contains(settings.fitWidth)) {
                settings.fitWidth = DEFAULT_SETTINGS.fitWidth;
            }
        });
    }
    updateSetting(key, value) {
        settings[key] = value;
        rerenderCharts();
        return this.saveData(settings);
    }
    onunload() {
        this.unloaded = true;
        this.resolveLayoutReady();
        if (this.loadingNotice) this.loadingNotice.hide();
        if (window.renderPlotly === this.renderApi) delete window.renderPlotly;
        if (window.loadPlotlyLibraries === this.loadLibrariesApi) delete window.loadPlotlyLibraries;
        if (this.agentProvider) {
            this.agentProvider.dispose();
            this.agentProvider = undefined;
        }
        delete this[AGENT_CAPABILITY_PROVIDER];
        delete this[STATIC_CHART_API];
        this.app.workspace.trigger(PROVIDERS_CHANGED_EVENT);
        liveCharts.forEach(ref => {
            const chart = ref.deref();
            if (chart) {
                chart.destroy();
            }
        });
        liveCharts.clear();
    }
}


export default ChartHandsPlugin;
// For tests outside Obsidian; Obsidian itself only uses the default export.
export { createAgentProvider };


