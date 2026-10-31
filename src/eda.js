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
    const s = value.trim();
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
export function analyze(dataset, spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('analysis must be an object.');
    if (!['summary', 'histogram', 'correlation'].includes(spec.type)) throw new Error('analysis.type must be summary, histogram or correlation.');
    const cols = spec.columns;
    if (!Array.isArray(cols) || cols.length !== (spec.type === 'correlation' ? 2 : 1) || cols.some(c => typeof c !== 'string')) throw new Error('summary and histogram need one column; correlation needs two columns.');
    if (spec.method !== undefined && (spec.type !== 'correlation' || spec.method !== 'pearson')) throw new Error('Only Pearson correlation is supported.');
    if (spec.bins !== undefined && (spec.type !== 'histogram' || !Number.isInteger(spec.bins) || spec.bins < 1 || spec.bins > 50)) throw new Error('Histogram bins must be an integer from 1 to 50.');
    const indexes = cols.map(c => indexOf(dataset, c));
    let excluded = 0;
    const pairs = [];
    for (const row of dataset.rows) {
        const nums = indexes.map(i => number(row[i]));
        if (nums.some(n => n === null)) excluded++; else pairs.push(nums);
    }
    if (spec.type === 'summary') return { type: 'summary', columns: cols, totalRows: dataset.rows.length, excludedRows: excluded, statistics: summary(pairs.map(p => p[0])) };
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
