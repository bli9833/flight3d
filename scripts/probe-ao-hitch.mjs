#!/usr/bin/env node
/*
 * Attribute the first-aft-frame hitch after CockpitOcclusion.warm(): per-frame
 * cost plus renderer.info.programs deltas, to separate shader compilation from
 * other first-look-away work (shadow refresh, render target sizing).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import assert from 'assert';

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function attach(port) {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch (e) {}
  }
  assert.ok(target, 'CDP page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0; const waiting = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || 'exception');
  });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalCode = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  return { send, evalCode, cdpErrors: errors, ws };
}

const FREEZE_LOOP = 'window.__nativeRAF = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = () => 0;';

const PROBE = `(() => {
  const s = window.simulator;
  const g = s.renderer.getContext();
  s.cockpitOcclusion.dispose(); s.cockpitOcclusion.pass = null;
  s.cameraSystem.photoCockpit = true; s.cameraSystem.lookYaw = 0; s.cameraSystem.lookPitch = -0.04;
  for (let i = 0; i < 10; i++) { s.animate(); g.finish(); }
  const warmBuiltPass = s.cockpitOcclusion.pass !== null;
  s.cameraSystem.lookYaw = Math.PI; s.cameraSystem.lookPitch = 0;
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const before = s.renderer.info.programs.length;
    const keysBefore = new Set(s.renderer.info.programs.map(p => p.cacheKey));
    const t0 = performance.now();
    s.animate();
    g.finish();
    const added = s.renderer.info.programs.filter(p => !keysBefore.has(p.cacheKey))
      .map(p => (p.name || '?') + ' :: ' + String(p.cacheKey).replace(/[^A-Za-z0-9:;|]/g, '').slice(0, 160));
    rows.push({ ms: +(performance.now() - t0).toFixed(1), programsBefore: before,
      programsAfter: s.renderer.info.programs.length, added });
  }
  // Same crossing again after everything is resident: isolate one-off costs.
  s.cameraSystem.lookYaw = 0; s.animate(); s.animate();
  const before = s.renderer.info.programs.length;
  s.cameraSystem.lookYaw = Math.PI;
  const t1 = performance.now(); s.animate(); g.finish();
  return { warmBuiltPass, rows, warmupMs: 0,
    warmFrames: rows.slice(1).map(r=>r.ms),
    secondCrossing: { ms: +(performance.now() - t1).toFixed(1), programsBefore: before,
      programsAfter: s.renderer.info.programs.length } };
})()`;

async function main() {
  const useGpu = fs.existsSync('/dev/dri/renderD128') && process.env.FORCE_GPU !== '0';
  const port = Number(process.env.PORT) || await freePort();
  const cdpPort = Number(process.env.CDP_PORT) || await freePort();
  const simUrl = `http://localhost:${port}/`;
  const vite = spawn(process.execPath,
    [path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'],
    { stdio: 'ignore' });
  let served = false;
  for (let i = 0; i < 80 && !served; i++) { await sleep(250); try { served = (await fetch(simUrl)).ok; } catch (e) {} }
  assert.ok(served, 'vite up');
  const chrome = spawn('google-chrome-stable', [
    '--headless=new', `--user-data-dir=/tmp/chrome-ao-hitch-${Date.now()}`,
    `--remote-debugging-port=${cdpPort}`, '--window-size=1440,900',
    '--no-first-run', '--no-default-browser-check', '--use-gl=angle',
    useGpu ? '--use-angle=vulkan' : '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ], { stdio: 'ignore' });
  let session = null;
  try {
    session = await attach(cdpPort);
    const { send, evalCode } = session;
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE_LOOP });
    await send('Page.navigate', { url: simUrl });
    for (let i = 0; i < 100; i++) { await sleep(300); if (await evalCode('!!(window.simulator?.cameraSystem&&window.__nativeRAF)')) break; }
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) { await sleep(500);
      ready = await evalCode('!!(window.simulator?.aircraft?.modelLoaded&&window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)'); }
    assert.ok(ready, 'GLBs loaded');
    await evalCode(`(async()=>{const s=window.simulator;await s.aircraft.cockpit.shaderWarmup;
      s.demoDirector?.stop?.();s.gameFlow?.enterFlight?.();s.integratePhysics=()=>{};
      s.cameraSystem.enableCursorTrack=false;s.cameraSystem.enableEdgePan=false;
      s.setAirport('coastal');s.setPreset('runway');s.cameraSystem.setMode(0,true);return true;})()`);
    console.log('rigged');
    const out = await evalCode(PROBE);
    console.log(JSON.stringify(out, null, 1));
  } finally {
    session?.ws.close(); chrome.kill(); vite.kill();
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
