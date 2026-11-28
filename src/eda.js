import { periodKey } from './period.js';
import { checkDuplicateLabels, checkSeriesInputs } from './chart-builder.js';
import { inspectColumn } from './column-roles.js';
import { defaultReduction, highlightIndices } from './chart-facts.js';
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
// One fixed collation for tie-breaks and label sorts, so results do not depend on the machine's locale
// (String.prototype.localeCompare without a locale follows the OS: ko-KR and en-US order Hangul and Latin differently).
export const compareText = new Intl.Collator('ko').compare;
export const compareNatural = new Intl.Collator('ko', { numeric: true }).compare;
const missing = value => value.trim() === '';
const withAxisUnit = (name, unit, locale) => unit ? `${name}${locale !== 'ko' && /[A-Za-z0-9)]$/.test(name) ? ' ' : ''}(${unit})` : name;
const NUM = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d*)?|\\.\\d+)';
const UNIT = /(?:%p|%|백만원|천원|만원|억원|조원|원|달러|개소|건|명|개|회|곳|톤|kg|km|thousand|million|billion|people|units|cases|items|USD|EUR|KRW|JPY|GBP|pcs|bn|mn|pp|K|k|M|B)/.source;
const CUR = /(?:[₩$€¥£]|USD|EUR|KRW|JPY|GBP)/.source;
const SYM = '[₩$€¥£]';
const SCALE = /(?:thousand|million|billion|bn|mn|K|k|M|B)/.source;
// "$120K" keeps the symbol and the scale as one unit ("$K"); word scales keep their space ("$ million").
const symScale = (sym, scale) => `${sym}${/^[A-Za-z]{2,}$/.test(scale) && !/^(?:bn|mn)$/.test(scale) ? ' ' : ''}${scale}`;
export function parseCell(text) {
    const s = text.trim(), ws = '[ \\t]*';
    let m, sign = '', unit = '', notation;
    if ((m = s.match(/^([+−-]?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/))) sign = m[1];
    else if ((m = s.match(new RegExp(`^([+\\-−△]?)${ws}(${CUR})${ws}(${NUM})$`)))) { sign = m[1]; unit = m[2]; m = [m[0], sign, m[3]]; }
    else if ((m = s.match(new RegExp(`^([+\\-−△]?)${ws}(${SYM})${ws}(${NUM})${ws}(${SCALE})$`)))) { sign = m[1]; unit = symScale(m[2], m[4]); m = [m[0], sign, m[3]]; }
    else if ((m = s.match(new RegExp(`^\\(${ws}(${SYM})${ws}(${NUM})${ws}(${SCALE})${ws}\\)$`)))) { unit = symScale(m[1], m[3]); m = [m[0], '', m[2]]; notation = '()'; }
    else if ((m = s.match(new RegExp(`^([+\\-−△]?)${ws}(${NUM})${ws}(${UNIT})$`)))) { sign = m[1]; unit = m[3]; }
    else if ((m = s.match(new RegExp(`^(△)${ws}(${NUM})$`)))) sign = m[1];
    else {
        m = s.match(new RegExp(`^(${CUR})?${ws}\\(${ws}(${NUM})${ws}\\)${ws}(${UNIT})?$`));
        if (m && m[1] && m[3]) return null;
        if (m) { unit = m[1] || m[3] || ''; m = [m[0], '', m[2]]; }
        else if ((m = s.match(new RegExp(`^\\(${ws}(${CUR})${ws}(${NUM})${ws}\\)$`)))) { unit = m[1]; m = [m[0], '', m[2]]; }
        else if ((m = s.match(new RegExp(`^\\(${ws}(${NUM})${ws}(${UNIT})${ws}\\)$`)))) { unit = m[2]; m = [m[0], '', m[1]]; }
        else return null;
        notation = '()';
    }
    if (sign === '△') notation = '△';
    const n = Number(m[2].replace(/,/g, '')) * (notation || sign === '-' || sign === '−' ? -1 : 1);
    if (!Number.isFinite(n)) return null;
    return { value: n === 0 ? 0 : n, unit, ...(notation ? { notation } : {}) };
}
const number = value => parseCell(value)?.value ?? null;
const factsCache = new WeakMap();
export function columnFacts(rows, index) {
    let cache = factsCache.get(rows);
    if (!cache) factsCache.set(rows, cache = new Map());
    if (cache.has(index)) return cache.get(index);
    const cells = rows.map(row => missing(row[index]) ? null : parseCell(row[index]));
    const missingRows = rows.filter(row => missing(row[index])).length;
    const invalidRows = cells.filter((cell, i) => !cell && !missing(rows[i][index])).length;
    const nonzero = new Set(cells.filter(c => c && c.value !== 0).map(c => c.unit));
    const zeroUnits = new Set(cells.filter(c => c && c.value === 0).map(c => c.unit));
    const adopt = nonzero.size === 1 && !nonzero.has('') && [...zeroUnits].every(unit => unit === '' || nonzero.has(unit));
    const units = [...new Set(cells.filter(Boolean).map(c => adopt && c.value === 0 ? [...nonzero][0] : c.unit))];
    const notation = [...new Set(cells.filter(c => c?.notation).map(c => c.notation))];
    const leadingZeros = rows.some((row, i) => cells[i] && /^[^\d.]*0\d/.test(row[index]));
    const facts = { parsed: cells.map(c => c?.value ?? null), invalidRows, missingRows, units, notation, strictNumeric: rows.length > missingRows && !invalidRows && units.length <= 1, leadingZeros };
    cache.set(index, facts); return facts;
}
function checkedFacts(rows, index, name, locale) {
    const facts = columnFacts(rows, index);
    if (facts.units.length > 1) {
        const units = facts.units.map(u => u || (locale === 'ko' ? '단위 없음' : 'no unit')).join(', ');
        throw new Error(locale === 'ko' ? `열 ${name}의 선택된 행에 단위가 섞여 있습니다(${units}). filter로 한 단위의 행만 고르거나 자료를 고치세요.` : `Column ${name} has mixed units in the selected rows (${units}). Use filter to select one unit or correct the data.`);
    }
    return facts;
}
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
function indexOf(dataset, name, locale = 'en') {
    const index = dataset.headers.indexOf(name);
    if (index < 0) throw new Error(locale === 'ko' ? `모르는 열: ${name}. 사용 가능한 열: ${dataset.headers.slice(0, 30).join(', ')}. 이 열 이름 중 하나로 다시 호출하세요.` : `Unknown column: ${name}. Available columns: ${dataset.headers.slice(0, 30).join(', ')}. Use one of these column names.`);
    return index;
}
const summaryNames = new Set(['합계', '총계', '소계', '계', '합', '총합', 'total', 'subtotal', 'grand total', 'sum']);
const summaryLabel = value => String(value).trim().replace(/^\*\*(.*?)\*\*$/, '$1').trim();
export const isSummary = value => typeof value === 'string' && summaryNames.has(summaryLabel(value).toLowerCase());
const summaryNotes = (groups, column, locale) => groups.filter(g => isSummary(g.group)).slice(0, 3).map(g => locale === 'ko'
    ? `그룹 '${g.group}'는 합계 행일 수 있습니다. 포함하면 다른 그룹과 함께 더해집니다. 빼려면 filter에 ${JSON.stringify({ column, op: 'ne', value: g.group })}를 더하세요.`
    : `Group '${g.group}' may be a summary row. It is included with other groups. To exclude it, add ${JSON.stringify({ column, op: 'ne', value: g.group })} to filter.`);
export function profile(dataset, from = 0, limit = 10) {
    const target = dataset.headers.findIndex((_, i) => dataset.rows.some(row => !missing(row[i]) && !parseCell(row[i])));
    const candidates = target < 0 ? [] : dataset.rows.flatMap((row, i) => {
        const label = summaryLabel(row[target]);
        return isSummary(row[target]) ? [{ rowNumber: i + 1, column: dataset.headers[target], label, ...(dataset.lines ? { line: dataset.lines[i] } : {}) }] : [];
    });
    return { rowCount: dataset.rows.length, columnCount: dataset.headers.length, ...(candidates.length ? { summaryRowCandidates: candidates.slice(0, 10), summaryRowCount: candidates.length } : {}), columns: dataset.headers.slice(from, from + limit).map((name, offset) => {
        const i = from + offset;
        const values = dataset.rows.map(row => row[i]).filter(v => !missing(v));
        const facts = columnFacts(dataset.rows, i), nums = facts.parsed.filter(n => n !== null);
        const numeric = facts.strictNumeric;
        const counts = new Map();
        for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
        const top = [...counts].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0])).slice(0, 5).map(([value, count]) => ({ value: [...value.slice(0, 80)].map(c => c.charCodeAt(0) < 32 ? ' ' : c).join(''), count }));
        return { name, type: numeric ? 'number' : values.length ? 'text' : 'empty', missing: dataset.rows.length - values.length, missingRate: dataset.rows.length ? (dataset.rows.length - values.length) / dataset.rows.length : 0, distinct: counts.size, ...(numeric ? { statistics: summary(nums) } : { top }), ...(facts.units.length === 1 && facts.units[0] ? { unit: facts.units[0] } : {}), ...(facts.notation.length ? { notation: facts.notation } : {}), ...(facts.units.length > 1 ? { mixedUnits: facts.units } : {}), ...(facts.leadingZeros ? { leadingZeros: true } : {}) };
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
function aggregate(dataset, spec, locale) {
    const cols = spec.columns;
    const fn = spec.function ?? (cols.length === 2 ? 'sum' : 'count');
    if (!AGGREGATE_FUNCTIONS.includes(fn)) throw new Error(`analysis.function must be one of ${AGGREGATE_FUNCTIONS.join(', ')}.`);
    if (fn !== 'count' && cols.length !== 2) throw new Error('aggregate needs [group column, value column]; count may omit the value column.');
    const sort = spec.sort ?? 'desc';
    if (!AGGREGATE_SORTS.includes(sort)) throw new Error(`analysis.sort must be one of ${AGGREGATE_SORTS.join(', ')}.`);
    const limit = spec.limit ?? AGGREGATE_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > AGGREGATE_MAX_LIMIT) throw new Error(`analysis.limit must be an integer from 1 to ${AGGREGATE_MAX_LIMIT}.`);
    const gi = indexOf(dataset, cols[0]), vi = cols.length === 2 ? indexOf(dataset, cols[1]) : -1;
    const facts = fn === 'count' ? null : checkedFacts(dataset.rows.filter(row => !missing(row[gi])), vi, cols[1], locale);
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
    const reduce = group => reduceValues(fn, group.values, group.rows);
    let list = [...groups].map(([key, group]) => ({ group: label(key), rows: group.rows, value: reduce(group) }));
    const additive = fn === 'sum' || fn === 'count';
    const total = additive ? list.reduce((a, g) => a + g.value, 0) : null;
    const allValues = additive ? [] : [...groups.values()].flatMap(group => group.values);
    const overall = allValues.length ? reduce({ values: allValues }) : null;
    if (sort === 'desc') list.sort((a, b) => b.value - a.value || compareText(a.group, b.group));
    else if (sort === 'asc') list.sort((a, b) => a.value - b.value || compareText(a.group, b.group));
    else if (sort === 'label') list.sort((a, b) => compareNatural(a.group, b.group));
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
    const shown = list.slice(0, limit), notes = summaryNotes(list, cols[0], locale);
    return { type: 'aggregate', columns: cols, function: fn, sort, totalRows: dataset.rows.length, validRows: dataset.rows.length - excluded - missingGroup,
        excludedRows: excluded, missingGroupRows: missingGroup, groupCount: list.length, truncated: list.length > shown.length,
        ...(list.length > shown.length ? { returnedGroups: shown.length, limit, maxLimit: AGGREGATE_MAX_LIMIT,
            note: list.length <= AGGREGATE_MAX_LIMIT
                ? `Returned the first ${shown.length} of ${list.length} groups. To see all groups, set analysis.limit to ${list.length} (maximum ${AGGREGATE_MAX_LIMIT}).`
                : `Returned the first ${shown.length} of ${list.length} groups. The maximum analysis.limit is ${AGGREGATE_MAX_LIMIT}; use a smaller CSV to see the remaining groups.` } : {}),
        ...(additive ? { total: finite(total) } : { overall: finite(overall) }), ...(facts?.units[0] ? { unit: facts.units[0] } : {}), groups: shown, chart: { labels: shown.map(g => g.group), values: shown.map(g => g.value) }, ...(notes.length ? { notes } : {}) };
}

function reduceValues(fn, values, rows = values.length) {
    if (fn === 'count') return rows;
    if (fn === 'sum') return values.reduce((a, b) => a + b, 0);
    if (fn === 'mean') {
        let mean = 0;
        values.forEach((value, i) => { mean += (value - mean) / (i + 1); });
        return mean;
    }
    if (fn === 'min') return values.reduce((a, b) => Math.min(a, b), Infinity);
    if (fn === 'max') return values.reduce((a, b) => Math.max(a, b), -Infinity);
    return quantile([...values].sort((a, b) => a - b), .5);
}

const finite = value => Number.isFinite(value) ? value : null;

const edaError = (locale, ko, en) => new Error(locale === 'ko' ? ko : en);

function chartReduction(spec, unit, path, locale) {
    const fn = spec.function === undefined ? defaultReduction(unit) : spec.function;
    if (!AGGREGATE_FUNCTIONS.includes(fn)) {
        const functions = AGGREGATE_FUNCTIONS.join(', ');
        const example = JSON.stringify({ columns: spec.columns, function: 'mean' });
        throw edaError(locale, `${path}.function: ${functions} 중 하나를 고르세요. 예: ${example}`, `${path}.function: choose ${functions}. Example: ${example}`);
    }
    return fn;
}

export function pivotSizeError(filterPath = 'analysis.filter', locale = 'en') {
    return locale === 'ko'
        ? `피벗이 차트 또는 결과 크기 한도를 넘습니다. ${filterPath}로 행을 줄이세요.`
        : `Pivot exceeds the chart or result size limit. Use ${filterPath} to select fewer rows.`;
}

function pivot(dataset, spec, locale, chartType = 'heatmap', path = 'analysis') {
    const [xi, si, vi] = spec.columns.map(column => indexOf(dataset, column, locale));
    if (vi === undefined && spec.function !== 'count') throw edaError(locale,
        `${path}.columns에 [x, series, value]를 주거나 ${path}.function을 count로 지정하세요. 예: ${JSON.stringify(spec.columns)}`,
        `${path}.columns: provide [x, series, value], or use ${path}.function: count with ${JSON.stringify(spec.columns)}.`);
    const matched = dataset.rows.filter(row => !missing(row[xi]) && !missing(row[si]));
    const facts = spec.function === 'count' ? null : checkedFacts(matched, vi, spec.columns[2], locale);
    const unit = facts?.units[0] ?? '';
    const fn = chartReduction(spec, unit, path, locale);
    const xNames = new Set(), cells = new Map();
    matched.forEach((row, i) => {
        const x = row[xi].trim(), series = row[si].trim();
        xNames.add(x);
        if (!cells.has(series)) cells.set(series, new Map());
        const seriesCells = cells.get(series);
        if (!seriesCells.has(x)) seriesCells.set(x, { rows: 0, values: [] });
        const cell = seriesCells.get(x);
        cell.rows++;
        const value = facts?.parsed[i];
        if (value != null) cell.values.push(value);
    });
    if (cells.size > (chartType === 'heatmap' ? 30 : 12) || xNames.size * cells.size > (chartType === 'heatmap' ? 1500 : 7500)) throw new Error(pivotSizeError(`${path}.filter`, locale));
    const sorted = (names, index) => {
        const { role, period } = inspectColumn({ ...dataset, rows: matched }, index, { weeks: true });
        const keys = role === 'period' ? period.keyMap : null;
        return [...names].sort((a, b) => (keys ? compareText(keys.get(a), keys.get(b)) : 0) || compareText(a, b));
    };
    const xs = sorted(xNames, xi);
    const labels = xs.map(label);
    const series = sorted(cells.keys(), si).map(name => ({ name: label(name), values: xs.map(x => {
        const cell = cells.get(name).get(x);
        return cell && (fn === 'count' || cell.values.length) ? finite(reduceValues(fn, cell.values, cell.rows)) : null;
    }) }));
    checkDuplicateLabels(labels, locale);
    checkDuplicateLabels(series.map(entry => entry.name), locale);
    return { type: 'pivot', columns: spec.columns, function: fn, ...(unit ? { unit } : {}), excludedRows: dataset.rows.length - matched.length + (facts ? facts.invalidRows + facts.missingRows : 0), chart: { labels, series } };
}

function compare(dataset, spec, locale) {
    const fail = (ko, en) => { throw new Error(locale === 'ko' ? ko : en); };
    const example = ' {"type":"compare","columns":["부서","실적"],"period":{"column":"연도","base":"2025","target":"2026"}} / {"type":"compare","columns":["부서","실적","목표"]}';
    const englishExample = ' {"type":"compare","columns":["group","value"],"period":{"column":"year","base":"2025","target":"2026"}} / {"type":"compare","columns":["group","value","plan"]}';
    const periodMode = Object.hasOwn(spec, 'period'), cols = spec.columns;
    if (!Array.isArray(cols) || cols.length !== (periodMode ? 2 : 3) || cols.some(c => typeof c !== 'string')) fail(`compare의 열 구성이 맞지 않습니다. 예:${example}`, `Invalid compare columns. Examples:${englishExample}`);
    const p = spec.period;
    if (periodMode && (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['column', 'base', 'target'].includes(k)) || ['column', 'base', 'target'].some(k => typeof p[k] !== 'string' || !p[k].trim()))) fail(`period에는 column, base, target 문자열이 필요합니다. 예:${example}`, `period requires column, base and target strings. Example:${englishExample}`);
    const fn = spec.function ?? 'sum', sort = spec.sort ?? 'desc', limit = spec.limit ?? 60;
    if (!['sum', 'mean'].includes(fn)) fail('compare function은 sum 또는 mean이어야 합니다. 예: {"function":"mean"}', 'compare function must be sum or mean. Example: {"function":"mean"}');
    if (!AGGREGATE_SORTS.includes(sort)) fail('compare sort는 desc, asc, label, original 중 하나여야 합니다. 예: {"sort":"desc"}', 'compare sort must be desc, asc, label or original. Example: {"sort":"desc"}');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('compare limit은 1~100 정수여야 합니다. 예: {"limit":60}', 'compare limit must be an integer from 1 to 100. Example: {"limit":60}');
    if (spec.rank_by !== undefined && !['difference', 'rate', 'ratio'].includes(spec.rank_by)) fail('rank_by는 difference, rate, ratio 중 하나여야 합니다. 예: {"rank_by":"difference"}', 'rank_by must be difference, rate or ratio. Example: {"rank_by":"difference"}');
    if (spec.rank_by !== undefined && ['label', 'original'].includes(sort)) fail('label 또는 original 정렬에는 rank_by를 쓰지 마세요. 예: {"sort":"label"}', 'Do not use rank_by with label or original sorting. Example: {"sort":"label"}');
    const relative = periodMode ? 'rate' : 'ratio', rankedBy = spec.rank_by && spec.rank_by !== 'difference' ? relative : 'difference';
    const [gi, vi, ri] = cols.map(c => indexOf(dataset, c, locale));
    let rows = dataset.rows, baseKey, targetKey, pi;
    if (periodMode) {
        pi = indexOf(dataset, p.column, locale); baseKey = periodKey(p.base, { compact: true }); targetKey = periodKey(p.target, { compact: true });
        if (baseKey === targetKey) fail('base와 target은 서로 다른 기간이어야 합니다. 예: {"base":"2025","target":"2026"}', 'base and target must be different periods. Example: {"base":"2025","target":"2026"}');
        const key = row => periodKey(row[pi], { compact: true });
        const available = [...new Set(rows.map(row => row[pi].trim()))].slice(0, 20).join(', ');
        if (!rows.some(row => key(row) === baseKey) || !rows.some(row => key(row) === targetKey)) fail(`base 또는 target에 해당하는 행이 없습니다. 열의 고유값 앞 20개: ${available}. 이 값으로 period를 다시 지정하세요.`, `No rows match base or target. First 20 distinct values: ${available}. Set period to values from this list.`);
        rows = rows.filter(row => key(row) === baseKey || key(row) === targetKey);
    }
    const selected = rows.filter(row => !missing(row[gi]));
    const vf = checkedFacts(selected, vi, cols[1], locale), rf = periodMode ? null : checkedFacts(selected, ri, cols[2], locale);
    const unit = vf.units[0] || '', refUnit = rf?.units[0] || '';
    if (!periodMode && unit !== refUnit) fail(`값 열 ${cols[1]}(${unit || '단위 없음'})과 기준 열 ${cols[2]}(${refUnit || '단위 없음'})의 단위가 다릅니다. 같은 단위의 열을 쓰세요. 단위 환산은 하지 않습니다.`, `Value column ${cols[1]} (${unit || 'no unit'}) and reference column ${cols[2]} (${refUnit || 'no unit'}) have different units. Use columns with the same unit; units are not converted.`);
    const groups = new Map(); let excluded = 0, missingGroup = 0;
    for (const row of rows) {
        if (missing(row[gi])) { missingGroup++; continue; }
        const value = number(row[vi]), reference = periodMode ? null : number(row[ri]);
        if (value === null || (!periodMode && reference === null)) { excluded++; continue; }
        const name = row[gi].trim();
        if (!groups.has(name)) groups.set(name, { a: [], b: [] });
        const g = groups.get(name);
        if (periodMode) (periodKey(row[pi], { compact: true }) === baseKey ? g.a : g.b).push(value);
        else { g.a.push(value); g.b.push(reference); }
    }
    const onlyA = [], onlyB = [], common = [];
    for (const [name, g] of groups) {
        if (!g.b.length) onlyA.push(label(name)); else if (!g.a.length) onlyB.push(label(name)); else common.push({ name: label(name), ...g });
    }
    const finite = n => Number.isFinite(n) ? n : null;
    const reduce = values => fn === 'sum' ? finite(values.reduce((a, b) => a + b, 0)) : summary(values).mean ?? null;
    const result = (a, b) => {
        const difference = a === null || b === null ? null : finite(periodMode ? b - a : a - b);
        const denominator = periodMode ? a : b;
        return { ...(periodMode ? { base: a, target: b } : { value: a, reference: b }), difference, [relative]: difference === null || !denominator ? null : finite(periodMode ? difference / Math.abs(denominator) : a / denominator) };
    };
    let list = common.map(g => ({ group: g.name, ...result(reduce(g.a), reduce(g.b)) }));
    if (sort === 'label') list.sort((a, b) => compareNatural(a.group, b.group));
    else if (sort !== 'original') list.sort((a, b) => a[rankedBy] === null ? (b[rankedBy] === null ? compareText(a.group, b.group) : 1) : b[rankedBy] === null ? -1 : (sort === 'desc' ? b[rankedBy] - a[rankedBy] : a[rankedBy] - b[rankedBy]) || compareText(a.group, b.group));
    const allA = common.flatMap(g => g.a), allB = common.flatMap(g => g.b);
    const overall = { ...result(allA.length ? reduce(allA) : null, allB.length ? reduce(allB) : null), method: fn === 'sum' ? 'sum of common groups' : 'mean of rows in common groups' };
    const shown = list.slice(0, limit), notes = summaryNotes(list, cols[0], locale);
    const fields = periodMode ? ['base', 'target', 'difference', 'rate'] : ['value', 'reference', 'difference', 'ratio'];
    return { type: 'compare', mode: periodMode ? 'period' : 'reference', columns: cols, function: fn, ...(periodMode ? { period: p, ...(!baseKey.startsWith('S:') ? { baseKey } : {}), ...(!targetKey.startsWith('S:') ? { targetKey } : {}) } : {}), ...(unit ? { unit, differenceUnit: unit === '%' ? '%p' : unit } : {}), sort, rankedBy, groups: shown, groupCount: list.length, truncated: list.length > shown.length, ...(list.length > shown.length ? { returnedGroups: shown.length, limit, maxLimit: 100, note: list.length <= 100 ? `Returned the first ${shown.length} of ${list.length} groups. To see all groups, set analysis.limit to ${list.length} (maximum 100).` : `Returned the first ${shown.length} of ${list.length} groups. The maximum analysis.limit is 100; use a smaller CSV to see the remaining groups.` } : {}), overall, ...(onlyA.length ? { onlyInBase: { count: onlyA.length, names: onlyA.slice(0, 20) } } : {}), ...(onlyB.length ? { onlyInTarget: { count: onlyB.length, names: onlyB.slice(0, 20) } } : {}), excludedRows: excluded, missingGroupRows: missingGroup, chart: { labels: shown.map(g => g.group), ...Object.fromEntries(fields.map(field => [field, shown.map(g => g[field])])) }, ...(notes.length ? { notes } : {}) };
}

// Shared by analysis and CSV chart input. Never paginate or shorten cells here.
export function selectRows(dataset, filter, locale = 'en', filterName = 'analysis.filter') {
    const spec = { filter };
    let selected = dataset.rows.map((row, i) => ({ row, rowNumber: i + 1, ...(dataset.lines ? { line: dataset.lines[i] } : {}) }));
    if (spec.filter !== undefined) {
        if (!Array.isArray(spec.filter) || spec.filter.length > 4) throw new Error(`${filterName} must be an array of at most 4 conditions.`);
        const ops = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'prefix', 'contains'];
        const conditions = spec.filter.map((condition, i) => {
            const where = `${filterName} condition ${i + 1}`;
            if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw new Error(`${where} must be an object.`);
            const key = Object.keys(condition).find(k => !['column', 'op', 'value'].includes(k));
            if (key !== undefined) throw new Error(`${where} has unknown key: ${key}.`);
            if (typeof condition.column !== 'string') throw new Error(`${where} column must be a string.`);
            if (!dataset.headers.includes(condition.column)) {
                try { indexOf(dataset, condition.column, locale); }
                catch (error) { throw new Error(`${where}: ${error.message}`); }
            }
            if (!ops.includes(condition.op)) throw new Error(`${where} has unknown op: ${condition.op}; allowed: ${ops.join(', ')}.`);
            if (typeof condition.value !== 'string') throw new Error(`${where} value must be a string.`);
            return { ...condition, index: indexOf(dataset, condition.column) };
        });
        conditions.forEach(({ index, op, value }, i) => {
            const target = parseCell(value);
            if (!target?.unit || op === 'prefix' || op === 'contains') return;
            const facts = columnFacts(dataset.rows, index);
            const other = facts.units.find(unit => unit !== target.unit);
            if (other !== undefined) {
                const display = other || (locale === 'ko' ? '단위 없음' : 'no unit');
                throw new Error(locale === 'ko' ? `filter 조건 ${i + 1}: 셀 단위(${display})와 비교값 단위(${target.unit})가 다릅니다. 같은 단위로 쓰거나 단위를 빼세요.` : `filter condition ${i + 1}: cell unit (${display}) differs from comparison unit (${target.unit}). Use the same unit or omit the unit.`);
            }
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
    return selected;
}

export function analyze(dataset, spec, locale = 'ko') {
    return analyzeSource(dataset, spec, locale);
}

function analyzeSource(dataset, spec, locale, chartType, path = 'analysis') {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('analysis must be an object.');
    const allowed = { summary: ['function'], histogram: ['bins'], correlation: ['method'], aggregate: ['function', 'sort', 'limit'], compare: ['period', 'function', 'sort', 'rank_by', 'limit'], rows: ['limit', 'offset', 'sort_by', 'sort'], pivot: ['function'] };
    if (!Object.hasOwn(allowed, spec.type)) throw edaError(locale,
        `${path}.type은 ${Object.keys(allowed).join(', ')} 중 하나여야 합니다.`,
        `${path}.type must be one of ${Object.keys(allowed).join(', ')}.`);
    const keys = ['type', 'columns', 'filter', ...allowed[spec.type]];
    const invalidKey = Object.keys(spec).find(key => !keys.includes(key));
    if (invalidKey !== undefined && spec.type === 'compare') throw new Error(locale === 'ko' ? `compare에 쓸 수 없는 키: ${invalidKey}. 예: {"type":"compare","columns":["부서","실적","목표"]}` : `Unknown compare key: ${invalidKey}. Example: {"type":"compare","columns":["group","value","plan"]}`);
    if (invalidKey !== undefined) throw edaError(locale,
        `${spec.type}에 쓸 수 없는 분석 키: ${invalidKey}. 쓸 수 있는 키: ${keys.join(', ')}.`,
        `Unknown or inapplicable analysis key: ${invalidKey}. ${spec.type} accepts: ${keys.join(', ')}.`);
    if (spec.type === 'summary' && Object.hasOwn(spec, 'function') && !AGGREGATE_FUNCTIONS.includes(spec.function)) throw edaError(locale,
        'summary function은 count, sum, mean, min, max, median 중 하나를 쓰거나 생략하세요.',
        'summary function must be one of count, sum, mean, min, max, median, or omitted.');
    const cols = spec.columns;
    if (spec.type === 'compare' && (!Array.isArray(cols) || cols.length !== (Object.hasOwn(spec, 'period') ? 2 : 3) || cols.some(c => typeof c !== 'string'))) return compare(dataset, spec, locale);
    const max = ['compare', 'pivot'].includes(spec.type) ? 3 : spec.type === 'rows' || spec.type === 'summary' ? 8 : spec.type === 'aggregate' || spec.type === 'correlation' ? 2 : 1;
    const min = ['correlation', 'pivot'].includes(spec.type) ? 2 : 1;
    if (!Array.isArray(cols) || cols.length < min || cols.length > max || cols.some(c => typeof c !== 'string')) throw edaError(locale,
        `${spec.type}의 ${path}.columns에 열 이름을 ${min === max ? min : `${min}~${max}`}개 주세요.`,
        `${spec.type} needs ${min === max ? min : `${min} to ${max}`} column${max === 1 ? '' : 's'} as strings in ${path}.columns.`);
    const indexes = cols.map((column, i) => {
        if (spec.type === 'pivot' || path === 'source.analysis') {
            if (!dataset.headers.includes(column)) throw edaError(locale,
                `${path}.columns[${i}]: 모르는 열 ${column}. 예: ${JSON.stringify(dataset.headers.slice(0, cols.length))}`,
                `${path}.columns[${i}]: ${column}. Example: ${JSON.stringify(dataset.headers.slice(0, cols.length))}`);
        }
        return indexOf(dataset, column, locale);
    });
    const selected = selectRows(dataset, spec.filter, locale, `${path}.filter`);
    const matched = Object.fromEntries((spec.filter ?? []).map(({ column }) => {
        const i = indexOf(dataset, column);
        return [column, selected.length ? { first: selected[0].row[i], last: selected.at(-1).row[i], rows: selected.length } : { rows: 0 }];
    }));
    let result;
    if (spec.type === 'rows') {
        const requestedLimit = spec.limit ?? 50, offset = spec.offset ?? 0;
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 1000) throw new Error('rows limit must be an integer from 1 to 1000.');
        const limit = Math.min(requestedLimit, 100);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('rows offset must be an integer from 0 to 9007199254740991.');
        if (spec.sort !== undefined && !['asc', 'desc'].includes(spec.sort)) throw edaError(locale, 'rows sort는 asc 또는 desc여야 합니다.', 'rows sort must be asc or desc.');
        if (spec.sort !== undefined && spec.sort_by === undefined) throw new Error(locale === 'ko'
            ? `rows에서 sort를 쓰려면 sort_by에 열 이름을 함께 줄 것. 예: "sort_by":${JSON.stringify(cols[cols.length - 1])},"sort":${JSON.stringify(spec.sort)} (sort는 그대로 두고 sort_by를 더한다)`
            : `To use sort with rows, also provide a column name in sort_by. Example: "sort_by":${JSON.stringify(cols[cols.length - 1])},"sort":${JSON.stringify(spec.sort)} (keep sort as it is and add sort_by)`);
        let sortNote;
        if (spec.sort_by !== undefined) {
            if (typeof spec.sort_by !== 'string') throw edaError(locale, 'rows sort_by에 열 이름을 주세요.', 'rows sort_by must be a column name.');
            const sortIndex = indexOf(dataset, spec.sort_by, locale), direction = spec.sort ?? 'asc';
            const facts = columnFacts(selected.map(item => item.row), sortIndex);
            const numeric = facts.strictNumeric;
            if (facts.units.length > 1) sortNote = locale === 'ko' ? '단위가 섞여 문자열로 정렬했습니다' : 'Mixed units were sorted as strings';
            const parsed = new Map(selected.map((item, i) => [item, facts.parsed[i]]));
            selected.sort((a, b) => {
                const x = a.row[sortIndex], y = b.row[sortIndex];
                if (missing(x) || missing(y)) return missing(x) === missing(y) ? a.rowNumber - b.rowNumber : missing(x) ? 1 : -1;
                const comparison = numeric ? parsed.get(a) - parsed.get(b) : compareText(x.trim(), y.trim());
                return (direction === 'desc' ? -comparison : comparison) || a.rowNumber - b.rowNumber;
            });
        }
        const page = selected.slice(offset, offset + limit);
        const truncated = offset + page.length < selected.length;
        result = { type: 'rows', columns: cols, ...(spec.sort_by !== undefined ? { sortedBy: spec.sort_by, sort: spec.sort ?? 'asc', order: spec.sort === 'desc' ? 'descending (largest first)' : 'ascending (smallest first)' } : {}), ...(sortNote ? { sortNote } : {}), matchedRows: selected.length, rows: page.map(({ row, rowNumber, line }) => {
            const truncatedColumns = cols.filter((_, j) => row[indexes[j]].length > 200);
            return { rowNumber, ...(line !== undefined ? { line } : {}), values: indexes.map(i => row[i].slice(0, 200)), ...(truncatedColumns.length ? { truncatedColumns } : {}) };
        }), truncated, nextOffset: truncated ? offset + page.length : null,
        ...(requestedLimit > 100 ? { limitApplied: 100, note: locale === 'ko' ? '100행까지만 반환합니다. 이어 받으려면 offset에 nextOffset을 주세요.' : 'Returns at most 100 rows. To continue, set offset to nextOffset.' } : {}) };
    } else if (spec.type === 'pivot') {
        result = pivot({ ...dataset, rows: selected.map(item => item.row) }, spec, locale, chartType, path);
    } else {
        result = analyzeSelected({ ...dataset, rows: selected.map(item => item.row) }, spec, locale);
    }
    const scope = {};
    if (['summary', 'aggregate', 'compare', 'rows'].includes(spec.type) && spec.filter !== undefined) scope.matched = matched;
    if (spec.type === 'summary') {
        scope.shareOf = 'sum of the listed columns';
        scope.unlistedNumericColumns = dataset.headers.filter((name, i) => {
            return !cols.includes(name) && columnFacts(dataset.rows, i).strictNumeric;
        });
    }
    const note = spec.type === 'summary' && Object.hasOwn(spec, 'function') ? {
        note: locale === 'ko'
            ? 'summary는 개수, 합계, 평균, 최솟값, 최댓값, 사분위수를 함께 반환하므로 function을 생략할 수 있습니다.'
            : 'summary returns count, sum, mean, min, max and quartiles together; function is not needed.'
    } : {};
    return { ...result, ...scope, totalRows: dataset.rows.length, ...(spec.filter !== undefined ? { filter: spec.filter, filteredRows: selected.length } : {}), ...note };
}

export function validateChartSource(args, locale = 'ko') {
    checkSeriesInputs(args.series, locale);
    const fail = (ko, en) => { throw new Error(locale === 'ko' ? ko : en); };
    const source = args.source;
    if (!source || typeof source !== 'object' || Array.isArray(source) || typeof source.path !== 'string' || !source.path.trim() || Object.keys(source).some(k => !['path', 'table', 'labels', 'x', 'filter', 'sort', 'limit', 'analysis'].includes(k))) {
        fail('source는 path, table, labels, x, filter, sort, limit, analysis만 받는 객체입니다. 예: source:{path:"data.csv",labels:"month"},series:[{column:"value"}]', 'source must be an object with only path, table, labels, x, filter, sort, limit, analysis. Example: source:{path:"data.csv",labels:"month"},series:[{column:"value"}]');
    }
    if (Object.hasOwn(source, 'analysis')) {
        const forbidden = ['labels', 'x', 'sort', 'limit', 'filter'].filter(k => Object.hasOwn(source, k));
        if (forbidden.length) {
            const example = JSON.stringify({ path: source.path, ...(source.table !== undefined ? { table: source.table } : {}), analysis: source.analysis });
            if (['summary', 'pivot'].includes(source.analysis?.type)) fail(
                `source.${forbidden.join(', source.')}: source.analysis를 쓸 때는 source.analysis.filter에 조건을 주세요. 예: source:${example}`,
                `source.${forbidden.join(', source.')}: with source.analysis, put the filter in source.analysis.filter. Example: source:${example}`);
            fail(
                `source.analysis와 함께 쓸 수 없는 source 키: ${forbidden.join(', ')}. 범주는 분석 결과의 그룹에서 오고, filter·sort·limit은 analysis 안에 씁니다. 예: source:${example}`,
                `source keys cannot be combined with source.analysis: ${forbidden.join(', ')}. Categories come from the analysis groups; put filter, sort and limit inside analysis. Example: source:${example}`
            );
        }
    }
    if (source.sort !== undefined && (!source.sort || typeof source.sort !== 'object' || Array.isArray(source.sort) || typeof source.sort.column !== 'string' || !source.sort.column || Object.keys(source.sort).some(k => !['column', 'order'].includes(k)) || (source.sort.order !== undefined && !['desc', 'asc'].includes(source.sort.order)))) fail('source.sort는 column과 선택적 order(desc 또는 asc)가 필요합니다.', 'source.sort requires column and an optional order (desc or asc).');
    if (source.limit !== undefined && (!Number.isInteger(source.limit) || source.limit < 1 || source.limit > 200)) fail('source.limit은 1~200의 정수여야 합니다.', 'source.limit must be an integer from 1 to 200.');
    if (Object.hasOwn(args, 'labels') || !Array.isArray(args.series) || !args.series.length || args.series.some(s => !s || typeof s !== 'object' || ['values', 'x', 'size'].some(k => Object.hasOwn(s, k)))) {
        fail('source를 쓰면 labels 또는 series[].values/x/size 직접 배열 대신 series[].column으로 하나 이상의 계열을 주세요. 예: source:{path:"data.csv",labels:"month"},series:[{column:"value"}]', 'With source provide at least one series with column instead of labels or series[].values/x/size arrays. Example: source:{path:"data.csv",labels:"month"},series:[{column:"value"}]');
    }
    return source;
}

// Resolve trusted CSV cells into the builder's ordinary data shape.
export function resolveChartSource(dataset, args, locale = 'ko') {
    const fail = (ko, en) => { throw new Error(locale === 'ko' ? ko : en); };
    const source = validateChartSource(args, locale);
    if (Object.hasOwn(source, 'analysis')) {
        const result = resolveAnalysisSource(dataset, args, locale);
        return orderHorizontal(result, result.analysisResult?.sort !== 'original');
    }
    const points = ['scatter', 'bubble'].includes(args.type);
    const needsLabels = ['bar', 'barh', 'line', 'area', 'combo', 'pie', 'donut', 'funnel', 'treemap', 'sunburst', 'waterfall', 'heatmap', 'radar'].includes(args.type);
    const alias = needsLabels && source.labels === undefined && source.x !== undefined;
    const labelColumn = alias ? source.x : source.labels;
    if (source.x !== undefined && !points && !alias) fail('source.x는 scatter와 bubble에만 씁니다. 범주 열은 source.labels를 쓰세요.', 'source.x is only for scatter and bubble; use source.labels for categories.');
    if (args.type !== 'bubble' && args.series.some(s => s.sizeColumn !== undefined)) fail('sizeColumn은 bubble에만 씁니다.', 'sizeColumn is only for bubble.');
    let selected = selectRows(dataset, source.filter, locale, 'source.filter');
    const selectedRows = selected.map(item => item.row), units = Object.create(null);
    const selectedDataset = { ...dataset, rows: selectedRows };
    const roles = new Map();
    const role = i => {
        if (!roles.has(i)) roles.set(i, inspectColumn(dataset, i, { weeks: true }).role);
        return roles.get(i);
    };
    const example = where => {
        const categorical = dataset.headers.filter((_, i) => ['category', 'period'].includes(role(i)));
        const numeric = dataset.headers.filter((_, i) => role(i) === 'numeric');
        const demoSource = { path: source.path, ...(source.table ? { table: source.table } : {}) };
        const demoSeries = { column: numeric[points ? 1 : 0] ?? numeric[0] ?? dataset.headers[0] };
        if (needsLabels) demoSource.labels = categorical[0] ?? dataset.headers[0];
        if (points) demoSource.x = numeric[0] ?? dataset.headers[0];
        if (args.type === 'bubble') demoSeries.sizeColumn = numeric[2] ?? numeric[0] ?? dataset.headers[0];
        if (where === 'source.sort.column') {
            const orderColumn = dataset.headers.find((_, i) => role(i) === 'period') ?? numeric[0];
            if (orderColumn) demoSource.sort = { column: orderColumn };
        }
        return { categories: categorical.join(', '), input: `source:${JSON.stringify(demoSource)},series:${JSON.stringify([demoSeries])}` };
    };
    const sourceColumn = (name, where, numeric = false) => {
        if (!dataset.headers.includes(name)) {
            const { categories, input } = example(where);
            const hint = where === 'source.labels' && categories ? categories : dataset.headers.join(', ');
            if (name === undefined) fail(`${where}에 CSV 열 이름을 주세요. 열: ${hint}. 예: ${input}`, `Provide a CSV column name in ${where}. Columns: ${hint}. Example: ${input}`);
            fail(`${where}: 모르는 열 ${name}. 열: ${hint}. 예: ${input}`, `${where}: Unknown column ${name}. Columns: ${hint}. Example: ${input}`);
        }
        const i = indexOf(dataset, name, locale);
        if (numeric) {
            const facts = columnFacts(selectedRows, i);
            if (facts.invalidRows) {
                const { input } = example(where);
                fail(`${where} ${name}: 숫자가 아닌 값이 있습니다. 숫자 열을 선택하세요. 예: ${input}`, `${where} ${name}: contains non-numeric values. Choose a numeric column. Example: ${input}`);
            }
            try { checkedFacts(selectedRows, i, name, locale); }
            catch (error) { fail(`${where}: ${error.message} 예: ${example(where).input}`, `${where}: ${error.message} Example: ${example(where).input}`); }
            if (facts.units[0]) units[name] = facts.units[0];
        }
        return i;
    };
    // Validate whole filtered columns before limiting the output rows.
    const labelsIndex = needsLabels || source.labels !== undefined ? sourceColumn(labelColumn, alias ? 'source.x' : 'source.labels') : undefined;
    const xIndex = points ? sourceColumn(source.x, 'source.x', true) : undefined;
    const seriesIndexes = args.series.map((entry, i) => ({
        value: sourceColumn(entry.column, `series[${i}].column`, true),
        size: args.type === 'bubble' ? sourceColumn(entry.sizeColumn, `series[${i}].sizeColumn`, true) : undefined
    }));
    let sortOrder, valueSorted = false;
    if (source.sort) {
        const i = sourceColumn(source.sort.column, 'source.sort.column');
        const { role: sortRole, period } = inspectColumn(selectedDataset, i, { weeks: true });
        const columnKind = sortRole === 'empty' ? role(i) : sortRole;
        if (!['period', 'numeric', 'empty'].includes(columnKind)) {
            const { input } = example('source.sort.column');
            fail(`source.sort.column ${source.sort.column}: 값 순서는 숫자 열, 시간 순서는 기간 열을 쓰세요. 예: ${input}`, `source.sort.column ${source.sort.column}: use a numeric column for value order or a period column for chronological order. Example: ${input}`);
        }
        valueSorted = columnKind === 'numeric';
        if (valueSorted) sourceColumn(source.sort.column, 'source.sort.column', true);
        sortOrder = source.sort.order ?? (columnKind === 'period' ? 'asc' : 'desc');
        const direction = sortOrder === 'asc' ? 1 : -1;
        const value = row => missing(row[i]) ? null : period ? period.keyMap.get(row[i].trim()) : number(row[i]);
        selected.sort((a, b) => {
            const av = value(a.row), bv = value(b.row);
            return av === null ? (bv === null ? 0 : 1) : bv === null ? -1 : direction * (period ? compareText(av, bv) : av - bv);
        });
    }
    if (source.limit !== undefined) selected = selected.slice(0, source.limit);
    if (!selected.length || selected.length > 200) fail('source의 결과는 1~200행이어야 합니다. source.filter 또는 source.limit을 고치세요.', 'source must match 1–200 rows. Change source.filter or source.limit.');
    const column = (i, numeric = false) => selected.map(({ row }) => numeric ? number(row[i]) : row[i]);
    const resolved = { ...args };
    delete resolved.source;
    const sourceLabels = labelsIndex === undefined ? undefined : column(labelsIndex);
    if (sourceLabels && !points) resolved.labels = sourceLabels;
    if (needsLabels) checkDuplicateLabels(resolved.labels, locale);
    const x = points ? column(xIndex, true) : undefined;
    resolved.series = args.series.map(({ column: name, sizeColumn, ...rest }, i) => {
        const { value, size } = seriesIndexes[i];
        return { ...rest, values: column(value, true), ...(points ? { x } : {}), ...(size !== undefined ? { size: column(size, true) } : {}), ...(points && sourceLabels && rest.text === undefined ? { text: sourceLabels.map(label) } : {}) };
    });
    const seriesUnits = args.series.map(s => units[s.column] || '');
    for (const secondary of [false, true]) {
        const entries = args.series.filter(s => Boolean(s.secondary) === secondary);
        if (new Set(entries.map(s => units[s.column] || '')).size > 1) fail(`같은 축에 단위가 다른 계열: ${entries.map(s => `${s.column}(${units[s.column] || '단위 없음'})`).join(', ')} — 하나를 secondary로 옮기세요.`, `Series on the same axis have different units: ${entries.map(s => `${s.column}(${units[s.column] || 'no unit'})`).join(', ')}; move one to secondary.`);
    }
    if (args.unit !== undefined) for (const s of args.series) if (units[s.column] && units[s.column] !== args.unit) fail(`unit "${args.unit}"이 열 ${s.column}의 단위 "${units[s.column]}"과 다릅니다. 표시 단위만 바꾸는 환산은 하지 않습니다.`, `unit "${args.unit}" differs from column ${s.column} unit "${units[s.column]}"; units are not converted.`);
    if (args.unit === undefined && new Set(seriesUnits).size === 1 && seriesUnits[0]) resolved.unit = seriesUnits[0];
    const normalize = (s, max) => { const v = String(s).replace(/\p{Cc}/gu, ' '); return v.length > max ? `${v.slice(0, max - 1)}…` : v; };
    const axisTitle = s => normalize(withAxisUnit(s.column, units[s.column], locale), 100);
    if (!['pie', 'donut', 'treemap', 'sunburst', 'radar', 'indicator', 'funnel', 'heatmap'].includes(args.type)) {
        const key = ['barh', 'histogram'].includes(args.type) ? 'x_title' : 'y_title';
        if (!resolved[key]) resolved[key] = axisTitle(args.series.find(s => !s.secondary) || args.series[0]);
        const secondary = args.series.find(s => s.secondary);
        if (secondary && !resolved.y2_title) resolved.y2_title = axisTitle(secondary);
        if (['scatter', 'bubble'].includes(args.type) && !resolved.x_title) resolved.x_title = normalize(withAxisUnit(source.x, units[source.x], locale), 100);
    }
    const filter = source.filter?.length ? source.filter.map(f => `${f.column} ${f.op} ${f.value}`).join('; ') : '';
    const sourceCaption = normalize(`${locale === 'ko' ? '자료' : 'Source'}: ${source.path}${dataset.table ? ` ${locale === 'ko' ? '표' : 'table'} ${dataset.table.index}` : ''} · ${selected.length}${locale === 'ko' ? '행' : ' rows'}${filter ? ` · ${locale === 'ko' ? '조건' : 'filter'} ${filter}` : ''}`, 200);
    if (args.caption === undefined && ['report', 'print', 'slides'].includes(args.style)) resolved.caption = sourceCaption;
    Object.defineProperties(resolved, {
        sourceCaption: { value: sourceCaption },
        seriesUnits: { value: seriesUnits },
        beforeLimit: { value: selectedRows.length },
        sourcePointLabels: { value: points && Boolean(sourceLabels) },
        labelColumn: { value: labelColumn },
        sortOrder: { value: sortOrder },
        valueSorted: { value: valueSorted },
        normalizedArgs: { value: alias ? ['source.x → source.labels'] : [] }
    });
    if (Object.keys(units).length) Object.defineProperty(resolved, 'sourceUnits', { value: { ...units } });
    return orderHorizontal(resolved, Boolean(source.sort));
}

function orderHorizontal(resolved, ordered) {
    if (resolved.type === 'barh' && ordered) {
        const highlight = resolved.highlight;
        const key = Object.keys(highlight ?? {})[0];
        const rank = highlight?.[key];
        const ranked = resolved.series.length === 1 && Object.keys(highlight ?? {}).length === 1 && ['top', 'bottom'].includes(key) && Number.isInteger(rank) && rank >= 1 && rank <= 50;
        const selectedLabels = () => highlightIndices(highlight, resolved.labels, resolved.series[0].values).map(i => resolved.labels[i]);
        const selected = ranked ? selectedLabels() : [];
        resolved.labels.reverse();
        for (const entry of resolved.series) entry.values.reverse();
        Object.defineProperty(resolved, 'horizontalReversed', { value: true });
        // Keep the original tie-break when reversing the trace and freezing its input.
        if (selected.length && selectedLabels().some(name => !selected.includes(name))) {
            resolved.highlight = { labels: selected };
            Object.defineProperty(resolved, 'originalHighlight', { value: highlight });
        }
    }
    return resolved;
}

function resolveMatrixSource(dataset, args, locale) {
    const fail = (ko, en) => { throw edaError(locale, ko, en); };
    const spec = args.source.analysis;
    const isPivot = spec.type === 'pivot';
    const path = 'source.analysis';
    const types = isPivot ? ['bar', 'barh', 'line', 'area', 'heatmap'] : ['pie', 'donut', 'bar', 'barh', 'funnel', 'treemap', 'indicator'];
    if (!types.includes(args.type)) fail(
        `${path}.type ${spec.type}: 차트 유형은 ${types.join(', ')} 중 하나여야 합니다.`,
        `${path}.type ${spec.type}: chart type must be one of ${types.join(', ')}.`);
    const fields = isPivot || args.type === 'indicator' ? ['value'] : ['value', 'share'];
    if (args.series.length !== 1 || !fields.includes(args.series[0].column)) fail(
        `series: ${spec.type}에는 column이 ${fields.join(' 또는 ')}인 계열 하나를 주세요. 예: [{"column":"value"}]`,
        `series: ${spec.type} needs one series with column ${fields.join(' or ')}. Example: [{"column":"value"}]`);
    const { column, ...entry } = args.series[0];
    let result, labels, series, unit;
    if (isPivot) {
        result = analyzeSource(dataset, spec, locale, args.type, path);
        ({ labels, series } = result.chart);
        if (!labels.length) fail(
            `${path}.filter: 피벗에 범주가 없습니다. x와 계열 열이 비어 있지 않은 행을 고르세요.`,
            `${path}.filter: pivot returned no categories. Select rows with nonblank x and series columns.`);
        unit = result.unit ?? '';
        series = series.map(({ name, values }) => ({ ...entry, name, values, quantity: 'value' }));
    } else {
        const min = args.type === 'indicator' ? 1 : 2;
        const max = args.type === 'indicator' ? 1 : 8;
        if (!Array.isArray(spec.columns) || spec.columns.length < min || spec.columns.length > max || spec.columns.some(name => typeof name !== 'string') || new Set(spec.columns).size !== spec.columns.length) {
            const count = min === max ? min : `${min}–${max}`;
            const example = JSON.stringify(dataset.headers.slice(0, min));
            fail(`${path}.columns: summary에 서로 다른 열 이름을 ${count}개 주세요. 예: ${example}`,
                `${path}.columns: summary needs ${count} distinct columns. Example: ${example}`);
        }
        if (spec.function !== undefined) chartReduction(spec, undefined, path, locale);
        const stats = analyzeSource(dataset, spec, locale, undefined, path);
        if (stats.unitMismatch) fail(
            `${path}.columns: summary 열의 단위가 다릅니다(${stats.unitMismatch.join(', ')}). 같은 단위의 열을 고르세요.`,
            `${path}.columns: summary columns have different units (${stats.unitMismatch.join(', ')}). Select columns with the same unit.`);
        const sourceUnit = stats.unit ?? stats.units?.[spec.columns[0]] ?? '';
        const fn = chartReduction(spec, sourceUnit, path, locale);
        const values = (stats.perColumn?.map(item => item.statistics) ?? [stats.statistics]).map(row => row[fn] ?? null);
        let shares;
        if (column === 'share') {
            const total = values.reduce((sum, value) => sum + value, 0);
            if (values.some(value => value < 0) || !Number.isFinite(total) || total <= 0) fail(
                'series[0].column share는 음수가 없고 합계가 양수인 summary 값에만 쓸 수 있습니다. column을 value로 바꾸세요.',
                'series[0].column share needs nonnegative summary values with a positive total. Use column value instead.');
            shares = values.map(value => value === null ? null : value / total);
        }
        labels = spec.columns;
        series = [{ ...entry, ...(args.type === 'indicator' ? { name: entry.name ?? labels[0] } : {}), quantity: column, values: shares ? shares.map(value => value === null ? null : value * 100) : values }];
        unit = column === 'share' ? '%' : fn === 'count' ? '' : sourceUnit;
        result = { type: 'summary', columns: spec.columns, function: fn, filteredRows: stats.filteredRows ?? stats.totalRows, filter: spec.filter };
    }
    if (unit && args.unit !== undefined && args.unit !== unit) fail(
        `unit ${args.unit}은 원자료 단위 ${unit}와 다릅니다. 원자료 단위를 쓰세요.`,
        `unit ${args.unit} differs from ${unit}; use the source unit.`);
    const resolved = { ...args, series, ...(args.type === 'indicator' ? {} : { labels: [...labels] }) };
    delete resolved.source;
    if (args.type === 'treemap') resolved.parents = labels.map(() => '');
    if (unit && args.unit === undefined) resolved.unit = unit;
    if (isPivot && args.type !== 'heatmap') {
        const horizontal = args.type === 'barh';
        resolved[horizontal ? 'y_title' : 'x_title'] ??= spec.columns[0];
        resolved[horizontal ? 'x_title' : 'y_title'] ??= withAxisUnit(spec.columns[2] ?? 'Count', unit, locale);
    }
    const filter = spec.filter?.length ? ` · ${locale === 'ko' ? '조건' : 'filter'} ${spec.filter.map(f => `${f.column} ${f.op} ${f.value}`).join('; ')}` : '';
    const table = dataset.table ? ` ${locale === 'ko' ? '표' : 'table'} ${dataset.table.index}` : '';
    const sourceCaption = `${locale === 'ko' ? '자료' : 'Source'}: ${args.source.path}${table} · ${spec.type} ${spec.columns.join(' ')} ${result.function}${filter}`.replace(/\p{Cc}/gu, ' ').slice(0, 200);
    if (args.caption === undefined && ['report', 'print', 'slides'].includes(args.style)) resolved.caption = sourceCaption;
    Object.defineProperties(resolved, {
        sourceCaption: { value: sourceCaption },
        analysisResult: { value: result },
        calculatedValues: { value: true },
        labelColumn: { value: isPivot ? spec.columns[0] : '' }
    });
    return resolved;
}

function resolveAnalysisSource(dataset, args, locale) {
    const fail = (ko, en) => { throw new Error(locale === 'ko' ? ko : en); };
    const spec = args.source.analysis;
    if (['summary', 'pivot'].includes(spec?.type)) return resolveMatrixSource(dataset, args, locale);
    if (!spec || !['aggregate', 'compare'].includes(spec.type)) fail('source.analysis.type은 aggregate, compare, summary, pivot 중 하나여야 합니다.', 'source.analysis.type must be aggregate, compare, summary or pivot.');
    if (!['bar', 'barh', 'line', 'area', 'combo', 'pie', 'donut', 'funnel', 'radar', 'heatmap', 'waterfall'].includes(args.type)) fail('이 차트 유형에는 source.analysis를 쓸 수 없습니다.', 'This chart type does not support source.analysis.');
    const result = analyze(dataset, spec, locale);
    if (!result.groups.length) fail('분석 결과에 그룹이 없습니다.', 'The analysis returned no groups.');
    const labels = result.groups.map(g => g.group);
    checkDuplicateLabels(labels, locale);
    const fields = result.type === 'aggregate' ? (['sum', 'count'].includes(result.function) ? ['value', 'share'] : ['value']) : result.mode === 'period' ? ['base', 'target', 'difference', 'rate'] : ['value', 'reference', 'difference', 'ratio'];
    for (const s of args.series) if (!fields.includes(s.column)) fail(`분석 결과 필드는 ${fields.join(', ')} 중 하나여야 합니다.`, `Analysis result field must be one of: ${fields.join(', ')}.`);
    if (args.type === 'waterfall' && (result.mode !== 'period' || result.function !== 'sum' || ['%', '%p', 'pp'].includes(result.unit) || result.truncated || args.series.length !== 1 || args.series[0].column !== 'difference' || Object.hasOwn(args, 'measure'))) fail('waterfall은 더할 수 있는 증감(합계 기준, 잘리지 않은 결과)에만 씁니다. 평균이나 비율의 변화는 barh로 그리세요.', 'Use waterfall only for additive changes (sum, untruncated results). Use barh for changes in averages or ratios.');
    const unitFor = field => ['share', 'rate', 'ratio'].includes(field) ? '%' : field === 'difference' && result.unit === '%' ? '%p' : result.function === 'count' ? '' : result.unit || '';
    const names = { value: result.type === 'aggregate' && result.function === 'count' ? (locale === 'ko' ? '건수' : 'Count') : spec.columns[1] || spec.columns[0], base: spec.period?.base, target: spec.period?.target, difference: locale === 'ko' ? '증감' : 'Change', rate: locale === 'ko' ? '증감률' : 'Change rate', ratio: locale === 'ko' ? '기준 대비' : 'Ratio to reference', reference: spec.columns[2], share: locale === 'ko' ? '비중' : 'Share' };
    const normalize = (v, max) => { const s = String(v).replace(/\p{Cc}/gu, ' '); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
    const units = Object.fromEntries(fields.map(f => [f, unitFor(f)]));
    for (const secondary of [false, true]) {
        const entries = args.series.filter(s => Boolean(s.secondary) === secondary);
        if (new Set(entries.map(s => units[s.column])).size > 1) fail(`같은 축에 단위가 다른 계열: ${entries.map(s => `${s.column}(${units[s.column] || '단위 없음'})`).join(', ')} — 하나를 secondary로 옮기세요.`, `Series on the same axis have different units: ${entries.map(s => `${s.column}(${units[s.column] || 'no unit'})`).join(', ')}; move one to secondary.`);
    }
    for (const s of args.series) if (args.unit !== undefined && units[s.column] && args.unit !== units[s.column]) fail(`unit이 ${s.column}의 단위와 다릅니다.`, `unit differs from ${s.column} unit; units are not converted.`);
    const resolved = { ...args, labels, series: args.series.map(({ column, ...rest }) => ({ ...rest, name: rest.name ?? normalize(names[column], 100), quantity: ['share', 'rate', 'ratio', 'difference'].includes(column) ? column : 'value', values: result.groups.map(g => g[column] === null ? null : ['share', 'rate', 'ratio'].includes(column) ? g[column] * 100 : g[column]) })) };
    delete resolved.source;
    const seriesUnits = args.series.map(s => units[s.column]);
    if (args.unit === undefined && new Set(seriesUnits).size === 1 && seriesUnits[0]) resolved.unit = seriesUnits[0];
    const axis = s => normalize(withAxisUnit(names[s.column], units[s.column], locale), 100);
    if (!['pie', 'donut', 'radar', 'funnel', 'heatmap'].includes(args.type)) {
        const key = args.type === 'barh' ? 'x_title' : 'y_title';
        if (!resolved[key]) resolved[key] = axis(args.series.find(s => !s.secondary) || args.series[0]);
        const secondary = args.series.find(s => s.secondary);
        if (secondary && !resolved.y2_title) resolved.y2_title = axis(secondary);
    }
    const summary = `${result.type} ${result.columns.join(' ')} ${result.function}${result.period ? ` ${result.period.base}→${result.period.target}` : ''}`;
    const filter = spec.filter?.length ? spec.filter.map(f => `${f.column} ${f.op} ${f.value}`).join('; ') : '';
    const sourceCaption = normalize(`${locale === 'ko' ? '자료' : 'Source'}: ${args.source.path}${dataset.table ? ` ${locale === 'ko' ? '표' : 'table'} ${dataset.table.index}` : ''} · ${result.filteredRows ?? result.totalRows}${locale === 'ko' ? '행' : ' rows'}${filter ? ` · ${locale === 'ko' ? '조건' : 'filter'} ${filter}` : ''} · ${summary}`, 200);
    if (args.caption === undefined && ['report', 'print', 'slides'].includes(args.style)) resolved.caption = sourceCaption;
    Object.defineProperties(resolved, {
        sourceCaption: { value: sourceCaption },
        seriesUnits: { value: seriesUnits },
        analysisResult: { value: result },
        calculatedValues: { value: true },
        sourceUnits: { value: Object.fromEntries(args.series.map(s => [s.column, units[s.column]])) }
    });
    return resolved;
}

function analyzeSelected(dataset, spec, locale) {
    if (spec.type === 'compare') return compare(dataset, spec, locale);
    if (spec.type === 'aggregate') {
        if (!Array.isArray(spec.columns) || spec.columns.length < 1 || spec.columns.length > 2 || spec.columns.some(c => typeof c !== 'string')) throw new Error('aggregate needs [group column, value column].');
        if (spec.method !== undefined || spec.bins !== undefined) throw new Error('method and bins do not apply to aggregate.');
        return aggregate(dataset, spec, locale);
    }
    if ((spec.type !== 'summary' && spec.function !== undefined) || spec.sort !== undefined || spec.limit !== undefined) throw new Error('function, sort and limit apply only to aggregate.');
    const cols = spec.columns;
    if (!Array.isArray(cols) || (spec.type === 'summary' ? cols.length < 1 || cols.length > 8 : cols.length !== (spec.type === 'correlation' ? 2 : 1)) || cols.some(c => typeof c !== 'string')) throw new Error('summary needs one to eight columns; histogram needs one; correlation needs two.');
    if (spec.method !== undefined && (spec.type !== 'correlation' || spec.method !== 'pearson')) throw new Error('Only Pearson correlation is supported.');
    if (spec.bins !== undefined && (spec.type !== 'histogram' || !Number.isInteger(spec.bins) || spec.bins < 1 || spec.bins > 50)) throw new Error('Histogram bins must be an integer from 1 to 50.');
    const indexes = cols.map(c => indexOf(dataset, c));
    const facts = indexes.map((index, i) => checkedFacts(dataset.rows, index, cols[i], locale));
    if (spec.type === 'summary' && cols.length > 1) {
        const perColumn = indexes.map((index, i) => {
            const values = facts[i].parsed.filter(value => value !== null);
            const statistics = summary(values);
            if (values.length) { const sum = values.reduce((a, b) => a + b, 0); statistics.sum = Number.isFinite(sum) ? sum : null; }
            return { column: cols[i], excludedRows: dataset.rows.length - values.length, statistics };
        });
        const total = perColumn.reduce((sum, entry) => sum + (entry.statistics.sum === null ? Infinity : entry.statistics.sum ?? 0), 0);
        const mismatch = new Set(facts.map(f => f.units[0] || '')).size > 1;
        const sumTotal = !mismatch && Number.isFinite(total) ? total : null;
        const shares = mismatch ? null : perColumn.map(({ column, statistics }) => {
            const sum = statistics.sum === undefined ? 0 : statistics.sum;
            const share = sum !== null && sumTotal !== null && sumTotal !== 0 ? sum / sumTotal : null;
            return { column, sum, share: Number.isFinite(share) && share !== null ? share : null };
        });
        const units = Object.fromEntries(cols.flatMap((name, i) => facts[i].units[0] ? [[name, facts[i].units[0]]] : []));
        return { type: 'summary', columns: cols, totalRows: dataset.rows.length, perColumn, sumTotal, shareOf: 'sum of the listed columns', shares, ...(Object.keys(units).length ? { units } : {}), ...(mismatch ? { unitMismatch: cols.map((name, i) => `${name}(${facts[i].units[0] || (locale === 'ko' ? '단위 없음' : 'no unit')})`) } : {}) };
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
        return { type: 'summary', columns: cols, totalRows: dataset.rows.length, excludedRows: excluded, statistics, ...(facts[0].units[0] ? { unit: facts[0].units[0] } : {}) };
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
