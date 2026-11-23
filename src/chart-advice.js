// Non-blocking presentation advice (A1-A7) evaluated on raw Plotly definitions.
import { isSummary } from './eda.js';

const MAX_ADVICE = 6;
const AXIS_TITLE_TYPES = new Set(['bar', 'waterfall', 'box', 'violin', 'histogram', 'scatter', 'scattergl']);
const SUMMARY_SLICE_TYPES = new Set(['pie', 'treemap', 'sunburst']);
const NO_AXIS_TRACES = new Set([
    'pie', 'treemap', 'sunburst', 'icicle', 'sankey', 'indicator', 'table',
    'scatterpolar', 'scatterpolargl', 'barpolar',
    'scattergeo', 'choropleth', 'scattermap', 'choroplethmap', 'densitymap',
    'scattermapbox', 'choroplethmapbox', 'densitymapbox',
    'scatter3d', 'surface', 'mesh3d', 'cone', 'streamtube', 'volume', 'isosurface',
    'scatterternary', 'parcoords', 'parcats'
]);

const traceType = (trace) => (typeof trace.type === 'string' ? trace.type : 'scatter');

const axisKey = (ref, fallback) => {
    const value = typeof ref === 'string' && ref ? ref : fallback;
    const match = value.match(/^([xy])(\d*)$/);
    if (!match) return `${fallback}axis`;
    const suffix = match[2] && match[2] !== '1' ? match[2] : '';
    return `${match[1]}axis${suffix}`;
};

const hasAxisTitle = (layout, key) => {
    const title = layout[key]?.title;
    return Boolean(title && typeof title === 'object' && typeof title.text === 'string' && title.text.trim());
};

const isAreaScatter = (trace, type) => (type === 'scatter' || type === 'scattergl')
    && ((typeof trace.fill === 'string' && trace.fill && trace.fill !== 'none') || Boolean(trace.stackgroup));

const isMarkersOnlyScatter = (trace, type) => {
    if (type !== 'scatter' && type !== 'scattergl') return false;
    if (isAreaScatter(trace, type)) return false;
    const mode = typeof trace.mode === 'string' ? trace.mode : '';
    return /\bmarkers\b/.test(mode) && !/\blines\b/.test(mode);
};

export function adviseChart(json, locale = 'en') {
    if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray(json.data)) return [];
    const traces = json.data.filter(trace => trace && typeof trace === 'object' && !Array.isArray(trace));
    if (!traces.length) return [];
    const layout = json.layout && typeof json.layout === 'object' && !Array.isArray(json.layout) ? json.layout : {};
    const ko = locale === 'ko';
    const advice = [];
    const add = (koText, enText) => {
        if (advice.length < MAX_ADVICE) advice.push(ko ? koText : enText);
    };

    // A1: Bar, histogram, or area scatter value axis starts above 0.
    const seenA1 = new Set();
    for (const trace of traces) {
        const type = traceType(trace);
        if (type !== 'bar' && type !== 'histogram' && !isAreaScatter(trace, type)) continue;
        const horizontal = trace.orientation === 'h';
        const key = axisKey(horizontal ? trace.xaxis : trace.yaxis, horizontal ? 'x' : 'y');
        if (seenA1.has(key)) continue;
        const axis = layout[key];
        if (!axis || typeof axis !== 'object' || axis.autorange === true || axis.type === 'log') continue;
        if (!Array.isArray(axis.range) || axis.range.length < 2) continue;
        const [a, b] = axis.range;
        if (typeof a !== 'number' || !Number.isFinite(a) || typeof b !== 'number' || !Number.isFinite(b)) continue;
        const low = Math.min(a, b);
        if (low > 0) {
            seenA1.add(key);
            add(
                `막대·면적 값 축이 0이 아닌 ${low}에서 시작합니다. 차이가 실제보다 커 보일 수 있습니다.`,
                `The bar/area value axis starts at ${low} instead of 0; differences may look larger than they are.`
            );
        }
    }

    // A2: Pie trace with more than 6 slices.
    for (const trace of traces) {
        if (traceType(trace) === 'pie' && Array.isArray(trace.labels) && trace.labels.length > 6) {
            const count = trace.labels.length;
            add(
                `원형 조각이 ${count}개입니다. 7개 이상이면 정렬된 가로 막대가 비교하기 쉽습니다.`,
                `Pie chart has ${count} slices; with 7 or more, a sorted horizontal bar chart is easier to compare.`
            );
        }
    }

    // A3: Summary row label in pie, treemap, or sunburst.
    const seenA3 = new Set();
    for (const trace of traces) {
        if (!SUMMARY_SLICE_TYPES.has(traceType(trace)) || !Array.isArray(trace.labels)) continue;
        for (const rawLabel of trace.labels) {
            if (typeof rawLabel !== 'string' || !isSummary(rawLabel)) continue;
            const label = rawLabel.trim();
            if (seenA3.has(label)) continue;
            seenA3.add(label);
            add(
                `'${label}' 조각이 있습니다. 합계 행이면 다른 조각과 함께 세어집니다.`,
                `Slice '${label}' looks like a summary row; including it counts it alongside the other slices.`
            );
        }
    }

    // A4: Missing value axis title.
    const requiredAxes = new Set();
    for (const trace of traces) {
        const type = traceType(trace);
        if (!AXIS_TITLE_TYPES.has(type)) continue;
        if (isMarkersOnlyScatter(trace, type)) {
            requiredAxes.add(axisKey(trace.xaxis, 'x'));
            requiredAxes.add(axisKey(trace.yaxis, 'y'));
        }
        else {
            const horizontal = trace.orientation === 'h';
            requiredAxes.add(axisKey(horizontal ? trace.xaxis : trace.yaxis, horizontal ? 'x' : 'y'));
        }
    }
    if ([...requiredAxes].some(key => !hasAxisTitle(layout, key))) {
        add('값 축 제목(단위)이 없습니다.', 'Value axis title (with unit) is missing.');
    }

    // A5: Missing chart title.
    const titleText = layout.title && typeof layout.title === 'object' ? layout.title.text : '';
    if (typeof titleText !== 'string' || !titleText.trim()) {
        add('제목이 없습니다.', 'Chart title is missing.');
    }

    // A6: More than 6 traces sharing the same axis pair.
    const axisCounts = new Map();
    for (const trace of traces) {
        if (NO_AXIS_TRACES.has(traceType(trace))) continue;
        const pair = `${axisKey(trace.xaxis, 'x')}|${axisKey(trace.yaxis, 'y')}`;
        axisCounts.set(pair, (axisCounts.get(pair) || 0) + 1);
    }
    for (const count of axisCounts.values()) {
        if (count > 6) {
            add(
                `한 축에 계열이 ${count}개입니다. 구분이 어려울 수 있습니다.`,
                `${count} series share one axis; they may be hard to tell apart.`
            );
        }
    }

    // A7: Stacked or relative bars with negative values.
    if (layout.barmode === 'stack' || layout.barmode === 'relative') {
        const hasNegativeBar = traces.some(trace => {
            if (traceType(trace) !== 'bar') return false;
            const values = trace.orientation === 'h' ? trace.x : trace.y;
            return Array.isArray(values) && values.some(v => typeof v === 'number' && Number.isFinite(v) && v < 0);
        });
        if (hasNegativeBar) {
            add(
                '음수가 있는 누적 막대입니다. 합계를 읽기 어려울 수 있습니다.',
                'Stacked bars contain negative values; totals may be hard to read.'
            );
        }
    }

    return advice;
}
