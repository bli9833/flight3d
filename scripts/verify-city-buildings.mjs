// Start Vite on port 5173 first. Compare the parent of this branch with current source.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve(process.env.ARTIFACT_DIR || '.tmp/city-buildings');
const baseline = process.env.BASELINE_REF || '28559fc';
await mkdir(output, { recursive: true });
await mkdir('.tmp/city-buildings', { recursive: true });
const beforeSource = execFileSync('git', ['show', `${baseline}:src/environment/FoliageAndCities.js`], { encoding: 'utf8' });
// Inject the same seeded placement source into the baseline. Three.js object
// creation also consumes Math.random, so global seeding would shift positions.
const deterministicBefore = beforeSource.replace('constructor(terrain) {',
  'constructor(terrain, random = Math.random) { this.random = random;').replaceAll('Math.random()', 'this.random()');
await writeFile('.tmp/city-buildings/FoliageAndCities-before.js', deterministicBefore);
await writeFile('.tmp/city-buildings/review.html', '<!doctype html><html><body style="margin:0"></body></html>');
const afterSource = await readFile('src/environment/FoliageAndCities.js');
const assetsSource = await readFile('src/environment/CityBuildingAssets.js');

const profile = await mkdtemp(join(tmpdir(), 'flight3d-city-'));
const port = Number(process.env.CDP_PORT || 9471);
const chrome = spawn(process.env.CHROME_PATH || 'google-chrome-stable', [
  '--headless=new', '--no-sandbox', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--window-size=1440,900', '--no-first-run', '--no-default-browser-check',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'
], { stdio: 'ignore' });
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
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(page => page.type === 'page'); }
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
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const site = process.env.SIM_URL || 'http://127.0.0.1:5173';
  await send('Page.navigate', { url: `${site}/.tmp/city-buildings/review.html` });
  await delay(500);

  const setup = await evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { FoliageAndCities: Before } = await import('/.tmp/city-buildings/FoliageAndCities-before.js');
    const { FoliageAndCities: After } = await import('/src/environment/FoliageAndCities.js');
    const terrain = { getHeight: () => 25 };
    const create = Type => {
      let seed = 12345;
      const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
      return new Type(terrain, random);
    };
    const before = create(Before), after = create(After);
    for (const city of [before, after]) {
      // The first two children are the unchanged foliage instancing groups.
      city.group.children[0].visible = city.group.children[1].visible = false;
    }
    const scene = new T.Scene();
    scene.background = new T.Color(0xa8bfd1);
    scene.fog = new T.FogExp2(0xa8bfd1, 0.00005);
    const ground = new T.Mesh(new T.PlaneGeometry(12000, 12000), new T.MeshStandardMaterial({ color: 0x77866d }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 24.5; scene.add(ground);
    const ambient = new T.HemisphereLight(0xffffff, 0x53615a, 2); scene.add(ambient);
    const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(-800, 1200, -500); scene.add(sun);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(1440, 900);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.appendChild(renderer.domElement);
    const camera = new T.PerspectiveCamera(52, 1.6, 1, 16000);
    scene.add(before.group, after.group);
    window.review = { T, before, after, scene, renderer, camera, ambient, sun };
    const gl = renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
    const originalCenters = new Set(before.buildingData.map(building => `${building.x},${building.y},${building.z}`));
    const sameCenters = after.buildingData.filter(building => originalCenters.has(`${building.x},${building.y},${building.z}`)).length;
    return { browser: navigator.userAgent,
      gpu: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      beforeBuildings: before.buildingData.length, afterBuildings: after.buildingData.length, sameCenters };
  });
  assert.ok(setup.beforeBuildings > 400 && setup.afterBuildings > 400);
  assert.equal(setup.sameCenters, setup.afterBuildings, 'New buildings must retain their baseline positions');
  const cases = [
    ['east-near-day', [3500, 175, 2600], [2800, 75, 1400], 12],
    ['east-skyline-day', [6500, 700, 4300], [2800, 90, 1400], 12],
    ['north-near-day', [-1000, 140, -1600], [-800, 55, -2800], 12],
    ['east-near-night', [3500, 175, 2600], [2800, 75, 1400], 23]
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
    assert.ok(result.calls <= 8, 'Ground plus six city draw calls');
    assert.ok(result.textureBytesRGBA8 < 750000, 'Two 256px RGBA8 atlases with mipmaps');
  }
  const sourceBytes = { before: Buffer.byteLength(beforeSource), after: afterSource.length + assetsSource.length };
  await writeFile(join(output, 'browser-results.json'), JSON.stringify({ baseline, host: { platform: platform(), cpu: cpus()[0].model }, ...setup,
    resolution: [1440, 900], sourceBytes, atlasTransferBytes: 0, metrics, errors,
    note: 'Isolated city and flat ground, seeded placement. Frame wall time uses gl.finish after 5 warmups; not full-flight FPS. Texture memory estimates RGBA8 plus mipmaps. Source bytes are uncompressed JS source, not production bundle transfer.' }, null, 2));
} finally {
  socket?.close();
  chrome.kill();
  await delay(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
