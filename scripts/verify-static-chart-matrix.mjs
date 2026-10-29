// Synthetic, CSP-isolated Edge probe for every builder type. Evidence stays under node_modules/.cache.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';

const labels = ['Jan', 'Feb', 'Mar'];
const cases = [
    { type: 'line', labels, series: [{ name: 'A', values: [1, 2, 3] }, { name: 'B', values: [3, 2, 1] }] },
    { type: 'area', labels, series: [{ values: [1, 2, 3] }, { values: [2, 2, 2] }], stacked: true, range_slider: true },
    { type: 'bar', labels, series: [{ values: [0.125, 0.42, 0.3] }] },
    { type: 'barh', labels, series: [{ values: [1, 2, 3] }] },
    { type: 'combo', labels, series: [{ name: 'A', values: [10, 12, 15] }, { name: 'B', values: [8, 9, 11], secondary: true }] },
    { type: 'scatter', series: [{ x: [1, 2], values: [3, 4] }] },
    { type: 'bubble', series: [{ x: [1, 2, 3], values: [3, 1, 2], size: [10, 40, 90] }] },
    { type: 'pie', labels, series: [{ values: [1, 2, 3] }] },
    { type: 'donut', labels, series: [{ values: [1, 2, 3] }] },
    { type: 'treemap', labels: ['R&D', '$A', '<B>'], parents: ['', 'R&D', 'R&D'], series: [{ values: [5, 2, 3] }] },
    { type: 'sunburst', labels: ['All', 'A', 'B'], parents: ['', 'All', 'All'], series: [{ values: [0, 2, 3] }] },
    { type: 'waterfall', labels: ['Start', 'Up', 'End'], measure: ['absolute', 'relative', 'total'], series: [{ values: [10, 5, 0] }] },
    { type: 'funnel', labels: ['Visit', 'Cart', 'Buy'], series: [{ values: [100, 40, 12] }] },
    { type: 'histogram', series: [{ values: [1, 2, 2, 3, 3, 3] }], bins: 3 },
    { type: 'box', series: [{ values: [1, 2, 2, 3, 9] }] },
    { type: 'violin', series: [{ values: [1, 2, 2, 3, 9] }] },
    { type: 'heatmap', labels, series: [{ name: 'Row A', values: [1, -2, 3] }, { name: 'Row B', values: [4, 5, -6] }] },
    { type: 'radar', labels, series: [{ values: [3, 4, 5] }] },
    { type: 'indicator', series: [{ name: 'Revenue', values: [120, 100] }] },
];
const out = resolve('node_modules/.cache/static-chart-matrix');
await mkdir(out, { recursive: true });
const bundle = await build({ entryPoints: ['src/static-chart.js'], bundle: true, platform: 'browser', format: 'iife', globalName: 'StaticChart', write: false });
await writeFile(resolve(out, 'static-chart.js'), bundle.outputFiles[0].contents);
const plotly = pathToFileURL(resolve('node_modules/plotly.js-dist-min/plotly.min.js')).href;
const staticChart = pathToFileURL(resolve(out, 'static-chart.js')).href;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' file:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:"><style>body{margin:0;font:13px sans-serif}.grid{display:grid;grid-template-columns:repeat(4,250px)}section img{width:250px;height:150px}output{display:block}</style><script src="${plotly}"></script><script src="${staticChart}"></script></head><body><output id="result">pending</output><div class="grid"></div><script>
const cases=${JSON.stringify(cases)};const blocked=[];document.addEventListener('securitypolicyviolation',e=>blocked.push(e.violatedDirective));
(async()=>{const records=[];for(const item of cases){document.getElementById('result').textContent=JSON.stringify({status:'running',current:item.type,records,blocked});try{const result=await StaticChart.renderStaticChart(JSON.stringify(item),{document,loadPlotly:async()=>Plotly});const section=document.createElement('section');section.textContent=item.type;const img=document.createElement('img');img.src=URL.createObjectURL(new Blob([result.bytes],{type:'image/png'}));section.appendChild(img);document.querySelector('.grid').appendChild(section);await img.decode();const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=600;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,1000,600).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0&&(pixels[i]<230||pixels[i+1]<230||pixels[i+2]<230))ink++;records.push({type:item.type,bytes:result.bytes.length,ink});}catch(e){records.push({type:item.type,error:String(e)})}}document.getElementById('result').textContent=JSON.stringify({status:'done',records,blocked})})();
</script></body></html>`;
const page = resolve(out, 'probe.html');
await writeFile(page, html);
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(out, 'profile')}`, '--window-size=1040,1000', '--hide-scrollbars', pathToFileURL(page).href], { stdio: 'ignore', windowsHide: true });
let socket;
try {
    const deadline = Date.now() + 60000;
    let target;
    while (Date.now() < deadline && !target) {
        try { target = (await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })).json()).find(item => item.type === 'page' && item.url.startsWith('file:')); } catch {}
        if (!target) await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(target, 'browser target missing');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0; const pending = new Map();
    socket.onmessage = event => { const item = JSON.parse(event.data), callback = pending.get(item.id); if (callback) { pending.delete(item.id); callback(item); } };
    const call = async (method, params) => {
        const requestId = ++id; let timer;
        const promise = new Promise((resolve, reject) => { timer = setTimeout(() => { pending.delete(requestId); reject(Error('CDP timeout')); }, 10000); pending.set(requestId, resolve); });
        socket.send(JSON.stringify({ id: requestId, method, params }));
        const response = await promise.finally(() => clearTimeout(timer));
        if (response.error || response.result?.exceptionDetails) throw Error(JSON.stringify(response.error ?? response.result.exceptionDetails));
        return response.result;
    };
    let result;
    while (Date.now() < deadline) {
        const response = await call('Runtime.evaluate', { expression: "document.getElementById('result')?.textContent", returnByValue: true });
        const value = response.result.value;
        if (value && value !== 'pending') { result = JSON.parse(value); if (result.status === 'done') break; }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(result?.status, 'done', JSON.stringify(result));
    assert.deepEqual(result.blocked, []);
    assert.equal(result.records.length, cases.length);
    for (const item of result.records) { assert.equal(item.error, undefined, JSON.stringify(item)); assert.ok(item.bytes > 1000 && item.ink > 100, JSON.stringify(item)); }
    await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2));
    await call('Emulation.setDeviceMetricsOverride', { width: 1040, height: 1200, deviceScaleFactor: 1, mobile: false });
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(resolve(out, 'matrix.png'), Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ types: result.records.length, output: out }));
} finally { socket?.close(); child.kill(); }
