import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RenderDiagnostics } from '../src/dev/RenderDiagnostics.js';
import { CockpitOcclusion } from '../src/aircraft/CockpitOcclusion.js';

function fixture(gpu = false) {
  let time = 0, ratio = 1.5, queryId = 0, disjoint = false;
  const queries = [], deleted = [];
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: () => gpu ? { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 } : null,
    isContextLost: () => false, getParameter: () => disjoint,
    createQuery: () => { const query = { id: ++queryId }; queries.push(query); return query; },
    beginQuery() {}, endQuery() {}, deleteQuery: query => deleted.push(query),
    getQueryParameter: (_query, kind) => kind === 1 ? true : 2e6,
  };
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  material.onBeforeCompile = shader => { shader.originalRan = true; };
  material.customProgramCacheKey = () => 'base-cockpit';
  const deck = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  deck.add(mesh);
  const aircraft = new THREE.Group(), lights = new THREE.Group(), light = new THREE.PointLight();
  lights.add(light); aircraft.add(deck, lights);
  const scenery = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  scenery.frustumCulled = false;
  const hidden = new THREE.Group(); hidden.visible = false;
  const scene = new THREE.Scene(); scene.add(aircraft, scenery, hidden);
  const renderer = { getPixelRatio: () => ratio, setPixelRatio: value => { ratio = value; },
    getContext: () => gl, domElement: { width: 2160, height: 1350 }, shadowMap: { enabled: true },
    info: { autoReset: true, render: { calls: 0, triangles: 0 }, programs: [],
      reset() { this.render.calls = this.render.triangles = 0; } } };
  const sim = { scene, renderer, developerMode: { enabled: false }, renderQuality: 'balanced',
    aircraft: { group: aircraft, lightsGroup: lights, cockpit: { group: aircraft, gltfCockpitGroup: deck, gltfCockpitLoaded: true } },
    cockpitOcclusion: { enabled: true },
    renderStandardScene(quality) {
      this.lastQuality = quality;
      this.onRender?.(); renderer.info.render.calls += 5; renderer.info.render.triangles += 100;
    } };
  const trial = new RenderDiagnostics(sim, () => time);
  return { trial, sim, material, mesh, deck, scenery, light, hidden, queries, deleted,
    at: value => { time = value; }, disjoint: value => { disjoint = value; } };
}

test('render trials are gated, session-only, validated and preserve the original pixel ratio', () => {
  const { trial, sim } = fixture();
  assert.equal(trial.open(), false);
  assert.equal(trial.set('resolution', '0.5'), false);
  trial.render(); assert.equal(sim.renderer.info.autoReset, true);
  sim.developerMode.enabled = true; assert.equal(trial.open(), true);
  assert.equal(trial.set('__proto__', 'off'), false);
  assert.equal(trial.set('resolution', 'NaN'), false);
  assert.equal(trial.set('resolution', '0.5'), true);
  assert.equal(sim.renderer.getPixelRatio(), .5);
  trial.open(); trial.reset(); assert.equal(sim.renderer.getPixelRatio(), 1.5);
  assert.equal(trial.active, true); trial.close();
  assert.equal(sim.renderer.info.autoReset, true);
  assert.equal(trial.set('resolution', '1'), false);
});

test('unlit, sidedness, depth and culling restore across option changes and closing', () => {
  const { trial, sim, material, mesh, scenery } = fixture();
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey;
  sim.developerMode.enabled = true; trial.open();
  trial.set('material', 'unlit'); trial.set('side', 'front'); trial.set('depth', 'projection'); trial.set('culling', 'off');
  assert.equal(mesh.material.isMeshBasicMaterial, true);
  assert.equal(mesh.material.side, THREE.FrontSide);
  const shader = { fragmentShader: '#include <logdepthbuf_fragment>' };
  material.onBeforeCompile(shader, {}); assert.equal(shader.originalRan, true);
  assert.equal(scenery.frustumCulled, false);
  trial.set('material', 'default'); assert.equal(mesh.material, material);
  trial.close();
  assert.equal(mesh.material, material); assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.onBeforeCompile, compile); assert.equal(material.customProgramCacheKey, key);
  assert.equal(mesh.frustumCulled, true); assert.equal(scenery.frustumCulled, false);
});

test('per-frame visibility and AO restore on errors; configured shadows restore on closing', () => {
  const { trial, sim, light, hidden, scenery } = fixture();
  sim.developerMode.enabled = true; trial.open();
  trial.set('scene', 'cockpit'); trial.set('lights', 'noLocal'); trial.set('ao', 'off'); trial.set('shadows', 'off');
  sim.onRender = () => {
    assert.equal(scenery.visible, false); assert.equal(light.visible, false);
    assert.equal(sim.cockpitOcclusion.enabled, false); assert.equal(sim.renderer.shadowMap.enabled, false);
    throw Error('render failed');
  };
  assert.throws(() => trial.render(), /render failed/);
  assert.equal(scenery.visible, true); assert.equal(light.visible, true); assert.equal(hidden.visible, false);
  assert.equal(sim.cockpitOcclusion.enabled, true); assert.equal(sim.renderer.shadowMap.enabled, false);
  sim.onRender = null; sim.renderQuality = 'performance'; trial.set('ao', 'on'); trial.render();
  assert.equal(sim.lastQuality, 'balanced', 'AO can be isolated from the global performance preset');
  trial.close();
  assert.equal(sim.renderer.shadowMap.enabled, true);
});

test('newly loaded cockpit meshes receive the active trial and restore their own original materials', () => {
  const { trial, sim, deck } = fixture(); sim.developerMode.enabled = true; trial.open();
  trial.set('material', 'unlit'); trial.set('depth', 'projection');
  const material = new THREE.MeshStandardMaterial(), added = new THREE.Mesh(new THREE.BoxGeometry(), material);
  deck.add(added); trial.refreshScene(); assert.equal(added.material.isMeshBasicMaterial, true);
  trial.close(); assert.equal(added.material, material);
  assert.equal(trial.materials.size, 0); assert.equal(trial.meshes.size, 0);
});

test('shadow changes invalidate compiled lighting programs on both disable and reset', () => {
  const { trial, sim, material } = fixture(); sim.developerMode.enabled = true; trial.open();
  const initial = material.version;
  trial.set('shadows', 'off'); assert.ok(material.version > initial);
  const off = material.version;
  trial.reset(); assert.ok(material.version > off);
  trial.close();
});

test('warmup and unsupported GPU timing never report fake zero measurements', () => {
  const { trial, sim, at } = fixture(); sim.developerMode.enabled = true; trial.open();
  trial.render(); assert.equal(trial.snapshot().samples, 0);
  at(2100); trial.render(); assert.equal(trial.snapshot().fps, null);
  at(2120); trial.render(); const sample = trial.snapshot();
  assert.equal(sample.gpuSupported, false); assert.equal(sample.gpuMs, null);
  assert.equal(sample.fps, 50); assert.equal(sample.calls, 5); assert.equal(sample.triangles, 100);
  assert.equal(sample.frameP95, 20); trial.close();
});

test('GPU queries are asynchronous, discard disjoint samples and clean up on disable', () => {
  const { trial, sim, at, queries, deleted, disjoint } = fixture(true);
  sim.developerMode.enabled = true; trial.open(); at(2100); trial.render();
  assert.equal(trial.snapshot().gpuMs, null);
  at(2120); trial.render(); assert.equal(trial.snapshot().gpuMs, 2);
  disjoint(true); at(2140); trial.render(); assert.equal(trial.snapshot().gpuMs, null);
  assert.equal(trial.snapshot().samples, 0);
  disjoint(false); at(5000); trial.render();
  sim.developerMode.enabled = false; trial.render();
  assert.equal(trial.active, false); assert.equal(sim.renderer.info.autoReset, true);
  assert.equal(deleted.length, queries.length);
});

for (const option of ['default', 'projection', 'unlit']) test(`loader-installed lighting survives refresh and close during ${option} trials`, () => {
  const { trial, sim, material } = fixture(); sim.developerMode.enabled = true; trial.open();
  if (option === 'projection') trial.set('depth', option);
  if (option === 'unlit') trial.set('material', option);
  const baked = shader => { shader.baked = true; }, key = () => 'bake-ready';
  material.onBeforeCompile = baked; material.customProgramCacheKey = key;
  trial.refreshScene();
  const shader = { fragmentShader: '#include <logdepthbuf_fragment>' };
  material.onBeforeCompile(shader, {}); assert.equal(shader.baked, true);
  trial.close();
  assert.equal(material.onBeforeCompile, baked); assert.equal(material.customProgramCacheKey, key);
});

test('first AO initialization uses original cockpit materials while an unlit trial is active', t => {
  const { trial, sim, deck, mesh } = fixture();
  sim.developerMode.enabled = true; sim.renderQuality = 'performance';
  sim.cameraSystem = { mode: 0, photoCockpit: false, isLookingAwayFromCenter: () => false };
  sim.aircraft.cockpit.gltfCockpitLoaded = true;
  const display = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()); deck.add(display);
  const ao = new CockpitOcclusion(sim.scene, new THREE.PerspectiveCamera(), sim.aircraft.cockpit);
  t.after(() => ao.dispose()); sim.cockpitOcclusion = ao;
  sim.renderStandardScene = quality => { if (ao.enabled && quality !== 'performance' && !ao.pass) ao.init(); };
  trial.open(); trial.set('material', 'unlit'); trial.set('ao', 'on'); trial.render();
  assert.equal(mesh.material.isMeshBasicMaterial, true, 'The actual experiment still renders unlit');
  assert.ok(mesh.layers.isEnabled(1), 'Opaque cockpit surfaces belong to the AO geometry layer');
  assert.equal(mesh.layers.isEnabled(2), false, 'Temporary unlit surfaces are not instrument displays');
  assert.ok(display.layers.isEnabled(2));
  trial.close(); assert.ok(mesh.layers.isEnabled(1)); assert.equal(mesh.layers.isEnabled(2), false);
});

test('unified C172 models reject cockpit-only material trials without changing exterior materials', () => {
  const { trial, sim, mesh, material } = fixture();
  sim.aircraft.cockpit.gltfCockpitGroup = sim.aircraft.group;
  sim.aircraft.cockpit.group = new THREE.Group();
  sim.developerMode.enabled = true; trial.open();
  assert.equal(trial.set('material', 'unlit'), false);
  assert.equal(trial.set('side', 'front'), false);
  assert.equal(mesh.material, material); assert.equal(material.side, THREE.DoubleSide);
  trial.close();
});

test('pending baked receiver binding cannot be bypassed by swapping materials before loading completes', () => {
  const { trial, sim, material, mesh } = fixture();
  sim.aircraft.cockpit.gltfCockpitLoaded = false;
  sim.developerMode.enabled = true; trial.open();
  assert.equal(trial.hasDedicatedCockpit, true);
  assert.equal(trial.set('material', 'unlit'), false); assert.equal(trial.set('side', 'front'), false);
  assert.equal(mesh.material, material, 'The pending baker must still find StandardMaterials to bind');
  sim.aircraft.cockpit.gltfCockpitLoaded = true; trial.refreshScene();
  assert.equal(trial.set('material', 'unlit'), true);
  trial.close(); assert.equal(mesh.material, material);
});

test('leaving or closing a visibility experiment invalidates a consumed cockpit shadow cache', () => {
  const { trial, sim, light } = fixture();
  light.castShadow = true; light.shadow.autoUpdate = false;
  sim.onRender = () => { if (!sim.aircraft.group.visible) light.shadow.needsUpdate = false; };
  sim.developerMode.enabled = true; trial.open(); trial.set('scene', 'world'); trial.render();
  assert.equal(light.shadow.needsUpdate, false, 'The experiment consumed an empty caster map');
  trial.set('scene', 'default'); assert.equal(light.shadow.needsUpdate, true);
  trial.set('scene', 'world'); trial.render(); assert.equal(light.shadow.needsUpdate, false);
  trial.close(); assert.equal(light.shadow.needsUpdate, true);
});
