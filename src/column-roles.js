import { columnFacts } from './eda.js';
import { periodKey } from './period.js';

const PERIOD_HEADER_RE = /(?:연도|년도|연월|년월|월|주차|분기|반기|기간|일자|날짜|year|month|week|quarter|period|date)$/;
const ID_HEADER_RE = /(?:회차|차수|기수|순번|번호|no|id|코드|code)$/;

const normalizeHeader = (name = '') => String(name).toLowerCase().replace(/\s/g, '');

export function periodHeader(name = '') {
    return PERIOD_HEADER_RE.test(normalizeHeader(name));
}

export function isIdentifierHeader(name = '') {
    return ID_HEADER_RE.test(normalizeHeader(name));
}

export function inspectColumn(dataset, index, { weeks = true } = {}) {
    const name = dataset.headers[index] ?? '';
    const rows = dataset.rows;
    const rawValues = [];
    const seen = new Map();
    for (const row of rows) {
        const value = row[index]?.trim() ?? '';
        if (!value) continue;
        rawValues.push(value);
        seen.set(value, (seen.get(value) || 0) + 1);
    }
    const distinctValues = [...seen.keys()];
    if (!rawValues.length) {
        return {
            name, role: 'empty', unit: '', distinct: 0, distinctValues,
            missingRows: rows.length, facts: columnFacts(rows, index),
            isIdentifier: false, period: null
        };
    }
    const facts = columnFacts(rows, index);
    const hasPeriodHeader = periodHeader(name);
    const identifier = isIdentifierHeader(name) || facts.leadingZeros;
    if (identifier) {
        return {
            name, role: 'category', unit: '', distinct: distinctValues.length, distinctValues,
            missingRows: facts.missingRows, facts, isIdentifier: true, period: null
        };
    }

    // Check period classification (S1 + S1' + R4).
    const keyMap = new Map();
    const keyToRaws = new Map();
    let allPeriod = true;
    let unitKind = null;
    let hasYear = false;
    let hasNoYear = false;
    for (const value of distinctValues) {
        if (!hasPeriodHeader && /^\d+$/.test(value)) {
            allPeriod = false;
            break;
        }
        const key = periodKey(value, { compact: hasPeriodHeader, weeks });
        if (key.startsWith('S:')) {
            allPeriod = false;
            break;
        }
        const kind = key[0];
        if (unitKind === null) unitKind = kind;
        else if (unitKind !== kind) {
            allPeriod = false;
            break;
        }
        const yearKnown = key[1] !== '?';
        if (yearKnown) hasYear = true;
        else hasNoYear = true;
        keyMap.set(value, key);
        if (!keyToRaws.has(key)) keyToRaws.set(key, []);
        keyToRaws.get(key).push(value);
    }

    const mixedYear = allPeriod && hasYear && hasNoYear;
    const validPeriod = allPeriod && !mixedYear && (hasPeriodHeader || hasYear);
    let mixedNotation = null;
    if (allPeriod) {
        for (const raws of keyToRaws.values()) {
            if (raws.length > 1) {
                mixedNotation = raws.slice(0, 2);
                break;
            }
        }
    }

    if (validPeriod) {
        return {
            name, role: 'period', unit: '', distinct: distinctValues.length, distinctValues,
            missingRows: facts.missingRows, facts, isIdentifier: false,
            period: { unit: unitKind, hasYear, mixedYear: false, mixedNotation, keyMap, keyToRaws }
        };
    }

    if (facts.strictNumeric) {
        return {
            name, role: 'numeric', unit: facts.units[0] || '', distinct: distinctValues.length, distinctValues,
            missingRows: facts.missingRows, facts, isIdentifier: false, period: null
        };
    }

    return {
        name, role: 'category', unit: '', distinct: distinctValues.length, distinctValues,
        missingRows: facts.missingRows, facts, isIdentifier: false,
        period: mixedYear ? { unit: unitKind, hasYear: false, mixedYear: true, mixedNotation, keyMap, keyToRaws } : null
    };
}

export function columnRole(dataset, index) {
    return inspectColumn(dataset, index).role;
}
