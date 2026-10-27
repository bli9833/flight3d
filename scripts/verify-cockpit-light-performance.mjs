import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Run under chrome-session --project flight3d with Vite already serving APP_URL.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5173/';
const experiment = process.env.EXPERIMENT || 'floods';
assert.ok(['floods', 'direct'].includes(experiment), 'EXPERIMENT must be floods or direct');
const dir = process.env.ARTIFACT_DIR || `.cache/cockpit-light-performance-${experiment}`;
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
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout: ${method}`)); }, 60000);
  pending.set(id, result => {
    clearTimeout(timer); pending.delete(id);
    result.error ? reject(Error(JSON.stringify(result.error))) : resolve(result.result);
  });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitForCockpit = async () => {
  for (let i = 0; i < 180; i++) {
    if (await evaluate('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded')) return;
    await sleep(500);
  }
  throw Error('Cockpit did not load');
};
const configureTrial = () => evaluate(`(() => {
  const c = window.simulator.aircraft.cockpit, materials = new Map();
  c.gltfCockpitGroup.traverse(node => {
    if (!node.isMesh) return;
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (material.isMeshStandardMaterial && !materials.has(material)) {
        materials.set(material, { compile: material.onBeforeCompile, key: material.customProgramCacheKey });
      }
    }
  });
  window.__setLightingTrial = baseline => {
    if ('${experiment}' === 'floods') { c.floods.forEach(light => { light.visible = baseline; }); return; }
    for (const [material, original] of materials) {
      material.onBeforeCompile = function(shader, renderer) {
        original.compile.call(this, shader, renderer);
        if (baseline) shader.fragmentShader = shader.fragmentShader.replaceAll(
          'if ( directLight.visible ) RE_Direct(', 'RE_Direct('
        );
      };
      material.customProgramCacheKey = () => original.key.call(material) + ':trial-baseline-' + baseline;
      material.needsUpdate = true;
    }
  };
})()`);
const report = { experiment, visuals: [], timings: [] };
const save = () => fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report, null, 2));
try {
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await waitForCockpit();
  report.setup = await evaluate(`(async () => {
    const s = window.simulator, c = s.aircraft.cockpit;
    await c.shaderWarmup;
    s.animate = () => {};
    s.demoDirector.stop(); s.gameFlow.enterFlight(); s.setPreset('runway');
    s.cameraSystem.photoCockpit = false; s.cameraSystem.setMode(0, true);
    s.cameraSystem.enableCursorTrack = false; s.cameraSystem.enableEdgePan = false;
    s.setRenderQuality('balanced'); s.cockpitOcclusion.enabled = true;
    s.stepSimulation(0);
    const gl = s.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { bake: c.lightingBakeStatus, floods: c.floods.map(l => ({ visible: l.visible, intensity: l.intensity })),
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      gpuTimers: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
  })()`);
  assert.equal(report.setup.bake, 'ready');
  assert.ok(report.setup.floods.every(light => !light.visible && light.intensity === 0));
  await sleep(500); // Let the already-scheduled animation callback retire.
  await configureTrial();

  for (const hour of [12, 23]) for (const yaw of [0, Math.PI]) {
    const row = await evaluate(`(async () => {
      const s = window.simulator, c = s.aircraft.cockpit, gl = s.renderer.getContext();
      s.sky.setTimeOfDay(${hour}); s.cameraSystem.lookYaw = ${yaw}; s.cameraSystem.lookPitch = -.25;
      s.stepSimulation(0); c.syncLighting(s.sky, s.quaternion, 10);
      const shots = [], pixels = [];
      for (const visible of [true, true, false, false]) {
        window.__setLightingTrial(visible);
        s.renderScene();
        const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
        pixels.push(data); shots.push(s.renderer.domElement.toDataURL('image/png').split(',')[1]);
      }
      let changed = 0, changedPixels = 0, maxDifference = 0, squaredError = 0;
      let beforeDrift = 0, afterDrift = 0, beforeError = 0, afterError = 0;
      const locations = [];
      for (let i = 0; i < pixels[0].length; i += 4) {
        let pixelChanged = false;
        for (let channel = 0; channel < 4; channel++) {
          const k = i + channel, difference = Math.abs(pixels[1][k] - pixels[3][k]);
          if (difference) { changed++; pixelChanged = true; }
          squaredError += difference * difference;
          maxDifference = Math.max(maxDifference, difference);
          if (pixels[0][k] !== pixels[1][k]) beforeDrift++;
          if (pixels[2][k] !== pixels[3][k]) afterDrift++;
          beforeError += (pixels[0][k] - pixels[1][k]) ** 2;
          afterError += (pixels[2][k] - pixels[3][k]) ** 2;
        }
        if (pixelChanged) {
          changedPixels++;
          if (locations.length < 20) locations.push([i / 4 % gl.drawingBufferWidth, Math.floor(i / 4 / gl.drawingBufferWidth)]);
        }
      }
      return { hour: ${hour}, yaw: ${yaw}, changed, changedPixels, maxDifference, beforeDrift, afterDrift, locations,
        channels: pixels[0].length, changedFraction: changedPixels / (pixels[0].length / 4), rmse: Math.sqrt(squaredError / pixels[0].length),
        beforeRmse: Math.sqrt(beforeError / pixels[0].length), afterRmse: Math.sqrt(afterError / pixels[0].length),
        shots: [shots[1], shots[3]], glError: gl.getError() };
    })()`);
    for (let i = 0; i < row.shots.length; i++) {
      fs.writeFileSync(path.join(dir, `${hour}-${yaw === 0 ? 'forward' : 'rear'}-${i === 0 ? 'before' : 'after'}.png`), Buffer.from(row.shots[i], 'base64'));
    }
    delete row.shots; report.visuals.push(row); save();
    assert.equal(row.glError, 0);
    assert.ok(row.beforeDrift / row.channels < .0001, 'Baseline frames must be stable');
    assert.ok(row.afterDrift / row.channels < .0001, 'Optimized frames must be stable');
    // Shader variants can change subpixel raster/depth ties on fine model lettering.
    const rasterNoise = Math.max(.1, 2 * row.beforeRmse, 2 * row.afterRmse);
    assert.ok(row.changedFraction < .0001 && row.rmse <= rasterNoise, 'Optimization must preserve cockpit lighting');
  }

  if (report.setup.gpuTimers) for (const yaw of [0, Math.PI]) for (const visible of [true, false, false, true]) {
    const row = await evaluate(`(async () => {
      const s = window.simulator, c = s.aircraft.cockpit, gl = s.renderer.getContext();
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      s.sky.setTimeOfDay(12); s.cameraSystem.lookYaw = ${yaw}; s.stepSimulation(0);
      c.syncLighting(s.sky, s.quaternion, 10); window.__setLightingTrial(${visible});
      s.renderScene(); gl.finish(); // Complete cold pipeline compilation outside timing.
      const queries = [], times = [], frames = []; let previous;
      const poll = () => {
        for (let i = queries.length - 1; i >= 0; i--) if (gl.getQueryParameter(queries[i], gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(queries[i], gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(queries[i]); queries.splice(i, 1);
        }
      };
      const start = performance.now();
      await new Promise(resolve => {
        const tick = t => {
          poll(); if (previous !== undefined) frames.push(t - previous); previous = t;
          const query = queries.length < 4 ? gl.createQuery() : null;
          if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
          s.renderScene();
          if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(query); }
          if (performance.now() - start < 5000) requestAnimationFrame(tick); else resolve();
        }; requestAnimationFrame(tick);
      });
      const deadline = performance.now() + 5000;
      while (queries.length && performance.now() < deadline) { await new Promise(requestAnimationFrame); poll(); }
      const pending = queries.length; queries.forEach(query => gl.deleteQuery(query));
      times.sort((a,b) => a-b);
      return { yaw: ${yaw}, baseline: ${visible}, samples: times.length, pending,
        gpuMedianMs: times[Math.floor(times.length / 2)],
        fps: 1000 * frames.length / frames.reduce((a,b) => a+b,0), contextLost: gl.isContextLost() };
    })()`);
    assert.ok(row.samples > 0, 'GPU timing must produce samples');
    assert.equal(row.pending, 0, 'Every measured query must complete');
    assert.equal(row.contextLost, false);
    report.timings.push(row); console.log(JSON.stringify(row)); save();
  }

  await call('Network.enable');
  await call('Network.setBlockedURLs', { urls: ['*lighting/cockpit-*.json*'] });
  await call('Page.reload', { ignoreCache: true });
  await waitForCockpit();
  await configureTrial();
  report.fallback = await evaluate(`(() => {
    const s = window.simulator, c = s.aircraft.cockpit;
    s.animate = () => {}; s.demoDirector.stop(); s.gameFlow.enterFlight();
    s.cameraSystem.setMode(0, true); s.sky.setTimeOfDay(23); s.stepSimulation(0);
    return { bake: c.lightingBakeStatus, floods: c.floods.map((l,i) => ({ visible:l.visible, intensity:l.intensity, expected:c.floodBaseIntensity[i] })) };
  })()`);
  assert.equal(report.fallback.bake, 'fallback');
  assert.ok(report.fallback.floods.every(light => light.visible && light.intensity === light.expected));
  if (experiment === 'direct') {
    await sleep(500);
    report.fallback.comparison = await evaluate(`(() => {
      const s = window.simulator, gl = s.renderer.getContext(), pixels = [];
      for (const baseline of [true, true, false, false]) {
        window.__setLightingTrial(baseline); s.renderScene();
        const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
        pixels.push(data);
      }
      let squaredError = 0, beforeError = 0, afterError = 0, changed = 0;
      for (let i = 0; i < pixels[0].length; i++) {
        squaredError += (pixels[1][i] - pixels[3][i]) ** 2;
        beforeError += (pixels[0][i] - pixels[1][i]) ** 2;
        afterError += (pixels[2][i] - pixels[3][i]) ** 2;
        if (pixels[1][i] !== pixels[3][i]) changed++;
      }
      return { rmse: Math.sqrt(squaredError / pixels[0].length),
        beforeRmse: Math.sqrt(beforeError / pixels[0].length), afterRmse: Math.sqrt(afterError / pixels[0].length),
        changedFraction: changed / pixels[0].length, glError: gl.getError() };
    })()`);
    const comparison = report.fallback.comparison;
    assert.ok(comparison.changedFraction < .0001 && comparison.rmse <= Math.max(.1, 2 * comparison.beforeRmse, 2 * comparison.afterRmse),
      'Active fallback floods must retain their lighting');
    assert.equal(report.fallback.comparison.glError, 0);
  }
  assert.deepEqual(errors, []); report.status = 'PASS';
} catch (error) {
  report.failure = error.stack; process.exitCode = 1; console.error(error);
} finally {
  report.errors = errors; save();
  await fetch(`${endpoint}/json/close/${target.id}`).catch(() => {});
  ws.close();
}
