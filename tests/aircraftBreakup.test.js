import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AircraftBreakup } from '../src/effects/AircraftBreakup.js';

function fixture() {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const exterior = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  exterior.add(new THREE.Mesh(new THREE.BoxGeometry(20, 2, 30, 4, 1, 8), material));
  group.add(exterior);
  scene.add(group);
  group.position.set(40, 5, 20);
  const aircraft = { group, gltfGroup: exterior, useGltf: true, setCockpitMode() {} };
  return { scene, aircraft, material };
}

test('breakup conserves triangles, separates actual geometry and restores aircraft through repeated reset', () => {
  const { scene, aircraft, material } = fixture();
  const breakup = new AircraftBreakup(scene);
  for (let cycle = 0; cycle < 2; cycle++) {
    breakup.spawn(aircraft, new THREE.Vector3(30, -10, 0), 'TERRAIN');
    assert.equal(aircraft.group.visible, false);
    assert.equal(breakup.pieces.length, 6);
    let vertices = 0;
    for (const { object } of breakup.pieces) object.traverse(m => {
      if (m.isMesh) { vertices += m.geometry.attributes.position.count; assert.equal(m.material, material); }
    });
    assert.equal(vertices, aircraft.gltfGroup.children[0].geometry.index.count);
    const start = breakup.pieces[0].object.position.clone();
    breakup.update(1, { getHeight: () => 0 });
    assert.ok(breakup.pieces[0].object.position.distanceTo(start) > 1);
    for (let i = 0; i < 20; i++) breakup.update(1, { getHeight: () => 0 });
    for (const p of breakup.pieces) {
      assert.ok(p.object.position.y >= p.radius);
      assert.ok(p.velocity.length() < 0.1);
    }
    breakup.clear();
    assert.equal(aircraft.group.visible, true);
    assert.equal(scene.children.length, 1);
  }
});

test('water fragments sink and damp without bouncing off seabed', () => {
  const { scene, aircraft } = fixture();
  const breakup = new AircraftBreakup(scene);
  breakup.spawn(aircraft, new THREE.Vector3(0, -20, 0), 'WATER');
  for (let i = 0; i < 5; i++) breakup.update(1, { getHeight: () => 0 });
  assert.ok(breakup.pieces.every(p => p.object.position.y < 0 && p.velocity.y < 0));
  assert.equal(breakup.target.y, 0);
});

test('crash camera frames debris outside in portrait and rejects cockpit changes until reset', async () => {
  const { CameraSystem } = await import('../src/cameras/CameraSystem.js');
  const camera = new THREE.PerspectiveCamera(58, 0.5, 0.08, 45000);
  const system = new CameraSystem(camera, null);
  system.setMode(0, true);
  const wreckage = { target: new THREE.Vector3(10, 4, 20), radius: 25 };
  system.beginCrashView(wreckage);
  assert.equal(system.mode, 1);
  assert.equal(system.setMode(0, true), false);
  assert.ok(camera.position.distanceTo(wreckage.target) > 100);
  system.update(1, new THREE.Group());
  system.endCrashView();
  assert.equal(system.mode, 0);
  assert.equal(system.crashView, null);
});
