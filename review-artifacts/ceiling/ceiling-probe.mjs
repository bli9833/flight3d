// Scratch probe: measure shadow acne on the 737 ceiling with the camera looking up
// at a low sun. Not part of the repo gate; run under chrome-session:
//   APP_URL=http://127.0.0.1:5196 CDP_PORT=9225 node review-artifacts/ceiling-probe.mjs
import fs from 'node:fs';
import path from 'node:path';

const cdpPort = process.env.CDP_PORT || 9225;
const dir = process.env.ARTIFACT_DIR || path.resolve('review-artifacts/ceiling');
fs.mkdirSync(dir, { recursive: true });

const tab = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(process.env.APP_URL || 'http://127.0.0.1:5196/')}`,
  { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timeout = setTimeout(() => reject(new Error(`timeout ${method}`)), 120000);
  pending.set(id, (m) => { clearTimeout(timeout); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

try {
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await call('Page.enable');
  await call('Page.reload', { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 3000));
  for (let i = 0; i < 160; i++) {
    if (await evaluate('Boolean(window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)')) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  await evaluate(`(() => {
    const sim = window.simulator;
    sim.setRenderQuality('performance'); // 1024 maps: the worst tier, like the phone report
    sim.demoDirector.stop();
    sim.gameFlow.enterFlight();
    sim.animate = () => {};
    sim.cameraSystem.photoCockpit = false;
    sim.cameraSystem.lookYaw = 0;
    sim.cameraSystem.lookPitch = 0.62; // pilot head tilted up at the ceiling
    sim.cameraSystem.setMode(0);
    return true;
  })()`);

  const stage = async ({ hour, heading }) => await evaluate(`(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const sim = window.simulator;
    const sky = sim.sky;
    sim.position.set(0, 900, 0);
    sim.aircraft.group.position.copy(sim.position);
    sim.quaternion.setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(${heading}), 0, 'YXZ'));
    sim.aircraft.group.quaternion.copy(sim.quaternion);
    sky.setCloudCover(0);
    sky.setTimeOfDay(${hour}, sim.position, sim.camera.position);
    for (let i = 0; i < 6; i++) {
      sim.aircraft.setCockpitMode(true, true);
      sim.aircraft.group.updateMatrixWorld(true);
      sim.cameraSystem.lookPitch = 0.62; // re-assert: enterFlight/setMode reset the look
      sim.cameraSystem.update(1 / 60, sim.aircraft.group, sim.telemetry,
        (x, z) => sim.currentTerrain.getHeight(x, z));
      const daylight = sim.sky.updateCockpitSun({
        position: sim.aircraft.group.position,
        quaternion: sim.aircraft.group.quaternion,
        cockpitActive: true,
        dt: i === 0 ? 1 : 1 / 60,
        casterState: 'ceiling-probe',
      });
      sim.aircraft.cockpit?.syncDaylight?.(daylight);
      sim.renderScene();
    }
    // The ceiling occupies the upper band of this framing. Acne is pure black on a
    // lit tan shell, so count near-black pixels that sit inside an otherwise bright band.
    const gl = sim.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const y0 = Math.floor(h * 0.45), y1 = Math.floor(h * 0.92); // readPixels rows from bottom: upper frame band
    const buf = new Uint8Array(w * (y1 - y0) * 4);
    gl.readPixels(0, y0, w, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const n = w * (y1 - y0);
    let sum = 0, dark = 0, mid = 0;
    const lumas = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
      lumas[i] = l; sum += l;
      if (l < 20) dark++; else if (l > 60) mid++;
    }
    return {
      mapSize: sky.cockpitSun.light.shadow.mapSize.x,
      normalBias: sky.cockpitSun.light.shadow.normalBias,
      sunElev: +(Math.asin(sky.cockpitSun.pose.sunDirLocal.y) * 180 / Math.PI).toFixed(1),
      bandMean: +(sum / n).toFixed(1),
      blackShare: +(dark / n).toFixed(4),
      litShare: +(mid / n).toFixed(4),
    };
  })()`);

  const cells = {
    goldenAhead: { hour: 16.8, heading: 0 },
    leftSun: { hour: 9.0, heading: 302 },
    lowAstern: { hour: 17.0, heading: 136.5 },
  };
  for (const [name, cell] of Object.entries(cells)) {
    const r = await stage(cell);
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, `ceiling-${name}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`${name.padEnd(12)} map ${String(r.mapSize).padEnd(5)} normalBias ${r.normalBias} sun ${r.sunElev}deg | band ${r.bandMean} black ${r.blackShare} lit ${r.litShare}`);
  }
} finally {
  await call('Target.closeTarget', { targetId: tab.id }).catch(() => {});
  ws.close();
}
