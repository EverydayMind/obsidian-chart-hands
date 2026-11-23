import { periodKey } from './period.js';
import { periodHeader, isIdentifierHeader } from './column-roles.js';

// Numeric display shared by chart facts and visible value labels.
const CURRENCY = new Set(['₩', '$', '€', '£', '¥']);
const SPACED_UNIT_RE = /^(?!kg$|km$)[A-Za-z]{2,}$/;

export function joinUnit(number, unit = '') {
    if (!unit) return String(number);
    if (CURRENCY.has(unit) || unit === '&#36;') return `${unit}${number}`;
    const scaled = /^([₩$€£¥])(.+)$/.exec(unit);
    if (scaled) return `${scaled[1]}${number}${scaled[2]}`;
    return SPACED_UNIT_RE.test(unit) ? `${number} ${unit}` : `${number}${unit}`;
}

export function formatNumber(value, decimals) {
    const [coefficient, exponent = '0'] = String(Math.abs(value)).split('e');
    const shifted = Number(`${coefficient}e${Number(exponent) + decimals}`);
    const rounded = Number(`${Math.round(shifted)}e-${decimals}`);
    const formatted = rounded.toLocaleString('en-US', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true
    });
    return value < 0 && rounded !== 0 ? `−${formatted}` : formatted;
}

function baseDecimals(values) {
    const maxAbs = Math.max(0, ...values.map(Math.abs));
    return values.every(Number.isInteger) || maxAbs >= 100 ? 0 : maxAbs >= 1 ? 1 : 3;
}

export function displayGroup(values, { unit = '', quantity = 'value', target } = {}) {
    const all = [...values, ...(Number.isFinite(target) ? [target] : [])].filter(Number.isFinite);
    const base = baseDecimals(all);
    let decimals = base;
    const collisions = d => {
        const found = new Set();
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
            if (all[i] !== all[j] && formatNumber(all[i], d) === formatNumber(all[j], d)) {
                found.add(all[i]); found.add(all[j]);
            }
        }
        return found;
    };
    while (decimals < base + 3 && collisions(decimals).size) decimals++;
    const fallback = collisions(decimals);
    const displayUnit = quantity === 'difference' && unit === '%' ? '%p' : unit;
    const render = value => {
        if (!Number.isFinite(value)) return null;
        let number = fallback.has(value) ? String(value).replace(/^-/, '−') : formatNumber(value, decimals);
        if (quantity === 'difference' && value > 0 && Number(number.replace(/,/g, '')) !== 0) number = `+${number}`;
        return joinUnit(number, displayUnit);
    };
    return { decimals, strings: values.map(render), ...(Number.isFinite(target) ? { targetString: render(target) } : {}) };
}

const ADDITIVE_UNITS = new Set([
    '원', '천원', '만원', '백만원', '억원', '조원', '달러', ...CURRENCY, '건', '개', '회', '곳', '개소', '톤', 'kg',
    'K', 'k', 'M', 'B', 'bn', 'mn', 'thousand', 'million', 'billion',
    'USD', 'EUR', 'KRW', 'JPY', 'GBP',
    'pcs', 'units', 'people', 'cases', 'items',
    ...[...CURRENCY].flatMap(c => ['K', 'k', 'M', 'B', 'bn', 'mn', ' thousand', ' million', ' billion'].map(s => c + s))
]);
const SINGLE = ['pie', 'donut', 'treemap', 'sunburst', 'waterfall', 'indicator'];
const ADDITIVE_TYPES = ['bar', 'barh', 'line', 'area', 'combo', 'pie', 'donut', 'funnel'];
const valid = Number.isFinite;
const countText = value => formatNumber(value, 0);

export { periodHeader as isPeriodHeader } from './column-roles.js';

export function periodColumnKeys(labels, header = '') {
    const compact = periodHeader(header);
    if (isIdentifierHeader(header)) return null;
    const keys = labels.map(label => {
        const value = String(label).trim();
        if (!compact && /^\d+$/.test(value)) return '';
        const key = periodKey(value, { compact });
        return /^[YMDQH]\d{4}(?:-|$)/.test(key) && +key.slice(1, 5) >= 1900 && +key.slice(1, 5) <= 2100 ? key : '';
    });
    return keys.length && keys.every(key => key && key[0] === keys[0][0]) ? keys : null;
}

export function highlightIndices(highlight, labels, values, target) {
    const key = Object.keys(highlight)[0];
    if (key === 'labels') return labels.flatMap((label, i) => highlight.labels.includes(label) ? [i] : []);
    const indices = values.flatMap((value, i) => valid(value) ? [i] : []);
    if (key === 'top' || key === 'bottom') {
        const direction = key === 'top' ? -1 : 1;
        return indices.sort((a, b) => direction * (values[a] - values[b]) || a - b).slice(0, highlight[key]);
    }
    return indices.filter(i => key === 'above_target' ? values[i] >= target.value : values[i] < target.value);
}

// One precision per axis or color scale. Render each quantity with its own sign and unit.
export function chartDisplay(args) {
    const series = SINGLE.includes(args.type) ? args.series.slice(0, 1) : args.series;
    const units = args.seriesUnits;
    const targetIndex = args.target?.series ?? 0;
    const result = [];
    for (const secondary of [false, true]) {
        const members = series.flatMap((entry, i) => Boolean(entry.secondary) === secondary ? [i] : []);
        if (!members.length) continue;
        const values = members.flatMap(i => series[i].values);
        const target = members.includes(targetIndex) ? args.target?.value : undefined;
        const formatted = groupedDisplay(values, target);
        let offset = 0;
        for (const i of members) {
            const { quantity = 'value', values } = series[i];
            const unit = units?.[i] || args.unit || '';
            const strings = values.map((value, j) => withUnit(formatted.strings[offset + j], value, unit, quantity));
            const targetString = i === targetIndex ? withUnit(formatted.targetString, target, unit, 'value') : undefined;
            result[i] = { unit, quantity, strings, ...(targetString !== undefined ? { targetString } : {}) };
            offset += values.length;
        }
    }
    return result;
}

function withUnit(string, value, unit = '', quantity) {
    if (string == null) return string;
    const number = (quantity === 'difference' || quantity === 'rate') && value > 0 && +string.replace(/,/g, '') !== 0 ? `+${string}` : string;
    return joinUnit(number, quantity === 'difference' && unit === '%' ? '%p' : unit);
}

function groupedDisplay(values, target) {
    const unique = [...new Set([...values, target].filter(valid))];
    // For a large axis, find equal displays by lookup to avoid formatting every pair.
    if (unique.length <= 24) {
        const result = displayGroup(unique, { target });
        const byValue = new Map(unique.map((value, i) => [value, result.strings[i]]));
        return { strings: values.map(value => byValue.get(value) ?? null), targetString: result.targetString };
    }
    const base = baseDecimals(unique);
    let strings, collisions;
    for (let decimals = base; decimals <= base + 3; decimals++) {
        strings = new Map(unique.map(value => [value, formatNumber(value, decimals)]));
        const seen = new Map();
        collisions = new Set();
        for (const [value, string] of strings) {
            if (seen.has(string)) { collisions.add(value); collisions.add(seen.get(string)); }
            else seen.set(string, value);
        }
        if (!collisions.size) break;
    }
    for (const value of collisions) strings.set(value, String(value).replace(/^-/, '−'));
    return { strings: values.map(value => strings.get(value) ?? null), targetString: strings.get(target) };
}

function displayValues(values, unit, quantity = 'value') {
    return groupedDisplay(values).strings.map((string, i) => withUnit(string, values[i], unit, quantity));
}

function extrema(items) {
    if (!items.length) return {};
    return {
        max: items.reduce((a, b) => b.value > a.value ? b : a),
        min: items.reduce((a, b) => b.value < a.value ? b : a)
    };
}

function statistics(values, unit) {
    if (!values.length) return {};
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const fields = { min: sorted[0], median: sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2, max: sorted.at(-1), mean: values.reduce((sum, value) => sum + value / values.length, 0) };
    const strings = displayValues(Object.values(fields), unit);
    return { ...fields, display: Object.fromEntries(Object.keys(fields).map((key, i) => [key, strings[i]])) };
}

const delta = (value, unit) => ({ value: valid(value) ? value : null, display: displayValues([value], unit, 'difference')[0] });

function perLabel(entry, labels, scope, presentation, options) {
    const { unit, quantity, strings, targetString } = presentation;
    const items = entry.values.flatMap((value, i) => valid(value) ? [{ label: labels[i], value, display: strings[i] }] : []);
    const nulls = scope.shown - items.length;
    const result = { scope, count: items.length, nulls, display: { count: countText(items.length), nulls: countText(nulls) }, ...extrema(items) };
    if (options.additive && quantity === 'value' && ADDITIVE_UNITS.has(unit) && items.length) {
        const sum = items.reduce((total, item) => total + item.value, 0);
        if (valid(sum)) { result.sumOfShown = sum; result.display.sumOfShown = displayValues([sum], unit)[0]; }
    }
    if (options.ordered && items.length) {
        result.first = items[0];
        result.last = items.at(-1);
        if (items.length > 1) {
            const indices = entry.values.flatMap((value, i) => valid(value) ? [i] : []);
            const previous = items.at(-2), difference = result.last.value - previous.value;
            const skippedNulls = scope.shown - indices.at(-2) - 2;
            result.change = { from: previous.label, to: result.last.label, ...delta(difference, unit), skippedNulls, skippedNullsDisplay: countText(skippedNulls) };
        }
    }
    if (options.target !== undefined) {
        const below = items.filter(item => item.value < options.target).length;
        const atOrAbove = items.length - below;
        result.target = { value: options.target, display: targetString, atOrAbove, below, atOrAboveDisplay: countText(atOrAbove), belowDisplay: countText(below) };
        if (result.last) result.target.lastGap = delta(result.last.value - options.target, unit);
    }
    return result;
}

export function chartFacts(args, meta = {}) {
    const { type } = args;
    const labels = (args.labels ?? []).map(String);
    const analysis = meta.analysis ?? args.analysisResult;
    const labelColumn = meta.labelColumn ?? analysis?.columns[0] ?? '';
    const beforeLimit = analysis?.groupCount ?? meta.beforeLimit;
    const common = analysis?.type === 'compare' ? analysis.groupCount : undefined;
    const scope = (shown, valid) => ({ shown, valid, ...(beforeLimit !== undefined ? { beforeLimit } : {}), ...(common !== undefined ? { common } : {}) });
    const facts = { type, place: /기관|부서|지역|시도|시군구|기관명|청|과/.test(labelColumn) };
    const displays = meta.displays ?? (['scatter', 'bubble', 'histogram', 'box', 'violin'].includes(type) ? [] : chartDisplay(args));
    const targetIndex = args.target?.series ?? 0;
    const entries = SINGLE.includes(type) ? args.series.slice(0, 1) : args.series;
    if (type === 'heatmap') {
        const cells = entries.flatMap((entry, row) => entry.values.flatMap((value, col) => valid(value) ? [{ row: entry.name || `Row ${row + 1}`, label: labels[col], value, display: displays[row].strings[col] }] : []));
        facts.scope = { ...scope(labels.length, cells.length), cells: labels.length * entries.length };
        Object.assign(facts, extrema(cells));
    } else if (type === 'indicator') {
        const [value, reference] = entries[0].values;
        facts.scope = scope(1, Number(valid(value)));
        const unit = displays[0].unit;
        facts.value = value;
        facts.display = { value: displays[0].strings[0] };
        if (reference !== undefined) {
            const difference = valid(value) && valid(reference) && valid(value - reference) ? value - reference : null;
            const ratio = valid(value) && reference && valid(value / reference) ? value / reference : null;
            Object.assign(facts, { reference, difference, ratio });
            Object.assign(facts.display, { reference: displays[0].strings[1], difference: delta(difference, unit).display, ratio: displayValues([ratio === null ? null : ratio * 100], '%')[0] });
        }
    } else {
        const keys = meta.valueSorted || (analysis && !['label', 'original'].includes(analysis.sort)) ? null : periodColumnKeys(labels, labelColumn);
        const ordered = keys?.every((key, i) => i === 0 || key > keys[i - 1]);
        const additive = ADDITIVE_TYPES.includes(type) && (analysis ? analysis.type === 'aggregate' && ['sum', 'count'].includes(analysis.function) : meta.beforeLimit !== undefined);
        const indices = entries.length > 3 && targetIndex >= 3 ? [0, 1, targetIndex] : entries.slice(0, 3).map((_, i) => i);
        facts.series = indices.map(i => {
            const entry = entries[i], unit = args.seriesUnits?.[i] || args.unit || '';
            const info = { index: i, ...(entry.name ? { name: entry.name } : {}), unit, quantity: entry.quantity ?? 'value' };
            if (['scatter', 'bubble'].includes(type)) {
                const pairs = entry.values.flatMap((y, j) => valid(y) && valid(entry.x[j]) && (type !== 'bubble' || valid(entry.size[j])) ? [[entry.x[j], y]] : []);
                const range = (axis, unit) => {
                    const values = pairs.map(pair => pair[axis]);
                    const [min, max] = [Math.min(...values), Math.max(...values)];
                    const [low, high] = displayValues([min, max], unit);
                    return { min, max, display: { min: low, max: high } };
                };
                return { ...info, scope: scope(entry.values.length, pairs.length), count: pairs.length, display: { count: countText(pairs.length) }, ...(pairs.length ? { x: range(0, meta.xUnit), y: range(1, unit) } : {}) };
            }
            const values = entry.values.filter(valid);
            const ownScope = scope(entry.values.length, values.length);
            if (['histogram', 'box', 'violin'].includes(type)) {
                const { display, ...stats } = statistics(values, unit);
                return { ...info, scope: ownScope, count: values.length, ...stats, display: { ...display, count: countText(values.length) } };
            }
            const fact = perLabel(entry, labels, ownScope, displays[i], { ordered, additive, target: i === targetIndex ? args.target?.value : undefined });
            return { ...info, ...fact };
        });
        facts.scope = facts.series.find(series => series.index === targetIndex).scope;
    }
    if (args.highlight) {
        const index = type === 'combo' ? entries.findIndex((entry, i) => (entry.kind ?? (i === 0 ? 'bar' : 'line')) === 'bar') : 0;
        facts.highlighted = highlightIndices(args.highlight, labels, entries[index].values, args.target).map(i => labels[i]);
        facts.highlight = Object.keys(args.highlight)[0];
    }
    if (analysis?.type === 'compare') Object.assign(facts, compareFacts(analysis));
    return facts;
}

function compareFacts(analysis) {
    const { overall, mode, period, groupCount, unit } = analysis;
    const valueKeys = mode === 'period' ? ['base', 'target'] : ['value', 'reference'];
    const displays = displayValues(valueKeys.map(key => overall[key]), unit);
    const relative = mode === 'period' ? 'rate' : 'ratio';
    const percent = overall[relative] * 100;
    const relativeDisplay = valid(overall[relative]) && valid(percent)
        ? (relative === 'ratio' ? `${formatNumber(percent, 1)}%` : displayValues([percent], '%', 'rate')[0]) : null;
    return {
        compare: { mode, ...(period ? { period } : {}), overall: {
            ...overall, scope: 'common', display: {
                ...Object.fromEntries(valueKeys.map((key, i) => [key, displays[i]])),
                difference: delta(overall.difference, unit).display, [relative]: relativeDisplay
            }
        } },
        ...Object.fromEntries(['onlyInBase', 'onlyInTarget'].filter(key => analysis[key]).map(key => [key, { count: analysis[key].count, names: analysis[key].names.slice(0, 3) }])),
        ...(analysis.excludedRows ? { excludedRows: analysis.excludedRows } : {}),
        common: groupCount
    };
}

export function analysisPresentation(result, locale) {
    const fields = result.type === 'compare'
        ? result.mode === 'period' ? ['base', 'target', 'difference', 'rate'] : ['value', 'reference', 'difference', 'ratio']
        : ['value', ...(result.function === 'sum' || result.function === 'count' ? ['share'] : []), ...(['label', 'original'].includes(result.sort) ? ['change', 'changeRate'] : [])];
    const relative = ['share', 'rate', 'ratio', 'changeRate'];
    const signed = ['difference', 'change', 'rate', 'changeRate'];
    const values = field => result.groups.map(group => valid(group[field]) ? group[field] * (relative.includes(field) ? 100 : 1) : null);
    const labels = result.groups.map(group => group.group);
    const paired = fields.filter(field => !relative.includes(field) && !signed.includes(field));
    const commonDisplay = displayValues(paired.flatMap(values), result.unit);
    const display = Object.fromEntries(fields.map(field => {
        if (paired.includes(field)) {
            const start = paired.indexOf(field) * labels.length;
            return [field, commonDisplay.slice(start, start + labels.length)];
        }
        const percent = relative.includes(field);
        const unit = percent ? '%' : result.unit === '%' && signed.includes(field) ? '%p' : result.unit;
        const quantity = signed.includes(field) ? percent ? 'rate' : 'difference' : 'value';
        return [field, displayValues(values(field), unit, quantity)];
    }));
    const field = result.type === 'aggregate' || result.mode === 'reference' ? 'value' : 'target';
    const entry = { values: values(field) };
    const presentation = { unit: result.unit, quantity: 'value', strings: display[field] };
    const facts = chartFacts({ type: 'bar', unit: result.unit, labels, series: [entry] }, { analysis: result, displays: [presentation] });
    if (result.type === 'aggregate' && result.excludedRows) facts.excludedRows = result.excludedRows;
    return { display, factLines: factLines(facts, locale) };
}

function wording(facts, locale) {
    const ko = locale === 'ko';
    const countUnit = ko ? facts.place ? '곳' : '항목' : ' items';
    const number = n => `${countText(n)}${countUnit}`;
    const series = facts.series?.find(item => item.target) ?? facts.series?.[0];
    const { shown, valid, cells } = series?.scope ?? facts.scope;
    const count = cells ?? shown;
    const scope = ko
        ? cells === undefined ? `표시 ${number(count)} 중 유효 ${number(valid)}` : `표시 ${countText(count)}칸 중 유효 ${countText(valid)}칸`
        : cells === undefined ? `${number(count)} shown, ${number(valid)} valid` : `${countText(count)} cells shown, ${countText(valid)} valid`;
    const commonScope = facts.compare?.mode === 'period'
        ? (ko ? `양 기간 공통 ${number(facts.common)}` : `${number(facts.common)} common to both periods`)
        : (ko ? `공통 ${number(facts.common ?? 0)}` : `${number(facts.common ?? 0)} with both values`);
    return { ko, series, number, scope, commonScope, scoped: (line, common = false) => `${line} · ${common ? commonScope : scope}` };
}

function compareLine(facts, ko) {
    if (!facts.compare) return undefined;
    const { mode, period, overall: { display } } = facts.compare;
    if (mode === 'period' && display.target && display.base && display.difference) {
        const rate = display.rate ? ` (${display.rate})` : '';
        return ko ? `${period.target} ${display.target}, ${period.base} 대비 ${display.difference}${rate}` : `${period.target} ${display.target}, ${display.difference} vs ${period.base}${rate}`;
    }
    if (mode === 'reference' && display.ratio && display.difference) {
        return ko ? `기준 대비 ${display.ratio}, 차이 ${display.difference}` : `${display.ratio} of reference, difference ${display.difference}`;
    }
    return undefined;
}

function targetLine(series, ko, number) {
    const target = series?.target;
    if (!target || !series.count) return undefined;
    if (target.lastGap?.display) return ko
        ? `${series.last.label} ${series.last.display}, 목표 ${target.display} 대비 ${target.lastGap.display}`
        : `${series.last.label} ${series.last.display}, ${target.lastGap.display} vs target ${target.display}`;
    return ko ? `목표 ${target.display} 미달 ${target.belowDisplay}/${number(series.count)}`
        : `${target.belowDisplay}/${number(series.count)} below target ${target.display}`;
}

function rankLine(facts, ko, number) {
    if (!facts.highlighted?.length || !['bottom', 'top'].includes(facts.highlight)) return undefined;
    const labels = facts.highlighted.slice(0, 3).join(', ');
    const count = number(facts.highlighted.length);
    return ko ? `${labels} ${facts.highlight === 'bottom' ? '하위' : '상위'} ${count}`
        : `${facts.highlight === 'bottom' ? 'Bottom' : 'Top'} ${count}: ${labels}`;
}

function ro(text) {
    const value = String(text ?? '').trim();
    if (!value || /%p?$/.test(value)) return '로';
    const last = value.at(-1);
    if (/[0-9]/.test(last)) return /[036]/.test(last) ? '으로' : '로';
    const code = last.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
        const jong = (code - 0xAC00) % 28;
        return jong === 0 || jong === 8 ? '로' : '으로';
    }
    return '로';
}

export function titleDraft(facts, locale = 'ko') {
    const { ko, series, number, scoped } = wording(facts, locale);
    const target = targetLine(series, ko, number);
    if (target) return scoped(target);
    const compare = compareLine(facts, ko);
    if (compare) return scoped(compare, true);
    if (series?.count && facts.highlighted?.length) {
        const rank = rankLine(facts, ko, number);
        if (rank) return scoped(`${rank} (${ko ? `실제 강조 ${number(facts.highlighted.length)}` : `${number(facts.highlighted.length)} highlighted`})`);
        if (facts.highlight === 'labels') {
            const picked = facts.highlighted.slice(0, 3).join(', ');
            return scoped(ko ? `강조: ${picked}` : `Highlighted: ${picked}`);
        }
    }
    if (series?.change?.display) {
        const { first, last, change } = series;
        return scoped(`${first.label}~${last.label} ${first.display}→${last.display}, ${change.from}→${change.to} ${change.display}`);
    }
    const max = series?.max ?? facts.max;
    if (max && typeof max === 'object') return scoped(ko ? `${max.row ? `${max.row} · ` : ''}${max.label} ${max.display}${ro(max.display)} 가장 큼` : `${max.row ? `${max.row} · ` : ''}${max.label} highest at ${max.display}`);
    return undefined;
}

export function factLines(facts, locale = 'ko') {
    const { ko, series, number, scoped } = wording(facts, locale);
    const lines = [];
    const target = targetLine(series, ko, number);
    if (target) lines.push(scoped(target));
    const compare = compareLine(facts, ko);
    if (compare) lines.push(scoped(compare, true));
    if (facts.onlyInBase || facts.onlyInTarget) {
        const only = [facts.onlyInBase, facts.onlyInTarget].filter(Boolean);
        const count = number(only.reduce((sum, item) => sum + item.count, 0));
        const names = only.flatMap(item => item.names).slice(0, 3).join(', ');
        lines.push(scoped(ko ? `한쪽 기간에만 있어 비교에서 제외: ${count} (${names})` : `Excluded from comparison, present in one period: ${count} (${names})`, true));
    }
    if (facts.excludedRows) lines.push(scoped(ko ? `유효한 값이 없어 제외한 행: ${countText(facts.excludedRows)}행` : `Rows excluded for missing or nonnumeric values: ${countText(facts.excludedRows)}`, Boolean(facts.compare)));
    if (facts.highlighted?.length) {
        const count = number(facts.highlighted.length);
        const rank = rankLine(facts, ko, number);
        lines.push(scoped(`${ko ? `실제 강조 ${count}` : `${count} highlighted`}: ${rank ?? facts.highlighted.slice(0, 3).join(', ')}`));
    }
    if (series?.change?.display) lines.push(scoped(`${series.change.from}→${series.change.to} ${series.change.display}`));
    for (const [key, label] of [['max', ko ? '최댓값' : 'Maximum'], ['min', ko ? '최솟값' : 'Minimum']]) {
        const item = series?.[key] ?? facts[key];
        if (item && typeof item === 'object') lines.push(scoped(`${label}: ${item.row ? `${item.row} · ` : ''}${item.label} ${item.display}`));
    }
    if (series?.display?.sumOfShown) lines.push(scoped(`${ko ? '표시값 합계' : 'Sum of shown values'}: ${series.display.sumOfShown}`));
    if (series?.display?.median) lines.push(scoped(ko
        ? `최솟값 ${series.display.min}, 중앙값 ${series.display.median}, 최댓값 ${series.display.max}, 평균 ${series.display.mean}`
        : `Minimum ${series.display.min}, median ${series.display.median}, maximum ${series.display.max}, mean ${series.display.mean}`));
    if (series?.x) lines.push(scoped(`${ko ? '좌표 범위' : 'Coordinate ranges'}: x ${series.x.display.min}~${series.x.display.max}, y ${series.y.display.min}~${series.y.display.max}`));
    if (facts.type === 'indicator' && facts.display.value) {
        const { value, reference, difference, ratio } = facts.display;
        const parts = [`${ko ? '지표값' : 'Indicator value'} ${value}`];
        if (reference) parts.push(`${ko ? '기준값' : 'Reference'} ${reference}`);
        if (difference) parts.push(`${ko ? '차이' : 'Difference'} ${difference}`);
        if (ratio) parts.push(`${ko ? '기준 대비' : 'Ratio to reference'} ${ratio}`);
        lines.push(scoped(parts.join(', ')));
    }
    return lines.slice(0, 5).map(line => line.replace(/\p{Cc}/gu, ' '));
}
