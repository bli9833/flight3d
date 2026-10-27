import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Decide which B737 exterior lights can stay out of the compiled light set while
// the cockpit interior is what is on screen. Run under chrome-session --project
// flight3d with Vite already serving APP_URL.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5173/';
const dir = process.env.ARTIFACT_DIR || '.cache/aircraft-light-scope';
const seconds = Number(process.env.MEASURE_SECONDS || 3);
const LEVELS = ['none', 'navStrobe', 'navStrobeBeacon', 'allExterior'];
const POSES = [
  { key: 'forward', yaw: 0, pitch: -0.25 },
  { key: 'right', yaw: 1.3, pitch: -0.1 },
  { key: 'rear', yaw: 2.7, pitch: -0.15 },
  { key: 'overhead', yaw: 0, pitch: 0.6 },
];
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) pending.get(message.id)?.(message);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout ${method}`)); }, 120000);
  pending.set(id, result => { clearTimeout(timer); pending.delete(id); result.error ? reject(Error(JSON.stringify(result.error))) : resolve(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const report = { url, levels: LEVELS, rows: [], errors: [] };
const save = () => fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report, null, 2));

try {
  await call('Runtime.enable'); await call('Page.enable'); await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 240; i++) {
    if (await evaluate('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded')) break;
    await sleep(500);
  }
  report.setup = await evaluate(`(async () => {
    const s = window.simulator, c = s.aircraft.cockpit;
    await c.shaderWarmup;
    s.animate = () => {};
    s.demoDirector.stop(); s.gameFlow.enterFlight(); s.setPreset('runway');
    s.cameraSystem.photoCockpit = false; s.cameraSystem.setMode(0, true);
    s.cameraSystem.enableCursorTrack = false; s.cameraSystem.enableEdgePan = false;
    s.setRenderQuality('balanced'); s.stepSimulation(0);
    const gl = s.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    // Freeze the blink cycle so every trial shades identical intensities.
    const roles = new Map();
    for (const light of s.aircraft.lightsGroup.children) {
      if (!light.isLight) continue;
      const role = s.aircraft.strobeLights.includes(light) ? 'strobe'
        : s.aircraft.beaconLights.includes(light) ? 'beacon'
        : s.aircraft.landingLights.includes(light) ? 'landing'
        : light.isPointLight && light.distance === 8 ? 'nav' : 'other';
      roles.set(light, role);
      light.visible = true;
    }
    window.__roles = roles;
    // Shipped behaviour, driven through the same call the camera mode makes:
    // entering the cockpit must drop the airframe-only lamps by itself.
    const lamps = () => ({ nav: s.aircraft.navLights.map(light => light.visible),
      strobe: s.aircraft.strobeLights.map(light => light.visible),
      beacon: s.aircraft.beaconLights.map(light => light.visible),
      landing: s.aircraft.landingLights.map(light => light.visible) });
    s.aircraft.setCockpitMode(true, true);
    const cockpit = lamps();
    s.aircraft.setCockpitMode(false, true);
    const exterior = lamps();
    const drops = { none: [], navStrobe: ['nav', 'strobe'],
      navStrobeBeacon: ['nav', 'strobe', 'beacon'],
      allExterior: ['nav', 'strobe', 'beacon', 'landing'] };
    window.__scopeTrial = level => {
      const drop = drops[level];
      if (!drop) throw Error('Unknown scope level ' + level);
      let hidden = 0;
      for (const [light, role] of roles) {
        // stepSimulation calls aircraft.update(), which advances the real blink
        // cycle. Re-pin after every step, at the runtime's maximum intensities.
        if (role === 'strobe') light.intensity = 8;
        if (role === 'beacon') light.intensity = 6;
        light.visible = !drop.includes(role);
        if (!light.visible) hidden++;
      }
      return hidden;
    };
    return { gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      gpuTimers: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      exterior: [...roles.values()], pixelRatio: s.renderer.getPixelRatio(),
      cockpitLamps: cockpit, exteriorLamps: exterior };
  })()`);
  assert.ok(report.setup.exterior.includes('nav'), 'Exterior lights must be classified');
  assert.deepEqual(report.setup.cockpitLamps,
    { nav: [false, false, false], strobe: [false, false, false], beacon: [true, true], landing: [true, true] },
    'Cockpit mode must scope nav and strobe lamps only');
  assert.deepEqual(report.setup.exteriorLamps,
    { nav: [true, true, true], strobe: [true, true, true], beacon: [true, true], landing: [true, true] },
    'Exterior mode must keep every lamp compiled');
  await sleep(500);

  for (const hour of [12, 23]) for (const pose of POSES) {
    const row = { hour, pose: pose.key, cases: [] };
    report.rows.push(row); save();
    for (const level of LEVELS.concat(['none'])) {
      const measured = await evaluate(`(async () => {
        const s = window.simulator, gl = s.renderer.getContext();
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        s.sky.setTimeOfDay(${hour}); s.cameraSystem.lookYaw = ${pose.yaw}; s.cameraSystem.lookPitch = ${pose.pitch};
        s.aircraft.cockpit.syncLighting(s.sky, s.quaternion, 10); s.stepSimulation(0);
        const hidden = window.__scopeTrial('${level}');
        s.renderScene(); gl.finish(); // Compile the new light-count variant outside the measurement.
        const queries = [], times = [], marks = []; let previous;
        const poll = () => {
          for (let i = queries.length - 1; i >= 0; i--) if (gl.getQueryParameter(queries[i], gl.QUERY_RESULT_AVAILABLE)) {
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(queries[i], gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(queries[i]); queries.splice(i, 1);
          }
        };
        const start = performance.now();
        await new Promise(resolve => {
          const tick = t => {
            poll(); if (previous !== undefined) marks.push(t - previous); previous = t;
            const query = ext && queries.length < 4 ? gl.createQuery() : null;
            if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
            s.renderScene();
            if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(query); }
            if (performance.now() - start < ${seconds * 1000}) requestAnimationFrame(tick); else resolve();
          }; requestAnimationFrame(tick);
        });
        const deadline = performance.now() + 5000;
        while (queries.length && performance.now() < deadline) { await new Promise(requestAnimationFrame); poll(); }
        times.sort((a, b) => a - b);
        const info = s.renderer.info;
        return { level: '${level}', hidden, samples: times.length,
          blinkIntensities: { strobe: s.aircraft.strobeLights.map(l=>l.intensity), beacon: s.aircraft.beaconLights.map(l=>l.intensity) },
          gpuMedianMs: times[Math.floor(times.length / 2)] ?? null,
          gpuP95Ms: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? null,
          fps: 1000 * marks.length / marks.reduce((a, b) => a + b, 0),
          programs: info.programs?.length ?? 0, calls: info.render.calls, triangles: info.render.triangles,
          contextLost: gl.isContextLost() };
      })()`);
      assert.equal(measured.contextLost, false);
      assert.deepEqual(measured.blinkIntensities, { strobe: [8,8,8], beacon: [6,6] });
      assert.ok(measured.samples > 3, `GPU timing needs samples for ${level}`);
      row.cases.push(measured); save();
    }
    const base = row.cases[0];
    for (const item of row.cases) {
      item.deltaGpuPct = base.gpuMedianMs ? +(100 * (item.gpuMedianMs / base.gpuMedianMs - 1)).toFixed(1) : null;
      item.driftCheck = item.level === 'none' && item !== base
        ? +(100 * (item.gpuMedianMs / base.gpuMedianMs - 1)).toFixed(1) : undefined;
    }
    // Visual cost: compare the rendered frame with and without the lights.
    for (const level of ['navStrobe', 'navStrobeBeacon', 'allExterior']) {
      const diff = await evaluate(`(() => {
        const s = window.simulator, gl = s.renderer.getContext();
        const grab = level => {
          window.__scopeTrial(level); s.renderScene();
          const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
          // Read and serialize the SAME freshly rendered trial before yielding
          // to CDP or restoring the lights (preserveDrawingBuffer is false).
          const png = s.renderer.domElement.toDataURL('image/png').split(',')[1];
          let litPixels = 0;
          for(let i=0;i<data.length;i+=4) if(data[i]||data[i+1]||data[i+2]) litPixels++;
          return { data, png, litPixels };
        };
        const baseline = grab('none'), scoped = grab('${level}');
        const before = baseline.data, after = scoped.data;
        let changedPixels = 0, squared = 0, max = 0; const spots = [];
        for (let i = 0; i < before.length; i += 4) {
          let hit = false;
          for (let channel = 0; channel < 3; channel++) {
            const d = Math.abs(before[i + channel] - after[i + channel]);
            if (d) { hit = true; squared += d * d; max = Math.max(max, d); }
          }
          if (hit) { changedPixels++; if (spots.length < 6) spots.push([i / 4 % gl.drawingBufferWidth, Math.floor(i / 4 / gl.drawingBufferWidth)]); }
        }
        const pixels = before.length / 4;
        window.__scopeTrial('none'); s.renderScene();
        return { level: '${level}', changedFraction: changedPixels / pixels, rmse: Math.sqrt(squared / before.length),
          baselinePng: baseline.png, scopedPng: scoped.png,
          baselineLitPixels: baseline.litPixels, scopedLitPixels: scoped.litPixels,
          blinkIntensities: { strobe: s.aircraft.strobeLights.map(l=>l.intensity), beacon: s.aircraft.beaconLights.map(l=>l.intensity) },
          max, spots, glError: gl.getError() };
      })()`);
      assert.equal(diff.glError, 0);
      assert.deepEqual(diff.blinkIntensities, { strobe: [8,8,8], beacon: [6,6] });
      assert.ok(diff.baselineLitPixels > 1000 && diff.scopedLitPixels > 1000, 'Black captures cannot be visual evidence');
      fs.writeFileSync(path.join(dir, `${hour}h-${pose.key}-${level}.png`), Buffer.from(diff.scopedPng, 'base64'));
      fs.writeFileSync(path.join(dir, `${hour}h-${pose.key}-none.png`), Buffer.from(diff.baselinePng, 'base64'));
      delete diff.baselinePng; delete diff.scopedPng;
      const match = row.cases.find(item => item.level === level);
      if (match) Object.assign(match, diff);
      save();
    }
    console.log(`${hour}h ${pose.key} base ${base.gpuMedianMs.toFixed(1)}ms ` + row.cases.slice(1, 4)
      .map(item => `${item.level} ${item.gpuMedianMs.toFixed(1)}ms (${item.deltaGpuPct}%, hidden ${item.hidden}, ${item.changedFraction ? (100 * item.changedFraction).toFixed(2) + '%px' : '-'})`).join(' | '));
  }
  for (const row of report.rows) {
    const base = row.cases[0], scoped = row.cases.find(item => item.level === 'navStrobe');
    assert.ok(scoped.gpuMedianMs < base.gpuMedianMs, `Scoping must reduce GPU time (${row.hour}h ${row.pose})`);
    // Light-count variants can differ by one 8-bit step over a small region;
    // the existing wingtip glow also changes a handful of edge pixels. Record
    // the raw maximum/fraction rather than claiming byte-identical images.
    assert.ok(scoped.changedFraction < 0.001 && scoped.rmse < 0.1,
      `Scoped image exceeds the documented 0.1% pixels / 0.1 RGBA RMSE bounds (${row.hour}h ${row.pose})`);
    const drift = row.cases.at(-1);
    assert.equal(drift.level, 'none');
    assert.ok(Math.abs(drift.gpuMedianMs / base.gpuMedianMs - 1) < 0.08, `A/B/A drift must stay small (${row.hour}h ${row.pose})`);
  }
  report.errors = errors;
  assert.deepEqual(errors, []);
  report.status = 'PASS';
  save();
} catch (error) {
  report.failed = String(error); save();
  throw error;
} finally {
  await call('Target.closeTarget', { targetId: target.id }).catch(() => {});
  ws.close();
}
