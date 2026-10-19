import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

if (typeof document === 'undefined') {
  const noop = () => {};
  const mockCtx = new Proxy({}, {
    get: () => () => ({ addColorStop: noop })
  });
  globalThis.document = {
    createElement: () => ({
      getContext: () => mockCtx,
      width: 64,
      height: 64
    })
  };
}

import { Boeing737 } from '../src/aircraft/Boeing737.js';
import { PFDCanvas } from '../src/aircraft/PFDCanvas.js';
import { NDCanvas } from '../src/aircraft/NDCanvas.js';
import { EICASCanvas } from '../src/aircraft/EICASCanvas.js';

describe('Boeing737 PBR Model & IBL Reflection System', () => {
  it('should initialize Boeing737 with GLTF container and fallback procedural geometry', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    assert.ok(aircraft.group instanceof THREE.Group, 'Aircraft root must be a THREE.Group');
    assert.ok(aircraft.gltfGroup instanceof THREE.Group, 'GLTF container must exist');
    assert.strictEqual(aircraft.gltfGroup.name, 'GLTF_Boeing737');
    assert.strictEqual(aircraft.useGltf, false, 'Default should be procedural fallback before async GLB load');
    assert.ok(aircraft.fuselageGroup, 'Procedural fuselage group must exist as fallback');
  });

  it('should preserve setCockpitMode contract across both GLTF and procedural modes', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    // Procedural mode: enter cockpit
    aircraft.setCockpitMode(true);
    assert.strictEqual(aircraft.fuselageGroup.visible, false, 'Procedural fuselage must be hidden in cockpit view');
    assert.strictEqual(aircraft.cockpit.group.visible, true, 'Cockpit instruments must be visible in cockpit view');

    // Procedural mode: exit cockpit (chase view)
    aircraft.setCockpitMode(false);
    assert.strictEqual(aircraft.fuselageGroup.visible, true, 'Procedural fuselage must be visible in exterior view');
    assert.strictEqual(aircraft.tailGroup.visible, true, 'Procedural tail must be visible in exterior view');
    assert.strictEqual(aircraft.empennageGroup.visible, true, 'empennageGroup must match tailGroup visibility');
    assert.strictEqual(aircraft.cockpit.group.visible, false, 'Cockpit interior must be hidden in exterior view');

    // Simulate GLTF loaded state
    aircraft.useGltf = true;
    aircraft.setCockpitMode(true);
    assert.strictEqual(aircraft.gltfGroup.visible, false, 'GLTF model must be hidden in cockpit view');
    assert.strictEqual(aircraft.cockpit.group.visible, true, 'Cockpit must be visible in cockpit view');

    aircraft.setCockpitMode(false);
    assert.strictEqual(aircraft.gltfGroup.visible, true, 'GLTF model must be visible in exterior view');
    assert.strictEqual(aircraft.cockpit.group.visible, false, 'Cockpit must be hidden in exterior view');
  });

  it('should hide the procedural tail when the asynchronous model loads in cockpit view', (t) => {
    const aircraft = new Boeing737(new PFDCanvas(256, 256), new NDCanvas(256, 256), new EICASCanvas(256, 256));
    assert.strictEqual(aircraft.tailGroup, aircraft.empennageGroup);
    assert.strictEqual(aircraft.tailGroup.visible, true);

    let completeLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, onLoad) => { completeLoad = onLoad; });
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
      aircraft.loadGltfModel('/test.glb');
      aircraft.setCockpitMode(true);
      completeLoad({ scene: new THREE.Group() });
      assert.strictEqual(aircraft.modelLoaded, true);
      assert.strictEqual(aircraft.gltfGroup.visible, false, 'Late model load must preserve cockpit view');
      assert.strictEqual(aircraft.tailGroup.visible, false);
      aircraft.setCockpitMode(false);
      assert.strictEqual(aircraft.gltfGroup.visible, true);
      assert.strictEqual(aircraft.tailGroup.visible, false, 'Exterior transitions must not restore the procedural tail');
      aircraft.setCockpitMode(true);
      assert.strictEqual(aircraft.gltfGroup.visible, false);
      assert.strictEqual(aircraft.tailGroup.visible, false);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('should suppress procedural exterior during GLTF load to prevent popping, and restore on failure', (t) => {
    const aircraft = new Boeing737(new PFDCanvas(256, 256), new NDCanvas(256, 256), new EICASCanvas(256, 256));
    assert.strictEqual(aircraft.fuselageGroup.visible, true);

    let failLoad;
    t.mock.method(GLTFLoader.prototype, 'load', (_url, _onLoad, _onProgress, onError) => { failLoad = onError; });
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
      aircraft.loadGltfModel('/missing.glb');
      assert.strictEqual(aircraft.loadingGltf, true);
      assert.strictEqual(aircraft.fuselageGroup.visible, false, 'Procedural fuselage must be hidden while loading GLTF');
      assert.strictEqual(aircraft.tailGroup.visible, false, 'Procedural tail must be hidden while loading GLTF');

      // Trigger error fallback
      failLoad(new Error('Network error'));
      assert.strictEqual(aircraft.loadingGltf, false);
      assert.strictEqual(aircraft.useGltf, false);
      assert.strictEqual(aircraft.fuselageGroup.visible, true, 'Procedural fuselage must be restored on load failure');
      assert.strictEqual(aircraft.tailGroup.visible, true, 'Procedural tail must be restored on load failure');
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  it('should articulate crash visuals and restore pristine state', () => {
    const pfd = new PFDCanvas(256, 256);
    const nd = new NDCanvas(256, 256);
    const eicas = new EICASCanvas(256, 256);
    const aircraft = new Boeing737(pfd, nd, eicas);

    aircraft.triggerCrashVisuals('TERRAIN');
    assert.strictEqual(aircraft.isCrashed, true);
    assert.strictEqual(aircraft.gltfGroup.rotation.z, -0.18, 'GLTF group should dislocate on crash');

    aircraft.resetCrashVisuals();
    assert.strictEqual(aircraft.isCrashed, false);
    assert.strictEqual(aircraft.gltfGroup.rotation.z, 0, 'GLTF group rotation should reset to 0');
  });

  it('should verify 3D assets exist in public/ and remain well within memory budget (< 15MB)', () => {
    const modelPath = path.resolve(process.cwd(), 'public/models/b737-800.glb');
    const hdrPath = path.resolve(process.cwd(), 'public/textures/environment/sky_1k.hdr');

    assert.ok(fs.existsSync(modelPath), 'public/models/b737-800.glb must exist');
    assert.ok(fs.existsSync(hdrPath), 'public/textures/environment/sky_1k.hdr must exist');

    const modelStats = fs.statSync(modelPath);
    const hdrStats = fs.statSync(hdrPath);
    const totalBytes = modelStats.size + hdrStats.size;

    assert.ok(modelStats.size > 100 * 1024, 'GLB model must be at least 100KB');
    assert.ok(modelStats.size < 10 * 1024 * 1024, 'GLB model must be under 10MB budget');
    assert.ok(totalBytes < 15 * 1024 * 1024, 'Total assets must be well under 15MB budget');
  });

  it('should verify CREDITS.md documents CC BY 4.0 and CC0 licenses', () => {
    const creditsPath = path.resolve(process.cwd(), 'CREDITS.md');
    assert.ok(fs.existsSync(creditsPath), 'CREDITS.md must exist');
    const content = fs.readFileSync(creditsPath, 'utf8');

    assert.ok(content.includes('amvlab/aircraft-models'), 'Must credit amvlab model repository');
    assert.ok(content.includes('CC BY 4.0'), 'Must document CC BY 4.0 license');
    assert.ok(content.includes('Poly Haven'), 'Must credit Poly Haven HDRI');
    assert.ok(content.includes('CC0'), 'Must document CC0 license');
  });
});
