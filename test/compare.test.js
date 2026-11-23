import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodKey } from '../src/period.js';
import { analyze, parseDataset } from '../src/eda.js';

test('period keys normalize valid calendar forms', () => {
    for (const [key, values] of Object.entries({ Y2026: ['2026'], 'M2026-01': ['2026-01', '2026-1', '2026.1', '2026.01', '2026/01', '2026년 1월', '2026년1월'], 'D2026-01-05': ['2026-01-05', '2026.1.5', '2026/01/05', '2026년 1월 5일'], 'Q2026-1': ['2026 Q1', '2026-Q1', '2026Q1', '2026년 1분기', 'Q1 2026'], 'Q?-1': ['Q1', '1분기'], 'M?-01': ['1월'], 'H2026-1': ['2026 상반기', '2026년 상반기'], 'H?-2': ['하반기'] })) for (const value of values) assert.equal(periodKey(value), key);
    assert.notEqual(periodKey('2026.1'), periodKey('2026.10'));
    assert.equal(periodKey('2025-02-29'), 'S:2025-02-29');
    assert.equal(periodKey('2024-02-29'), 'D2024-02-29');
    for (const [value, key] of [['202601', 'M2026-01'], ['20260105', 'D2026-01-05']]) { assert.equal(periodKey(value), `S:${value}`); assert.equal(periodKey(value, { compact: true }), key); }
    for (const [key, values] of Object.entries({
        'M2025-01': ['Jan 2025', 'January 2025', 'Jan. 2025', 'Jan-2025', '2025 Jan'],
        'M?-01': ['Jan', 'January', 'Jan.'],
        'M?-09': ['Sep', 'Sept', 'September'],
        'H2025-1': ['H1 2025', '2025 H1', '2025-H1'],
        'H?-1': ['H1'],
        'H?-2': ['H2']
    })) for (const value of values) assert.equal(periodKey(value), key, value);
    assert.equal(periodKey('FY2025'), 'S:FY2025');
});
test('period comparison uses common rows, handles absent groups and truncation', () => {
    const ds = parseDataset('g,p,v\nA,2025,10\nA,2025,20\nA,2026,40\nB,2025,0\nB,2026,10\nC,2025,5\nD,2026,8\n,2026,3\nE,2026,x');
    const spec = { type: 'compare', columns: ['g', 'v'], period: { column: 'p', base: '2025', target: '2026' } };
    const r = analyze(ds, spec, 'en');
    assert.deepEqual(r.onlyInBase, { count: 1, names: ['C'] }); assert.deepEqual(r.onlyInTarget, { count: 1, names: ['D'] });
    assert.equal(r.overall.base, 30); assert.equal(r.overall.target, 50); assert.equal(r.groups.at(-1).rate, null);
    assert.equal(r.missingGroupRows, 1); assert.equal(r.excludedRows, 1);
    const mean = analyze(ds, { ...spec, function: 'mean', rank_by: 'ratio', limit: 1 }, 'en');
    assert.equal(mean.overall.base, 10); assert.equal(mean.overall.target, 25); assert.equal(mean.rankedBy, 'rate'); assert.equal(mean.truncated, true);
    assert.throws(() => analyze(ds, { ...spec, columns: ['g'] }, 'en'), /Examples/);
    assert.throws(() => analyze(ds, { type: 'compare', columns: ['g', 'v'] }, 'en'), /Examples/);
    assert.throws(() => analyze(ds, { ...spec, period: { ...spec.period, base: '2026.1', target: '2026-01' } }, 'en'), /different periods/);
    assert.throws(() => analyze(ds, { ...spec, period: { ...spec.period, base: '2020' } }, 'en'), /2025, 2026/);
    assert.throws(() => analyze(ds, { ...spec, sort: 'label', rank_by: 'rate' }, 'en'), /rank_by/);
});
test('reference comparison excludes incomplete pairs and checks units', () => {
    const ds = parseDataset('g,v,r\nA,80%,100%\nB,10%,0\nC,,10%\nD,10%,\n합계,90%,100%');
    const spec = { type: 'compare', columns: ['g', 'v', 'r'], rank_by: 'rate' };
    const r = analyze(ds, spec, 'en');
    assert.equal(r.rankedBy, 'ratio'); assert.equal(r.differenceUnit, '%p'); assert.equal(r.excludedRows, 2); assert.equal(r.groups.at(-1).ratio, null); assert.ok(r.notes.length);
    assert.throws(() => analyze(parseDataset('g,v,r\nA,1원,2명'), spec, 'en'), /different units/);
    assert.ok(analyze(ds, { type: 'aggregate', columns: ['g', 'v'] }, 'en').notes.length);
});
