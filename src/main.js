import * as obsidian from 'obsidian';

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
const preprocessor = (content, el, ctx) => {
    let json;
    try {
        json = obsidian.parseYaml(content);
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
    '\t- x: [0,1,2]',
    '\t  y: [0,1,0]',
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
// Notes are .md, like most of a vault, so neither tool is in the core group: a host shows them
// only when the request mentions one of these.
const AGENT_KEYWORDS = ['plotly', '차트', '그래프', '도표', '시각화', 'chart', 'graph', 'plot'];
const agentMeta = (effect) => ({
    'dev.agentinterop/effect': effect,
    'dev.agentinterop/group': 'chart',
    'dev.agentinterop/resourceTypes': ['.md'],
    'dev.agentinterop/keywords': AGENT_KEYWORDS,
    'dev.agentinterop/maxResultChars': AGENT_MAX_RESULT_CHARS
});
const AGENT_TOOLS = [
    {
        name: 'check_chart',
        title: 'Plotly 차트 검사',
        description: 'plotly 코드 블록의 내용(YAML 또는 JSON)을 검사한다. 읽을 수 있는지, 최상위 키가 data·layout·config·fit뿐인지, 트레이스와 레이아웃의 속성 이름과 값이 Plotly에 맞는지 확인하고 문제 목록을 돌려준다. 차트 블록을 노트에 쓰기 전에 부른다. 노트를 바꾸지 않는다.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['source'],
            properties: {
                source: { type: 'string', minLength: 1, maxLength: 20000, description: 'plotly 코드 블록 안에 들어갈 내용. 블록을 여닫는 울타리 줄은 빼고 준다.' }
            }
        },
        annotations: { readOnlyHint: true },
        _meta: agentMeta('pure')
    },
    {
        name: 'read_charts',
        title: '노트의 Plotly 차트 읽기',
        description: '노트에 있는 plotly 코드 블록을 찾아 차트마다 위치(줄 번호), 트레이스 종류와 점 수, 제목, 검사에서 나온 문제를 돌려준다. 한 번에 최대 20개이며 더 있으면 다음 from 값을 알려 준다. dataviewjs로 그리는 차트는 세기만 하고 검사하지 않는다.',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['path'],
            properties: {
                path: { type: 'string', minLength: 1, maxLength: 4096, description: 'Markdown 노트의 Vault 기준 상대 경로.' },
                from: { type: 'integer', minimum: 1, maximum: 100000, description: '이 순번의 차트부터 읽는다. 기본값 1.' }
            }
        },
        annotations: { readOnlyHint: true },
        _meta: agentMeta('read')
    }
];
const AGENT_INSTRUCTIONS = 'Obsidian 노트의 Plotly 차트를 검사하는 도구다. 차트는 노트에 언어가 plotly인 코드 블록으로 적는다. 블록 내용은 YAML 또는 JSON이고 최상위 키는 data(트레이스 배열), layout, config, fit만 쓸 수 있다. fit은 off·shrink·fill 중 하나로 그 차트의 폭 맞춤을 정한다. 차트 블록을 새로 쓰거나 고치기 전에 check_chart로 내용을 검사하고, 문제가 나오면 고쳐서 다시 검사한다. 이 도구들은 노트를 바꾸지 않는다. 검사는 정의가 Plotly 규칙에 맞는지만 보며 화면에 그려진 모양은 확인하지 않는다.';

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
const TRACE_LENGTH_KEYS = ['x', 'y', 'z', 'values', 'labels', 'r', 'theta', 'lat', 'lon', 'open'];
const describeTrace = (trace) => {
    if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
        return '(객체가 아님)';
    }
    const type = typeof trace.type === 'string' ? trace.type : 'scatter';
    const key = TRACE_LENGTH_KEYS.find(name => Array.isArray(trace[name]));
    const name = typeof trace.name === 'string' && trace.name ? ` "${agentClip(trace.name, 30)}"` : '';
    return `${type}${name}${key ? ` ${trace[key].length}점` : ''}`;
};
// The same rules the code block processor applies, plus Plotly's own schema check.
const analyzeChart = (source) => {
    const result = { problems: [], traces: [], title: '' };
    let json;
    try {
        json = obsidian.parseYaml(source);
    }
    catch (error) {
        result.problems.push(`YAML/JSON으로 읽을 수 없다: ${agentClip(error && error.message ? error.message : error, 300)}`);
        return result;
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        result.problems.push('블록 내용은 data, layout, config, fit 키를 가진 객체여야 한다.');
        return result;
    }
    const unknown = Object.keys(json).filter(key => !allowValues.includes(key));
    if (unknown.length) {
        result.problems.push(`쓸 수 없는 최상위 키: ${unknown.map(key => agentClip(key, 40)).join(', ')}. data, layout, config, fit만 쓸 수 있고, 하나라도 다른 키가 있으면 차트가 그려지지 않는다.`);
    }
    if (json.fit !== undefined && json.fit !== null && typeof json.fit !== 'boolean'
        && !(typeof json.fit === 'string' && FIT_MODES.includes(json.fit.toLowerCase()))) {
        result.problems.push(`fit은 ${FIT_MODES.join(', ')} 중 하나여야 한다.`);
    }
    if (json.data === undefined || json.data === null) {
        result.problems.push('data가 없다. 트레이스 배열을 data에 넣어야 차트가 그려진다.');
    }
    else if (!Array.isArray(json.data)) {
        result.problems.push('data는 트레이스의 배열이어야 한다.');
    }
    else {
        result.traces = json.data.map(describeTrace);
        if (!json.data.length) {
            result.problems.push('data가 비어 있다.');
        }
    }
    if (json.layout !== undefined && json.layout !== null && (typeof json.layout !== 'object' || Array.isArray(json.layout))) {
        result.problems.push('layout은 객체여야 한다.');
    }
    else if (json.layout && json.layout.title) {
        result.title = agentClip(typeof json.layout.title === 'string' ? json.layout.title : json.layout.title.text, 80);
    }
    if (Plotly && typeof Plotly.validate === 'function' && Array.isArray(json.data)
        && (!json.layout || (typeof json.layout === 'object' && !Array.isArray(json.layout)))) {
        try {
            // Plotly.validate returns undefined when there is nothing to report.
            const issues = Plotly.validate(json.data, json.layout || {}) || [];
            issues.forEach(issue => result.problems.push(agentClip(issue && issue.msg ? issue.msg : issue, 300)));
        }
        catch (error) {
            result.problems.push(`Plotly 검사 중 오류: ${agentClip(error && error.message ? error.message : error, 200)}`);
        }
    }
    return result;
};
const problemLines = (problems) => {
    const lines = problems.slice(0, AGENT_MAX_PROBLEMS).map(problem => `  - ${problem}`);
    if (problems.length > AGENT_MAX_PROBLEMS) {
        lines.push(`  - … 문제 ${problems.length - AGENT_MAX_PROBLEMS}개 더 있음`);
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
        throw new AgentToolError('INVALID_ARGUMENT', 'path는 Vault 기준 상대 경로여야 한다.', true);
    }
    return parts.filter(part => part && part !== '.').join('/');
};
const createAgentProvider = (plugin) => {
    const descriptor = {
        provider: {
            id: plugin.manifest.id,
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            description: '노트의 Plotly 차트 정의 검사'
        },
        instructions: AGENT_INSTRUCTIONS,
        tools: AGENT_TOOLS
    };
    let disposed = false;
    const handlers = {
        check_chart: (args) => __awaiter(void 0, void 0, void 0, function* () {
            if (plugin.ensureLibraries) yield plugin.ensureLibraries();
            const chart = analyzeChart(String(args.source));
            const summary = `트레이스 ${chart.traces.length}개${chart.traces.length ? `(${agentClip(chart.traces.join(', '), 400)})` : ''}${chart.title ? ` · 제목 「${chart.title}」` : ''}`;
            const lines = chart.problems.length
                ? [`문제 ${chart.problems.length}건 · ${summary}`, ...problemLines(chart.problems)]
                : [`문제 없음 · ${summary}`];
            return {
                content: [{ type: 'text', text: lines.join('\n') }],
                structuredContent: { valid: chart.problems.length === 0, problems: chart.problems.length, traces: chart.traces.length }
            };
        }),
        read_charts: (args) => __awaiter(void 0, void 0, void 0, function* () {
            const path = normalizeAgentPath(args.path);
            const file = plugin.app.vault.getAbstractFileByPath(path);
            if (!file || typeof file.extension !== 'string') {
                throw new AgentToolError('NOT_FOUND', `Vault에 이 노트가 없다: ${path}`, true);
            }
            if (file.extension.toLowerCase() !== 'md') {
                throw new AgentToolError('UNSUPPORTED_FORMAT', 'Markdown 노트(.md)만 읽는다.');
            }
            const found = findChartBlocks(yield plugin.app.vault.cachedRead(file));
            if (found.charts.length && plugin.ensureLibraries) yield plugin.ensureLibraries();
            const total = found.charts.length;
            const from = typeof args.from === 'number' ? args.from : 1;
            if (from > Math.max(total, 1)) {
                throw new AgentToolError('INVALID_ARGUMENT', `from은 1~${Math.max(total, 1)} 범위여야 한다.`, true);
            }
            const lines = [];
            let size = 0;
            let next = from;
            let withProblems = 0;
            while (next <= total && next - from < AGENT_MAX_CHARTS) {
                const block = found.charts[next - 1];
                const chart = analyzeChart(block.source);
                const entry = [
                    `차트 ${next} · ${block.startLine}~${block.endLine}행${block.closed ? '' : ' · 닫는 울타리 없음'} · 트레이스 ${chart.traces.length}개${chart.traces.length ? `(${agentClip(chart.traces.join(', '), 200)})` : ''}${chart.title ? ` · 제목 「${chart.title}」` : ''} · ${chart.problems.length ? `문제 ${chart.problems.length}건` : '문제 없음'}`,
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
                `노트 ${path} · plotly 차트 ${total}개${total ? ` 중 ${from}~${next - 1}` : ''}${found.dataview ? ` · dataviewjs로 그리는 차트 블록 ${found.dataview}개(검사하지 않음)` : ''}`,
                ...lines,
                ...(complete ? [] : [`… 계속: from=${next} (남은 차트 ${total - next + 1}개)`])
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
                    throw new AgentToolError('DISPOSED', '플러그인이 종료됐다.');
                }
                if (!Object.prototype.hasOwnProperty.call(handlers, name)) {
                    throw new AgentToolError('UNKNOWN_TOOL', `알 수 없는 도구다: ${name}`);
                }
                const result = yield handlers[name](args || {});
                if (ctx && ctx.signal && ctx.signal.aborted) {
                    throw new AgentToolError('CANCELLED', '호출이 취소됐다.');
                }
                return result;
            }
            catch (error) {
                const known = error instanceof AgentToolError;
                const code = known ? error.code : 'INTERNAL';
                const retryable = known && error.retryable;
                return {
                    isError: true,
                    content: [{ type: 'text', text: known ? error.message : `도구 실행 중 오류: ${error && error.message ? error.message : error}` }],
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
            this.loadLibrariesApi = () => this.ensureLibraries();
            window.loadPlotlyLibraries = this.loadLibrariesApi;
            this.renderApi = async (...args) => {
                await this.ensureLibraries();
                return renderPlotly(...args);
            };
            window.renderPlotly = this.renderApi;
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
                    await loadD3(this);
                    await loadPlotly(this);
                    if (this.unloaded) throw new Error('Chart Hands is unloaded.');
                    this.Plotly = Plotly;
                    new obsidian.Notice('Chart Hands: Plotly and D3 loaded', 3000);
                    return { Plotly, d3: window.d3 };
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


