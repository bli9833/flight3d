import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5283/';
const dir = process.env.ARTIFACT_DIR || '.cache/incheon-departure';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [], results = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 60000);
  pending.set(id, result => { clearTimeout(timer); result.error ? reject(new Error(JSON.stringify(result.error))) : resolve(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const capture = async name => {
  await evaluate(`(() => {
    const sim = window.simulator;
    sim.aircraft.group.updateMatrixWorld(true);
    for (let i = 0; i < 120; i++) sim.cameraSystem.update(1/60, sim.aircraft.group, sim.telemetry, (x,z) => sim.currentTerrain.getHeight(x,z));
    sim.camera.updateProjectionMatrix();
    sim.renderer.render(sim.scene, sim.camera);
  })()`);
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
};
try {
  await call('Runtime.enable'); await call('Page.enable');
  for (let i=0;i<120;i++) { if(await evaluate('Boolean(window.simulator?.lobbyScreen)')) break; await new Promise(r=>setTimeout(r,500)); }
  assert.ok(await evaluate('Boolean(window.simulator?.lobbyScreen)'), 'simulator ready');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(async()=>{ const s=window.simulator; s.demoDirector.stop(); s.gameFlow.isPhysicsFrozen=()=>true; s.setAircraft('C172'); await s.setAirport('incheon'); s.gameFlow.enterLobby(); s.lobby.preset='demo'; s.lobby.demoProfile='incheon-departure'; s.lobbyScreen.refresh(); })()`);
  assert.equal(await evaluate(`document.getElementById('lobby-demo-select').value`), 'incheon-departure');
  await capture('menu-desktop');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`document.getElementById('lobby-demo-options').scrollIntoView({block:'nearest'})`);
  await capture('menu-mobile');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no mobile overflow');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.getElementById('btn-fly').click()`);
  let previous;
  for (let sec=0;sec<1800;sec+=2) {
    const sample=await evaluate(`(()=>{const s=window.simulator; s.stepSimulation(2); const d=s.demoDirector; return {sec:${sec},active:d.isActive,stage:d.currentStage,index:d.incheonDepartureScenario.index,result:d.incheonDepartureScenario.result,pos:s.position.toArray(),speed:s.telemetry.groundSpeedKnots,heading:s.telemetry.headingDeg,crashed:s.isCrashed,incident:s.landingIncident,gear:s.gear.contacts.map(c=>c.damageState),onGround:s.gear.onGround,inputs:[s.controls.rudder,s.controls.throttle,s.controls.brakes],yawRate:s.angularVelocity.y};})()`);
    results.push(sample);
    if (previous !== sample.stage || sec%60===0 || !sample.active) console.log(JSON.stringify({...sample,result:{status:sample.result.status,airborne:sample.result.airborne}}));
    if (previous !== sample.stage || !sample.active) await capture('stage-'+sample.stage);
    previous=sample.stage;
    if (!sample.active) break;
  }
  const last=results.at(-1);
  assert.equal(last.result.status, 'completed');
  assert.ok(last.result.airborne, 'physical liftoff');
  assert.deepEqual(last.result.stages, ['gate','pushback','disconnect','taxi','hold','lineup','clearance','takeoff']);
  assert.ok(results.every(s=>!s.crashed&&!s.incident&&s.pos.every(Number.isFinite)), 'no crash, gear incident or invalid pose');
  assert.ok(last.gear.every(s=>s==='normal'), 'gear intact');
  assert.ok(await evaluate(`!window.simulator.controls.aircraftControlsDisabled && !window.simulator.scene.getObjectByName('departure-tug') && window.simulator.controls.throttle > .5`), 'manual handoff, climb thrust, no tug');
  await evaluate(`window.simulator.demoDirector.start('incheon','incheon-departure'); window.simulator.stepSimulation(10);`);
  assert.equal(await evaluate(`window.simulator.demoDirector.currentStage`),51, 'restart pushback');
  await call('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape' });
  await call('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape' });
  assert.ok(await evaluate(`!window.simulator.demoDirector.isActive && !window.simulator.controls.aircraftControlsDisabled && !window.simulator.scene.getObjectByName('departure-tug')`), 'Esc removes tug and releases controls');
  assert.equal(errors.length,0,'no browser exceptions');
  console.log('PASS', JSON.stringify(last.result));
} finally {
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({errors,results},null,2));
  ws.close(); await fetch(`${endpoint}/json/close/${target.id}`);
}
