import assert from 'node:assert/strict';

// Reuse the admitted project browser. No new browser process or profile.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const app = process.env.APP_URL || 'http://127.0.0.1:5274';
const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => reject(Error(method)), 45000);
  pending.set(id, message => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
try {
  // Establish the Vite origin without loading the simulator's heavy scene.
  await call('Page.enable');
  await call('Page.navigate', { url: `${app}/package.json` });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const result = await call('Runtime.evaluate', { expression: 'location.origin', returnByValue: true });
    if (result.result.value === new URL(app).origin) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Vite origin ready');
  const result = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(${async function () {
    const { Aerodynamics } = await import('/src/physics/Aerodynamics.js');
    const { FlightAudio } = await import('/src/audio/FlightAudio.js');
    const { AIRCRAFT_REGISTRY } = await import('/src/config/aircraftConfigs.js');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const results = [];
    for (const config of Object.values(AIRCRAFT_REGISTRY)) {
      const aero = new Aerodynamics(config);
      aero.gearHandleDown = true;
      const audio = new FlightAudio(); audio.loadAircraftConfig(config);
      const ctx = new OfflineAudioContext(1, 24000, 48000);
      audio.init(ctx);
      // Offline contexts have not advanced a sample yet: .value is not the
      // value scheduled at t=0. Record calls while preserving the real graph.
      let scheduledWarningGain;
      const setWarningGain = audio.warningGain.gain.setValueAtTime.bind(audio.warningGain.gain);
      audio.warningGain.gain.setValueAtTime = (value, time) => {
        scheduledWarningGain = value;
        return setWarningGain(value, time);
      };
      const aircraft = { quaternion: new THREE.Quaternion() };
      const sample = alpha => {
        const a = alpha * Math.PI / 180;
        return aero.computeAero(1 / 120, aircraft, new THREE.Vector3(0, -100 * Math.sin(a), -100 * Math.cos(a)), new THREE.Vector3(), 0, 1000, 0, 0);
      };
      const warning = sample(config.id === 'F16' ? 16 : 14);
      const state = { ...warning, onGround: false, engine1: { n1: 0 }, engine2: { n1: 0 }, groundSpeedKnots: 0 };
      audio.update(0.01, state, false);
      const activeGain = scheduledWarningGain;
      const separated = sample(40);
      const unloaded = sample(2);
      audio.update(0.01, { ...state, ...unloaded }, false);
      const recoveryGain = scheduledWarningGain;
      audio.update(0.01, { ...state, isStallWarning: true, isStalled: true, onGround: true }, false);
      const groundGain = scheduledWarningGain;
      // Render warning alone to prove the browser audio graph produces samples.
      for (const node of ['turbineGain','pistonGain','propGain','packGain','windGain','rumbleGain']) {
        audio[node]?.gain.cancelScheduledValues(0); audio[node]?.gain.setValueAtTime(0, 0);
      }
      audio.warningGain.gain.cancelScheduledValues(0);
      audio.warningGain.gain.setValueAtTime(activeGain, 0);
      const buffer = await ctx.startRendering();
      const samples = buffer.getChannelData(0);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      results.push({ id: config.id, warning: warning.isStallWarning, activeGain, separated: separated.isStalled,
        recoveryWarning: unloaded.isStallWarning, recoverySeparation: unloaded.isStalled, recoveryGain, groundGain, rms });
    }
    return results;
  }.toString()})()` });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  for (const row of result.result.value) {
    assert.equal(row.warning, true, row.id);
    assert.ok(row.activeGain > 0 && row.rms > 0, `${row.id}: audible graph`);
    assert.equal(row.separated, true);
    assert.equal(row.recoveryWarning, false);
    assert.equal(row.recoverySeparation, true);
    assert.equal(row.recoveryGain, 0);
    assert.equal(row.groundGain, 0);
  }
  console.log(JSON.stringify(result.result.value, null, 2));
} finally {
  ws.close();
  await fetch(`${endpoint}/json/close/${target.id}`);
}
