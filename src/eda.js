// Small, bounded CSV analysis engine. Analysis results contain no renderer-specific values.
const MAX_ROWS = 100000;
const MAX_COLUMNS = 100;
const MAX_BYTES = 5 * 1024 * 1024;

export function parseDataset(source) {
    if (typeof source !== 'string' || source.length > MAX_BYTES) throw new Error('CSV must be at most 5 MiB.');
    source = source.replace(/^\uFEFF/, '');
    const rows = []; let row = [], field = '', quoted = false, closed = false;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (quoted) {
            if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') { quoted = false; closed = true; }
            else field += c;
        } else if (c === ',' || c === '\n' || c === '\r') {
            row.push(field); field = ''; closed = false;
            if (c !== ',') {
                if (c === '\r' && source[i + 1] === '\n') i++;
                rows.push(row); row = [];
                if (rows.length > MAX_ROWS + 1) throw new Error('CSV exceeds 100000 data rows.');
            }
        } else if (c === '"' && !field && !closed) quoted = true;
        else if (closed || c === '"') throw new Error('Malformed CSV quoting.');
        else field += c;
    }
    if (quoted) throw new Error('Unclosed quoted CSV field.');
    if (field || row.length || closed) { row.push(field); rows.push(row); }
    if (!rows.length) throw new Error('CSV is empty.');
    const headers = rows.shift().map(h => h.trim());
    if (headers.length > MAX_COLUMNS || headers.some(h => !h || h.length > 100 || [...h].some(c => c.charCodeAt(0) < 32)) || new Set(headers).size !== headers.length) throw new Error('CSV requires 1–100 unique, nonempty column names of at most 100 characters.');
    if (rows.some(r => r.length !== headers.length)) throw new Error('CSV rows must have the same number of fields as the header.');
    return { headers, rows };
}
const missing = value => value.trim() === '';
const number = value => {
    let s = value.trim();
    // Spreadsheet exports often quote grouped numbers ("1,234,567.5"); only exact three-digit groups are accepted.
    if (/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    if (!s || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return null;
    const n = Number(s); return Number.isFinite(n) ? n : null;
};
const quantile = (sorted, p) => {
    const x = (sorted.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
};
function summary(values) {
    if (!values.length) return { count: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    // Incremental mean and sample variance; avoid overflow or non-finite JSON.
    let mean = 0, m2 = 0;
    values.forEach((v, i) => { const delta = v - mean; mean += delta / (i + 1); m2 += delta * (v - mean); });
    const finite = n => Number.isFinite(n) ? n : null;
    return { count: values.length, min: sorted[0], q1: finite(quantile(sorted, .25)), median: finite(quantile(sorted, .5)), q3: finite(quantile(sorted, .75)), max: sorted.at(-1), mean: finite(mean), stddevSample: values.length > 1 ? finite(Math.sqrt(m2 / (values.length - 1))) : null };
}
function indexOf(dataset, name) {
    const index = dataset.headers.indexOf(name);
    if (index < 0) throw new Error(`Unknown column: ${name}`);
    return index;
}
export function profile(dataset, from = 0, limit = 5) {
    return { rowCount: dataset.rows.length, columnCount: dataset.headers.length, columns: dataset.headers.slice(from, from + limit).map((name, offset) => {
        const i = from + offset;
        const values = dataset.rows.map(row => row[i]).filter(v => !missing(v));
        const nums = values.map(number);
        const numeric = values.length > 0 && nums.every(n => n !== null);
        const counts = new Map();
        for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
        const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([value, count]) => ({ value: [...value.slice(0, 80)].map(c => c.charCodeAt(0) < 32 ? ' ' : c).join(''), count }));
        return { name, type: numeric ? 'number' : values.length ? 'text' : 'empty', missing: dataset.rows.length - values.length, missingRate: dataset.rows.length ? (dataset.rows.length - values.length) / dataset.rows.length : 0, distinct: counts.size, ...(numeric ? { statistics: summary(nums) } : { top }) };
    }) };
}
export const AGGREGATE_FUNCTIONS = ['sum', 'mean', 'count', 'min', 'max', 'median'];
export const AGGREGATE_SORTS = ['desc', 'asc', 'label', 'original'];
const AGGREGATE_DEFAULT_LIMIT = 60;
const AGGREGATE_MAX_LIMIT = 100;
const label = value => [...value.trim().slice(0, 100)].map(c => c.charCodeAt(0) < 32 ? ' ' : c).join('');
/**
 * Group rows by one column and reduce a numeric column per group. Rows with a blank group or a non-numeric value are
 * counted, not guessed. With sort label or original, each group also gets its change from the previous group.
 */
function aggregate(dataset, spec) {
    const cols = spec.columns;
    const fn = spec.function ?? (cols.length === 2 ? 'sum' : 'count');
    if (!AGGREGATE_FUNCTIONS.includes(fn)) throw new Error(`analysis.function must be one of ${AGGREGATE_FUNCTIONS.join(', ')}.`);
    if (fn !== 'count' && cols.length !== 2) throw new Error('aggregate needs [group column, value column]; count may omit the value column.');
    const sort = spec.sort ?? 'desc';
    if (!AGGREGATE_SORTS.includes(sort)) throw new Error(`analysis.sort must be one of ${AGGREGATE_SORTS.join(', ')}.`);
    const limit = spec.limit ?? AGGREGATE_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > AGGREGATE_MAX_LIMIT) throw new Error(`analysis.limit must be an integer from 1 to ${AGGREGATE_MAX_LIMIT}.`);
    const gi = indexOf(dataset, cols[0]), vi = cols.length === 2 ? indexOf(dataset, cols[1]) : -1;
    const groups = new Map();
    let excluded = 0, missingGroup = 0;
    for (const row of dataset.rows) {
        if (missing(row[gi])) { missingGroup++; continue; }
        const value = vi < 0 ? null : number(row[vi]);
        if (vi >= 0 && value === null && fn !== 'count') { excluded++; continue; }
        const key = row[gi].trim();
        let group = groups.get(key);
        if (!group) groups.set(key, group = { values: [], rows: 0 });
        group.rows++;
        if (value !== null) group.values.push(value);
    }
    const reduce = ({ values, rows }) => {
        if (fn === 'count') return rows;
        if (fn === 'sum') return values.reduce((a, b) => a + b, 0);
        if (fn === 'mean') { let mean = 0; values.forEach((v, i) => { mean += (v - mean) / (i + 1); }); return mean; }
        if (fn === 'min') return values.reduce((a, b) => Math.min(a, b), Infinity);
        if (fn === 'max') return values.reduce((a, b) => Math.max(a, b), -Infinity);
        return quantile([...values].sort((a, b) => a - b), .5);
    };
    let list = [...groups].map(([key, group]) => ({ group: label(key), rows: group.rows, value: reduce(group) }));
    const additive = fn === 'sum' || fn === 'count';
    const total = additive ? list.reduce((a, g) => a + g.value, 0) : null;
    const allValues = additive ? [] : [...groups.values()].flatMap(group => group.values);
    const overall = allValues.length ? reduce({ values: allValues }) : null;
    if (sort === 'desc') list.sort((a, b) => b.value - a.value || a.group.localeCompare(b.group));
    else if (sort === 'asc') list.sort((a, b) => a.value - b.value || a.group.localeCompare(b.group));
    else if (sort === 'label') list.sort((a, b) => a.group.localeCompare(b.group, undefined, { numeric: true }));
    const finite = n => Number.isFinite(n) ? n : null;
    list = list.map((g, i) => {
        const result = { ...g, value: finite(g.value) };
        if (additive) result.share = total ? finite(g.value / total) : null;
        if (sort === 'label' || sort === 'original') {
            const prev = list[i - 1];
            result.change = prev ? finite(g.value - prev.value) : null;
            result.changeRate = prev && prev.value !== 0 ? finite((g.value - prev.value) / Math.abs(prev.value)) : null;
        }
        return result;
    });
    const shown = list.slice(0, limit);
    return { type: 'aggregate', columns: cols, function: fn, sort, totalRows: dataset.rows.length, validRows: dataset.rows.length - excluded - missingGroup,
        excludedRows: excluded, missingGroupRows: missingGroup, groupCount: list.length, truncated: list.length > shown.length,
        ...(list.length > shown.length ? { returnedGroups: shown.length, limit, maxLimit: AGGREGATE_MAX_LIMIT,
            note: list.length <= AGGREGATE_MAX_LIMIT
                ? `Returned the first ${shown.length} of ${list.length} groups. To see all groups, set analysis.limit to ${list.length} (maximum ${AGGREGATE_MAX_LIMIT}).`
                : `Returned the first ${shown.length} of ${list.length} groups. The maximum analysis.limit is ${AGGREGATE_MAX_LIMIT}; use a smaller CSV to see the remaining groups.` } : {}),
        ...(additive ? { total: finite(total) } : { overall: finite(overall) }), groups: shown, chart: { labels: shown.map(g => g.group), values: shown.map(g => g.value) } };
}

export function analyze(dataset, spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('analysis must be an object.');
    if (!['summary', 'histogram', 'correlation', 'aggregate', 'rows'].includes(spec.type)) throw new Error('analysis.type must be one of summary, histogram, correlation, aggregate, rows.');
    const allowed = { summary: [], histogram: ['bins'], correlation: ['method'], aggregate: ['function', 'sort', 'limit'], rows: ['limit', 'offset', 'sort_by', 'sort'] };
    const keys = ['type', 'columns', 'filter', ...allowed[spec.type]];
    const invalidKey = Object.keys(spec).find(key => !keys.includes(key));
    if (invalidKey !== undefined) throw new Error(`Unknown or inapplicable analysis key: ${invalidKey}. ${spec.type} accepts: ${keys.join(', ')}.`);
    const cols = spec.columns;
    const max = spec.type === 'rows' || spec.type === 'summary' ? 8 : spec.type === 'aggregate' || spec.type === 'correlation' ? 2 : 1;
    const min = spec.type === 'correlation' ? 2 : 1;
    if (!Array.isArray(cols) || cols.length < min || cols.length > max || cols.some(c => typeof c !== 'string')) throw new Error(`${spec.type} needs ${min === max ? min : `${min} to ${max}`} column${max === 1 ? '' : 's'} as strings in analysis.columns.`);
    const indexes = cols.map(c => indexOf(dataset, c));
    let selected = dataset.rows.map((row, i) => ({ row, rowNumber: i + 1 }));
    if (spec.filter !== undefined) {
        if (!Array.isArray(spec.filter) || spec.filter.length > 4) throw new Error('analysis.filter must be an array of at most 4 conditions.');
        const ops = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'prefix', 'contains'];
        const conditions = spec.filter.map((condition, i) => {
            const where = `analysis.filter condition ${i + 1}`;
            if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw new Error(`${where} must be an object.`);
            const key = Object.keys(condition).find(k => !['column', 'op', 'value'].includes(k));
            if (key !== undefined) throw new Error(`${where} has unknown key: ${key}.`);
            if (typeof condition.column !== 'string') throw new Error(`${where} column must be a string.`);
            if (!dataset.headers.includes(condition.column)) throw new Error(`${where} has unknown column: ${condition.column}.`);
            if (!ops.includes(condition.op)) throw new Error(`${where} has unknown op: ${condition.op}; allowed: ${ops.join(', ')}.`);
            if (typeof condition.value !== 'string') throw new Error(`${where} value must be a string.`);
            return { ...condition, index: indexOf(dataset, condition.column) };
        });
        selected = selected.filter(({ row }) => conditions.every(({ index, op, value }) => {
            const cell = row[index];
            if (op === 'prefix') return cell.startsWith(value);
            if (op === 'contains') return cell.includes(value);
            if (missing(cell)) return op === 'ne';
            const a = number(cell), b = number(value);
            const left = a !== null && b !== null ? a : cell.trim();
            const right = a !== null && b !== null ? b : value.trim();
            if (op === 'eq') return left === right;
            if (op === 'ne') return left !== right;
            if (op === 'gt') return left > right;
            if (op === 'gte') return left >= right;
            if (op === 'lt') return left < right;
            return left <= right;
        }));
    }
    let result;
    if (spec.type === 'rows') {
        const limit = spec.limit ?? 50, offset = spec.offset ?? 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('rows limit must be an integer from 1 to 100.');
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('rows offset must be an integer from 0 to 9007199254740991.');
        if (spec.sort !== undefined && !['asc', 'desc'].includes(spec.sort)) throw new Error('rows sort must be asc or desc.');
        if (spec.sort !== undefined && spec.sort_by === undefined) throw new Error(`rows에서 sort를 쓰려면 sort_by에 열 이름을 함께 줄 것. 예: "sort_by":${JSON.stringify(cols[cols.length - 1])},"sort":${JSON.stringify(spec.sort)} (sort는 그대로 두고 sort_by를 더한다)`);
        if (spec.sort_by !== undefined) {
            if (typeof spec.sort_by !== 'string') throw new Error('rows sort_by must be a column name.');
            const sortIndex = indexOf(dataset, spec.sort_by), direction = spec.sort ?? 'asc';
            const numeric = selected.every(({ row }) => missing(row[sortIndex]) || number(row[sortIndex]) !== null);
            selected.sort((a, b) => {
                const x = a.row[sortIndex], y = b.row[sortIndex];
                if (missing(x) || missing(y)) return missing(x) === missing(y) ? a.rowNumber - b.rowNumber : missing(x) ? 1 : -1;
                const comparison = numeric ? number(x) - number(y) : x.trim().localeCompare(y.trim());
                return (direction === 'desc' ? -comparison : comparison) || a.rowNumber - b.rowNumber;
            });
        }
        const page = selected.slice(offset, offset + limit);
        const truncated = offset + page.length < selected.length;
        result = { type: 'rows', columns: cols, ...(spec.sort_by !== undefined ? { sortedBy: spec.sort_by, sort: spec.sort ?? 'asc', order: spec.sort === 'desc' ? 'descending (largest first)' : 'ascending (smallest first)' } : {}), matchedRows: selected.length, rows: page.map(({ row, rowNumber }) => {
            const truncatedColumns = cols.filter((_, j) => row[indexes[j]].length > 200);
            return { rowNumber, values: indexes.map(i => row[i].slice(0, 200)), ...(truncatedColumns.length ? { truncatedColumns } : {}) };
        }), truncated, nextOffset: truncated ? offset + page.length : null };
    } else {
        result = analyzeSelected({ ...dataset, rows: selected.map(item => item.row) }, spec);
    }
    return { ...result, totalRows: dataset.rows.length, ...(spec.filter !== undefined ? { filter: spec.filter, filteredRows: selected.length } : {}) };
}

function analyzeSelected(dataset, spec) {
    if (spec.type === 'aggregate') {
        if (!Array.isArray(spec.columns) || spec.columns.length < 1 || spec.columns.length > 2 || spec.columns.some(c => typeof c !== 'string')) throw new Error('aggregate needs [group column, value column].');
        if (spec.method !== undefined || spec.bins !== undefined) throw new Error('method and bins do not apply to aggregate.');
        return aggregate(dataset, spec);
    }
    if (spec.function !== undefined || spec.sort !== undefined || spec.limit !== undefined) throw new Error('function, sort and limit apply only to aggregate.');
    const cols = spec.columns;
    if (!Array.isArray(cols) || (spec.type === 'summary' ? cols.length < 1 || cols.length > 8 : cols.length !== (spec.type === 'correlation' ? 2 : 1)) || cols.some(c => typeof c !== 'string')) throw new Error('summary needs one to eight columns; histogram needs one; correlation needs two.');
    if (spec.method !== undefined && (spec.type !== 'correlation' || spec.method !== 'pearson')) throw new Error('Only Pearson correlation is supported.');
    if (spec.bins !== undefined && (spec.type !== 'histogram' || !Number.isInteger(spec.bins) || spec.bins < 1 || spec.bins > 50)) throw new Error('Histogram bins must be an integer from 1 to 50.');
    const indexes = cols.map(c => indexOf(dataset, c));
    if (spec.type === 'summary' && cols.length > 1) {
        const perColumn = indexes.map((index, i) => {
            const values = dataset.rows.map(row => number(row[index])).filter(value => value !== null);
            const statistics = summary(values);
            if (values.length) { const sum = values.reduce((a, b) => a + b, 0); statistics.sum = Number.isFinite(sum) ? sum : null; }
            return { column: cols[i], excludedRows: dataset.rows.length - values.length, statistics };
        });
        const total = perColumn.reduce((sum, entry) => sum + (entry.statistics.sum === null ? Infinity : entry.statistics.sum ?? 0), 0);
        const sumTotal = Number.isFinite(total) ? total : null;
        const shares = perColumn.map(({ column, statistics }) => {
            const sum = statistics.sum === undefined ? 0 : statistics.sum;
            const share = sum !== null && sumTotal !== null && sumTotal !== 0 ? sum / sumTotal : null;
            return { column, sum, share: Number.isFinite(share) && share !== null ? share : null };
        });
        return { type: 'summary', columns: cols, totalRows: dataset.rows.length, perColumn, sumTotal, shareOf: 'sum of the listed columns', shares };
    }
    let excluded = 0;
    const pairs = [];
    for (const row of dataset.rows) {
        const nums = indexes.map(i => number(row[i]));
        if (nums.some(n => n === null)) excluded++; else pairs.push(nums);
    }
    if (spec.type === 'summary') {
        const values = pairs.map(p => p[0]);
        const statistics = summary(values);
        if (values.length) { const sum = values.reduce((a, b) => a + b, 0); statistics.sum = Number.isFinite(sum) ? sum : null; }
        return { type: 'summary', columns: cols, totalRows: dataset.rows.length, excludedRows: excluded, statistics };
    }
    if (spec.type === 'histogram') {
        const values = pairs.map(p => p[0]);
        const base = { type: 'histogram', columns: cols, totalRows: dataset.rows.length, validRows: values.length, excludedRows: excluded, bins: [] };
        if (!values.length) return base;
        let min = Infinity, max = -Infinity;
        for (const v of values) { min = Math.min(min, v); max = Math.max(max, v); }
        if (min === max) { base.bins.push({ lower: min, upper: max, count: values.length }); return base; }
        const count = spec.bins || 10;
        // Weighted interpolation avoids overflow for ranges crossing zero.
        const edge = i => min * (1 - i / count) + max * (i / count);
        base.bins = Array.from({ length: count }, (_, i) => ({ lower: edge(i), upper: edge(i + 1), count: 0 }));
        for (const v of values) {
            let i = 0;
            while (i < count - 1 && v >= base.bins[i].upper) i++;
            base.bins[i].count++;
        }
        return base;
    }
    let mx = 0, my = 0, sx = 0, sy = 0, co = 0;
    pairs.forEach(([x, y], i) => { const dx = x - mx, dy = y - my; mx += dx / (i + 1); my += dy / (i + 1); sx += dx * (x - mx); sy += dy * (y - my); co += dx * (y - my); });
    const r = co / Math.sqrt(sx * sy);
    return { type: 'correlation', columns: cols, method: 'pearson', totalRows: dataset.rows.length, validPairs: pairs.length, excludedRows: excluded, correlation: pairs.length >= 2 && sx > 0 && sy > 0 && Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null };
}
