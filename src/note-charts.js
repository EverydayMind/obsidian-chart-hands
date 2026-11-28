import { columnFacts } from './eda.js';
import { CHART_TYPES } from './chart-builder.js';
import { periodKey } from './period.js';

const REBUILD_PREFIX = '# chart-hands build v1: ';
const REBUILD_LIMIT = 600;
const REBUILD_KEYS = [
    'type', 'source', 'series', 'stacked', 'style', 'target', 'highlight', 'unit', 'title', 'title_from',
    'x_title', 'y_title', 'y2_title', 'range_slider', 'gauge', 'caption', 'parents', 'measure', 'bins'
];

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function rebuildComment(args) {
    const recipe = Object.fromEntries(REBUILD_KEYS.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
    const json = JSON.stringify(recipe);
    return json.length <= REBUILD_LIMIT ? REBUILD_PREFIX + json : '';
}

export function readRebuild(source, normalizePath, locale) {
    let marker;
    for (const line of source.split('\n')) {
        const text = line.trim();
        if (!text) continue;
        if (!text.startsWith('#')) break;
        if (text.startsWith('# chart-hands build ')) {
            marker = text;
            break;
        }
    }
    if (!marker) return { rebuild: null };
    const [, version, json] = /^# chart-hands build ([^:\s]+):\s*(.*)$/.exec(marker) ?? [];
    if (version && version !== 'v1') {
        return { rebuild: null, rebuildReason: locale === 'ko' ? '지원하지 않는 다시 만들기 주석 버전입니다.' : 'Unsupported rebuild comment version.' };
    }
    try {
        if (!json || json.length > REBUILD_LIMIT) throw new Error();
        const recipe = JSON.parse(json);
        if (!isRecord(recipe) || !CHART_TYPES.includes(recipe.type) || !isRecord(recipe.source)
            || !Array.isArray(recipe.series) || !recipe.series.length || recipe.series.some(series => !isRecord(series) || typeof series.column !== 'string')
            || Object.keys(recipe).some(key => !REBUILD_KEYS.includes(key))) throw new Error();
        recipe.source.path = normalizePath(recipe.source.path);
        return { rebuild: recipe };
    }
    catch {
        return { rebuild: null, rebuildReason: locale === 'ko' ? '다시 만들기 주석의 JSON 또는 인자가 잘못되었습니다.' : 'Invalid rebuild comment JSON or arguments.' };
    }
}

export function snippetEndLine(lines, fenceEndLine) {
    // reportSnippet uses a single blank line between sections.
    const skipBlank = start => lines[start]?.trim() === '' ? start + 1 : start;
    const factsStart = skipBlank(fenceEndLine);
    let factsEnd = factsStart;
    while (lines[factsEnd]?.startsWith('- ')) factsEnd++;
    const source = skipBlank(factsEnd);
    if (/^(?:자료:|Source:)/.test(lines[source] ?? '')) return source + 1;
    return factsEnd > factsStart ? factsEnd : fenceEndLine;
}

const labelKey = label => periodKey(label, { weeks: true });

export function tracePoints(trace) {
    if (trace?.type === 'pie') return [trace.labels, trace.values];
    if (trace?.type === 'bar' && trace.orientation === 'h') return [trace.y, trace.x];
    return [trace?.x, trace?.y];
}

export function compareTraces(traces, dataset, spec, locale) {
    const fail = (ko, en) => { throw new Error(locale === 'ko' ? ko : en); };
    const tolerance = spec.tolerance === undefined ? 0 : spec.tolerance;
    if (!Number.isFinite(tolerance) || tolerance < 0) fail('tolerance에는 0 이상의 유한한 숫자를 주세요.', 'tolerance must be a finite nonnegative number.');
    const labelColumn = dataset.headers.indexOf(spec.labels);
    if (labelColumn < 0) fail('compare.labels에 자료의 라벨 열 이름을 주세요.', 'Set compare.labels to a label column in the dataset.');
    const columns = dataset.headers.map((name, index) => ({
        name, head: name.split(/[_(]/, 1)[0].trim(), index, numeric: columnFacts(dataset.rows, index).strictNumeric
    }));
    const names = columns.filter(column => column.numeric).map(column => column.name).join(', ') || '—';
    const chooseColumns = () => fail(
        '계열마다 숫자 열을 하나씩 compare.columns에 지정하세요. 숫자 열: ' + names,
        'Supply one numeric column per trace in compare.columns. Numeric columns: ' + names
    );
    if (spec.columns !== undefined && (!Array.isArray(spec.columns) || spec.columns.length !== traces.length)) chooseColumns();
    const rows = new Map();
    for (const [i, row] of dataset.rows.entries()) {
        const label = row[labelColumn].trim();
        const key = labelKey(label);
        if (rows.has(key)) fail('자료의 라벨 열에서 같은 라벨이 여러 행에 있습니다.', 'The dataset label column has duplicate labels.');
        rows.set(key, { label, i });
    }
    const compareTrace = (trace, index) => {
        const where = index + 1;
        const name = typeof trace?.name === 'string' ? trace.name.trim() : '';
        const candidates = spec.columns !== undefined
            ? columns.filter(column => column.name === spec.columns[index])
            : columns.filter(column => name && (column.name === name || column.head === name));
        if (candidates.length !== 1 || !candidates[0].numeric) chooseColumns();
        const column = candidates[0];
        const [labels, values] = tracePoints(trace);
        if (trace?.z !== undefined || !Array.isArray(labels) || !Array.isArray(values) || labels.length !== values.length
            || labels.some(label => typeof label !== 'string' && !Number.isFinite(label))
            || values.some(value => value !== null && !Number.isFinite(value))) {
            fail('라벨과 숫자 값이 같은 개수로 있는 계열만 대조할 수 있습니다.', 'Comparison needs traces with equally long label and numeric value arrays.');
        }
        const data = columnFacts(dataset.rows, column.index).parsed;
        const chartOnly = { count: 0, labels: [] }, dataOnly = { count: 0, labels: [] };
        const addMissing = (bag, label) => {
            bag.count++;
            if (bag.labels.length < 10) bag.labels.push(label);
        };
        const seen = new Set(), mismatches = [];
        let compared = 0, mismatchCount = 0;
        labels.forEach((raw, i) => {
            const label = String(raw).trim();
            const key = labelKey(label);
            seen.add(key);
            const row = rows.get(key);
            if (!row) return addMissing(chartOnly, label);
            const chart = values[i], original = data[row.i];
            compared++;
            if (chart === original || (tolerance > 0 && chart !== null && original !== null
                && chart >= original - tolerance && chart <= original + tolerance)) return;
            mismatchCount++;
            if (mismatches.length < 50) mismatches.push({ label, chart, data: original });
        });
        for (const [key, row] of rows) if (!seen.has(key)) addMissing(dataOnly, row.label);
        return { trace: where, column: column.name, compared, mismatchCount, mismatches, chartOnly, dataOnly };
    };
    return traces.map(compareTrace);
}
