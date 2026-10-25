// Start Vite on port 5186, then run through chrome-session --project flight3d.
// Compares the pre-district main revision with the working tree on actual terrain.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve(process.env.ARTIFACT_DIR || '.tmp/city-district');
const baseline = process.env.BASELINE_REF || '2542473';
await mkdir(output, { recursive: true });
await mkdir('.tmp/city-district', { recursive: true });
const beforeSource = execFileSync('git', ['show', `${baseline}:src/environment/FoliageAndCities.js`], { encoding: 'utf8' });
// Inject the same seeded placement source into the baseline. Three.js object
// creation also consumes Math.random, so global seeding would shift positions.
const deterministicBefore = beforeSource.replace('constructor(terrain) {',
  'constructor(terrain, random = Math.random) { this.random = random;').replaceAll('Math.random()', 'this.random()').replaceAll("from './", "from '/src/environment/");
await writeFile('.tmp/city-district/FoliageAndCities-before.js', deterministicBefore);
await writeFile('.tmp/city-district/review.html', '<!doctype html><html><body style="margin:0"></body></html>');

const port = Number(process.env.CHROME_DEBUG_PORT || 9225);
let targetId;
const delay = ms => new Promise(r => setTimeout(r, ms));
let socket, sequence = 0;
const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timeout`)); }, 60000);
  pending.set(id, message => {
    clearTimeout(timer);
    message.error ? reject(Error(`${method}: ${JSON.stringify(message.error)}`)) : resolve(message.result);
  });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (fn, arg) => {
  const result = await send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(arg)})`, returnByValue: true, awaitPromise: true
  });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};

try {
  let target;
  for (let i = 0; i < 100; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); targetId = target.id; }
    catch { /* Chrome is starting. */ }
    if (target) break;
    await delay(100);
  }
  assert.ok(target, 'Chrome CDP target required');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const site = process.env.SIM_URL || 'http://127.0.0.1:5186';
  await send('Page.navigate', { url: `${site}/.tmp/city-district/review.html` });
  await delay(500);

  const setup = await evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { FoliageAndCities: Before } = await import('/.tmp/city-district/FoliageAndCities-before.js');
    const { FoliageAndCities: After } = await import('/src/environment/FoliageAndCities.js');
    const { Terrain } = await import('/src/environment/Terrain.js');
    const terrain = new Terrain();
    terrain.excludePavement(new T.Group());
    const create = Type => {
      let seed = 12345;
      const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
      return new Type(terrain, random);
    };
    const before = create(Before), after = create(After);
    if (!await after.districtReady) throw Error('District GLB failed to load');
    for (const city of [before, after]) {
      // The first two children are the unchanged foliage instancing groups.
      city.group.traverse(node => { if (node.name.startsWith('tree-')) node.visible = false; });
    }
    const scene = new T.Scene();
    scene.background = new T.Color(0xa8bfd1);
    scene.fog = new T.FogExp2(0xa8bfd1, 0.00005);
    scene.add(terrain.mesh);
    const ambient = new T.HemisphereLight(0xffffff, 0x53615a, 2); scene.add(ambient);
    const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(-800, 1200, -500); scene.add(sun);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(1440, 900);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    const camera = new T.PerspectiveCamera(52, 1.6, 1, 16000);
    scene.add(before.group, after.group);
    window.review = { terrain, T, before, after, scene, renderer, camera, ambient, sun };
    const gl = renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    const originalCenters = new Set(before.buildingData.map(building => `${building.x},${building.y},${building.z}`));
    const sameCenters = after.buildingData.filter(building => originalCenters.has(`${building.x},${building.y},${building.z}`)).length;
    return { browser: navigator.userAgent,
      gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      districtLoaded: after.districtLoaded, beforeBuildings: before.buildingData.length, afterBuildings: after.buildingData.length, sameCenters };
  });
  assert.ok(setup.beforeBuildings > 200 && setup.afterBuildings > 200);
  assert.ok(setup.districtLoaded);
  const cases = [
    ['district-low-day', [1400, 180, 1500], [900, 70, 950], 12],
    ['district-high-day', [2300, 1500, 2200], [900, 70, 950], 12],
    ['district-low-night', [1400, 180, 1500], [900, 70, 950], 23]
  ];
  const metrics = [];
  for (const [view, position, target, hour] of cases) {
    for (const version of ['before', 'after']) {
      const result = await evaluate(async ({ version, position, target, hour }) => {
        const { T, before, after, scene, renderer, camera, ambient, sun } = window.review;
        before.group.visible = version === 'before'; after.group.visible = version === 'after';
        const night = hour === 23;
        scene.background.set(night ? 0x111827 : 0xa8bfd1);
        scene.fog.color.copy(scene.background);
        ambient.intensity = night ? 0.25 : 2;
        sun.intensity = night ? 0.06 : 3;
        before.setTimeOfDay(hour);
        before.updateCityLod(new T.Vector3(...position));
        after.setTimeOfDay(hour);
        camera.position.set(...position); camera.lookAt(...target); camera.updateMatrixWorld();
        after.updateCityLod(camera.position);
        for (let i = 0; i < 5; i++) renderer.render(scene, camera);
        const gl = renderer.getContext(), samples = [];
        for (let i = 0; i < 20; i++) {
          const start = performance.now(); renderer.render(scene, camera); gl.finish(); samples.push(performance.now() - start);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        samples.sort((a, b) => a - b);
        const textures = new Set();
        (version === 'before' ? before : after).group.traverse(node => {
          if (!node.isMesh || !node.visible) return;
          for (const material of [node.material].flat()) {
            if (material.map) textures.add(material.map);
            if (material.emissiveMap) textures.add(material.emissiveMap);
          }
        });
        return {
          calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          frameMsMedian: samples[10], frameMsP95: samples[18],
          textureCount: textures.size,
          textureBytesRGBA8: [...textures].reduce((sum, texture) =>
            sum + texture.image.width * texture.image.height * 4 * (texture.generateMipmaps ? 4 / 3 : 1), 0),
          nearInstances: version === 'after' ? after.cityArchetypes.reduce((n, a) => n + a.near.count, 0) : null,
          farInstances: version === 'after' ? after.cityArchetypes.reduce((n, a) => n + a.far.count, 0) : null
        };
      }, { version, position, target, hour });
      metrics.push({ view, version, ...result });
      const screenshot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
      await writeFile(join(output, `${view}-${version}.jpg`), Buffer.from(screenshot.data, 'base64'));
      console.log(view, version, JSON.stringify(result));
    }
  }
  assert.equal(metrics.length, cases.length * 2);
  assert.equal(errors.length, 0, `Browser exceptions: ${errors.join('; ')}`);
  for (const result of metrics.filter(metric => metric.version === 'after')) {
    assert.equal(result.nearInstances + result.farInstances, setup.afterBuildings);
    assert.ok(result.calls <= 15, 'Terrain, roads and twelve city batches');
    assert.ok(result.textureBytesRGBA8 < 750000, 'Two 256px RGBA8 atlases with mipmaps');
  }
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*district-kit.glb*'] });
  const fallback = await evaluate(async () => {
    const { FoliageAndCities } = await import('/src/environment/FoliageAndCities.js');
    const city = new FoliageAndCities(window.review.terrain, () => .5);
    const loaded = await city.districtReady;
    return { loaded, districtBuildings: city.buildingData.filter(b => b.archetype >= 3).length,
      usesFallback: city.cityArchetypes.slice(3).every(b => b.near.material === city.cityAssets.nearMaterial) };
  });
  await send('Network.setBlockedURLs', { urls: [] });
  assert.equal(fallback.loaded, false);
  assert.equal(fallback.districtBuildings, 110);
  assert.ok(fallback.usesFallback);
  await writeFile(join(output, 'browser-results.json'), JSON.stringify({ baseline, host: { platform: platform(), cpu: cpus()[0].model }, ...setup,
    resolution: [1440, 900], fallback, glbTransferBytes: (await readFile('public/models/city/district-kit.glb')).length, metrics, errors,
    note: 'Isolated city on actual coastal terrain, seeded placement. Frame wall time uses gl.finish after 5 warmups; not full-flight FPS. Texture memory estimates RGBA8 plus mipmaps.' }, null, 2));
} finally {
  socket?.close();
  if (targetId) await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}
