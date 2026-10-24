// Builds a Plotly chart definition for the build_chart agent tool. Pure: no DOM, no Obsidian API.
import { PALETTE } from './chart-guide.js';

export const CHART_TYPES = ['line', 'bar', 'barh', 'pie', 'scatter'];
const SERIES_COLORS = [PALETTE.primary, PALETTE.series2, PALETTE.series3, PALETTE.highlight, PALETTE.neutral];
const LINE_DASHES = ['solid', 'dash', 'dot', 'dashdot'];
const MARKER_SYMBOLS = ['circle', 'square', 'diamond', 'triangle-up'];

const fail = (message) => {
    throw new Error(message);
};
const isNumberList = (value) => Array.isArray(value) && value.every(item => typeof item === 'number' && Number.isFinite(item));

const checkSeries = (type, labels, series) => {
    if (!Array.isArray(series) || !series.length) {
        fail('series needs at least one entry with a values array.');
    }
    series.forEach((entry, index) => {
        const where = `series[${index}]`;
        if (!entry || !isNumberList(entry.values) || !entry.values.length) {
            fail(`${where}.values must be a non-empty array of numbers.`);
        }
        if (type === 'scatter') {
            if (!isNumberList(entry.x) || entry.x.length !== entry.values.length) {
                fail(`${where}.x must be an array of numbers with the same length as values for a scatter chart.`);
            }
        }
        else if (entry.values.length !== labels.length) {
            fail(`${where}.values has ${entry.values.length} items but labels has ${labels.length}.`);
        }
    });
};

const buildTrace = (type, labels, entry, index, count, clean) => {
    const name = entry.name || (count > 1 ? `Series ${index + 1}` : undefined);
    const color = SERIES_COLORS[index % SERIES_COLORS.length];
    const trace = {};
    if (type === 'line') {
        Object.assign(trace, { x: labels, y: entry.values, type: 'scatter', mode: 'lines+markers' });
    }
    else if (type === 'scatter') {
        Object.assign(trace, { x: entry.x, y: entry.values, type: 'scatter', mode: 'markers' });
    }
    else if (type === 'bar') {
        Object.assign(trace, { x: labels, y: entry.values, type: 'bar' });
    }
    else {
        Object.assign(trace, { x: entry.values, y: labels, type: 'bar', orientation: 'h' });
    }
    if (name) {
        trace.name = name;
    }
    if (!clean) {
        return trace;
    }
    if (type === 'line') {
        trace.line = { color, dash: LINE_DASHES[index % LINE_DASHES.length], width: 2 };
        trace.marker = { color, symbol: MARKER_SYMBOLS[index % MARKER_SYMBOLS.length], size: 7 };
    }
    else if (type === 'scatter') {
        trace.marker = { color, symbol: MARKER_SYMBOLS[index % MARKER_SYMBOLS.length], size: 8 };
    }
    else {
        trace.marker = { color };
        if (count === 1) {
            trace.texttemplate = type === 'bar' ? '%{y:,.0f}' : '%{x:,.0f}';
            trace.textposition = 'outside';
            trace.cliponaxis = false;
        }
    }
    return trace;
};

const buildLayout = (args, count, clean) => {
    const { type, title } = args;
    const layout = {};
    if (title) {
        layout.title = { text: title };
    }
    if (type !== 'pie') {
        const axis = (text) => (text ? { title: { text } } : {});
        layout.xaxis = axis(args.x_title);
        layout.yaxis = axis(args.y_title);
    }
    if ((type === 'bar' || type === 'barh') && count > 1) {
        layout.barmode = args.stacked ? 'stack' : 'group';
    }
    if (!clean) {
        return layout;
    }
    layout.margin = { l: 50, r: 30, t: 90, b: 50, autoexpand: true };
    layout.font = { color: PALETTE.text };
    if (title) {
        layout.title.font = { color: PALETTE.title, size: 18 };
    }
    if (type !== 'pie') {
        Object.assign(layout.xaxis, { automargin: true, showgrid: false, showline: false, zeroline: false });
        Object.assign(layout.yaxis, { automargin: true, showgrid: true, gridcolor: PALETTE.grid, griddash: 'dot', showline: false, zeroline: false });
    }
    if (count > 1 || type === 'pie') {
        layout.legend = { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' };
    }
    if (type === 'line' && count > 1) {
        layout.hovermode = 'x unified';
    }
    return layout;
};

// Returns { data, layout, config }. Throws an Error with a message the agent can act on.
export const buildChartDefinition = (args) => {
    const type = args.type;
    if (!CHART_TYPES.includes(type)) {
        fail(`type must be one of: ${CHART_TYPES.join(', ')}.`);
    }
    const clean = args.style !== 'plain';
    const labels = Array.isArray(args.labels) ? args.labels.map(String) : [];
    if (type !== 'scatter' && !labels.length) {
        fail('labels is required for this chart type (category names, or slice names for a pie).');
    }
    checkSeries(type, labels, args.series);
    const series = args.series;
    const config = clean ? { responsive: true, displaylogo: false } : { responsive: true };
    if (type === 'pie') {
        const entry = series[0];
        const trace = { type: 'pie', labels, values: entry.values };
        if (entry.name) {
            trace.name = entry.name;
        }
        if (clean) {
            trace.marker = { colors: labels.map((_, index) => SERIES_COLORS[index % SERIES_COLORS.length]) };
            trace.textinfo = 'label+percent';
        }
        return { data: [trace], layout: buildLayout(args, 1, clean), config };
    }
    return {
        data: series.map((entry, index) => buildTrace(type, labels, entry, index, series.length, clean)),
        layout: buildLayout(args, series.length, clean),
        config
    };
};
