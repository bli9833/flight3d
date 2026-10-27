import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { summarizeFrameIntervals } from './lib/frameStats.mjs';

/**
 * Cockpit view frame-cost measurement: why cockpit mode is slower than exterior
 * views, and why looking aft is the worst case.
 *
 * Starts its own Vite server and headless Chrome (ANGLE/Vulkan when available),
 * freezes the app loop and physics, then times s.renderScene() + gl.finish() per
 * frame in six conditions: {3D virtual, PHOTO 2D} x {look forward, look aft},
 * plus aft views with the cockpit occlusion (SSAO) pass disabled as the cost
 * ablation. A final cold-switch probe disposes the SSAO pass and times the first
 * look-away frames to quantify the init hitch.
 *
 * Overrides: PORT, CDP_PORT, ARTIFACT_DIR, FORCE_GPU=0, TIMED_FRAMES.
 */
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.once('listening', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  probe.listen(0, '127.0.0.1');
});

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(process.cwd(), 'review-artifacts', 'cockpit-lookback');
const WARMUP = 15;
const TIMED = Number(process.env.TIMED_FRAMES) || 60;
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
  const cdpErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') cdpErrors.push(msg.params.exceptionDetails.text);
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
  return { ws, send, evalCode, cdpErrors };
}

const FREEZE_LOOP = `window.__nativeRAF=requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;`;

const CONDITIONS = [
  { name: '3d-forward', photo: false, yaw: 0, ao: true },
  { name: '3d-forward-noAO', photo: false, yaw: 0, ao: false },
  { name: '3d-back', photo: false, yaw: Math.PI, ao: true },
  { name: '3d-back-noAO', photo: false, yaw: Math.PI, ao: false },
  { name: 'photo-forward', photo: true, yaw: 0, ao: true },
  { name: 'photo-back', photo: true, yaw: Math.PI, ao: true },
];

// Applies the condition, warms synchronously (animate drives the full frame and
// lets lazy AO init happen outside the timed window), then times the render
// boundary alone with gl.finish() so each sample is the true GPU frame cost.
const measure = (condition) => `(() => {
  const s = window.simulator, r = s.renderer, g = r.getContext();
  s.cameraSystem.photoCockpit = ${condition.photo};
  s.cockpitOcclusion.enabled = ${condition.ao};
  s.cameraSystem.lookYaw = ${condition.yaw};
  s.cameraSystem.lookPitch = ${condition.photo ? -0.04 : Math.abs(condition.yaw) > 0.38 ? 0 : -0.25};
  for (let i = 0; i < ${WARMUP}; i++) s.animate();
  g.finish();
  const times = [];
  for (let i = 0; i < ${TIMED}; i++) {
    const t0 = performance.now();
    s.renderScene();
    g.finish();
    times.push(performance.now() - t0);
  }
  const g2 = r.getContext(), ext = g2.getExtension('WEBGL_debug_renderer_info');
  return { times,
    lookingAway: s.cameraSystem.isLookingAwayFromCenter(),
    interiorVisible: s.aircraft.cockpit.group.visible,
    occlusionRan: s.cockpitOcclusion.enabled && s.renderQuality !== 'performance' &&
      (!s.cameraSystem.photoCockpit || s.cameraSystem.isLookingAwayFromCenter()),
    calls: r.info.render.calls, triangles: r.info.render.triangles,
    programs: r.info.programs.length, dpr: r.getPixelRatio(),
    gpu: ext ? g2.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
    shaderErrors: r.info.programs.filter(p => p.diagnostics && p.diagnostics.runnable === false).length };
})()`;

// Cold switch: destroy the SSAO pass, then time whole animate() frames crossing
// into an aft look — frame 0 pays SSAOPass construction + program compilation.
// The warm-up must run in photo-forward, where the occlusion branch is skipped
// (mode COCKPIT, !photoCockpit false, !isLookingAway false), so the lazy init()
// is still pending when the head turns aft.
const COLD_SWITCH = `(() => {
  const s = window.simulator;
  s.cockpitOcclusion.dispose(); s.cockpitOcclusion.pass = null;
  s.cockpitOcclusion.enabled = true;
  s.cameraSystem.photoCockpit = true;
  s.cameraSystem.lookYaw = 0;
  s.cameraSystem.lookPitch = -0.04;
  for (let i = 0; i < 10; i++) { s.animate(); s.renderer.getContext().finish(); }
  const pendingAfterWarmup = s.cockpitOcclusion.pass === null;
  const times = [];
  s.cameraSystem.lookYaw = Math.PI;
  s.cameraSystem.lookPitch = 0;
  for (let i = 0; i < 12; i++) {
    const t0 = performance.now();
    s.animate();
    s.renderer.getContext().finish();
    times.push(performance.now() - t0);
  }
  const initCaptured = s.cockpitOcclusion.pass !== null;
  s.cameraSystem.photoCockpit = false;
  s.cameraSystem.lookYaw = 0;
  s.cameraSystem.lookPitch = -0.25;
  s.renderer.getContext().finish();
  return { first: times[0], restMedian: times.slice(1).sort((a,b)=>a-b)[Math.floor((times.length-1)/2)],
    pendingAfterWarmup, initCaptured, times };
})()`;

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const useGpu = fs.existsSync('/dev/dri/renderD128') && process.env.FORCE_GPU !== '0';
  const port = Number(process.env.PORT) || await freePort();
  const cdpPort = Number(process.env.CDP_PORT) || await freePort();
  const simUrl = `http://localhost:${port}/`;
  const viteLog = fs.openSync(path.join(ARTIFACT_DIR, 'vite.log'), 'w');
  const vite = spawn(process.execPath,
    [path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'],
    { stdio: ['ignore', viteLog, viteLog] });
  let served = false;
  for (let i = 0; i < 80 && !served; i++) {
    await sleep(250);
    try { served = (await fetch(simUrl)).ok; } catch (e) {}
  }
  assert.ok(served, `Vite dev server must answer on ${simUrl}`);
  console.log(`Dev server on ${simUrl}, CDP on ${cdpPort}, GPU=${useGpu ? 'vulkan' : 'swiftshader'}`);

  const chrome = spawn('google-chrome-stable', [
    '--headless=new',
    `--user-data-dir=/tmp/chrome-cockpit-lookback-${Date.now()}`,
    `--remote-debugging-port=${cdpPort}`,
    '--window-size=1440,900',
    '--no-first-run', '--no-default-browser-check',
    '--use-gl=angle',
    useGpu ? '--use-angle=vulkan' : '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ], { stdio: 'ignore' });

  let session = null;
  const results = [];
  try {
    session = await attach(cdpPort);
    const { send, evalCode, cdpErrors } = session;
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE_LOOP });
    await send('Page.navigate', { url: simUrl });
    for (let i = 0; i < 100; i++) {
      await sleep(300);
      if (await evalCode('!!(window.simulator?.cameraSystem&&window.__nativeRAF)')) break;
    }
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await sleep(500);
      ready = await evalCode('!!(window.simulator?.aircraft?.modelLoaded&&window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)');
    }
    assert.ok(ready, 'exterior and cockpit GLBs must both load');
    await evalCode(`(async()=>{const s=window.simulator;await s.aircraft.cockpit.shaderWarmup;
      s.demoDirector?.stop?.();s.gameFlow?.enterFlight?.();s.integratePhysics=()=>{};
      s.cameraSystem.enableCursorTrack=false;s.cameraSystem.enableEdgePan=false;
      s.setAirport('coastal');s.setPreset('runway');s.cameraSystem.setMode(0,true);
      return true;})()`);
    console.log('Rigged: 3D cockpit, runway preset, loop and physics frozen.');

    const order = [...CONDITIONS];
    const gpuRows = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      if (repeat) order.reverse();
      for (const condition of order) {
        const row = await evalCode(measure(condition));
        assert.equal(row.shaderErrors, 0, `no unrunnable programs in ${condition.name}`);
        if (useGpu && row.gpu === null) console.warn(`note: ${condition.name} renderer name unavailable (transient probe)`);
        else if (useGpu) assert.ok(!/swiftshader|llvmpipe|software|basic render/i.test(row.gpu), 'hardware GPU required');
        assert.equal(row.times.length, TIMED, `${condition.name}: full sample set`);
        const prior = results.find((x) => x.condition === condition.name);
        if (prior && row.programs !== prior.programs) {
          console.warn(`note: ${condition.name} programs ${prior.programs} -> ${row.programs} (lazy compile)`);
        }
        const summary = summarizeFrameIntervals(row.times, Math.min(TIMED, 120));
        const entry = { condition: condition.name, repeat,
          lookingAway: row.lookingAway, interiorVisible: row.interiorVisible, occlusionRan: row.occlusionRan,
          meanMs: +summary.meanMs.toFixed(2), medianMs: +summary.medianMs.toFixed(2),
          p95Ms: +summary.p95Ms.toFixed(2), maxMs: +summary.maxMs.toFixed(2),
          calls: row.calls, triangles: row.triangles, programs: row.programs, dpr: row.dpr };
        results.push(entry);
        gpuRows.push({ condition: `${condition.name} r${repeat}`, gpu: row.gpu, times: row.times });
        console.log(`${condition.name} r${repeat}: mean=${summary.meanMs.toFixed(2)}ms median=${summary.medianMs.toFixed(2)} ` +
          `p95=${summary.p95Ms.toFixed(2)} calls=${row.calls} ao=${row.occlusionRan} interior=${row.interiorVisible}`);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(ARTIFACT_DIR, `${condition.name}${repeat ? '-r1' : ''}.png`), Buffer.from(shot.data, 'base64'));
        assert.deepEqual(cdpErrors, [], `no page exceptions (${condition.name})`);
      }
    }
    if (useGpu) assert.ok(gpuRows.some(r => r.gpu && !/swiftshader|llvmpipe|software|basic render/i.test(r.gpu)),
      'at least one hardware renderer probe must succeed');
    const cold = await evalCode(COLD_SWITCH);
    results.push({ condition: 'cold-ao-switch', repeat: 0,
      firstMs: +cold.first.toFixed(2), restMedianMs: +cold.restMedian.toFixed(2),
      probeValid: cold.pendingAfterWarmup && cold.initCaptured, times: cold.times });
    console.log(`cold AO switch: first frame=${cold.first.toFixed(1)}ms, steady=${cold.restMedian.toFixed(1)}ms, ` +
      `probe ${cold.pendingAfterWarmup && cold.initCaptured ? 'valid (init happened on first aft frame)' : 'INVALID (warmup ' + cold.pendingAfterWarmup + '/captured ' + cold.initCaptured + ')'}`);
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'measurements.json'),
      JSON.stringify({ gpu: useGpu, warmup: WARMUP, timed: TIMED, viewport: '1440x900@1',
        gpuName: 'see rows', results, raw: gpuRows }, null, 2));
    console.log('Artifacts in', ARTIFACT_DIR);
  } finally {
    if (session) session.ws.close();
    chrome.kill();
    vite.kill();
    fs.closeSync(viteLog);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
