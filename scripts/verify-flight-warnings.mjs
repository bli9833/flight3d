import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const url = process.env.APP_URL || 'http://127.0.0.1:5197/';
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const output = process.env.ARTIFACT_DIR || '.cache/flight-warnings';
await fs.mkdir(output, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(method)); }, 60000);
  pending.set(id, message => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn) => {
  const response = await call('Runtime.evaluate', { expression: `(${fn.toString()})()`, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
try {
  for (let i = 0; i < 90; i++) {
    if (await evaluate(() => Boolean(window.simulator?.startupReady))) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(await evaluate(() => Boolean(window.simulator?.startupReady)), 'simulator ready');
  const result = await evaluate(async () => {
    const sim = window.simulator;
    sim.demoDirector.stop(); sim.gameFlow.enterFlight();
    sim.setPreset('cruise');
    sim.gameFlow.isPhysicsFrozen = () => true;
    // Exercise the real simulation connection through deterministic physics steps.
    sim.position.y = 5000; sim.linearVelocity.set(0, 0, -230);
    sim.stepSimulation(0.1);
    const liveIds = sim.telemetry.warnings.map(a => a.id);
    const { FlightAudio } = await import('/src/audio/FlightAudio.js');
    const { BOEING_737_800 } = await import('/src/config/aircraftConfigs.js');
    const ctx = new OfflineAudioContext(1, 24000, 48000), audio = new FlightAudio();
    audio.loadAircraftConfig(BOEING_737_800); audio.init(ctx);
    const state = { ...sim.telemetry, warnings: [{id:'overspeed'}], isStalled:false, isPreStall:false };
    audio.update(0.1, state, true);
    // Use the warning oscillator alone to distinguish clacker energy from engines.
    for (const name of ['engineGain','turbineGain','turbineGain2','windGain','rumbleGain','packGain'])
      audio[name]?.gain.setValueAtTime(0, 0);
    const buffer = await ctx.startRendering();
    const samples = buffer.getChannelData(0);
    const energy = Math.sqrt(samples.reduce((sum, v) => sum + v*v, 0) / samples.length);
    const voices = [];
    audio.playGpwsCallout = text => voices.push(text);
    audio.update(0.1, { ...state, warnings:[{id:'pull-up',voice:'Whoop whoop, pull up'}] }, true);
    sim.telemetry.warnings = [{ id:'pull-up',text:'PULL UP',priority:100 }]; sim.updateHUD();
    return { liveIds, energy, voices, hud:document.getElementById('hud-warning').textContent,
      visible:!document.getElementById('hud-warning').hidden, speechAvailable:'speechSynthesis' in window };
  });
  assert.ok(result.liveIds.includes('overspeed'), 'live physics produces overspeed');
  assert.ok(result.energy > 0.001, 'real Web Audio graph renders warning signal');
  assert.deepEqual(result.voices, ['Whoop whoop, pull up']);
  assert.equal(result.hud, 'PULL UP'); assert.ok(result.visible);
  const shot = await call('Page.captureScreenshot', { format:'png' });
  await fs.writeFile(`${output}/pull-up.png`, Buffer.from(shot.data, 'base64'));
  await fs.writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
