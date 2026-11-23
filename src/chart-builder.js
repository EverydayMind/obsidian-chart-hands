// Builds a Plotly chart definition for the build_chart agent tool. Pure: no DOM, no Obsidian API.
import { PALETTE } from './chart-guide.js';
import { chartDisplay, highlightIndices, joinUnit } from './chart-facts.js';

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
const PRINT_COLORS = ['#111827', '#4B5563', '#9CA3AF', '#D1D5DB', '#6B7280'];
const LINE_DASHES = ['solid', 'dash', 'dot', 'dashdot'];
const MARKER_SYMBOLS = ['circle', 'square', 'diamond', 'triangle-up'];
const SEQUENTIAL_SCALE = [[0, '#EFF6FF'], [0.5, '#60A5FA'], [1, '#1E3A8A']];
const DIVERGING_SCALE = [[0, PALETTE.highlight], [0.5, '#F8FAFC'], [1, PALETTE.primary]];
const HEATMAP_TEXT_CELLS = 150;
const BUBBLE_MAX_PX = 40;

// Mixes a #RRGGBB colour 70% toward white (pale version for non-highlighted categories).
const tint = (hex) => /^#[0-9a-f]{6}$/i.test(hex) ? `#${[1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.3 + 255 * 0.7).toString(16).padStart(2, '0')).join('').toUpperCase()}` : '#E2E8F0';
const fail = (message) => {
    throw new Error(message);
};
export function validateBuildArgs(args, locale = 'ko') {
    const { type, series = [] } = args;
    const error = (ko, en) => fail(locale === 'ko' ? ko : en);
    const reject = (key, allowed) => error(`${key}은 ${allowed}에만 쓸 수 있습니다. 해당 유형으로 바꾸거나 인자를 빼세요.`, `${key} is only supported for ${allowed}; change the type or omit it.`);
    if (PER_LABEL.includes(type) && Array.isArray(args.labels)) checkDuplicateLabels(args.labels, locale);
    if (args.style !== undefined && !['clean', 'plain', 'report', 'print', 'slides'].includes(args.style)) reject('style', 'clean, plain, report, print, slides');
    for (const [key, types] of [['parents', ['treemap', 'sunburst']], ['measure', ['waterfall']], ['bins', ['histogram']]]) if (args[key] !== undefined && !types.includes(type)) reject(key, types.join(', '));
    if (args.range_slider && !RANGE_SLIDER.includes(type)) reject('range_slider', RANGE_SLIDER.join(', '));
    if (args.source?.x !== undefined && !POINTS.includes(type)) reject('source.x', 'scatter, bubble; source.labels');
    series.forEach((s, i) => {
        if (!s) return;
        for (const [key, types] of [['x', POINTS], ['size', ['bubble']], ['sizeColumn', ['bubble']], ['kind', ['combo']]]) if (s[key] !== undefined && !types.includes(type)) reject(`series[${i}].${key}`, types.join(', '));
        if (s.secondary && !SECONDARY_AXIS.includes(type)) reject(`series[${i}].secondary`, SECONDARY_AXIS.join(', '));
    });
    if (args.stacked) {
        const bars = series.filter((s, i) => type === 'combo' ? (s.kind || (i ? 'line' : 'bar')) === 'bar' : ['bar', 'barh'].includes(type)).length;
        if (!(type === 'area' || type === 'histogram' && series.length >= 2 || ['bar', 'barh', 'combo'].includes(type) && (bars >= 2 || type === 'combo' && series.some(s => s.kind === 'area')))) reject('stacked', 'bar/barh/combo with two bars, combo with area, area, or histogram with two series');
    }
    const ignored = [];
    if (NO_AXES.includes(type)) for (const key of ['x_title', 'y_title']) if (args[key] !== undefined) ignored.push(key);
    if (type === 'funnel' && args.x_title !== undefined) ignored.push('x_title');
    if (args.y2_title !== undefined && !series.some(s => s?.secondary)) ignored.push('y2_title');
    if (['scatter', 'bubble', 'histogram', 'box', 'violin', 'indicator'].includes(type)) {
        if (args.labels !== undefined) ignored.push('labels');
        if (args.source?.labels !== undefined) ignored.push('source.labels');
    }
    if (!POINTS.includes(type)) series.forEach((s, i) => { if (s?.text?.length) ignored.push(`series[${i}].text`); });
    for (const [key, max] of [['unit', 12], ['caption', 200]]) if (args[key] !== undefined && (typeof args[key] !== 'string' || args[key].length > max || /\p{Cc}/u.test(args[key]))) reject(key, `string ≤ ${max}`);
    if (args.target !== undefined) {
        if (!['line', 'area', 'bar', 'barh', 'combo'].includes(type)) reject('target', 'line, area, bar, barh, combo');
        const t = args.target;
        if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).some(k => !['value', 'label', 'series'].includes(k)) || !Number.isFinite(t.value) || t.label !== undefined && (typeof t.label !== 'string' || t.label.length > 100 || /\p{Cc}/u.test(t.label)) || t.series !== undefined && (!Number.isInteger(t.series) || t.series < 0 || t.series >= series.length) || series.some(s => s.secondary) && t.series === undefined) error('target의 값 또는 계열이 잘못되었습니다. 보조축이 있으면 target.series를 지정하세요.', 'Invalid target value or series; specify target.series when a secondary axis is present.');
    }
    if (args.highlight !== undefined) {
        const h = args.highlight, keys = h && typeof h === 'object' && !Array.isArray(h) ? Object.keys(h) : [];
        const k = keys[0];
        if (keys.length > 1 && keys.every(key => ['labels', 'top', 'bottom', 'below_target', 'above_target'].includes(key))) error(`highlight에는 선택자를 하나만 주세요(받은 것: ${keys.join(', ')}). 이름을 정해 강조하면 labels만 씁니다.`, `Give highlight only one selector (received: ${keys.join(', ')}). To highlight by name, use labels alone.`);
        if (keys.length !== 1 || !['labels', 'top', 'bottom', 'below_target', 'above_target'].includes(k) || (k === 'labels' ? !Array.isArray(h[k]) || !h[k].length || h[k].length > 50 || h[k].some(v => typeof v !== 'string') : ['top', 'bottom'].includes(k) ? !Number.isInteger(h[k]) || h[k] < 1 || h[k] > 50 : h[k] !== true || !args.target)) error('highlight 선택자가 잘못되었습니다. labels, top, bottom, below_target, above_target 중 하나를 지정하세요.', 'Invalid highlight selector; specify exactly one of labels, top, bottom, below_target or above_target.');
        if (k === 'labels' && Array.isArray(args.labels) && h.labels.some(v => !args.labels.includes(v))) error(`highlight.labels는 실제 labels에서 선택하세요: ${args.labels.join(', ')}`, `Choose highlight.labels from the actual labels: ${args.labels.join(', ')}`);
        const bar = type === 'combo' ? series.findIndex((s, i) => (s.kind || (i ? 'line' : 'bar')) === 'bar') : 0;
        const ok = k === 'labels'
            ? (['bar', 'barh'].includes(type) || type === 'combo' && bar >= 0)
            : (type === 'combo' && bar >= 0 || ['bar', 'barh'].includes(type) && series.length === 1);
        if (!ok) {
            if (!['bar', 'barh'].includes(type) && !(type === 'combo' && bar >= 0)) error(`highlight은 bar, barh, 또는 막대가 있는 combo에만 쓸 수 있습니다(지금 type: ${type}). type을 bar나 barh로 바꾸거나 highlight를 빼세요.`, `highlight is only supported for bar, barh, or combo with a bar (type is ${type}); change type to bar or barh, or omit highlight.`);
            error('top·bottom·below_target·above_target은 단일 계열 막대에만 쓸 수 있습니다. 여러 계열이면 highlight.labels로 범주를 지정하세요.', 'top, bottom, below_target and above_target are only supported for a single bar series. With several series, use highlight.labels to pick categories.');
        }
        if (['below_target', 'above_target'].includes(k) && (args.target.series ?? 0) !== bar) error('목표를 단 계열과 강조할 막대 계열이 다릅니다.', 'The target series differs from the highlighted bar series.');
    }
    return ignored;
}
export function checkDuplicateLabels(labels, locale = 'ko') {
    const seen = new Set();
    for (const value of labels) {
        const name = String(value).slice(0, 100);
        if (seen.has(name)) fail(locale === 'ko' ? `범주 이름이 겹칩니다: ${name}. 같은 이름의 행을 합치려면 source.analysis로 aggregate하세요.` : `Duplicate category name: ${name}. To combine rows with the same name, aggregate with source.analysis.`);
        seen.add(name);
    }
}
// CSV blanks are gaps, never zeroes.
const isNumberList = (value) => Array.isArray(value) && value.every(item => item === null || typeof item === 'number' && Number.isFinite(item));
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
    const colors = args.style === 'print' ? PRINT_COLORS : SERIES_COLORS;
    const color = colors[index % colors.length];
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
        if (count === 1 && (type === 'combo' || entry.values.length <= 40)) {
            trace.texttemplate = type === 'combo' ? '%{y:,.12~g}' : '%{text}';
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
        const colors = args.style === 'print' ? PRINT_COLORS : SERIES_COLORS;
        trace.marker = { colors: labels.map((_, index) => colors[index % colors.length]), line: { color: '#FFFFFF', width: 2 } };
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
        trace.increasing = { marker: { color: args.style === 'print' ? PRINT_COLORS[1] : PALETTE.series2 } };
        trace.decreasing = { marker: { color: args.style === 'print' ? PRINT_COLORS[2] : PALETTE.highlight } };
        trace.totals = { marker: { color: args.style === 'print' ? PRINT_COLORS[0] : PALETTE.primary } };
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
        trace.texttemplate = '%{text}';
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
export const buildChartDefinition = (args, { mode = 'strict', locale = 'ko' } = {}) => {
    const type = args.type;
    if (mode !== 'legacy') validateBuildArgs(args, locale);
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
    if (data[0].texttemplate === '%{text}') {
        const displays = chartDisplay(args);
        data[0].text = type === 'heatmap' ? displays.map(entry => entry.strings) : displays[0].strings;
    }
    const layout = buildLayout(args, data, clean);
    if (['report', 'print', 'slides'].includes(args.style)) {
        layout.font = { ...layout.font, family: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif', size: args.style === 'slides' ? 16 : 13 };
        if (layout.title) Object.assign(layout.title, { x: 0, xanchor: 'left', font: { color: PALETTE.title, size: args.style === 'slides' ? 26 : 20 } });
        if (args.style === 'print') {
            layout.colorway = PRINT_COLORS;
            layout.paper_bgcolor = layout.plot_bgcolor = '#FFFFFF';
            if (type === 'heatmap') data[0].colorscale = [[0, '#F9FAFB'], [1, '#111827']];
            data.forEach((trace, i) => { if (trace.type === 'bar') trace.marker = { ...trace.marker, color: layout.colorway[i % 5], ...(data.filter(t => t.type === 'bar').length > 1 ? { pattern: { shape: ['', '/', 'x', '.'][i % 4] } } : {}) }; });
        }
    }
    if (args.unit) {
        const prefix = /^[₩$€£¥]$/.test(args.unit);
        const format = value => joinUnit(value, args.unit);
        const suffix = joinUnit('', args.unit);
        data.forEach(trace => {
            if (type === 'combo' && trace.type === 'bar' && trace.texttemplate) trace.texttemplate = format(trace.texttemplate);
            if (trace.type === 'funnel') trace.texttemplate = `${format('%{value:,.12~g}')}<br>%{percentInitial}`;
            if (trace.type === 'indicator') trace.number = { ...trace.number, [prefix ? 'prefix' : 'suffix']: prefix ? args.unit : suffix };
        });
    }
    if (args.target) {
        const t = args.target, horizontal = type === 'barh', axis = series[t.series ?? 0]?.secondary ? 'y2' : 'y';
        const line = { dash: 'dot', color: args.style === 'print' ? PRINT_COLORS[0] : PALETTE.highlight };
        layout.shapes = [horizontal ? { type: 'line', xref: 'x', x0: t.value, x1: t.value, yref: 'paper', y0: 0, y1: 1, line } : { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: axis, y0: t.value, y1: t.value, line }];
        const targetValue = joinUnit(t.value, args.unit || '');
        layout.annotations = [{ ...(horizontal ? { xref: 'x', x: t.value, yref: 'paper', y: 1 } : { xref: 'paper', x: 1, xanchor: 'right', yref: axis, y: t.value }), yanchor: 'bottom', showarrow: false, text: t.label ?? `${locale === 'ko' ? '목표' : 'Target'} ${targetValue}` }];
    }
    if (args.highlight) {
        const highlightColor = args.style === 'print' ? '#111827' : PALETTE.highlight;
        const mutedColor = args.style === 'print' ? '#D1D5DB' : '#CBD5E1';
        if (Object.hasOwn(args.highlight, 'labels')) {
            const chosen = new Set(highlightIndices(args.highlight, labels, series[0].values, args.target));
            const bars = data.filter(trace => trace.type === 'bar');
            // One bar series: highlight colour vs grey. Several: each series keeps its own colour on the chosen
            // categories and a pale tint of it elsewhere, so the series stay distinguishable.
            bars.forEach((trace, n) => {
                const base = bars.length === 1 ? highlightColor : typeof trace.marker?.color === 'string' ? trace.marker.color : (args.style === 'print' ? PRINT_COLORS : SERIES_COLORS)[n % 5];
                const faded = bars.length === 1 ? mutedColor : tint(base);
                trace.marker = { ...trace.marker, color: labels.map((_, i) => chosen.has(i) ? base : faded) };
            });
        } else {
            const i = type === 'combo' ? data.findIndex(t => t.type === 'bar') : 0;
            const chosen = new Set(highlightIndices(args.highlight, labels, series[i].values, args.target));
            data[i].marker = { ...data[i].marker, color: labels.map((_, n) => chosen.has(n) ? highlightColor : mutedColor) };
        }
    }
    if (args.caption) {
        layout.annotations = [...(layout.annotations || []), { xref: 'paper', yref: 'paper', x: 0, y: -0.2, xanchor: 'left', yanchor: 'top', showarrow: false, text: args.caption, font: { size: 11, color: '#6B7280' } }];
        layout.margin = { ...layout.margin, b: Math.max(layout.margin?.b || 0, 90) };
    }
    return { data, layout, config };
};
