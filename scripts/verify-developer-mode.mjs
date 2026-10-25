/** Start Vite separately. SIM_URL / CDP_PORT / CHROME_PATH / ARTIFACT_DIR override. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

const port = Number(process.env.CDP_PORT || 9472);
const directory = resolve(process.env.ARTIFACT_DIR || '.tmp/developer-mode');
const profile = await mkdtemp(join(tmpdir(), 'flight3d-dev-'));
const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome-stable'), [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--window-size=1440,1000', '--no-first-run', '--no-default-browser-check',
  '--use-gl=angle', `--use-angle=${process.platform === 'win32' ? 'd3d11' : 'vulkan'}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let socket, nextId = 1;
const pending = new Map(), exceptions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 120000);
  pending.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, arg) => {
  const r = await send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg) ?? ''})`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const capture = async name => {
  const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  await writeFile(join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
};
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { /* startup */ }
    if (!target) await delay(100);
  }
  assert.ok(target, 'Chrome started');
  socket = new WebSocket(target.webSocketDebuggerUrl); await once(socket, 'open');
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
    const request = pending.get(m.id);
    if (!request) return;
    pending.delete(m.id);
    if (m.error) request.reject(new Error(m.error.message)); else request.resolve(m.result);
  });
  await mkdir(directory, { recursive: true });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: process.env.SIM_URL || 'http://127.0.0.1:5192' });
  let ready = false;
  for (let i = 0; i < 240 && !ready; i++) {
    ready = await evaluate(() => Boolean(window.simulator?.aircraft.modelLoaded && window.simulator?.aircraft.cockpit.gltfCockpitLoaded));
    if (!ready) await delay(500);
  }
  assert.ok(ready, 'B738 exterior and cockpit loaded');
  const gate = await evaluate(() => {
    const s = window.simulator;
    s.clock.getDelta = () => 0; s.physicsAccumulator = 0;
    s.demoDirector.stop(); s.gameFlow.returnToLobby(true);
    const denied = s.devRunner.start('normal') === false && s.setPreset('shadow') === false;
    document.getElementById('lobby-tab-settings').click();
    document.getElementById('dev-enabled').click();
    document.getElementById('lobby-tab-dev').click();
    s.developerPanel.select.value = 'left-collapse'; s.developerPanel.refresh();
    return { denied, enabled: s.developerMode.enabled, panel: !document.getElementById('lobby-panel-dev').hidden,
      build: document.getElementById('dev-build').textContent, noPublicShadow: !document.getElementById('lobby-preset-shadow') };
  });
  assert.ok(gate.denied && gate.enabled && gate.panel && gate.noPublicShadow);
  assert.ok(!gate.build.includes('unknown'));
  await capture('developer-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  await delay(300); await capture('developer-mobile');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const results = await evaluate(async () => {
    const { DEV_SCENARIOS } = await import('/src/dev/scenarios/index.js');
    const s = window.simulator, results = {};
    for (const [id, definition] of Object.entries(DEV_SCENARIOS)) {
      if (id === 'shadow') continue;
      if (!s.devRunner.start(id)) throw new Error(`Rejected ${id}`);
      s.stepSimulation(definition.duration + 11);
      results[id] = s.devRunner.result;
    }
    return results;
  });
  console.log(Object.fromEntries(Object.entries(results).map(([id, result]) => [id, result?.status])));
  await writeFile(join(directory, 'results.json'), JSON.stringify({ gate, results, exceptions }, null, 2));
  await evaluate(() => {
    const s = window.simulator;
    s.devRunner.start('left-collapse'); s.stepSimulation(46); s.developerPanel.refresh();
    s.renderScene();
  });
  await capture('left-collapse');
  const lifecycle = await evaluate(() => {
    const s = window.simulator;
    s.devRunner.restart(); s.stepSimulation(.1);
    s.gameFlow.pause(); const elapsed = s.devRunner.elapsed;
    s.stepSimulation(2); const paused = elapsed === s.devRunner.elapsed;
    s.gameFlow.resume(); s.stepSimulation(.1);
    const resumed = s.devRunner.elapsed > elapsed;
    s.devRunner.stop();
    const repaired = s.gear.contacts.every(c => c.damage === 0)
      && Object.values(s.gear.bodyDamage).every(d => d === 0) && !s.isCrashed;
    const time = s.sky.timeOfDay, cloud = s.sky.cloudCover;
    s.devRunner.start('shadow'); s.stepSimulation(6);
    const inspecting = s.devRunner.status === 'inspecting' && s.devRunner.result === null;
    if (s.cameraSystem.trauma !== 0) throw new Error('Old crash shake leaked into shadow inspection');
    if (!s.aircraft.cockpit.gltfCockpitLoaded || !s.aircraft.cockpit.gltfCockpitGroup.visible) throw new Error('Cockpit must be visible after shader warmup');
    s.developerPanel.refresh(); s.renderScene();
    return { paused, resumed, repaired, inspecting, time, cloud };
  });
  await capture('shadow');
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  await delay(300); await capture('shadow-mobile');
  const mobile = await evaluate(() => {
    const a = document.getElementById('shadow-demo').getBoundingClientRect();
    const b = document.getElementById('dev-live').getBoundingClientRect();
    return { separated: a.bottom <= b.top, fits: b.left >= 0 && b.right <= innerWidth,
      touchHidden: getComputedStyle(document.getElementById('touch-controls-overlay')).display === 'none',
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.ok(mobile.separated && mobile.fits && mobile.touchHidden && !mobile.overflow, JSON.stringify(mobile));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const realtimeStart = await evaluate(() => {
    const s = window.simulator;
    s.devRunner.start('normal'); s.clock.getDelta = () => 1 / 60;
    return s.devRunner.elapsed;
  });
  await delay(800);
  const realtime = await evaluate(start => {
    const s = window.simulator;
    const advanced = s.devRunner.elapsed > start && s.devRunner.status === 'running';
    s.clock.getDelta = () => 0;
    s.devRunner.start('tower'); s.stepSimulation(3); s.exitCrashToLobby();
    return { advanced, crashExit: !s.devRunner.active && !s.isCrashed && s.gameFlow.state === 'lobby' };
  }, realtimeStart);
  assert.ok(realtime.advanced && realtime.crashExit, JSON.stringify(realtime));
  const cleanup = await evaluate(({ time, cloud }) => {
    const s = window.simulator;
    s.devRunner.stop();
    const restored = Math.abs(s.sky.timeOfDay - time) < 1e-8 && s.sky.cloudCover === cloud && s.sky.sunDirectionOverride === null;
    s.devRunner.start('normal'); s.setAirport('lukla');
    const airportCancelled = s.devRunner.active === null && !s.devRunner.start('normal');
    s.setAirport('coastal'); s.devRunner.start('normal'); s.setAircraft('C172');
    const aircraftCancelled = s.devRunner.active === null && !s.devRunner.start('normal');
    document.getElementById('dev-enabled').click();
    return { restored, airportCancelled, aircraftCancelled, disabled: !s.developerMode.enabled && !s.devRunner.start('shadow') };
  }, lifecycle);
  await writeFile(join(directory, 'results.json'), JSON.stringify({ gate, results, lifecycle, mobile, realtime, cleanup, exceptions }, null, 2));
  for (const [id, result] of Object.entries(results)) assert.equal(result?.status, 'passed', `${id}: ${JSON.stringify(result)}`);
  for (const key of ['paused', 'resumed', 'repaired', 'inspecting']) assert.ok(lifecycle[key], key);
  assert.ok(Object.values(cleanup).every(Boolean), JSON.stringify(cleanup));
  assert.equal(exceptions.length, 0, 'No browser exceptions');
  console.log('Developer mode browser acceptance passed.');
} finally {
  socket?.close(); chrome.kill();
  await delay(1500);
  // mkdtemp supplied this exact dedicated profile; never remove a shared browser profile.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
