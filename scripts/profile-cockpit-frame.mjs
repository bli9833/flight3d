import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Where does a cockpit-mode frame actually go? Wraps the animate() stages with
 * accumulators, drives native rAF frames in {photo-forward, 3d-forward, 3d-back},
 * and reports per-stage totals alongside the raw frame intervals so JS cost,
 * render-boundary cost, and compositor/present cost can be told apart.
 *
 * Overrides: PORT, CDP_PORT, ARTIFACT_DIR, FORCE_GPU=0, PROFILE_FRAMES.
 */
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.once('listening', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.listen(0, '127.0.0.1');
});
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(process.cwd(), 'review-artifacts', 'cockpit-lookback');
const FRAMES = Number(process.env.PROFILE_FRAMES) || 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attach(cdpPort) {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const targets = await (await fetch(`http://localhost:${cdpPort}/json`)).json();
      target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) {}
  }
  assert.ok(target?.webSocketDebuggerUrl, 'Chrome page target must be reachable');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  const evalCode = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    return res.result?.value;
  };
  return { ws, send, evalCode };
}

const WRAP = `(() => {
  const s = window.simulator;
  if (window.__probe) return 'already wrapped';
  window.__probe = { totals: {}, counts: {} };
  const wrap = (label, owner, key) => {
    const original = owner[key];
    if (typeof original !== 'function') return;
    window.__probe.totals[label] = 0; window.__probe.counts[label] = 0;
    owner[key] = function (...args) {
      const t0 = performance.now();
      const r = original.apply(this, args);
      window.__probe.totals[label] += performance.now() - t0;
      window.__probe.counts[label]++;
      return r;
    };
  };
  wrap('displays', s, 'updateFlightDisplays');
  wrap('renderScene', s, 'renderScene');
  wrap('occlusion', s.cockpitOcclusion, 'render');
  wrap('aircraftUpdate', s.aircraft, 'update');
  wrap('cameraUpdate', s.cameraSystem, 'update');
  wrap('hud', s, 'updateHUD');
  wrap('diagnostics', s.diagnostics, 'update');
  wrap('touchUI', s.touchControls, 'updateUI');
  wrap('foliageUpdate', s.foliage, 'update');
  wrap('cityLod', s.foliage, 'updateCityLod');
  wrap('sunSync', s.sky, 'updateSun');
  wrap('cockpitSun', s.sky, 'updateCockpitSun');
  wrap('syncLighting', s.aircraft.cockpit, 'syncLighting');
  wrap('waterUpdate', s.water, 'update');
  wrap('audio', s.audio, 'update');
  wrap('gameFlow', s.gameFlow, 'update');
  wrap('overlayUpdate', s.cockpitPhotoOverlay, 'update');
  wrap('overlayRender', s.cockpitPhotoOverlay, 'render');
  return 'wrapped';
})()`;

const profileRun = (mode, photo, yaw, ao) => `(async () => {
  const s = window.simulator;
  s.cameraSystem.setMode(${mode}, true);
  s.cameraSystem.photoCockpit = ${photo};
  s.cockpitOcclusion.enabled = ${ao};
  s.cameraSystem.lookYaw = ${yaw};
  s.cameraSystem.lookPitch = ${mode === 0 && photo ? -0.04 : 0};
  for (const k of Object.keys(window.__probe.totals)) { window.__probe.totals[k] = 0; window.__probe.counts[k] = 0; }
  const g = s.renderer.getContext();
  const intervals = [], callbackMs = []; let previous = null, frame = 0;
  await new Promise(resolve => { const run = (t) => {
    const c0 = performance.now();
    s.animate();
    g.finish();
    const c1 = performance.now();
    if (previous !== null) { intervals.push(t - previous); callbackMs.push(c1 - c0); }
    previous = t;
    if (++frame <= ${FRAMES}) window.__nativeRAF(run); else resolve();
  }; window.__nativeRAF(run); });
  const sum = a => a.reduce((x, y) => x + y, 0);
  s.renderer.getContext().finish();
  return { intervals, callbackMeanMs: sum(callbackMs) / callbackMs.length, totals: window.__probe.totals,
    counts: window.__probe.counts, calls: s.renderer.info.render.calls, programs: s.renderer.info.programs.length };
})()`;

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const useGpu = fs.existsSync('/dev/dri/renderD128') && process.env.FORCE_GPU !== '0';
  const port = Number(process.env.PORT) || await freePort();
  const cdpPort = Number(process.env.CDP_PORT) || await freePort();
  const simUrl = `http://localhost:${port}/`;
  const viteLog = fs.openSync(path.join(ARTIFACT_DIR, 'vite-profile.log'), 'w');
  const vite = spawn(process.execPath,
    [path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'],
    { stdio: ['ignore', viteLog, viteLog] });
  let served = false;
  for (let i = 0; i < 80 && !served; i++) { await sleep(250); try { served = (await fetch(simUrl)).ok; } catch (e) {} }
  assert.ok(served, 'Vite must serve');
  const chrome = spawn('google-chrome-stable', [
    '--headless=new', `--user-data-dir=/tmp/chrome-cockpit-profile-${Date.now()}`,
    `--remote-debugging-port=${cdpPort}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check',
    '--use-gl=angle', useGpu ? '--use-angle=vulkan' : '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    // With NO_VSYNC=1 the compositor presents as fast as frames are produced,
    // so rAF intervals reflect real frame cost instead of present pacing.
    ...(process.env.NO_VSYNC === '1' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
  ], { stdio: 'ignore' });
  let session = null;
  const out = {};
  try {
    session = await attach(cdpPort);
    const { send, evalCode } = session;
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument',
      { source: 'window.__nativeRAF=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;' });
    await send('Page.navigate', { url: simUrl });
    for (let i = 0; i < 100; i++) { await sleep(300); if (await evalCode('!!(window.simulator?.cameraSystem&&window.__nativeRAF)')) break; }
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await sleep(500);
      ready = await evalCode('!!(window.simulator?.aircraft?.modelLoaded&&window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)');
    }
    assert.ok(ready, 'models must load');
    await evalCode(`(async()=>{const s=window.simulator;await s.aircraft.cockpit.shaderWarmup;
      s.demoDirector?.stop?.();s.gameFlow?.enterFlight?.();s.integratePhysics=()=>{};
      s.cameraSystem.enableCursorTrack=false;s.cameraSystem.enableEdgePan=false;
      s.setAirport('coastal');s.setPreset('runway');s.cameraSystem.setMode(0,true);
      for(let i=0;i<8;i++)s.animate();return true;})()`);
    assert.equal(await evalCode(WRAP), 'wrapped');
    // Let lazy programs/strobe compiles settle before attributing.
    await evalCode(`(async()=>{const s=window.simulator;
      await new Promise(r=>{let f=0;const run=()=>{s.animate();if(++f<150)window.__nativeRAF(run);else r();};window.__nativeRAF(run);});
      return s.renderer.info.programs.length;})()`);

    for (const [label, mode, photo, yaw, ao] of [
      ['chase', 1, false, 0, true],
      ['photo-forward', 0, true, 0, true],
      ['3d-forward', 0, false, 0, true],
      ['3d-forward-noAO', 0, false, 0, false],
      ['3d-back', 0, false, Math.PI, true],
      ['3d-back-noAO', 0, false, Math.PI, false],
    ]) {
      const row = await evalCode(profileRun(mode, photo, yaw, ao));
      const sorted = [...row.intervals].sort((a, b) => a - b);
      const total = row.intervals.reduce((a, b) => a + b, 0);
      const frames = row.counts.renderScene || FRAMES;
      const per = Object.fromEntries(Object.entries(row.totals).map(([k, v]) => [k, +(v / frames).toFixed(2)]));
      const accounted = Object.values(row.totals).reduce((a, b) => a + b, 0);
      out[label] = { intervalMeanMs: +(total / row.intervals.length).toFixed(2),
        intervalMedianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
        intervalMinMs: +sorted[0].toFixed(2), callbackMeanMs: +row.callbackMeanMs.toFixed(2), frames,
        perFrameMs: per, accountedMsPerFrame: +(accounted / frames).toFixed(2),
        calls: row.calls, programs: row.programs, intervals: row.intervals };
      console.log(label, JSON.stringify({ mean: out[label].intervalMeanMs, median: out[label].intervalMedianMs,
        callback: out[label].callbackMeanMs, accounted: out[label].accountedMsPerFrame,
        renderScene: per.renderScene, occlusion: per.occlusion, displays: per.displays, hud: per.hud }));
    }
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'frame-profile.json'), JSON.stringify(out, null, 2));
    console.log('Frame profile in', ARTIFACT_DIR);
  } finally {
    if (session) session.ws.close();
    chrome.kill(); vite.kill(); fs.closeSync(viteLog);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
