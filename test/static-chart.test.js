import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStaticChart, renderStaticChart } from '../src/static-chart.js';

const source = JSON.stringify({ type: 'bar', title: '매출 비율', labels: ['Q1', 'Q2'], series: [{ name: '비율', values: [0.125, 0.42] }] });
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('static chart accepts only bounded builder inputs', () => {
    const chart = parseStaticChart(source);
    assert.deepEqual(chart.data[0].y, [0.125, 0.42]);
    for (const value of [
        '{', JSON.stringify({ type: 'bar', labels: ['x'], series: [{ values: [1] }], layout: { images: [{ source: 'https://example.test/a' }] } }),
        JSON.stringify({ type: 'bar', labels: ['bad\u0000text'], series: [{ values: [1] }] }),
        JSON.stringify({ type: 'scatter', series: [{ values: Array(2001).fill(1), x: Array(2001).fill(1) }] }),
    ]) assert.throws(() => parseStaticChart(value));
});

test('user text is encoded as literal Plotly text, including tree references', () => {
    const chart = parseStaticChart(JSON.stringify({ type: 'treemap', title: 'R&D $100', labels: ['A<B', '&lt;b&gt;'], parents: ['', 'A<B'], series: [{ name: '<img src=x>', values: [2, 2] }] }));
    assert.deepEqual(chart.data[0].labels, ['A&lt;B', '&amp;lt;b&amp;gt;']);
    assert.deepEqual(chart.data[0].parents, ['', 'A&lt;B']);
    assert.equal(chart.data[0].name, '&lt;img src=x&gt;');
    assert.equal(chart.layout.title.text, 'R&amp;D &#36;100');
});

test('render fixes size, returns PNG bytes and cleans up even after failure', async () => {
    let attached = 0, purged = 0, seen;
    const document = { body: { appendChild: () => { attached++; } }, defaultView: { setTimeout, clearTimeout, atob: value => Buffer.from(value, 'base64').toString('binary') },
        createElement: () => ({ style: {}, remove() { attached--; } }) };
    const plotly = { newPlot: async (_container, data, layout, config) => { seen = { data, layout, config }; },
        toImage: async () => `data:image/png;base64,${png.toString('base64')}`, purge: () => { purged++; } };
    const result = await renderStaticChart(source, { document, loadPlotly: async () => plotly });
    assert.deepEqual(result.bytes, Uint8Array.from(png));
    assert.deepEqual(seen.data[0].y, [0.125, 0.42]);
    assert.equal(seen.layout.width, 1000);
    assert.equal(seen.config.staticPlot, true);
    assert.equal(attached, 0);
    assert.equal(purged, 1);
    plotly.toImage = async () => { throw new Error('failure'); };
    await assert.rejects(renderStaticChart(source, { document, loadPlotly: async () => plotly }));
    assert.equal(attached, 0);
    assert.equal(purged, 2);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(renderStaticChart(source, { document, loadPlotly: async () => plotly, signal: abort.signal }));
    assert.equal(attached, 0);
});

test('hung rendering times out and abort cleans up the detached chart', async () => {
    let attached = 0, purged = 0;
    const document = { body: { appendChild: () => { attached++; } }, defaultView: { setTimeout, clearTimeout }, createElement: () => ({ style: {}, remove() { attached--; } }) };
    const plotly = { newPlot: () => new Promise(() => {}), purge: () => { purged++; } };
    await assert.rejects(renderStaticChart(source, { document, loadPlotly: async () => plotly, timeoutMs: 10 }), /timed out/);
    assert.equal(attached, 0);
    assert.equal(purged, 1);
    const abort = new AbortController();
    const pending = renderStaticChart(source, { document, loadPlotly: async () => plotly, signal: abort.signal });
    await new Promise(resolve => setTimeout(resolve, 0));
    abort.abort();
    await assert.rejects(pending);
    assert.equal(attached, 0);
    assert.equal(purged, 2);
});
