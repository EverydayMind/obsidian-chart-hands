// Synthetic browser probe; all output stays in node_modules/.cache.
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const out = resolve('node_modules/.cache/static-chart-probe');
await mkdir(out, { recursive: true });
const bundle = await build({ entryPoints: ['src/static-chart.js'], bundle: true, platform: 'browser', format: 'iife', globalName: 'StaticChart', write: false });
await writeFile(resolve(out, 'static-chart.js'), bundle.outputFiles[0].contents);
const plotly = pathToFileURL(resolve('node_modules/plotly.js-dist-min/plotly.min.js')).href;
const staticChart = pathToFileURL(resolve(out, 'static-chart.js')).href;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' file:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:"><style>body{margin:0}img{width:1000px;height:600px}</style><script src="${plotly}"></script><script src="${staticChart}"></script></head><body><output id="result" data-status="pending"></output><script>
const blocked=[]; document.addEventListener('securitypolicyviolation', e => blocked.push(e.violatedDirective));
(async()=>{ try { const source=JSON.stringify({type:'bar',title:'Quarterly rate',labels:['Q1','Q2'],series:[{name:'Rate',values:[0.125,0.42]}],y_title:'Rate'}); const result=await StaticChart.renderStaticChart(source,{document,loadPlotly:async()=>Plotly}); const image=document.createElement('img'); image.src=URL.createObjectURL(new Blob([result.bytes],{type:'image/png'})); document.body.appendChild(image); const out=document.getElementById('result'); out.dataset.status='ok'; out.dataset.png=btoa(Array.from(result.bytes, x=>String.fromCharCode(x)).join('')); out.textContent=JSON.stringify({size:result.bytes.length,width:result.width,height:result.height,blocked}); } catch(e) { const out=document.getElementById('result'); out.dataset.status='error'; out.textContent=String(e); } })();
</script></body></html>`;
const page = resolve(out, 'probe.html');
await writeFile(page, html);
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const common = ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', `--user-data-dir=${resolve(out, 'edge-profile')}`, '--window-size=1024,720', '--hide-scrollbars', '--virtual-time-budget=12000'];
const probe = spawnSync(edge, [...common, '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 4_000_000 });
assert.equal(probe.status, 0, probe.stderr);
assert.match(probe.stdout, /data-status="ok"/);
assert.match(probe.stdout, /"blocked":\[\]/);
const png = /data-png="([A-Za-z0-9+/=]+)"/.exec(probe.stdout);
assert.ok(png);
await writeFile(resolve(out, 'chart-only.png'), Buffer.from(png[1], 'base64'));
await writeFile(resolve(out, 'result.html'), probe.stdout);
const screenshot = spawnSync(edge, [...common, `--screenshot=${resolve(out, 'chart.png')}`, pathToFileURL(page).href], { encoding: 'utf8', timeout: 60000 });
assert.equal(screenshot.status, 0, screenshot.stderr);
assert.ok((await readFile(resolve(out, 'chart.png'))).length > 1000);
console.log(`Static chart rendered without blocked resource loads; evidence: ${out}`);
