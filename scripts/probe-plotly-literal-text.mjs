// Synthetic CSP-isolated Plotly text experiment. This does not change product behavior.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = resolve('node_modules/.cache/plotly-literal-text'); await mkdir(out, { recursive: true });
const bundle=await build({entryPoints:['src/static-chart.js'],bundle:true,platform:'browser',format:'iife',globalName:'StaticChart',write:false});
await writeFile(resolve(out,'static-chart.js'),bundle.outputFiles[0].contents);
const plotly = pathToFileURL(resolve('node_modules/plotly.js-dist-min/plotly.min.js')).href;
const staticChart = pathToFileURL(resolve(out,'static-chart.js')).href;
const values = ['R&D', '$100', 'x<y', 'x>y', '<a href="https://example.invalid/">LINK</a>', '&lt;b&gt;', '$x$'];
const data = JSON.stringify(values).replace(/</g, '\\u003c');
const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' file:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:"><script src="${plotly}"></script><script src="${staticChart}"></script></head><body><div id="chart" style="width:1000px;height:600px"></div><output id="result">pending</output><script>
const original=${data};const blocked=[];document.addEventListener('securitypolicyviolation',e=>blocked.push(e.violatedDirective));
(async()=>{try{const definition=StaticChart.parseStaticChart(JSON.stringify({type:'bar',labels:original,title:'R&D $100 x<y',series:[{values:[1,2,3,4,5,6,7]}]}));const labels=definition.data[0].x;await Plotly.newPlot('chart',definition.data,{...definition.layout,width:1000,height:600},{staticPlot:true});const ticks=[...document.querySelectorAll('.xtick text')].map(x=>x.textContent);const title=document.querySelector('.gtitle')?.textContent;const image=await Plotly.toImage('chart',{format:'svg',width:1000,height:600});const payload=image.slice(image.indexOf(',')+1);const xml=image.slice(0,image.indexOf(',')).includes(';base64')?atob(payload):decodeURIComponent(payload);const svg=new DOMParser().parseFromString(xml,'image/svg+xml');const exportTicks=[...svg.querySelectorAll('.xtick text')].map(x=>x.textContent);document.getElementById('result').textContent=JSON.stringify({original,labels,ticks,exportTicks,title,blocked,svgSize:image.length,links:document.querySelectorAll('#chart a').length,exportLinks:svg.querySelectorAll('a').length})}catch(e){document.getElementById('result').textContent=JSON.stringify({error:String(e),blocked})}})();
</script></body></html>`;
const page=resolve(out,'probe.html');await writeFile(page,html);
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve(out,'profile')}`,'--window-size=1040,800',pathToFileURL(page).href],{stdio:'ignore',windowsHide:true});
let socket;
try {
 const deadline=Date.now()+30000;let target;
 while(Date.now()<deadline&&!target){try{target=(await(await fetch(`http://127.0.0.1:${port}/json`,{signal:AbortSignal.timeout(1000)})).json()).find(x=>x.type==='page'&&x.url.startsWith('file:'))}catch{} if(!target)await new Promise(r=>setTimeout(r,200));}
 assert.ok(target);socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});let id=0;const pending=new Map();socket.onmessage=e=>{const x=JSON.parse(e.data),f=pending.get(x.id);if(f){pending.delete(x.id);f(x)}};
 const call=async(method,params)=>{const n=++id;let timer;const p=new Promise((r,j)=>{timer=setTimeout(()=>j(Error('timeout')),10000);pending.set(n,r)});socket.send(JSON.stringify({id:n,method,params}));const x=await p.finally(()=>clearTimeout(timer));if(x.error||x.result?.exceptionDetails)throw Error(JSON.stringify(x.error??x.result.exceptionDetails));return x.result};
 let result;while(Date.now()<deadline){const x=await call('Runtime.evaluate',{expression:"document.getElementById('result')?.textContent",returnByValue:true});if(x.result.value&&x.result.value!=='pending'){result=JSON.parse(x.result.value);break}await new Promise(r=>setTimeout(r,200))}
 assert.ok(result, 'probe timed out');assert.deepEqual(result.ticks,values);assert.deepEqual(result.exportTicks,values);assert.equal(result.title,'R&D $100 x<y');assert.equal(result.links,0);assert.equal(result.exportLinks,0);assert.deepEqual(result.blocked,[]);await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,'probe.png'),Buffer.from(shot.data,'base64'));console.log(JSON.stringify(result));
}finally{socket?.close();child.kill()}
