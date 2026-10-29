// Builds a Plotly chart definition for the build_chart agent tool. Pure: no DOM, no Obsidian API.
import { PALETTE } from './chart-guide.js';

export const CHART_TYPES = [
    'line', 'area', 'bar', 'barh', 'combo', 'scatter', 'bubble',
    'pie', 'donut', 'treemap', 'sunburst', 'waterfall', 'funnel',
    'histogram', 'box', 'violin', 'heatmap', 'radar', 'indicator'
];
// Data shape of each type: labels plus one value per label, raw observations, or x/y points.
const PER_LABEL = ['line', 'area', 'bar', 'barh', 'combo', 'pie', 'donut', 'treemap', 'sunburst', 'waterfall', 'funnel', 'heatmap', 'radar'];
const POINTS = ['scatter', 'bubble'];
export const SINGLE_SERIES_TYPES = ['pie', 'donut', 'treemap', 'sunburst', 'waterfall', 'indicator'];
const NO_AXES = ['pie', 'donut', 'treemap', 'sunburst', 'radar', 'indicator'];
const SECONDARY_AXIS = ['line', 'area', 'bar', 'combo'];
const RANGE_SLIDER = ['line', 'area', 'bar', 'combo', 'scatter', 'bubble'];
const MEASURES = ['relative', 'total', 'absolute'];

const SERIES_COLORS = [PALETTE.primary, PALETTE.series2, PALETTE.series3, PALETTE.highlight, PALETTE.neutral];
const LINE_DASHES = ['solid', 'dash', 'dot', 'dashdot'];
const MARKER_SYMBOLS = ['circle', 'square', 'diamond', 'triangle-up'];
const SEQUENTIAL_SCALE = [[0, '#EFF6FF'], [0.5, '#60A5FA'], [1, '#1E3A8A']];
const DIVERGING_SCALE = [[0, PALETTE.highlight], [0.5, '#F8FAFC'], [1, PALETTE.primary]];
const HEATMAP_TEXT_CELLS = 150;
const BUBBLE_MAX_PX = 40;

const fail = (message) => {
    throw new Error(message);
};
const isNumberList = (value) => Array.isArray(value) && value.every(item => typeof item === 'number' && Number.isFinite(item));
const translucent = (hex, alpha) => {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

const checkTree = (labels, parents, values) => {
    if (!Array.isArray(parents) || parents.length !== labels.length) {
        fail(`parents must have one entry per label (${labels.length}); use "" for a top-level item.`);
    }
    if (new Set(labels).size !== labels.length) {
        fail('labels must be unique for a treemap or sunburst.');
    }
    parents.forEach((parent, index) => {
        if (parent !== '' && !labels.includes(parent)) {
            fail(`parents[${index}] "${parent}" is not one of the labels; use "" for a top-level item.`);
        }
    });
    if (!parents.includes('')) {
        fail('parents needs at least one "" entry for a top-level item.');
    }
    if (values.some(value => value < 0)) {
        fail('treemap and sunburst values cannot be negative.');
    }
};

const checkSeries = (args, labels) => {
    const { type, series } = args;
    if (!Array.isArray(series) || !series.length) {
        fail('series needs at least one entry with a values array.');
    }
    series.forEach((entry, index) => {
        const where = `series[${index}]`;
        if (!entry || !isNumberList(entry.values) || !entry.values.length) {
            fail(`${where}.values must be a non-empty array of numbers.`);
        }
        if (POINTS.includes(type) && (!isNumberList(entry.x) || entry.x.length !== entry.values.length)) {
            fail(`${where}.x must be an array of numbers with the same length as values for a ${type} chart.`);
        }
        if (type === 'bubble' && (!isNumberList(entry.size) || entry.size.length !== entry.values.length || entry.size.some(size => size < 0))) {
            fail(`${where}.size must be an array of non-negative numbers with the same length as values for a bubble chart.`);
        }
        if (PER_LABEL.includes(type) && entry.values.length !== labels.length) {
            fail(`${where}.values has ${entry.values.length} items but labels has ${labels.length}.`);
        }
        if (entry.secondary && !SECONDARY_AXIS.includes(type)) {
            fail(`${where}.secondary works only with ${SECONDARY_AXIS.join(', ')}.`);
        }
    });
    if ((type === 'pie' || type === 'donut') && series[0].values.some(value => value < 0)) {
        fail('pie and donut values cannot be negative.');
    }
    if (type === 'treemap' || type === 'sunburst') {
        checkTree(labels, args.parents, series[0].values);
    }
    if (type === 'waterfall' && args.measure !== undefined
        && (!Array.isArray(args.measure) || args.measure.length !== labels.length || args.measure.some(item => !MEASURES.includes(item)))) {
        fail(`measure must have one entry per label (${labels.length}), each one of: ${MEASURES.join(', ')}.`);
    }
    if (type === 'radar' && labels.length < 3) {
        fail('a radar chart needs at least 3 labels (one per axis).');
    }
    if (type === 'indicator' && series[0].values.length > 2) {
        fail('an indicator takes values [value] or [value, reference].');
    }
    if (args.range_slider && !RANGE_SLIDER.includes(type)) {
        fail(`range_slider works only with ${RANGE_SLIDER.join(', ')}.`);
    }
};

// One trace per series for the types that draw several series on shared axes.
const buildTrace = (args, labels, entry, index, count, clean) => {
    const { type } = args;
    const name = entry.name || (count > 1 || type === 'box' || type === 'violin' ? `Series ${index + 1}` : undefined);
    const color = SERIES_COLORS[index % SERIES_COLORS.length];
    const kind = type === 'combo' ? (entry.kind || (index === 0 ? 'bar' : 'line')) : type;
    const trace = {};
    if (kind === 'line' || kind === 'area') {
        Object.assign(trace, { x: labels, y: entry.values, type: 'scatter', mode: kind === 'line' ? 'lines+markers' : 'lines' });
        if (kind === 'area') {
            if (args.stacked) {
                trace.stackgroup = 'one';
            }
            else {
                trace.fill = 'tozeroy';
            }
        }
    }
    else if (kind === 'bar') {
        Object.assign(trace, { x: labels, y: entry.values, type: 'bar' });
    }
    else if (kind === 'barh') {
        Object.assign(trace, { x: entry.values, y: labels, type: 'bar', orientation: 'h' });
    }
    else if (kind === 'scatter' || kind === 'bubble') {
        Object.assign(trace, { x: entry.x, y: entry.values, type: 'scatter', mode: 'markers' });
        if (Array.isArray(entry.text) && entry.text.length) {
            trace.text = entry.text.map(String);
        }
        if (kind === 'bubble') {
            const largest = Math.max(...args.series.flatMap(item => item.size), 1);
            trace.marker = { size: entry.size, sizemode: 'area', sizeref: (2 * largest) / (BUBBLE_MAX_PX ** 2), sizemin: 4 };
        }
    }
    else if (kind === 'funnel') {
        Object.assign(trace, { x: entry.values, y: labels, type: 'funnel', textinfo: 'value+percent initial' });
    }
    else if (kind === 'histogram') {
        Object.assign(trace, { x: entry.values, type: 'histogram' });
        if (args.bins) {
            trace.nbinsx = args.bins;
        }
    }
    else if (kind === 'box') {
        Object.assign(trace, { y: entry.values, type: 'box', boxmean: true });
    }
    else if (kind === 'violin') {
        Object.assign(trace, { y: entry.values, type: 'violin', box: { visible: true }, meanline: { visible: true } });
    }
    else if (kind === 'radar') {
        // Repeat the first point so the outline closes.
        Object.assign(trace, { r: [...entry.values, entry.values[0]], theta: [...labels, labels[0]], type: 'scatterpolar', fill: 'toself' });
    }
    if (name) {
        trace.name = name;
    }
    if (entry.secondary) {
        trace.yaxis = 'y2';
    }
    if (!clean) {
        return trace;
    }
    if (kind === 'line') {
        trace.line = { color, dash: LINE_DASHES[index % LINE_DASHES.length], width: 2 };
        trace.marker = { color, symbol: MARKER_SYMBOLS[index % MARKER_SYMBOLS.length], size: 7 };
    }
    else if (kind === 'area') {
        trace.line = { color, width: 2 };
        trace.fillcolor = translucent(color, args.stacked ? 0.55 : 0.18);
    }
    else if (kind === 'scatter' || kind === 'bubble') {
        trace.marker = Object.assign(trace.marker || { size: 8 }, { color, symbol: MARKER_SYMBOLS[index % MARKER_SYMBOLS.length] });
        if (kind === 'bubble') {
            Object.assign(trace.marker, { opacity: 0.7, line: { color: '#FFFFFF', width: 1 } });
        }
    }
    else if (kind === 'bar' || kind === 'barh') {
        trace.marker = { color };
        if (count === 1) {
            trace.texttemplate = kind === 'bar' ? '%{y:,.12~g}' : '%{x:,.12~g}';
            trace.textposition = 'outside';
            trace.cliponaxis = false;
        }
    }
    else if (kind === 'funnel') {
        trace.marker = { color };
        if (count > 1) {
            trace.connector = { visible: false };
        }
    }
    else if (kind === 'histogram') {
        trace.marker = { color, line: { color: '#FFFFFF', width: 1 } };
        if (count > 1 && !args.stacked) {
            trace.opacity = 0.6;
        }
    }
    else if (kind === 'box' || kind === 'violin') {
        trace.marker = { color };
        trace.line = { color };
    }
    else if (kind === 'radar') {
        trace.line = { color, width: 2 };
        trace.fillcolor = translucent(color, 0.15);
        trace.marker = { color, symbol: MARKER_SYMBOLS[index % MARKER_SYMBOLS.length], size: 6 };
    }
    return trace;
};

const buildPie = (args, labels, entry, clean) => {
    const trace = { type: 'pie', labels, values: entry.values };
    if (args.type === 'donut') {
        trace.hole = 0.55;
    }
    if (entry.name) {
        trace.name = entry.name;
    }
    if (clean) {
        trace.marker = { colors: labels.map((_, index) => SERIES_COLORS[index % SERIES_COLORS.length]), line: { color: '#FFFFFF', width: 2 } };
        trace.textinfo = 'label+percent';
        trace.sort = false;
    }
    return trace;
};

// branchvalues total draws nothing when a parent is smaller than its children, so it is used only
// when every parent value equals the sum of its children.
const buildTree = (args, labels, entry, clean) => {
    const values = entry.values;
    const isParentTotal = labels.every((label, index) => {
        const children = labels.filter((_, child) => args.parents[child] === label);
        if (!children.length) {
            return true;
        }
        const sum = children.reduce((total, child) => total + values[labels.indexOf(child)], 0);
        return Math.abs(sum - values[index]) <= Math.abs(values[index]) * 1e-9;
    });
    const trace = { type: args.type, labels, parents: args.parents.map(String), values };
    if (isParentTotal && args.parents.some(parent => parent !== '')) {
        trace.branchvalues = 'total';
    }
    if (entry.name) {
        trace.name = entry.name;
    }
    if (clean) {
        trace.marker = { line: { color: '#FFFFFF', width: 2 } };
        trace.textinfo = args.type === 'treemap' ? 'label+value+percent parent' : 'label+percent parent';
    }
    return trace;
};

const buildWaterfall = (args, labels, entry, clean) => {
    const measure = args.measure || labels.map(() => 'relative');
    const trace = { type: 'waterfall', x: labels, y: entry.values, measure };
    if (entry.name) {
        trace.name = entry.name;
    }
    if (clean) {
        trace.texttemplate = measure.map(item => (item === 'relative' ? '%{delta:+,.12~g}' : '%{final:,.12~g}'));
        trace.textposition = 'outside';
        trace.cliponaxis = false;
        trace.increasing = { marker: { color: PALETTE.series2 } };
        trace.decreasing = { marker: { color: PALETTE.highlight } };
        trace.totals = { marker: { color: PALETTE.primary } };
        trace.connector = { line: { color: PALETTE.neutral, dash: 'dot', width: 1 } };
    }
    return trace;
};

const buildHeatmap = (labels, series, clean) => {
    const z = series.map(entry => entry.values);
    const trace = { type: 'heatmap', x: labels, y: series.map((entry, index) => entry.name || `Row ${index + 1}`), z };
    if (!clean) {
        return trace;
    }
    const flat = z.flat();
    const diverging = Math.min(...flat) < 0 && Math.max(...flat) > 0;
    trace.colorscale = diverging ? DIVERGING_SCALE : SEQUENTIAL_SCALE;
    if (diverging) {
        trace.zmid = 0;
    }
    trace.xgap = 2;
    trace.ygap = 2;
    if (flat.length <= HEATMAP_TEXT_CELLS) {
        trace.texttemplate = '%{z:,}';
    }
    return trace;
};

const buildIndicator = (args, entry, clean) => {
    const [value, reference] = entry.values;
    const trace = { type: 'indicator', mode: reference === undefined ? 'number' : 'number+delta', value };
    if (reference !== undefined) {
        trace.delta = { reference, relative: true, valueformat: '.1%' };
        if (clean) {
            Object.assign(trace.delta, { increasing: { color: PALETTE.series2 }, decreasing: { color: PALETTE.highlight } });
        }
    }
    if (entry.name) {
        trace.title = { text: entry.name };
    }
    if (clean) {
        trace.number = { valueformat: ',', font: { color: PALETTE.title } };
    }
    return trace;
};

const buildLayout = (args, data, clean) => {
    const { type, title } = args;
    const count = data.length;
    const layout = {};
    if (title) {
        layout.title = { text: title };
    }
    const axes = !NO_AXES.includes(type);
    if (axes) {
        const axis = (text) => (text ? { title: { text } } : {});
        // A funnel hides its value axis, so it gets only the stage axis.
        if (type !== 'funnel') {
            layout.xaxis = axis(args.x_title);
        }
        layout.yaxis = axis(args.y_title);
    }
    const secondary = data.some(trace => trace.yaxis === 'y2');
    if (secondary) {
        layout.yaxis2 = { overlaying: 'y', side: 'right' };
        if (args.y2_title) {
            layout.yaxis2.title = { text: args.y2_title };
        }
    }
    const bars = data.filter(trace => trace.type === 'bar').length;
    if (bars > 1) {
        layout.barmode = args.stacked ? 'stack' : 'group';
    }
    if (type === 'funnel' && count > 1) {
        layout.funnelmode = 'group';
    }
    if (type === 'histogram' && count > 1) {
        layout.barmode = args.stacked ? 'stack' : 'overlay';
    }
    if (args.range_slider) {
        layout.xaxis.rangeslider = { visible: true };
    }
    if (type === 'heatmap') {
        // The first series is the top row, as in a table.
        layout.yaxis.autorange = 'reversed';
    }
    if (type === 'box' || type === 'violin' || type === 'waterfall') {
        layout.showlegend = false;
    }
    if (!clean) {
        return layout;
    }
    layout.margin = { l: 50, r: 30, t: 90, b: 50, autoexpand: true };
    layout.font = { color: PALETTE.text };
    if (title) {
        layout.title.font = { color: PALETTE.title, size: 18 };
    }
    if (axes) {
        const grid = { automargin: true, showgrid: true, gridcolor: PALETTE.grid, griddash: 'dot', showline: false, zeroline: false };
        const plain = { automargin: true, showgrid: false, showline: false, zeroline: false };
        const horizontal = type === 'barh' || type === 'funnel';
        if (layout.xaxis) {
            Object.assign(layout.xaxis, horizontal || type === 'scatter' || type === 'bubble' ? grid : plain);
        }
        Object.assign(layout.yaxis, horizontal || type === 'heatmap' ? plain : grid);
        if (secondary) {
            // An overlaying axis syncs its ticks to the primary grid by default, which gives odd tick values.
            Object.assign(layout.yaxis2, { automargin: true, showgrid: false, zeroline: false, tickmode: 'auto' });
        }
    }
    if (type === 'radar') {
        layout.polar = {
            radialaxis: { visible: true, gridcolor: PALETTE.grid, linecolor: PALETTE.grid },
            angularaxis: { gridcolor: PALETTE.grid, linecolor: PALETTE.grid }
        };
    }
    if (type === 'treemap' || type === 'sunburst') {
        layout.colorway = SERIES_COLORS;
        layout.margin = { l: 10, r: 10, t: title ? 70 : 20, b: 10, autoexpand: true };
    }
    if (type === 'indicator') {
        layout.margin = { l: 20, r: 20, t: title ? 70 : 20, b: 20, autoexpand: true };
    }
    if (layout.showlegend !== false && type !== 'heatmap' && type !== 'indicator' && (count > 1 || type === 'pie' || type === 'donut')) {
        layout.legend = { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' };
    }
    if ((type === 'line' || type === 'area' || type === 'combo') && count > 1) {
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
    if (PER_LABEL.includes(type) && !labels.length) {
        fail('labels is required for this chart type (categories, slice or node names, heatmap columns or radar axes).');
    }
    checkSeries(args, labels);
    const series = SINGLE_SERIES_TYPES.includes(type) ? args.series.slice(0, 1) : args.series;
    const config = clean ? { responsive: true, displaylogo: false } : { responsive: true };
    let data;
    if (type === 'pie' || type === 'donut') {
        data = [buildPie(args, labels, series[0], clean)];
    }
    else if (type === 'treemap' || type === 'sunburst') {
        data = [buildTree(args, labels, series[0], clean)];
    }
    else if (type === 'waterfall') {
        data = [buildWaterfall(args, labels, series[0], clean)];
    }
    else if (type === 'heatmap') {
        data = [buildHeatmap(labels, series, clean)];
    }
    else if (type === 'indicator') {
        data = [buildIndicator(args, series[0], clean)];
    }
    else {
        data = series.map((entry, index) => buildTrace(args, labels, entry, index, series.length, clean));
    }
    return { data, layout: buildLayout(args, data, clean), config };
};
