import { createHash } from 'node:crypto';
import { summarizeFrameIntervals } from './lib/frameStats.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

// Run inside chrome-session --project flight3d. Reuse the project daemon;
// create/close only this script's own tab, never the shared browser.
if (process.env.CHROME_PROJECT !== 'flight3d') throw new Error('Run with chrome-session --project flight3d');
const port = process.env.CHROME_DEBUG_PORT ?? '9225';
const url = process.env.APP_URL ?? 'http://127.0.0.1:5201/flight3d/';
const artifacts = process.env.ARTIFACT_DIR ?? path.join(process.cwd(), 'review-artifacts/incheon-stage5');
const baseline=process.env.BASELINE_URL;
if(!baseline)throw new Error('BASELINE_URL must point at untouched merged stage four');
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
async function click(selector) {
  const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await settle();
}
async function capture(name) {
  await evaluate("document.querySelector('#pause-menu')?.style.setProperty('display','none','important');true");
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'));
  await evaluate("document.querySelector('#pause-menu')?.style.removeProperty('display');true");
}
const results={url,baseline,baselineCommit:process.env.BASELINE_COMMIT??null,testedSources:{},load:[],passes:[],acceptance:{},viewport:{width:1280,height:720,dpr:1},notes:['Native requestAnimationFrame, full live physics/render/audio loop; no forced stepping in FPS samples','HTTP cache disabled; local server and OS disk caches may be warm','JS heap is measured through CDP after GC outside frame samples; not GPU memory','Existing automatic favicon request excluded from resource errors']};
for (const file of ['src/environment/IncheonTraffic.js','src/environment/IncheonAirport.js','src/geospatial/incheonTraffic.js','src/geospatial/IncheonFlightSurface.js','src/main.js']) results.testedSources[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const setupView=`window.setupView=(view)=>{const s=sim;s.setPreset(view==='city'?'cruise':view);s.cameraSystem.setMode(view==='city'?1:0,true);if(view==='city'){s.position.set(-150,180,800);s.linearVelocity.set(0,0,-90);s.quaternion.identity();s.applyComputedTrim();s.renderPose.reset(s.position,s.quaternion);s.aircraft.group.position.copy(s.position);s.aircraft.group.quaternion.copy(s.quaternion);s.cameraSystem.snapToTarget(s.aircraft.group);}else if(view==='runway'){s.controls.setParkingBrake(true);}s.physicsAccumulator=0;};`;
async function waitFor(expression) {
  for(let i=0;i<200;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}
  throw new Error(`Not ready: ${expression}`);
}
async function navigate(destination) {
  await send('Page.navigate',{url:destination});
  await waitFor('Boolean(window.sim?.gameFlow && sim.aircraft.modelLoaded && sim.aircraft.cockpit.gltfCockpitLoaded)');
  await evaluate(`(async()=>{await sim.aircraft.cockpit.shaderWarmup;sim.demoDirector.stop();sim.gameFlow.enterFlight();sim.gameFlow.pause();sim.setRenderQuality('balanced');${setupView}return true;})()`);
}
async function heap() {await send('HeapProfiler.collectGarbage');return send('Runtime.getHeapUsage');}
async function checkTraffic() {
  results.acceptance=await evaluate(`(()=>{const t=sim.incheonAirport.traffic;const r=t.routes.at(-1);sim.gameFlow.enterFlight();sim.gameFlow.pause();t.reset();const camera={...r.center,y:30};t.update(0,camera,'high',true);const visible=t.mesh.count;const first=Array.from(t.mesh.instanceMatrix.array);t.update(.1,camera,'high',true);const paused=first.every((v,i)=>v===t.mesh.instanceMatrix.array[i]);t.update(.1,camera,'high');const moved=first.some((v,i)=>v!==t.mesh.instanceMatrix.array[i]);const positions=t.cars.map(car=>car.route.id);const low=t.update(0,camera,'performance',true);t.update(0,{x:9000,y:500,z:9000},'high',true);const distant=t.mesh.count;t.enabled=false;const disabled=t.update(.1,camera,'high');t.enabled=true;t.reset();const reset=t.elapsed===0;return {routes:t.routes.length,cars:t.cars.length,visible,paused,moved,low,distant,disabled,reset,positions,center:r.center};})()`);
  const a=results.acceptance;
  assert.ok(a.routes>0&&a.cars>0&&a.cars<=64&&a.visible>0&&a.visible<=64);
  assert.ok(a.paused&&a.moved&&a.reset);assert.ok(a.low<=20);assert.equal(a.distant,0);assert.equal(a.disabled,0);
  // Product pause and preset reset, including a camera move while paused.
  const integration=await evaluate(`(async()=>{const t=sim.incheonAirport.traffic;sim.gameFlow.enterFlight();t.elapsed=12;sim.setPreset('runway');const reset=t.elapsed===0;sim.gameFlow.pause();const elapsed=t.elapsed;await new Promise(r=>setTimeout(r,250));const paused=t.elapsed===elapsed;await sim.setAirport('coastal');const hidden=!sim.incheonAirport.group.visible;await sim.setAirport('incheon');return {reset,paused,hidden,cached:sim.incheonAirport.traffic===t};})()`);
  assert.ok(Object.values(integration).every(Boolean));results.acceptance.integration=integration;
  // Show the actual cars, movement, road surface, and instance budget in two settled GPU frames.
  await evaluate(`(()=>{const t=sim.incheonAirport.traffic,r=t.routes.at(-1);sim.gameFlow.enterFlight();sim.gameFlow.pause();sim.cameraSystem.userModeSelected=false;sim.cameraSystem.userLookOverridden=false;sim.cameraSystem.setCustomViewUpdater(({camera})=>{camera.position.set(r.center.x+80,95,r.center.z+110);camera.lookAt(r.center.x,7,r.center.z);return true;});sim.cameraSystem.update(.1,sim.aircraft.group,sim.telemetry);t.update(0,sim.camera.position,'high',true);return true;})()`);
  await settle();await capture('traffic-close');
  await evaluate('sim.incheonAirport.traffic.elapsed+=5;true');await settle();await capture('traffic-after-5s');
  results.acceptance.render=await evaluate(`(()=>{const t=sim.incheonAirport.traffic;return {visible:t.mesh.count,calls:sim.renderer.info.render.calls,triangles:sim.renderer.info.render.triangles,geometries:sim.renderer.info.memory.geometries,textures:sim.renderer.info.memory.textures,trafficGeometryBytes:Object.values(t.mesh.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+t.mesh.instanceMatrix.array.byteLength+(t.mesh.instanceColor?.array.byteLength??0)};})()`);
  assert.ok(results.acceptance.render.visible>0);
  // Returning repeatedly must reuse buffers; no per-preset allocations in traffic.
  const stable=await evaluate(`(()=>{const t=sim.incheonAirport.traffic,matrix=t.mesh.instanceMatrix,geometry=t.mesh.geometry;for(let i=0;i<8;i++){sim.setPreset('runway');t.update(.1,{...t.routes[0].center,y:40},'high');t.update(0,{x:9000,y:1000,z:9000},'performance',true);}return matrix===t.mesh.instanceMatrix&&geometry===t.mesh.geometry;})()`);
  assert.ok(stable);results.acceptance.stableBuffers=stable;
}
try {
  await mkdir(artifacts,{recursive:true});
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Network.enable');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`let seed=12345;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);localStorage.setItem('flight3d.renderQuality','balanced');window.__longTasks=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});`});
  // ABBA across untouched stage four and the candidate; reload before each block.
  for(const [block,variant] of ['baseline','traffic','traffic','baseline'].entries()) {
    await navigate(variant==='baseline'?baseline:url);
    const before=await heap();
    const loaded=await evaluate(`(async()=>{const frames=[];let previous=null,active=true;const observe=t=>{if(previous!==null)frames.push(t-previous);previous=t;if(active)requestAnimationFrame(observe);};requestAnimationFrame(observe);const start=performance.now();await sim.setAirport('incheon');setupView('city');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));active=false;return {loadMs:performance.now()-start,frames,maxFrameMs:Math.max(0,...frames),longTasks:window.__longTasks.filter(e=>e.start>=start),resources:performance.getEntriesByType('resource').filter(r=>r.name.includes('/scenery/incheon/')).map(r=>({name:r.name.split('/').at(-1),encodedBytes:r.encodedBodySize,decodedBytes:r.decodedBodySize,duration:r.duration})),geometries:sim.renderer.info.memory.geometries,textures:sim.renderer.info.memory.textures};})()`);
    assert.equal(await evaluate('sim.activeAirport'),'incheon');assert.ok(loaded.loadMs>0&&loaded.frames.length>=1);
    results.load.push({block,variant,beforeHeap:before,afterHeap:await heap(),...loaded});
    results.gpu??=await evaluate(`(()=>{const gl=sim.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown';})()`);
    assert.doesNotMatch(results.gpu,/SwiftShader|llvmpipe|unknown/i);
    if(block===0) {
      await evaluate("setupView('runway');sim.cameraSystem.setMode(0,true);sim.gameFlow.enterFlight();true");
      await send('Profiler.enable');await send('Profiler.start');
      await new Promise(r=>setTimeout(r,5000));
      const {profile}=await send('Profiler.stop');await evaluate('sim.gameFlow.pause();true');
      results.baselineCpuProfile={durationMs:(profile.endTime-profile.startTime)/1000,samples:profile.samples?.length,
        nodes:profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,30).map(n=>({name:n.callFrame.functionName,url:n.callFrame.url.split('/').at(-1),line:n.callFrame.lineNumber,hitCount:n.hitCount}))};
    }
    if(variant==='traffic'&&block===1)await checkTraffic();
    for(const quality of (block%2?['performance','balanced','high']:['high','balanced','performance']))for(const view of ['runway','approach','city']) {
      await evaluate(`sim.gameFlow.enterFlight();sim.gameFlow.pause();sim.cameraSystem.setCustomViewUpdater(null);sim.setRenderQuality('${quality}');sim.setTimeOfDay(12.5);setupView('${view}');true`);
      // Warm shaders while frozen, then reset and run the simulator's native frame loop.
      const row=await evaluate(`(async()=>{await new Promise(r=>{let n=0;const warm=()=>{if(++n>=30)r();else requestAnimationFrame(warm);};requestAnimationFrame(warm);});setupView('${view}');sim.gameFlow.enterFlight();const start={...sim.position},startSim=sim.totalSimTime,startTraffic=sim.incheonAirport.traffic?.elapsed,intervals=[],counts=[];let previous=null;await new Promise(resolve=>{const sample=t=>{if(previous!==null){intervals.push(t-previous);counts.push(sim.incheonAirport.traffic?.mesh.count??0);}previous=t;if(intervals.length<120)requestAnimationFrame(sample);else resolve();};requestAnimationFrame(sample);});const end={...sim.position};sim.gameFlow.pause();return {intervals,counts,start,end,simulatedSeconds:sim.totalSimTime-startSim,trafficSeconds:sim.incheonAirport.traffic?sim.incheonAirport.traffic.elapsed-startTraffic:null,crashed:sim.isCrashed,airport:sim.activeAirport,calls:sim.renderer.info.render.calls,triangles:sim.renderer.info.render.triangles,pixelRatio:sim.renderer.getPixelRatio(),canvas:{width:sim.renderer.domElement.width,height:sim.renderer.domElement.height},cameraMode:sim.cameraSystem.mode,geometries:sim.renderer.info.memory.geometries,textures:sim.renderer.info.memory.textures};})()`);
      assert.equal(row.crashed,false,`${variant}/${quality}/${view} crash`);assert.equal(row.airport,'incheon');assert.ok(row.simulatedSeconds>.5);
      if(view!=='runway')assert.ok(Math.hypot(row.end.x-row.start.x,row.end.z-row.start.z)>20,'live flight moves');
      if(variant==='traffic'&&view==='city')assert.ok(Math.max(...row.counts)>0,'city sample must include traffic');
      const summary=summarizeFrameIntervals(row.intervals);
      results.passes.push({block,variant,quality,view,...summary,...row});
      await writeFile(path.join(artifacts,'performance.json'),JSON.stringify(results,null,2)+'\n');
      console.log(`${block} ${variant} ${quality} ${view}: ${summary.fps.toFixed(1)} FPS / p95 ${summary.p95Ms.toFixed(1)}ms / cars ${Math.max(...row.counts)}`);
    }
  }
  assert.deepEqual(errors,[],'runtime/resource errors');
  assert.equal(results.passes.length,36);
  results.errors=errors;results.completedAt=new Date().toISOString();
  await writeFile(path.join(artifacts,'performance.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({passes:results.passes.length,gpu:results.gpu,acceptance:results.acceptance}));
} catch(error) {await capture('failure');console.error(errors);throw error;}
finally {ws.close();await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);}
