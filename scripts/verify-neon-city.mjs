import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run through chrome-session --project flight3d with Vite serving APP_URL.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const dir = process.env.ARTIFACT_DIR || '.cache/neon-city';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(process.env.APP_URL || 'http://127.0.0.1:5173/')}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [], report = { cases: [] };
ws.addEventListener('message', event => {
  const m = JSON.parse(event.data);
  if (m.id) pending.get(m.id)?.(m);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout ${method}`)); }, 60000);
  pending.set(id, m => { clearTimeout(timer); pending.delete(id); m.error ? reject(Error(JSON.stringify(m.error))) : resolve(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await call('Runtime.enable'); await call('Page.enable'); await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i=0;i<180;i++) {
    if (await evaluate('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded')) break;
    await sleep(500);
  }
  await evaluate(`(async()=>{
    const s=window.simulator;s.demoDirector.stop();s.gameFlow.enterFlight();s.integratePhysics=()=>{};
    s.setAircraft('C172');await s.setAirport('neon');s.setRenderQuality('balanced');
    s.cameraSystem.setMode(1,true);s.cameraSystem.enableCursorTrack=false;s.cameraSystem.enableEdgePan=false;
  })()`);
  for(let i=0;i<180;i++) {
    if(await evaluate('!!window.simulator.aircraft.gltfModel'))break;
    await sleep(500);
  }
  assert.equal(await evaluate('!!window.simulator.aircraft.gltfModel'),true);
  for(const preset of ['runway','approach','cruise']) {
    const state=await evaluate(`(()=>{
      const s=window.simulator;s.setPreset('${preset}');s.stepSimulation(0);
      return {preset:'${preset}',airport:s.activeAirport,aircraft:s.currentAircraftId,visible:s.neonCity.group.visible,
        buildings:s.neonCity.buildingData.length,position:s.position.toArray()};
    })()`);
    await sleep(1200);
    // Serialize in the same evaluation as rendering: the default buffer is not preserved.
    const shot=await evaluate(`(()=>{const s=window.simulator;s.renderScene();return s.renderer.domElement.toDataURL('image/png').split(',')[1]})()`);
    fs.writeFileSync(path.join(dir,`${preset}.png`),Buffer.from(shot,'base64'));
    assert.equal(state.airport,'neon');assert.equal(state.aircraft,'C172');assert.equal(state.visible,true);
    assert.ok(state.buildings>50);report.cases.push(state);
  }
  report.airportRestore = await evaluate(`(async()=>{
    const s=window.simulator;s.developerMode.enable();s.renderDiagnosticsPanel.open();
    s.renderDiagnostics.set('scene','world');await s.setAirport('coastal');
    return {active:s.renderDiagnostics.active,hidden:s.renderDiagnosticsPanel.root.hidden};
  })()`);
  assert.deepEqual(report.airportRestore,{active:false,hidden:true},'Changing airports must restore diagnostic trials');
  assert.equal(await evaluate('window.simulator.neonCity.group.visible'),false,'Leaving Neon must hide its scenery');
  assert.deepEqual(errors,[]);report.status='PASS';
} catch(error) {report.failure=error.stack;process.exitCode=1;console.error(error)}
finally {
  report.errors=errors;fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));
  await fetch(`${endpoint}/json/close/${target.id}`).catch(()=>{});ws.close();
}
