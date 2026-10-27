import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Does the sun shadow map still get rebuilt when it has to be, and does skipping it cost
// a pixel anywhere? Measures a parked flight deck (where the reuse should pay) against
// `sun.shadow.autoUpdate = true`, which is what this branch replaced, then repeats it while
// the airframe advances (where nothing may change, in time or in pixels).
// Run under chrome-session --project flight3d with Vite already serving APP_URL.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5173/';
const dir = process.env.ARTIFACT_DIR || '.cache/cockpit-shadow-scope';
const seconds = Number(process.env.MEASURE_SECONDS || 3);
const POSES = [
  { key: 'forward', yaw: 0, pitch: -0.25 },
  { key: 'right', yaw: 1.3, pitch: -0.1 },
  { key: 'rear', yaw: 2.7, pitch: -0.15 },
  { key: 'overhead', yaw: 0, pitch: 0.6 },
];
const HOURS = (process.env.VIEWS || '12,23').split(',').map(Number);
const POSE_FILTER = process.env.POSES ? process.env.POSES.split(',') : null;
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
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout ${method}`)); }, 180000);
  pending.set(id, result => { clearTimeout(timer); pending.delete(id); result.error ? reject(Error(JSON.stringify(result.error))) : resolve(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const report = { url, seconds, rows: [], moving: [], errors: [] };
const save = () => fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report, null, 2));

// One cockpit frame at a settled pose, timed on the GPU and on the wall clock, with the
// number of shadow passes the refresh asked for. `move` slides the airframe, which is what
// a real flight does to the sun's box every frame.
const measure = (hour, pose, level, move = false) => evaluate(`(async () => {
  const s = window.simulator, gl = s.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const sun = s.sky.sunLight, refresh = s.sky.sunShadowRefresh;
  s.sky.setTimeOfDay(${hour});
  s.cameraSystem.lookYaw = ${pose.yaw}; s.cameraSystem.lookPitch = ${pose.pitch};
  s.aircraft.cockpit.syncLighting(s.sky, s.quaternion, 10);
  window.__scopePin();
  s.stepSimulation(0);
  window.__scopeTrial('${level}');
  s.renderScene(); gl.finish(); // Allocate the target and compile before anything is timed.
  let passes = 0;
  const original = refresh.beforeRender;
  const wrapped = refresh.beforeRender.bind(refresh);
  refresh.beforeRender = (scene, camera) => { const needed = wrapped(scene, camera); if (needed) passes++; return needed; };
  const queries = [], times = [], marks = []; let previous, frames = 0;
  const poll = () => {
    for (let i = queries.length - 1; i >= 0; i--) if (gl.getQueryParameter(queries[i], gl.QUERY_RESULT_AVAILABLE)) {
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(queries[i], gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(queries[i]); queries.splice(i, 1);
    }
  };
  const start = performance.now();
  await new Promise(resolve => {
    const tick = t => {
      poll();
      if (previous !== undefined) marks.push(t - previous);
      previous = t;
      // Slid rather than stepped in the moving run: the physics write-back would keep
      // putting the airframe back where it started, and that run only needs a sun which
      // has to follow a moving aircraft.
      if (${move}) s.aircraft.group.position.x += 0.5; else s.stepSimulation(1 / 60);
      const query = ext && queries.length < 4 ? gl.createQuery() : null;
      if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      s.renderScene();
      if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(query); }
      frames++;
      if (performance.now() - start < ${seconds * 1000}) requestAnimationFrame(tick); else resolve();
    };
    tick(start);
  });
  const deadline = performance.now() + 5000;
  while (queries.length && performance.now() < deadline) { await new Promise(requestAnimationFrame); poll(); }
  refresh.beforeRender = original;
  marks.sort((a, b) => a - b);
  times.sort((a, b) => a - b);
  window.__scopeTrial('ship');
  return { level: '${level}', frames, passes, samples: times.length,
    gpuMedianMs: times[Math.floor(times.length / 2)] ?? null,
    gpuP95Ms: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? null,
    wallMedianMs: marks[Math.floor(marks.length / 2)] ?? null,
    contextLost: gl.isContextLost() };
})()`);

// The same pose rendered by both levels, compared over the whole drawing buffer.
const diff = (hour, pose, left, right) => evaluate(`(() => {
  const s = window.simulator, gl = s.renderer.getContext();
  const grab = level => {
    s.sky.setTimeOfDay(${hour});
    s.cameraSystem.lookYaw = ${pose.yaw}; s.cameraSystem.lookPitch = ${pose.pitch};
    s.aircraft.cockpit.syncLighting(s.sky, s.quaternion, 10);
    window.__scopePin();
    s.stepSimulation(0);
    window.__scopeTrial(level);
    s.renderScene(); s.renderScene(); gl.finish();
    const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  };
  const a = grab('${left}'), b = grab('${right}');
  let changedPixels = 0, squared = 0, max = 0; const spots = [];
  for (let i = 0; i < a.length; i += 4) {
    let hit = false;
    for (let channel = 0; channel < 3; channel++) {
      const d = Math.abs(a[i + channel] - b[i + channel]);
      if (d) { hit = true; squared += d * d; max = Math.max(max, d); }
    }
    if (hit) { changedPixels++; if (spots.length < 6) spots.push([i / 4 % gl.drawingBufferWidth, Math.floor(i / 4 / gl.drawingBufferWidth)]); }
  }
  window.__scopeTrial('ship');
  return { pair: '${left} vs ${right}', changedFraction: changedPixels / (a.length / 4),
    rmse: Math.sqrt(squared / a.length), max, spots, glError: gl.getError() };
})()`);

const shoot = async (hour, pose, level, file) => {
  const data = await evaluate(`(() => {
    const s = window.simulator;
    s.sky.setTimeOfDay(${hour});
    s.cameraSystem.lookYaw = ${pose.yaw}; s.cameraSystem.lookPitch = ${pose.pitch};
    s.aircraft.cockpit.syncLighting(s.sky, s.quaternion, 10);
    window.__scopePin();
    s.stepSimulation(0);
    window.__scopeTrial('${level}');
    s.renderScene(); s.renderScene();
    const image = s.renderer.domElement.toDataURL('image/png').split(',')[1];
    window.__scopeTrial('ship');
    s.renderScene();
    return image;
  })()`);
  fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
};

try {
  await call('Runtime.enable'); await call('Page.enable'); await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 240; i++) {
    if (await evaluate('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded')) break;
    await sleep(500);
  }
  report.setup = await evaluate(`(() => {
    const s = window.simulator;
    s.animate = () => {};
    s.demoDirector.stop(); s.gameFlow.enterFlight(); s.setPreset('runway');
    s.integratePhysics = () => {}; // A parked deck: the view moves, the airframe does not.
    s.cameraSystem.photoCockpit = false; s.cameraSystem.setMode(0, true);
    s.cameraSystem.enableCursorTrack = false; s.cameraSystem.enableEdgePan = false;
    s.setRenderQuality('balanced'); s.stepSimulation(0);
    // A parked deck still moves: the 737's strobe and beacon flash on performance.now(),
    // so does the airport's approach "rabbit", and the turbine fans and the ocean's wave
    // phase accumulate one step at a time — and a measured run takes a different number of
    // steps every time. None of that is the sun's map, so the animators are parked before a
    // single frame is compared. Without this, two identical renders differ by ~3% of pixels.
    const frozen = [];
    for (const [name, owner] of [['aircraft', s.aircraft], ['water', s.water], ['ships', s.ships],
      ['airport', s.airport], ['incheonAirport', s.incheonAirport], ['luklaAirport', s.luklaAirport],
      ['currentAirport', s.currentAirport],
      ['explosions', s.explosionSystem], ['smoke', s.tireSmokeSystem]]) {
      if (typeof owner?.update === 'function') { owner.update = () => {}; frozen.push(name); }
    }
    const sun = s.sky.sunLight;
    const parked = s.aircraft.group.position.clone();
    // A run accumulates an instrument clock, and the panel displays redraw from it, so two
    // runs of different lengths leave the same deck showing different digits. Pin what the
    // animators used to advance before every settle.
    window.__scopePin = () => { s.totalSimTime = 0; s.physicsAccumulator = 0; };
    window.__scopeTrial = level => {
      sun.shadow.autoUpdate = level === 'before';
      sun.shadow.needsUpdate = true; // The first frame fills the map whichever level runs.
      s.aircraft.group.position.copy(parked); // Both levels start the run from the same pose.
      return { level, autoUpdate: sun.shadow.autoUpdate };
    };
    let casters = 0, meshes = 0;
    const moving = [];
    s.scene.traverse(object => {
      if (!object.isMesh) return;
      for (let node = object; node; node = node.parent) if (!node.visible) return;
      meshes++;
      if (!object.castShadow) return;
      casters++;
      if (/prop|blade|rotor/i.test(object.name || '')) moving.push(object.name);
    });
    window.__scopeTrial('ship');
    return { autoUpdate: sun.shadow.autoUpdate, mapSize: sun.shadow.mapSize.x,
      quality: s.renderQuality ?? null, refresh: typeof s.sky.sunShadowRefresh?.beforeRender === 'function',
      casters, meshes, spinningCastors: moving.slice(0, 8), animatorsParked: frozen };
  })()`);
  assert.equal(report.setup.autoUpdate, false, 'The sun pass must be on demand in the shipped build');
  assert.equal(report.setup.refresh, true, 'SkyAtmosphere must own a SunShadowRefresh');
  console.log(`sun map ${report.setup.mapSize}px on demand, ${report.setup.casters}/${report.setup.meshes} meshes cast into it`
    + `, spinning castors: ${report.setup.spinningCastors.join(', ') || 'none'}`
    + `, animators parked: ${report.setup.animatorsParked.join(', ')}`);

  for (const hour of HOURS) for (const pose of POSES.filter(item => !POSE_FILTER || POSE_FILTER.includes(item.key))) {
    const row = { hour, pose: pose.key, cases: [] };
    report.rows.push(row);
    save();
    for (const level of ['ship', 'before', 'ship']) {
      row.cases.push(await measure(hour, pose, level));
      save();
    }
    const [ship, before, again] = row.cases;
    // Two identical renders of the same pose are not bit-identical in this pipeline: a few
    // pixels land differently every frame, and they still do with the shadow pass switched
    // off entirely. Take the worst of three same-level pairs as this view's floor, and hold
    // the cross-level comparison to it.
    const noise = { pair: 'ship vs ship', changedFraction: 0, max: 0, spots: [] };
    for (let attempt = 0; attempt < 3; attempt++) {
      const sample = await diff(hour, pose, 'ship', 'ship');
      noise.changedFraction = Math.max(noise.changedFraction, sample.changedFraction);
      noise.max = Math.max(noise.max, sample.max);
      noise.spots = sample.spots;
    }
    Object.assign(before, await diff(hour, pose, 'before', 'ship'));
    before.noiseFraction = noise.changedFraction;
    before.noiseMax = noise.max;
    before.noiseSpots = noise.spots;
    for (const level of ['ship', 'before']) await shoot(hour, pose, level, `${hour}h-${pose.key}-${level}.png`);
    save();
    ship.deltaGpuPct = +(100 * (ship.gpuMedianMs / before.gpuMedianMs - 1)).toFixed(1);
    again.driftPct = +(100 * (again.gpuMedianMs / ship.gpuMedianMs - 1)).toFixed(1);
    console.log(`${hour}h ${pose.key} rebuilt ${ship.passes}/${ship.frames} `
      + `ship ${ship.gpuMedianMs.toFixed(1)}ms wall ${ship.wallMedianMs.toFixed(1)}ms | `
      + `before ${before.gpuMedianMs.toFixed(1)}ms wall ${before.wallMedianMs.toFixed(1)}ms `
      + `(${ship.deltaGpuPct}%, ${(100 * before.changedFraction).toFixed(3)}%px max ${before.max}, `
      + `noise ${(100 * noise.changedFraction).toFixed(3)}%px max ${noise.max}) | A/B/A ${again.driftPct}%`);
  }

  // In motion: the sun's box follows the airframe, so the map is genuinely stale every frame
  // and the refresh must neither skip a pass nor add measurable cost to one.
  const move = { hour: HOURS[0], pose: 'taxiing', nudge: 0.5 };
  report.moving.push(move);
  save();
  for (const level of ['ship', 'before']) move[level] = await measure(HOURS[0], POSES[0], level, true);
  move.deltaGpuPct = +(100 * (move.ship.gpuMedianMs / move.before.gpuMedianMs - 1)).toFixed(1);
  // The run is time-boxed, so throughput is the wall-clock measure that survives a median
  // quantised to whole 16.7 ms display ticks.
  move.deltaFramesPct = +(100 * (move.ship.frames / move.before.frames - 1)).toFixed(1);
  console.log(`taxiing rebuilt ${move.ship.passes}/${move.ship.frames} ship ${move.ship.gpuMedianMs.toFixed(1)}ms `
    + `vs before ${move.before.gpuMedianMs.toFixed(1)}ms (${move.deltaGpuPct}% gpu, ${move.deltaFramesPct}% frames)`);

  for (const row of report.rows) {
    const [ship, before, again] = row.cases;
    assert.ok(ship.passes <= ship.frames * 0.1, `A parked deck must mostly skip the pass (${row.hour}h ${row.pose}: ${ship.passes}/${ship.frames})`);
    assert.ok(before.passes >= before.frames * 0.9, `The baseline rebuilds every frame (${row.hour}h ${row.pose}: ${before.passes}/${before.frames})`);
    assert.ok(ship.gpuMedianMs < before.gpuMedianMs, `Skipping the pass must save GPU time (${row.hour}h ${row.pose})`);
    // 1e-5 of a 1600×900 frame is about fifteen pixels: the allowance for a view whose own
    // floor measured zero.
    assert.ok(before.changedFraction <= Math.max(before.noiseFraction * 2, 1e-5),
      `The reuse must not change more than the pipeline changes by itself (${row.hour}h ${row.pose}: `
      + `${(100 * before.changedFraction).toFixed(4)}% vs a ${(100 * before.noiseFraction).toFixed(4)}% floor)`);
    assert.ok(before.max <= Math.max(before.noiseMax, 64),
      `The reuse must not change any pixel more than the floor does (${row.hour}h ${row.pose}: ${before.max} vs ${before.noiseMax})`);
    assert.ok(before.noiseFraction < 1e-4,
      `The harness has stopped being reproducible (${row.hour}h ${row.pose}: ${(100 * before.noiseFraction).toFixed(4)}%)`);
    assert.ok(Math.abs(again.driftPct) < 8, `A/B/A drift must stay small (${row.hour}h ${row.pose}: ${again.driftPct}%)`);
    assert.equal(ship.contextLost, false);
  }
  assert.ok(report.moving[0].ship.passes >= report.moving[0].ship.frames * 0.9,
    'A moving airframe must rebuild the map every frame');
  assert.ok(Math.abs(report.moving[0].deltaGpuPct) < 5, 'Flight must not lose time to the check');
  assert.ok(Math.abs(report.moving[0].deltaFramesPct) < 5, 'Flight must not lose frames to the check');
  report.errors = errors;
  save();
} catch (error) {
  report.failed = String(error);
  save();
  throw error;
} finally {
  await call('Target.closeTarget', { targetId: target.id }).catch(() => {});
}
