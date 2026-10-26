import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run inside chrome-session --project flight3d. Reuse the project daemon;
// create/close only this script's own tab, never the shared browser.
if (process.env.CHROME_PROJECT !== 'flight3d') throw new Error('Run with chrome-session --project flight3d');
const port = process.env.CHROME_DEBUG_PORT ?? '9225';
const url = process.env.APP_URL ?? 'http://127.0.0.1:5198/';
const artifacts = process.env.ARTIFACT_DIR ?? path.join(process.cwd(), 'review-artifacts/incheon-depth');
const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map();
const errors = [];
let id = 0;
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && !message.params.entry.url?.endsWith('/favicon.ico')) errors.push(`${message.params.entry.text} ${message.params.entry.url ?? ''}`.trim());
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 90000);
    pending.set(requestId, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
async function capture(name) {
  await evaluate("document.querySelector('#pause-menu')?.style.setProperty('display','none','important');true");
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'));
  await evaluate("document.querySelector('#pause-menu')?.style.removeProperty('display');true");
}
const label = process.env.CAPTURE_LABEL ?? 'after';
try {
  await mkdir(artifacts,{recursive:true});
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url});
  let ready=false;
  for(let i=0;i<150;i++) {ready=await evaluate('Boolean(window.sim?.gameFlow)');if(ready)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready);
  await evaluate("(async()=>{await sim.setAirport('incheon');sim.fly();sim.gameFlow.pause();sim.setTimeOfDay(12.5);return true;})()");
  const views = [
    {name:'runway',preset:'runway',mode:1},
    {name:'approach',preset:'approach',mode:1},
    {name:'cruise',preset:'cruise',mode:1},
    {name:'regional',preset:'runway',mode:6,orbit:[1.8,3300,2300]},
  ];
  const stats=[];
  for (const view of views) {
    await evaluate(`(()=>{sim.setPreset('${view.preset}');sim.cameraSystem.setMode(${view.mode},true);${view.orbit?`sim.cameraSystem.resetDroneOrbit(${view.orbit.join(',')});sim.cameraSystem.snapToTarget(sim.aircraft.group);`:''}sim.stepSimulation(.01);return true;})()`);
    await settle();await capture(`${label}-${view.name}`);
    stats.push(await evaluate(`({view:'${view.name}',calls:sim.renderer.info.render.calls,triangles:sim.renderer.info.render.triangles,programs:sim.renderer.info.programs.length})`));
  }
  assert.deepEqual(errors,[],'browser/shader errors');
  await writeFile(path.join(artifacts,`${label}.json`),JSON.stringify({stats,errors},null,2)+'\n');
  console.log(JSON.stringify({label,stats,errors,artifacts}));
} finally {
  ws.close();await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
}
