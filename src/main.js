import * as obsidian from 'obsidian';
import { parseDataset, profile, analyze, resolveChartSource, validateChartSource, AGGREGATE_FUNCTIONS, AGGREGATE_SORTS } from './eda.js';
import { splitLines, fenceOpen, fenceClose, tableDataset } from './markdown-table.js';
import { GUIDE_TOPICS } from './chart-guide.js';
import { CHART_TYPES, SINGLE_SERIES_TYPES, buildChartDefinition, validateBuildArgs } from './chart-builder.js';
import { analysisPresentation, chartFacts, factLines, titleDraft } from './chart-facts.js';
import { adviseChart } from './chart-advice.js';
import { SUGGEST_GOALS, suggestChart } from './suggest.js';
import { STATIC_CHART_API, parseStaticChart, renderStaticChart } from './static-chart.js';
import { getLocale, initLocale } from './locale.js';

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
    errorDiv.textContent = (getLocale() === 'ko' ? '차트를 표시할 수 없습니다: ' : "Couldn't render plot:") + error;
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
        throw getLocale() === 'ko' ? '이 블록에 유효한 JSON이 있어야 합니다.' : "There should be a valid JSON in this block.";
    }
    Object.keys(json).forEach(key => {
        if (!allowValues.contains(key)) {
            throw getLocale() === 'ko' ? '사용할 수 있는 키는 data, layout, config, fit뿐입니다.' : "The only valid keys are data, layout, config and fit.";
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
    '```'
].join('\n');
const NEW_PLOTLY_CHART_NAME = () => getLocale() === 'ko' ? '새 Plotly 차트' : "New Plotly chart";
const INSERT_PLOTLY_CHART_NAME = () => getLocale() === 'ko' ? 'Plotly 차트 삽입' : 'Insert Plotly chart';
// Ensure fenced blocks start on their own line and stay separated from surrounding paragraphs or headings.
const blockInsertion = (block, lineText = '', ch = 0, nextLineText) => {
    const line = typeof lineText === 'string' ? lineText : '';
    const offset = typeof ch === 'number' ? ch : 0;
    const before = line.slice(0, offset);
    const after = line.slice(offset);
    const prefix = /\S/.test(before) ? '\n\n' : '';
    const hasAfterText = /\S/.test(after);
    const hasNextLineText = typeof nextLineText === 'string' && /\S/.test(nextLineText);
    const suffix = hasAfterText || hasNextLineText ? '\n\n' : '\n';
    return `${prefix}${block}${suffix}`;
};
const insertChartBlock = (editor, block) => {
    const doc = typeof editor.getDoc === 'function' ? editor.getDoc() : editor;
    const cursor = doc.getCursor();
    const hasPos = cursor && typeof cursor.line === 'number';
    const line = hasPos ? cursor.line : 0;
    const ch = hasPos && typeof cursor.ch === 'number' ? cursor.ch : 0;
    const getLine = typeof editor.getLine === 'function' ? n => editor.getLine(n) : typeof doc.getLine === 'function' ? n => doc.getLine(n) : null;
    const lineCount = typeof editor.lineCount === 'function' ? editor.lineCount() : typeof doc.lineCount === 'function' ? doc.lineCount() : 0;
    const lineText = getLine ? getLine(line) : '';
    const nextLineText = getLine && line + 1 < lineCount ? getLine(line + 1) : undefined;
    const insertion = blockInsertion(block, lineText, ch, nextLineText);
    doc.replaceRange(insertion, cursor);
    const setCursor = typeof editor.setCursor === 'function' ? pos => editor.setCursor(pos) : typeof doc.setCursor === 'function' ? pos => doc.setCursor(pos) : null;
    if (setCursor && hasPos) {
        const prefixLines = insertion.startsWith('\n\n') ? 2 : 0;
        const lines = block.split('\n');
        const dataIndex = lines.findIndex((text, index) => index > 0 && /x\s*:/.test(text));
        if (dataIndex !== -1) {
            setCursor({ line: line + prefixLines + dataIndex, ch: lines[dataIndex].length });
        }
    }
};
const newPlotlyChart = (editor) => {
    insertChartBlock(editor, basicPlotlyChart);
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
const NEW_PLOTLY_CHART_BY_DATAVIEWJS_NAME = () => getLocale() === 'ko' ? '새 Plotly 차트 (Dataviewjs)' : "New Plotly chart (Dataviewjs)";
const isDataviewEnabled = (app) => {
    const plugins = app?.plugins;
    if (!plugins) return false;
    try {
        if (typeof plugins.enabledPlugins?.has === 'function') {
            return plugins.enabledPlugins.has('dataview');
        }
    }
    catch { /* Fall back to loaded plugin instances when enabledPlugins is inaccessible. */ }
    return Boolean(plugins.plugins?.dataview);
};
const newPlotlyChartByDataviewjs = (editor, app) => {
    insertChartBlock(editor, dataviewjsPlotlyChart);
    if (!isDataviewEnabled(app)) {
        new obsidian.Notice(getLocale() === 'ko' ? '이 블록은 Dataview 플러그인이 켜져 있어야 그려집니다. 지금은 코드만 보입니다.' : 'This block renders only when the Dataview plugin is enabled. For now it shows as code.');
    }
};
// Agent facade (agentinterop v1). An agent host discovers this object on the plugin instance under
// AGENT_CAPABILITY_PROVIDER and calls describe()/callTool(). It knows nothing about any particular
// host. The tools only inspect chart definitions: they never draw into a note or change a file.
const AGENT_CAPABILITY_PROVIDER = Symbol.for('dev.agentinterop.capability-provider');
const PROVIDERS_CHANGED_EVENT = 'agentinterop:providers-changed';
const AGENT_MAX_RESULT_CHARS = 8000;
const DATA_MAX_RESULT_CHARS = 16000;
const AGENT_PAGE_CHARS = 6000;
const AGENT_MAX_CHARTS = 20;
const AGENT_MAX_PROBLEMS = 12;
// Notes are .md, like most of a vault, so no tool is in the core group: a host shows them
// only when the request mentions one of these.
const AGENT_KEYWORDS = ['plotly', 'chart', 'graph', 'plot', 'visuali', 'diagram', 'histogram', 'heatmap', 'treemap', 'sankey', 'dashboard',
    '차트', '그래프', '도표', '시각화', '파이', '막대', '분포', '히트맵', '산점도', '대시보드'];
// Keep EDA discovery focused on analysis and relevant charts: inheriting every chart keyword
// exceeds Verbex's 32-keyword descriptor limit and hides all tools from the provider.
const EDA_KEYWORDS = [
    'eda', 'data', 'csv', 'statistics', 'correlation', 'dataset', 'aggregate',
    '데이터', '분석', '통계', '집계', '합계', '평균', '상관', '분포', '추이', '인사이트', '계산', '누계',
    'chart', 'graph', 'plot', 'visuali', 'histogram', 'heatmap', 'dashboard',
    '차트', '그래프', '시각화', '히트맵', '산점도', '대시보드'
];
const agentMeta = (effect, maxResultChars = AGENT_MAX_RESULT_CHARS) => ({
    'dev.agentinterop/effect': effect,
    'dev.agentinterop/group': 'chart',
    'dev.agentinterop/resourceTypes': ['.md'],
    'dev.agentinterop/keywords': AGENT_KEYWORDS,
    'dev.agentinterop/maxResultChars': maxResultChars
});
const edaMeta = () => ({ ...agentMeta('read', DATA_MAX_RESULT_CHARS), 'dev.agentinterop/group': 'data', 'dev.agentinterop/resourceTypes': ['.csv'], 'dev.agentinterop/keywords': EDA_KEYWORDS });
const GUIDE_TOPIC_NAMES = Object.keys(GUIDE_TOPICS);
const createAgentTools = (locale) => {
const tools = [
    {
        name: 'eda_profile', title: 'Profile a CSV dataset',
        description: 'Read a vault CSV and infer columns, missing rates, distinct counts, frequent values and numeric descriptive statistics. Blank or whitespace-only cells are missing; a numeric column needs every nonblank value to be a number in one unit (1,234, 12%, ₩5, △5 negative; a unitless 0 takes the column unit). Returns ten columns per page. CSV must have unique headers and at most 100000 rows, 100 columns and 5 MiB. Does not modify files or load Plotly.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Vault-relative CSV path, or a Markdown note (.md); its pipe table is read (table picks which, 1-based, default 1).' },
            table: { type: 'integer', minimum: 1, maximum: 1000, description: 'Markdown notes only: which pipe table to read, 1-based; default 1.' },
            from: { type: 'integer', minimum: 1, description: '1-based first column of this page; defaults to 1. When more columns remain, the result gives nextFrom: call again with from set to it.' }
        } }, annotations: { readOnlyHint: true }, _meta: edaMeta()
    },
    {
        name: 'eda_analyze', title: 'Analyze a CSV dataset',
        description: 'filter ANDs up to four conditions: eq, ne, gt, gte, lt, lte, prefix, contains. Numbers compare numerically, else as strings. Period: {"column":"연월","op":"gte","value":"2025-01"} plus lte. summary gives count, sum, mean, min, max for each of 1–8 numeric columns over matching rows; use it for one overall total or average, e.g. a year\'s monthly average with a filter. With 2–8 columns it also gives each column\'s share of their combined sum. histogram takes one column, correlation two. aggregate groups columns[0], reduces columns[1]: one value per group by sum, mean, count, min, max or median; count may omit the value column. For mean, min, max or median it also returns overall, the same function over all matching rows. Sort desc, asc, label or original; label and original give change from the previous group. Groups have shares and chart data. rows: cells and row numbers, paged by limit and offset. 1,234, 12%, ₩5 and △5 (negative) are numbers; mixed units are refused.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'analysis'], properties: {
            path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Vault-relative CSV path, or a Markdown note (.md); its pipe table is read (table picks which, 1-based, default 1).' },
            table: { type: 'integer', minimum: 1, maximum: 1000, description: 'Markdown notes only: which pipe table to read, 1-based; default 1.' },
            analysis: { type: 'object', additionalProperties: false, required: ['type', 'columns'], properties: {
                type: { type: 'string', enum: ['summary', 'histogram', 'correlation', 'aggregate', 'compare', 'rows'], description: 'compare: two periods with columns [group, value] and period {column, base, target}, or value against plan with [group, value, reference]. Returns difference and rate or ratio per group, groups found in one period only, and overall over common groups.' },
                columns: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } },
                filter: { type: 'array', description: 'Up to four conditions combined with AND before analysis.', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['column', 'op', 'value'], properties: { column: { type: 'string', description: 'CSV column to compare.' }, op: { type: 'string', description: 'Comparison operator.', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'prefix', 'contains'] }, value: { type: 'string', description: 'Value to compare against the cell.' } } } },
                period: { type: 'object', additionalProperties: false, required: ['column', 'base', 'target'], description: 'For compare, select the period column and two period values.', properties: { column: { type: 'string' }, base: { type: 'string' }, target: { type: 'string' } } },
                rank_by: { type: 'string', enum: ['difference', 'rate', 'ratio'], description: 'For compare, rank by difference or the relative rate or ratio.' },
                method: { type: 'string', enum: ['pearson'] },
                bins: { type: 'integer', minimum: 1, maximum: 50, description: 'Histogram bin count, default 10; intervals are left-closed, right-open except the last.' },
                function: { type: 'string', enum: AGGREGATE_FUNCTIONS, description: 'aggregate only. Default sum with a value column, count without. summary ignores it and returns every statistic.' },
                sort: { type: 'string', enum: AGGREGATE_SORTS, description: 'aggregate: desc (default), asc, label, original; rows: asc (default) or desc with sort_by.' },
                sort_by: { type: 'string', description: 'rows only. Sort by this CSV column before pagination.' },
                limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'aggregate: default 60, maximum 100 groups (larger values are rejected). rows: default 50; requests above 100 are capped at 100 with limitApplied and offset guidance.' },
                offset: { type: 'integer', minimum: 0, description: 'rows only. Zero-based offset, default 0.' }
            } }
        } }, annotations: { readOnlyHint: true }, _meta: edaMeta()
    },

    {
        name: 'check_chart',
        title: 'Check a Plotly chart',
        description: 'Check the content of a plotly code block (YAML or JSON): that it parses, that the top-level keys are only data, layout, config and fit, that trace and layout attributes and values suit Plotly, and common mistakes such as unquoted colours. Returns a list of problems. Call it before writing a chart block into a note. Does not change any note. It also lists optional advice (presentation notes) that never makes a chart invalid.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['source'],
            properties: {
                source: { type: 'string', minLength: 1, maxLength: 20000, description: 'The content that goes inside a plotly code block, with or without the plotly fence lines: YAML with data: and layout: each starting its own line (use \\n in this string), or one JSON object such as {"data":[…],"layout":{…}}. Do not join keys with commas on one line.' }
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
        description: 'Return guidance for writing Plotly chart blocks for Chart Hands. Topics: basics (block format, YAML rules, which chart type fits which question, workflow), style (polished look: palette, margins, labels, annotations), report (report charts from vault data: workflow, styles, targets, highlights, facts), examples (line, bar and pie blocks), statistical (histogram, box, violin, correlation heatmap, density, splom, error bars), hierarchy (treemap, sunburst, icicle, sankey, waterfall, funnel, parcats), timeseries (date axes, range slider and buttons, candlestick, event shading, KPI indicator and gauge), scientific (contour, 3D surface, polar, wind rose, ternary, parallel coordinates, table), maps (choropleth, scattergeo, tile maps), layout (subplots, secondary axis, rich hover, reference lines, buttons, sliders), dataviewjs (dynamic charts), errors (fixing charts that do not render). Read basics before writing a chart by hand.',
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
        description: (locale === 'ko' ? 'CSV의 값을 그릴 때는 값을 옮겨 적지 말고 source와 series[].column을 준다. ' : 'To plot values from a CSV, pass source and series[].column instead of copying the numbers. ') + 'Build a plotly block and check it against Plotly\'s schema. source:{path,labels?,x?,filter?,sort?,limit?} reads 1–200 rows after filtering and limit. For top-N pass source.sort and source.limit instead of sorting with eda_analyze and copying the values. Do not combine source with labels or series values/x/size. Blank numeric cells become gaps. Without source, supply series[].values; per-label types need labels, scatter/bubble need x (bubble also size), histogram/box/violin use observations, indicator uses [value,reference?]. combo uses kind; secondary uses the right axis. treemap/sunburst need parents. Returns a plotly fence in reportSnippet or block, with a compact staticBlock for HWPX when compatible. Insert with host note-editing tools; no file is changed.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'series'],
            properties: {
                type: { type: 'string', enum: CHART_TYPES, description: 'Chart type.' },
                title: { type: 'string', maxLength: 200, description: 'Chart title.' },
                title_from: { type: 'string', enum: ['facts'], description: 'facts: use the returned titleDraft as the chart title.' },
                source: { type: 'object', additionalProperties: false, required: ['path'], properties: {
                    path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Vault-relative CSV path, or a Markdown note (.md); its pipe table is read (table picks which, 1-based, default 1).' },
                    table: { type: 'integer', minimum: 1, maximum: 1000, description: 'Markdown notes only: which pipe table to read, 1-based; default 1.' },
                    analysis: { type: 'object', additionalProperties: false, required: ['type', 'columns'], description: 'Chart the result of eda_analyze aggregate or compare instead of raw rows; series[].column then names a result field (value, share, base, target, difference, rate, reference, ratio).', properties: {
                        type: { type: 'string', enum: ['aggregate', 'compare'] }, columns: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
                        filter: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['column', 'op', 'value'], properties: { column: { type: 'string' }, op: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'prefix', 'contains'] }, value: { type: 'string' } } } },
                        function: { type: 'string', enum: AGGREGATE_FUNCTIONS }, sort: { type: 'string', enum: AGGREGATE_SORTS }, limit: { type: 'integer', minimum: 1, maximum: 100 },
                        period: { type: 'object', additionalProperties: false, required: ['column', 'base', 'target'], properties: { column: { type: 'string' }, base: { type: 'string' }, target: { type: 'string' } } }, rank_by: { type: 'string', enum: ['difference', 'rate', 'ratio'] }
                    } },
                    labels: { type: 'string', description: 'CSV category column; required for per-label chart types.' },
                    x: { type: 'string', description: 'Numeric CSV x column; required for scatter and bubble.' },
                    filter: { type: 'array', maxItems: 4, description: 'Same AND conditions as eda_analyze; applied before charting, without pagination.', items: { type: 'object', additionalProperties: false, required: ['column', 'op', 'value'], properties: {
                        column: { type: 'string' }, op: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'prefix', 'contains'] }, value: { type: 'string' }
                    } } },
                    sort: { type: 'object', additionalProperties: false, required: ['column'], properties: { column: { type: 'string', description: 'Numeric CSV column to sort.' }, order: { type: 'string', enum: ['desc', 'asc'], description: 'Sort order; defaults to desc.' } } },
                    limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum rows after filtering and sorting.' }
                } },
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
                        properties: {
                            column: { type: 'string', description: 'Numeric CSV column; required with source. Without source provide values instead.' },
                            sizeColumn: { type: 'string', description: 'Numeric CSV size column; required for bubble with source.' },
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
                style: { type: 'string', enum: ['clean', 'plain', 'report', 'print', 'slides'], description: 'Chart presentation style.' },
                target: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'number' }, label: { type: 'string', maxLength: 100 }, series: { type: 'integer', minimum: 0 } } },
                highlight: { type: 'object', additionalProperties: false, properties: { labels: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } }, top: { type: 'integer', minimum: 1, maximum: 50 }, bottom: { type: 'integer', minimum: 1, maximum: 50 }, below_target: { type: 'boolean' }, above_target: { type: 'boolean' } } },
                unit: { type: 'string', maxLength: 12, description: 'Display unit.' },
                caption: { type: 'string', maxLength: 200, description: 'Source or other caption below the chart.' }
            }
        },
        annotations: { readOnlyHint: true },
        _meta: { ...agentMeta('read', DATA_MAX_RESULT_CHARS), 'dev.agentinterop/resourceTypes': ['.csv'] }
    },
    {
        name: 'suggest_chart',
        title: 'Suggest chart types for a dataset',
        description: 'Suggest chart types for a goal from the data\'s shape: trend, compare, rank, share, distribution, relationship, target, change or matrix. Reads a vault CSV or a Markdown table, classifies columns (period, category, numeric with unit) and returns up to three candidates with the reason, cautions found in the data, and build arguments that build_chart accepts as they are; needs lists what the data cannot tell (a target value, the periods to compare). Deterministic rules; does not draw or change files.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['path'],
            properties: {
                path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Vault-relative CSV path, or a Markdown note (.md); its pipe table is read (table picks which, 1-based, default 1).' },
                table: { type: 'integer', minimum: 1, maximum: 1000, description: 'Markdown notes only: which pipe table to read, 1-based; default 1.' },
                goal: { type: 'string', enum: SUGGEST_GOALS, description: 'Charting goal. Optional when request states one.' },
                request: { type: 'string', minLength: 1, maxLength: 500, description: 'User request text to parse goal, periods, target value and highlight.' },
                label: { type: 'string', description: 'Override category or period column.' },
                values: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' }, description: 'Override numeric value columns (1–12).' },
                reference: { type: 'string', description: 'target goal: reference numeric column.' },
                top: { type: 'integer', minimum: 1, maximum: 50, description: 'rank goal: number of items (default 10).' },
                filter: { type: 'array', maxItems: 4, description: 'Up to four AND conditions applied before classification and charting.', items: { type: 'object', additionalProperties: false, required: ['column', 'op', 'value'], properties: { column: { type: 'string' }, op: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'prefix', 'contains'] }, value: { type: 'string' } } } },
                period: { type: 'object', additionalProperties: false, required: ['base', 'target'], description: 'change goal: explicit period column and base/target values.', properties: { column: { type: 'string' }, base: { type: 'string' }, target: { type: 'string' } } },
                target_value: { type: 'number', description: 'Explicit numeric target line value.' },
                highlight: { type: 'object', additionalProperties: false, description: 'Explicit bar highlight selector.', properties: { labels: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } }, top: { type: 'integer', minimum: 1, maximum: 50 }, bottom: { type: 'integer', minimum: 1, maximum: 50 }, below_target: { type: 'boolean' }, above_target: { type: 'boolean' } } }
            }
        },
        annotations: { readOnlyHint: true },
        _meta: edaMeta()
    }
];
if (locale === 'en') {
    const translations = {
        '차트': 'chart', '그래프': 'graph', '도표': 'diagram', '시각화': 'visualization', '파이': 'pie', '막대': 'bar',
        '분포': 'distribution', '히트맵': 'heatmap', '산점도': 'scatterplot', '대시보드': 'dashboard',
        '데이터': 'data', '분석': 'analysis', '통계': 'statistics', '집계': 'aggregate', '합계': 'sum',
        '평균': 'average', '상관': 'correlation', '추이': 'trend', '인사이트': 'insight', '계산': 'calculation', '누계': 'cumulative'
    };
    for (const tool of tools) {
        tool._meta['dev.agentinterop/keywords'] = [...new Set(tool._meta['dev.agentinterop/keywords'].map(keyword => translations[keyword] || keyword))];
        if (tool.name === 'eda_analyze') tool.description = tool.description.replace('연월', 'year_month');
    }
}
return tools;
};
const AGENT_INSTRUCTIONS = 'For CSV or Markdown-table data use eda_profile for schema, units and missingness, then eda_analyze: summary for one overall total or average of a column (with filter for a period), aggregate for one value per group (shares, top groups), compare for two periods or a value against its plan, histogram, Pearson correlation, rows; quote its computed numbers instead of doing arithmetic yourself. Use filter to select rows and rows to inspect paginated cells. Column meanings and units are not in the CSV: before reading values as amounts or ratios, check the notes the host lists as mentioning the file. Interpret excluded rows and undefined correlations. These tools never edit data. A chart is a plotly fenced block of YAML or JSON with only data (list of traces), layout, config and fit as top-level keys. Quote colours ("#2563EB") and date-like strings; use no functions or variables. Write titles as objects: title: {text: "..."}. suggest_chart picks chart types for the question from the data; for a report chart call get_chart_guide report. Use Plotly\'s advanced types (heatmap, box, violin, treemap, sunburst, sankey, waterfall, funnel, candlestick, polar, contour, 3D, maps, subplots) when the data has that shape; call get_chart_guide when unsure. For values from a vault CSV, use build_chart with source; never copy the numbers by hand. Write a block yourself only for types build_chart lacks. build_chart checks the blocks it builds; run check_chart on any block you write or edit yourself, and fix every problem it reports; advice items are optional notes. Insert the block with the host\'s note-editing tools: none of these tools edits a note or draws a chart. read_charts lists and checks the plotly blocks already in a note. The check verifies the definition against Plotly\'s rules, not its appearance on screen.';
const DATA_RESULT_CHARS = 15000;
const resultLength = (content, structuredContent) => [...content.map(item => item.text), JSON.stringify(structuredContent)].join('\n').length;

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
        if (!/^\s*#/.test(line) && UNQUOTED_HEX.test(line)) {
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
const analyzeChart = (source, locale = getLocale(), plotly = Plotly) => {
    const result = { problems: [], advice: [], traces: [], title: '' };
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
    const validator = plotly && typeof plotly.validate === 'function' ? plotly : null;
    if (validator && Array.isArray(json.data)
        && (!json.layout || (typeof json.layout === 'object' && !Array.isArray(json.layout)))) {
        try {
            // Plotly.validate returns undefined when there is nothing to report.
            const issues = (validator.validate(json.data, json.layout || {}) || []).filter(issue => !isMenuArgsIssue(issue));
            issues.forEach(issue => result.problems.push(agentClip(issue && issue.msg ? issue.msg : issue, 300)));
        }
        catch (error) {
            result.problems.push(`Plotly check failed: ${agentClip(error && error.message ? error.message : error, 200)}`);
        }
    }
    result.advice = adviseChart(json, locale);
    return result;
};
const stripPlotlyFence = (source) => {
    const raw = String(source);
    const lines = splitLines(raw).map(line => line.text);
    let start = 0, end = lines.length - 1;
    while (start <= end && !lines[start].trim()) start++;
    while (end >= start && !lines[end].trim()) end--;
    if (start >= end) return raw;
    const open = fenceOpen(lines[start]);
    if (!open || (open.info.split(/\s/)[0] || '').toLowerCase() !== 'plotly') return raw;
    if (!fenceClose(lines[end], open.fence)) return raw;
    return lines.slice(start + 1, end).join('\n');
};
const problemLines = (problems) => {
    const lines = problems.slice(0, AGENT_MAX_PROBLEMS).map(problem => `  - ${problem}`);
    if (problems.length > AGENT_MAX_PROBLEMS) {
        lines.push(`  - … ${problems.length - AGENT_MAX_PROBLEMS} more problems`);
    }
    return lines;
};
const adviceLines = (advice, locale) => advice.length
    ? [
        locale === 'ko'
            ? '참고(사용자에게 알릴 선택 사항입니다. 차트는 완성됐으니 이것만을 위해 다시 만들거나 다시 검사하지 마세요):'
            : 'Advice (optional notes for the user; the chart is complete — do not rebuild or re-check just to clear them):',
        ...advice.map(item => `  - ${item}`)
    ]
    : [];
const PROVENANCE_PREFIX = '# chart-hands source:';
const extractProvenance = (source) => {
    const first = String(source).split(/\r?\n/).find(line => line.trim() !== '');
    if (!first) return '';
    const trimmed = first.trim();
    return trimmed.startsWith(PROVENANCE_PREFIX) ? trimmed.slice(PROVENANCE_PREFIX.length).trim() : '';
};
// Fenced blocks whose language is exactly "plotly", with the 1-based line range of the fence.
const findChartBlocks = (markdown) => {
    const lines = splitLines(markdown).map(line => line.text);
    const charts = [];
    let dataview = 0;
    for (let index = 0; index < lines.length; index++) {
        const open = fenceOpen(lines[index]);
        if (!open) {
            continue;
        }
        const fence = open.fence;
        const language = (open.info.split(/\s/)[0] || '').toLowerCase();
        const body = [];
        const startLine = index + 1;
        let closed = false;
        for (index++; index < lines.length; index++) {
            if (fenceClose(lines[index], fence)) {
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
const createAgentProvider = (plugin, locale = getLocale(), { now = () => new Date() } = {}) => {
    const descriptor = {
        provider: {
            id: plugin.manifest.id,
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            description: 'Analyze CSV data and build, check and read Plotly charts'
        },
        instructions: AGENT_INSTRUCTIONS,
        tools: createAgentTools(locale)
    };
    let disposed = false;
    const csvCandidates = (path, sameFolderOnly = false) => {
        const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        const files = (plugin.app.vault.getFiles?.() ?? []).filter(f => f.extension?.toLowerCase() === 'csv');
        const nearby = files.filter(f => (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '') === folder);
        const stem = path.split('/').pop().replace(/\.[^.]*$/, '').normalize('NFC').toLowerCase();
        const parts = [...new Set(Array.from({ length: Math.max(0, stem.length - 2) }, (_, i) => stem.slice(i, i + 3)))];
        const score = f => {
            const name = f.path.split('/').pop().replace(/\.[^.]*$/, '').normalize('NFC').toLowerCase();
            return parts.filter(part => name.includes(part)).length;
        };
        const candidates = nearby.length || sameFolderOnly ? nearby : files.filter(f => score(f) > 0);
        return candidates.map(f => ({ path: f.path, score: score(f) })).sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).slice(0, 5).map(f => f.path);
    };
    const candidateText = (paths) => locale === 'ko'
        ? ` CSV 후보: ${paths.length ? paths.join(', ') : '(없음)'}. 후보의 path로 다시 호출하세요.`
        : ` CSV candidates: ${paths.length ? paths.join(', ') : '(none)'}. Call again with a candidate path.`;
    const readDataset = async (rawPath, table) => {
        const path = normalizeAgentPath(rawPath);
        const file = plugin.app.vault.getAbstractFileByPath(path);
        if (!file || !file.extension) throw new AgentToolError('NOT_FOUND', `File not found in the vault: ${path}` + candidateText(csvCandidates(path)), true);
        const ext = file.extension.toLowerCase();
        if (!['csv', 'md'].includes(ext)) throw new AgentToolError('UNSUPPORTED_FORMAT', (locale === 'ko' ? 'CSV 파일(.csv) 또는 표가 있는 Markdown 노트(.md)만 분석할 수 있습니다.' : 'Only CSV files (.csv) or Markdown notes (.md) containing tables can be analyzed.') + candidateText(csvCandidates(path, true)), true);
        if (ext === 'csv' && table !== undefined && table !== 1) throw new AgentToolError('INVALID_ARGUMENT', locale === 'ko' ? 'table은 Markdown 노트(.md)에만 씁니다.' : 'table is only for Markdown notes (.md).', true);
        if (file.stat && file.stat.size > 5 * 1024 * 1024) throw new AgentToolError('INVALID_ARGUMENT', ext === 'csv' ? 'CSV must be at most 5 MiB.' : 'Markdown must be at most 5 MiB.', true);
        try {
            const text = await plugin.app.vault.cachedRead(file);
            if (ext === 'md' && text.length > 5 * 1024 * 1024) throw new Error('Markdown must be at most 5 MiB.');
            return { path, dataset: ext === 'csv' ? parseDataset(text) : tableDataset(text, table, locale) };
        }
        catch (error) { throw new AgentToolError('INVALID_ARGUMENT', error.message + (ext === 'md' && /no pipe tables|파이프 표가 없습니다/.test(error.message) ? candidateText(csvCandidates(path, true)) : ''), true); }
    };
    const handlers = {
        eda_profile: async (args) => {
            const { path, dataset } = await readDataset(args.path, args.table);
            const from = args.from === undefined ? 1 : args.from;
            if (!Number.isInteger(from) || from < 1 || from > dataset.headers.length) throw new AgentToolError('INVALID_ARGUMENT', 'from must identify a column, starting at 1.', true);
            const result = profile(dataset, from - 1);
            if (dataset.table) result.table = dataset.table;
            result.from = from;
            result.to = from + result.columns.length - 1;
            result.complete = result.to === result.columnCount;
            if (!result.complete) result.nextFrom = result.to + 1;
            const prefix = dataset.table ? (locale === 'ko' ? `표 ${dataset.table.index}(${path}, ${dataset.table.startLine}줄)` : `Table ${dataset.table.index} in ${path} (line ${dataset.table.startLine})`) : `CSV ${path}`;
            const text = locale === 'ko' ? `${prefix}: ${result.rowCount}행, ${result.columnCount}열. 열 ${result.from}~${result.to}을 반환했습니다.` : `${prefix}: ${result.rowCount} rows, ${result.columnCount} columns. Returned columns ${result.from}–${result.to}.`;
            return { content: [{ type: 'text', text }], structuredContent: result, _meta: { 'dev.agentinterop/resource': { path } } };
        },
        eda_analyze: async (args) => {
            const { path, dataset } = await readDataset(args.path, args.table);
            let result;
            try { result = analyze(dataset, args.analysis, locale); }
            catch (error) { throw new AgentToolError('INVALID_ARGUMENT', error.message, true); }
            if (dataset.table) result.table = dataset.table;
            const prefix = dataset.table ? (locale === 'ko' ? `표 ${dataset.table.index}(${path}, ${dataset.table.startLine}줄)` : `Table ${dataset.table.index} in ${path} (line ${dataset.table.startLine})`) : `CSV ${path}`;
            const text = locale === 'ko' ? `${prefix}: ${result.type} 분석, 전체 ${result.totalRows}행 중 ${result.filteredRows ?? result.totalRows}행을 선택했습니다.` : `${prefix}: ${result.type} analysis selected ${result.filteredRows ?? result.totalRows} of ${result.totalRows} rows.`;
            const content = [{ type: 'text', text }];
            if (['aggregate', 'compare'].includes(result.type)) {
                Object.assign(result, analysisPresentation(result, locale));
                if (result.groups.length) {
                    const isCompare = result.type === 'compare';
                    const isRef = isCompare && result.mode === 'reference';
                    const field = !isCompare ? 'value' : isRef ? 'ratio' : 'difference';
                    const chartType = isRef ? 'bar' : result.groups.length <= 7 ? 'bar' : 'barh';
                    result.chartArgs = {
                        type: chartType,
                        style: 'report',
                        source: { path, ...(dataset.table ? { table: dataset.table.index } : {}), analysis: args.analysis },
                        series: [{ column: field }],
                        ...(isRef ? { target: { value: 100 } } : {})
                    };
                    content[0].text += `\n${locale === 'ko' ? '이 결과를 차트로 그리려면 chartArgs를 그대로 build_chart에 주세요.' : 'To chart this result, pass chartArgs to build_chart as it is.'}`;
                }
                if (resultLength(content, result) > DATA_RESULT_CHARS) {
                    delete result.display;
                    result.displayOmitted = 'too_long';
                    if (resultLength(content, result) > DATA_RESULT_CHARS) {
                        delete result.chart;
                        result.chartOmitted = 'too_long';
                        if (resultLength(content, result) > DATA_RESULT_CHARS) {
                            throw new AgentToolError('RESULT_TOO_LARGE', 'The analysis result is too large. Reduce analysis.limit (maximum 100) or use a smaller dataset.', true);
                        }
                    }
                }
            }
            return { content, structuredContent: result, _meta: { 'dev.agentinterop/resource': { path } } };
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
        build_chart: async ({ title_from: titleFrom, ...args }) => {
            if (titleFrom !== undefined && titleFrom !== 'facts') {
                throw new AgentToolError('INVALID_ARGUMENT', locale === 'ko' ? 'title_from은 facts만 받습니다.' : 'title_from only accepts facts.', true);
            }
            const ignoreTitleFrom = titleFrom === 'facts' && args.title !== undefined;
            let definition;
            let source;
            let provenance;
            let ignoredArgs;
            let factsMeta;
            let limitArg = 'labels·series';
            const validationArgs = args.source ? { ...args, source: { ...args.source, x: undefined }, series: args.series?.map(s => ({ ...s, sizeColumn: undefined })) } : args;
            try { ignoredArgs = validateBuildArgs(validationArgs, locale); }
            catch (error) { throw new AgentToolError('INVALID_ARGUMENT', error.message, true); }
            if (ignoreTitleFrom) ignoredArgs.push('title_from');
            if (Object.hasOwn(args, 'source')) {
                try { validateChartSource(args, locale); }
                catch (error) { throw new AgentToolError('INVALID_ARGUMENT', error.message, true); }
                const { path, dataset } = await readDataset(args.source?.path, args.source?.table);
                const requestedSource = args.source;
                try { args = resolveChartSource(dataset, args, locale); }
                catch (error) { throw new AgentToolError('INVALID_ARGUMENT', error.message, true); }
                limitArg = args.analysisResult ? 'source.analysis.limit' : 'source.limit';
                factsMeta = {
                    labelColumn: requestedSource.labels,
                    beforeLimit: args.beforeLimit,
                    valueSorted: Boolean(requestedSource.sort),
                    xUnit: args.sourceUnits?.[requestedSource.x]
                };
                const labels = args.labels ?? args.series[0].x ?? [];
                source = { path, ...(dataset.table ? { table: dataset.table } : {}), rows: args.series[0].values.length, labels: labels.length ? { first: labels[0], last: labels.at(-1) } : {}, ...(args.sourceUnits ? { units: args.sourceUnits } : {}), ...('sort' in requestedSource ? { sort: requestedSource.sort } : {}), ...('limit' in requestedSource ? { limit: requestedSource.limit } : {}) };
                if (args.analysisResult) {
                    const r = args.analysisResult;
                    source.analysis = { type: r.type, columns: r.columns, function: r.function, ...(r.period ? { period: r.period } : {}), ...(r.filter ? { filter: r.filter } : {}) };
                    Object.assign(source, { excludedRows: r.excludedRows, groupCount: r.groupCount, truncated: r.truncated }, ...(r.onlyInBase ? [{ onlyInBase: { count: r.onlyInBase.count } }] : []), ...(r.onlyInTarget ? [{ onlyInTarget: { count: r.onlyInTarget.count } }] : []));
                }
                const date = now();
                const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const details = [`# chart-hands source: ${path}${dataset.table ? ` table ${dataset.table.index}` : ''}`, `rows ${source.rows} of ${dataset.rows.length}`];
                if (requestedSource.filter?.length) details.push(`filter ${requestedSource.filter.map(f => `${f.column} ${f.op} ${f.value}`).join('; ')}`);
                if (requestedSource.sort) details.push(`sort ${requestedSource.sort.column} ${requestedSource.sort.order || 'desc'}`);
                if (requestedSource.limit !== undefined) details.push(`limit ${requestedSource.limit}`);
                if (source.analysis) { const a = source.analysis; details.push(`analysis ${a.type} ${a.columns.join(' ')} ${a.function}${a.period ? ` ${a.period.base}→${a.period.target}` : ''}`); }
                details.push(`built ${day}`);
                const line = details.join(' · ').replace(/\p{Cc}/gu, ' ');
                provenance = line.length > 300 ? `${line.slice(0, 299)}…` : line;
            } else if (Array.isArray(args.series) && args.series.some(s => s && (Object.hasOwn(s, 'column') || Object.hasOwn(s, 'sizeColumn')))) {
                throw new AgentToolError('INVALID_ARGUMENT', locale === 'ko' ? 'series[].column/sizeColumn에는 source가 필요합니다. 예: source:{path:"data.csv",labels:"month"},series:[{column:"value"}]. 직접 입력하려면 column 대신 values:[1,2]를 주세요.' : 'series[].column/sizeColumn requires source. Example: source:{path:"data.csv",labels:"month"},series:[{column:"value"}]. For direct input use values:[1,2] instead of column.', true);
            } else if (!Array.isArray(args.series) || !args.series.length || args.series.some(s => !s || !Array.isArray(s.values) || !s.values.length)) {
                throw new AgentToolError('INVALID_ARGUMENT', locale === 'ko' ? 'source가 없으면 각 series에 values 숫자 배열이 필요합니다. 예: labels:["A"],series:[{values:[1]}]. CSV는 source와 series[].column을 주세요.' : 'Without source each series requires a numeric values array. Example: labels:["A"],series:[{values:[1]}]. For CSV use source and series[].column.', true);
            }
            try {
                definition = buildChartDefinition(args, { locale });
            }
            catch (error) {
                throw new AgentToolError('INVALID_ARGUMENT', error.message, true);
            }
            const facts = chartFacts(args, factsMeta);
            const draft = titleDraft(facts, locale);
            const lines = factLines(facts, locale);
            if (titleFrom === 'facts' && !ignoreTitleFrom) {
                if (!draft) throw new AgentToolError('INVALID_ARGUMENT', locale === 'ko' ? 'facts로 만들 제목이 없습니다: 유효한 값이 없습니다. title을 주세요.' : 'No title template is available from facts. Supply a title.', true);
                const title = draft.replace(/\p{Cc}/gu, ' ');
                args.title = title.length > 200 ? `${title.slice(0, 199)}…` : title;
                definition = buildChartDefinition(args, { locale });
            }
            // Compact JSON keeps large raw bar arrays within the same result budget without dropping data points.
            const compact = source && !source.analysis && ['bar', 'barh'].includes(args.type) && args.series.length === 1 && source.rows > 40;
            const body = compact ? JSON.stringify(definition) : obsidian.stringifyYaml(definition).trimEnd();
            const yaml = `${provenance ? `${provenance}\n` : ''}${body}`;
            const loadedPlotly = plugin.ensureLibraries ? await plugin.ensureLibraries() : undefined;
            const validator = (Plotly && typeof Plotly.validate === 'function') ? Plotly : (loadedPlotly && typeof loadedPlotly.validate === 'function') ? loadedPlotly : null;
            const chart = analyzeChart(yaml, locale, validator);
            const staticSource = JSON.stringify(args);
            let staticBlock;
            try {
                if (staticSource.length <= 2000) {
                    parseStaticChart(staticSource);
                    staticBlock = `\`\`\`chart-hands-static\n${staticSource}\n\`\`\``;
                }
            }
            catch { /* The interactive chart can support inputs that the static renderer cannot. */ }
            const staticBlockMissing = staticBlock ? undefined : staticSource.length > 2000 ? 'too_long' : 'unsupported';
            const notes = [];
            if (SINGLE_SERIES_TYPES.includes(args.type) && Array.isArray(args.series) && args.series.length > 1) {
                notes.push(`A ${args.type} chart shows one series; only the first was used.`);
            }
            const reduce = source ? `${limitArg}을` : 'labels·series 값 개수를';
            const reduceEn = source ? limitArg : 'the number of labels and series values';
            const text = [
                chart.problems.length
                    ? `${chart.problems.length} problem(s) found in the built chart:`
                    : validator
                        ? "Built and checked a plotly block against Plotly's schema: no problems."
                        : 'Built a plotly block. Basic checks found no problems; call check_chart for full Plotly schema validation.',
                ...problemLines(chart.problems),
                ...adviceLines(chart.advice, locale),
                ...notes,
                ...(ignoredArgs.length ? [`${locale === 'ko' ? '쓰이지 않아 무시한 인자' : 'Ignored unused arguments'}: ${ignoredArgs.join(', ')}`] : []),
                ...(staticBlock
                    ? [locale === 'ko'
                        ? 'staticBlock은 HWPX·PPTX 내보내기 전용입니다. 노트에는 reportSnippet(또는 block)을 넣으세요.'
                        : 'staticBlock is for HWPX/PPTX export only; put reportSnippet (or block) in the note.']
                    : [locale === 'ko'
                        ? `HWPX·PPTX로 내보낼 때만 정적 블록이 필요합니다: ${staticBlockMissing === 'too_long' ? `JSON이 2,000자를 넘습니다. ${reduce} 줄이세요.` : '지원하지 않는 입력입니다.'}`
                        : `A static block is needed only for HWPX/PPTX export: ${staticBlockMissing === 'too_long' ? `JSON exceeds 2,000 characters; reduce ${reduceEn}.` : 'unsupported input.'}`]),
                ...lines
            ].join('\n');
            const block = `\`\`\`plotly\n${yaml}\n\`\`\``;
            const sourcePrefix = locale === 'ko' ? '자료: ' : 'Source: ';
            const caption = source ? args.caption || args.sourceCaption : undefined;
            const reportSnippet = [block, ...(lines.length ? [lines.map(line => `- ${line}`).join('\n')] : []), ...(caption ? [caption.startsWith(sourcePrefix) ? caption : `${sourcePrefix}${caption}`] : [])].join('\n\n');
            const result = {
                content: [{ type: 'text', text }],
                structuredContent: { valid: chart.problems.length === 0, problems: chart.problems.length, ...(chart.advice.length ? { advice: chart.advice } : {}), ...(staticBlock ? { staticBlock, staticBlockUse: 'HWPX or PPTX export only; put reportSnippet (or block) in the note' } : { staticBlockMissing }), ...(ignoredArgs.length ? { ignoredArgs } : {}), ...(source ? { source } : {}), facts, ...(draft ? { titleDraft: draft } : {}), factLines: lines, reportSnippet },
                ...(source ? { _meta: { 'dev.agentinterop/resource': { path: source.path } } } : {})
            };
            if (resultLength(result.content, result.structuredContent) > DATA_RESULT_CHARS) {
                delete result.structuredContent.reportSnippet;
                Object.assign(result.structuredContent, { block, snippetOmitted: 'too_long' });
                result.content[0].text += `\n${block}`;
                const length = resultLength(result.content, result.structuredContent);
                if (length > DATA_RESULT_CHARS) throw new AgentToolError('RESULT_TOO_LARGE', locale === 'ko' ? `${length}자: ${reduce} 줄이세요.` : `${length} characters: reduce ${reduceEn}.`, true);
            }
            return result;
        },
        check_chart: (args) => __awaiter(void 0, void 0, void 0, function* () {
            const loadedPlotly = plugin.ensureLibraries ? yield plugin.ensureLibraries() : undefined;
            const validator = (Plotly && typeof Plotly.validate === 'function') ? Plotly : (loadedPlotly && typeof loadedPlotly.validate === 'function') ? loadedPlotly : null;
            const chart = analyzeChart(stripPlotlyFence(args.source), locale, validator);
            const summary = `traces: ${chart.traces.length}${chart.traces.length ? `(${agentClip(chart.traces.join(', '), 400)})` : ''}${chart.title ? ` · title "${chart.title}"` : ''}`;
            const lines = chart.problems.length
                ? [`${chart.problems.length} problem(s) · ${summary}`, ...problemLines(chart.problems)]
                : [`No problems · ${summary}`];
            lines.push(...adviceLines(chart.advice, locale));
            return {
                content: [{ type: 'text', text: lines.join('\n') }],
                structuredContent: { valid: chart.problems.length === 0, problems: chart.problems.length, traces: chart.traces.length, ...(chart.advice.length ? { advice: chart.advice } : {}) }
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
            const sources = [];
            const advice = [];
            let size = 0;
            let next = from;
            let withProblems = 0;
            while (next <= total && next - from < AGENT_MAX_CHARTS) {
                const block = found.charts[next - 1];
                const chart = analyzeChart(block.source, locale);
                const provenance = extractProvenance(block.source);
                const entry = [
                    `Chart ${next} · lines ${block.startLine}-${block.endLine}${block.closed ? '' : ' · no closing fence'} · traces: ${chart.traces.length}${chart.traces.length ? `(${agentClip(chart.traces.join(', '), 200)})` : ''}${chart.title ? ` · title "${chart.title}"` : ''}${provenance ? ` · source "${agentClip(provenance, 120)}"` : ''} · ${chart.problems.length ? `${chart.problems.length} problem(s)` : 'no problems'}${chart.advice.length ? ` · ${chart.advice.length} advice` : ''}`,
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
                if (provenance) {
                    sources.push({ chart: next, source: provenance });
                }
                if (chart.advice.length) {
                    advice.push({ chart: next, count: chart.advice.length });
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
                structuredContent: Object.assign(
                    { charts: total, from, to: next - 1, withProblems, dataviewBlocks: found.dataview, complete },
                    complete ? {} : { nextFrom: next },
                    sources.length ? { sources } : {},
                    advice.length ? { advice } : {}
                ),
                _meta: { 'dev.agentinterop/resource': { path } }
            };
        }),
        suggest_chart: async (args) => {
            const { path, dataset } = await readDataset(args.path, args.table);
            let result;
            try { result = suggestChart(dataset, { ...args, path }, locale); }
            catch (error) { throw new AgentToolError('INVALID_ARGUMENT', error.message, true); }
            if (dataset.table) result.table = dataset.table;
            for (const candidate of result.candidates) {
                if (!candidate.build) continue;
                try {
                    const built = await handlers.build_chart(candidate.build);
                    const validCount = built.structuredContent?.facts?.scope?.valid ?? 0;
                    if (!built.structuredContent?.valid || validCount < 1) {
                        delete candidate.build;
                        candidate.failure = {
                            code: built.structuredContent?.valid ? 'NO_VALID_DATA' : 'INVALID_CHART',
                            message: built.structuredContent?.valid
                                ? (locale === 'ko' ? '유효한 관측값이 없습니다.' : 'No valid observations to plot.')
                                : `${built.structuredContent?.problems ?? 0} problem(s) found in the built chart.`
                        };
                    }
                }
                catch (error) {
                    delete candidate.build;
                    candidate.failure = {
                        code: error instanceof AgentToolError ? error.code : 'INTERNAL',
                        message: error?.message || String(error)
                    };
                }
            }
            const types = result.candidates.map(c => c.type).join(', ') || (locale === 'ko' ? '없음' : 'none');
            const extra = [];
            if (result.confirm?.length) extra.push(`confirm: ${result.confirm.map(c => c.field).join(', ')}`);
            const needsFields = [...new Set([...(result.needs ?? []), ...result.candidates.flatMap(c => c.needs ?? [])])];
            if (needsFields.length) extra.push(`needs: ${needsFields.join(', ')}`);
            const summaryLine = locale === 'ko'
                ? `목적 ${result.goal ?? '미정'} · 후보: ${types}${extra.length ? ` · ${extra.join(' · ')}` : ''}`
                : `Goal ${result.goal ?? 'unset'} · candidates: ${types}${extra.length ? ` · ${extra.join(' · ')}` : ''}`;
            const text = [summaryLine, ...result.candidates.map(c => `${c.type}: ${c.why}`)].join('\n');
            const content = [{ type: 'text', text }];
            while (resultLength(content, result) > DATA_RESULT_CHARS) {
                let index = -1;
                for (let i = result.candidates.length - 1; i >= 0; i--) {
                    if (result.candidates[i].build) { index = i; break; }
                }
                if (index < 0) {
                    throw new AgentToolError('RESULT_TOO_LARGE', locale === 'ko'
                        ? '추천 결과가 15,000자를 넘습니다. filter로 행 수를 줄이거나 열을 지정하세요.'
                        : 'Suggestion result exceeds 15,000 characters. Use filter or specify columns.', true);
                }
                delete result.candidates[index].build;
                result.candidates[index].buildOmitted = 'too_long';
            }
            return { content, structuredContent: result, _meta: { 'dev.agentinterop/resource': { path } } };
        }
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
        const ko = getLocale() === 'ko';
        containerEl.empty();
        const introEl = containerEl.createDiv({ cls: 'setting-item-description' });
        introEl.createEl('p', { text: ko
            ? `차트를 넣으려면 노트에서 명령 팔레트의 "${NEW_PLOTLY_CHART_NAME()}"를 실행하거나, 편집기에서 오른쪽 클릭 › "${INSERT_PLOTLY_CHART_NAME()}"을 고르세요.`
            : `To add a chart, run "${NEW_PLOTLY_CHART_NAME()}" from the command palette in a note, or right-click in the editor and choose "${INSERT_PLOTLY_CHART_NAME()}".` });
        introEl.createEl('p', { text: ko
            ? 'plotly 코드 블록 안의 data·layout을 고치면 바로 다시 그려집니다.'
            : 'Edit data and layout inside the plotly code block and the chart redraws.' });
        new obsidian.Setting(containerEl)
            .setName(ko ? '차트 너비 맞추기' : 'Fit chart width')
            .setDesc(ko ? '차트를 노트 너비에 맞춥니다. 코드 블록에 "fit: off", "fit: shrink" 또는 "fit: fill"을 추가하여 해당 차트의 설정을 바꿀 수 있습니다.' : 'Fit charts to the note width. Add "fit: off", "fit: shrink" or "fit: fill" to a code block to override this for that chart.')
            .addDropdown(dropdown => dropdown
            .addOption('shrink', ko ? '더 넓을 때만 축소' : 'Shrink only when wider')
            .addOption('fill', ko ? '항상 너비에 맞추기' : 'Always fill the width')
            .addOption('off', ko ? '끄기 (원래 크기)' : 'Off (original size)')
            .setValue(settings.fitWidth)
            .onChange(value => this.plugin.updateSetting('fitWidth', value)));
        new obsidian.Setting(containerEl)
            .setName(ko ? '축소할 때 가로세로 비율 유지' : 'Keep aspect ratio when shrinking')
            .setDesc(ko ? '너비와 함께 높이도 조절합니다. 끄면 높이는 설정된 값으로 유지됩니다.' : 'Scale the height along with the width. When off, the height stays as set.')
            .addToggle(toggle => toggle
            .setValue(settings.keepAspectRatio)
            .onChange(value => this.plugin.updateSetting('keepAspectRatio', value)));
        new obsidian.Setting(containerEl)
            .setName(ko ? 'PDF로 내보낼 때 페이지 너비에 맞추기' : 'Fit the page width when exporting to PDF')
            .setDesc(ko ? 'PDF로 내보내거나 인쇄할 때 페이지보다 넓은 차트를 페이지 너비로 축소하여 잘리지 않게 합니다.' : 'Scale charts wider than the page down to the page width when exporting to PDF or printing, so they are not clipped.')
            .addToggle(toggle => toggle
            .setValue(settings.printFit)
            .onChange(value => this.plugin.updateSetting('printFit', value)));
    }
}
class ChartHandsPlugin extends obsidian.Plugin {
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            initLocale();
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
                name: NEW_PLOTLY_CHART_NAME(),
                editorCallback: (editor, view) => newPlotlyChart(editor)
            });
            this.addCommand({
                id: "add-plotly-dataviewjs-example",
                name: NEW_PLOTLY_CHART_BY_DATAVIEWJS_NAME(),
                editorCallback: (editor, view) => newPlotlyChartByDataviewjs(editor, this.app)
            });
            this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
                menu.addItem(item => item
                    .setTitle(INSERT_PLOTLY_CHART_NAME())
                    .setIcon(typeof obsidian.getIcon === 'function' && !obsidian.getIcon('bar-chart-3') ? 'bar-chart' : 'bar-chart-3')
                    .onClick(() => newPlotlyChart(editor)));
            }));
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
                const notice = new obsidian.Notice(getLocale() === 'ko' ? 'Chart Hands: Plotly와 D3를 불러오는 중…' : 'Chart Hands: loading Plotly and D3…', 0);
                this.loadingNotice = notice;
                try {
                    // Yield once so the ready layout and loading notice can be painted.
                    await new Promise(resolve => window.setTimeout(resolve, 0));
                    await loadPlotly(this);
                    if (this.unloaded) throw new Error('Chart Hands is unloaded.');
                    this.Plotly = Plotly;
                    return Plotly;
                }
                catch (error) {
                    if (!this.unloaded) new obsidian.Notice((getLocale() === 'ko' ? 'Chart Hands: Plotly를 불러오지 못했습니다. 다음 사용 시 다시 시도합니다.' : 'Chart Hands: could not load Plotly. It will retry on next use.') + `
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
export { blockInsertion, createAgentProvider, DATA_RESULT_CHARS, isDataviewEnabled };
export { getLocale, resolveLocale, setLocaleForTests } from './locale.js';


