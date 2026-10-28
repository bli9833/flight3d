import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d; reuse its browser and close only our tab.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5283/';
const dir = process.env.ARTIFACT_DIR || '.cache/departure-gate';
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
  if (process.env.SCREENSHOTS === '0') return;
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
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  for(let i=0;i<180;i++){if(await evaluate('Boolean(window.simulator?.startupReady)'))break;await new Promise(r=>setTimeout(r,500));}
  assert.ok(await evaluate('Boolean(window.simulator?.startupReady)'),'startup ready');
  await evaluate(`(async()=>{const s=window.simulator;s.demoDirector.stop();s.gameFlow.isPhysicsFrozen=()=>true;s.setAircraft('B738');await s.setAirport('incheon');s.gameFlow.enterLobby();s.lobby.preset='demo';s.lobby.demoProfile='incheon-departure';s.audio.setMuted(true);s.lobbyScreen.refresh();})()`);
  await capture('737-menu');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.getElementById('lobby-demo-options').scrollIntoView({block:'nearest'})`);
  await capture('737-menu-mobile');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'mobile menu fits');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.getElementById('btn-fly').click();window.simulator.stepSimulation(.1)`);
  assert.equal(await evaluate('window.simulator.currentAirport.departureBridge.extension'),1);
  await capture('bridge-docked');
  await evaluate('window.simulator.stepSimulation(6)');
  assert.equal(await evaluate('window.simulator.currentAirport.departureBridge.extension'),0);
  assert.equal(await evaluate('window.simulator.demoDirector.currentStage'),51);
  await capture('bridge-clear-pushback');
  for(let i=0;i<80;i++){if(await evaluate('window.simulator.demoDirector.currentStage===52'))break;await evaluate('window.simulator.stepSimulation(1)');}
  assert.equal(await evaluate('window.simulator.demoDirector.currentStage'),52);
  const initial=await evaluate('window.simulator.demoDirector.incheonDepartureScenario.tug.position.toArray()');
  await evaluate('window.simulator.stepSimulation(5)');
  const tug=await evaluate(`(()=>{const t=window.simulator.demoDirector.incheonDepartureScenario.tug;return {pos:t.position.toArray(),towbarVisible:t.userData.animation.towbar.visible,wheel:t.userData.animation.wheels[0].rotation.x};})()`);
  assert.ok(Math.hypot(tug.pos[0]-initial[0],tug.pos[2]-initial[2])>5,'tractor visibly drives away');
  assert.equal(tug.towbarVisible,false);assert.ok(Math.abs(tug.wheel)>1);
  await capture('tug-disconnected');
  await evaluate('window.simulator.demoDirector.stop()');
  assert.equal(await evaluate('window.simulator.currentAirport.departureBridge.extension'),0);
  assert.equal(errors.length,0);
  fs.writeFileSync(path.join(dir,'gate-results.json'),JSON.stringify({tug,initial,browserExceptions:errors.length},null,2));
  console.log('PASS',JSON.stringify({tug,initial}));
} finally {ws.close();await fetch(`${endpoint}/json/close/${target.id}`);}
