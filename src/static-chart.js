import { buildChartDefinition, CHART_TYPES } from './chart-builder.js';

// A distinct internal API for frozen report inputs, not the Markdown renderer.
export const STATIC_CHART_API = Symbol.for('dev.chart-hands.static-chart-v1');
const TOP_KEYS = new Set(['type', 'title', 'labels', 'parents', 'measure', 'series', 'x_title', 'y_title', 'y2_title', 'stacked', 'bins', 'range_slider', 'style']);
const SERIES_KEYS = new Set(['name', 'values', 'x', 'size', 'text', 'kind', 'secondary']);
const text = (value, max) => typeof value === 'string' && value.length <= max
    && !Array.from(value).some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127);
const stringArray = (value, maxItems, maxChars) => Array.isArray(value) && value.length <= maxItems && value.every(item => text(item, maxChars));
const numberArray = (value) => Array.isArray(value) && value.length <= 2000 && value.every(item => typeof item === 'number' && Number.isFinite(item));
const object = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.has(key));
const invalid = () => { throw new Error('Invalid or unsupported static chart data. Use bounded plain JSON without control characters.'); };
// Plotly interprets HTML-like markup and dollar-delimited math. Encode user text
// exactly once, so it is displayed literally and cannot activate those paths.
const literal = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split('$').join('&#36;');

/** Only plain builder inputs, no arbitrary Plotly definition, markup or external sources. */
export function parseStaticChart(source) {
    if (typeof source !== 'string' || source.length > 200000) return invalid();
    let args;
    try { args = JSON.parse(source); } catch { return invalid(); }
    if (!object(args, TOP_KEYS) || !CHART_TYPES.includes(args.type)) return invalid();
    for (const key of ['title', 'x_title', 'y_title', 'y2_title']) {
        if (args[key] !== undefined && !text(args[key], key === 'title' ? 200 : 100)) return invalid();
    }
    for (const key of ['labels', 'parents', 'measure']) {
        if (args[key] !== undefined && !stringArray(args[key], 200, 100)) return invalid();
    }
    if (args.measure && args.measure.some(item => !['relative', 'total', 'absolute'].includes(item))) return invalid();
    if (args.style !== undefined && !['clean', 'plain'].includes(args.style)) return invalid();
    for (const key of ['stacked', 'range_slider']) if (args[key] !== undefined && typeof args[key] !== 'boolean') return invalid();
    if (args.bins !== undefined && (!Number.isInteger(args.bins) || args.bins < 1 || args.bins > 200)) return invalid();
    if (!Array.isArray(args.series) || args.series.length < 1 || args.series.length > 12) return invalid();
    let total = 0;
    for (const series of args.series) {
        if (!object(series, SERIES_KEYS) || !numberArray(series.values) || !series.values.length) return invalid();
        total += series.values.length;
        for (const key of ['x', 'size']) if (series[key] !== undefined && !numberArray(series[key])) return invalid();
        if (series.name !== undefined && !text(series.name, 100)) return invalid();
        if (series.text !== undefined && !stringArray(series.text, 2000, 100)) return invalid();
        if (series.kind !== undefined && !['bar', 'line', 'area'].includes(series.kind)) return invalid();
        if (series.secondary !== undefined && typeof series.secondary !== 'boolean') return invalid();
    }
    if (total > 10000) return invalid();
    for (const key of ['title', 'x_title', 'y_title', 'y2_title']) if (args[key] !== undefined) args[key] = literal(args[key]);
    for (const key of ['labels', 'parents']) if (args[key] !== undefined) args[key] = args[key].map(literal);
    for (const series of args.series) {
        if (series.name !== undefined) series.name = literal(series.name);
        if (series.text !== undefined) series.text = series.text.map(literal);
    }
    return buildChartDefinition(args);
}

/** Keep the caller responsive even if Plotly or its loader never settles. */
function waitFor(promise, signal, deadline, timers) {
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (callback, value) => {
            if (done) return;
            done = true; timers.clearTimeout(timer); signal?.removeEventListener('abort', aborted); callback(value);
        };
        const aborted = () => finish(reject, signal.reason ?? new Error('Chart rendering cancelled.'));
        const timer = timers.setTimeout(() => finish(reject, new Error('Static chart rendering timed out.')), Math.max(0, deadline - Date.now()));
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) aborted();
        Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    });
}

/** Produces PNG bytes in memory only; caller is responsible for source binding and approval. */
export async function renderStaticChart(source, { document, loadPlotly, signal, timeoutMs = 30000 }) {
    const definition = parseStaticChart(source);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid static chart timeout.');
    const deadline = Date.now() + timeoutMs;
    const timers = document.defaultView;
    if (!timers) throw new Error('Static chart requires a window.');
    signal?.throwIfAborted();
    const plotly = await waitFor(loadPlotly(), signal, deadline, timers);
    signal?.throwIfAborted();
    const container = document.createElement('div');
    Object.assign(container.style, { position: 'fixed', left: '-10000px', top: '0', width: '1000px', height: '600px', pointerEvents: 'none' });
    document.body.appendChild(container);
    try {
        await waitFor(plotly.newPlot(container, definition.data, { ...definition.layout, width: 1000, height: 600 }, { staticPlot: true, responsive: false, displayModeBar: false, showSendToCloud: false }), signal, deadline, timers);
        signal?.throwIfAborted();
        const url = await waitFor(plotly.toImage(container, { format: 'png', width: 1000, height: 600, scale: 1 }), signal, deadline, timers);
        signal?.throwIfAborted();
        if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,') || url.length > 12_000_000) throw new Error('Invalid chart image.');
        const binary = document.defaultView.atob(url.slice(22));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        if (bytes.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value)) throw new Error('Invalid chart image.');
        return { bytes, width: 1000, height: 600 };
    } finally {
        try { plotly.purge(container); } catch { /* Plotly may not have finished initializing. */ } finally { container.remove(); }
    }
}
