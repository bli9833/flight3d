import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

test('tail framing stays fixed during descending flight with uneven render intervals', () => {
  const camera = new THREE.PerspectiveCamera();
  const system = new CameraSystem(camera, { addEventListener() {} });
  const aircraft = new THREE.Object3D();
  aircraft.position.set(100, 2900, 100);
  aircraft.updateMatrixWorld(true);
  system.setMode(CameraSystem.MODES.CHASE);
  system.snapToTarget(aircraft);
  const offset = camera.position.clone().sub(aircraft.position);
  const rotation = camera.quaternion.clone();
  for (let i = 0; i < 240; i++) {
    const dt = [1 / 144, 1 / 30, 1 / 60, 0.08][i % 4];
    aircraft.position.addScaledVector(new THREE.Vector3(0, -4, -65), dt);
    aircraft.updateMatrixWorld(true);
    system.update(dt, aircraft, {}, () => 0);
    assert.ok(camera.position.clone().sub(aircraft.position).distanceTo(offset) < 1e-8,
      'camera must translate with the aircraft without variable lag');
    assert.ok(camera.quaternion.angleTo(rotation) < 1e-7, 'background orientation must remain stable');
  }
});

test('tail orbit damping is independent of frame rate and reset discards old position', () => {
  function run(hz) {
    const camera = new THREE.PerspectiveCamera();
    const system = new CameraSystem(camera, { addEventListener() {} });
    const aircraft = new THREE.Object3D();
    aircraft.position.y = 2900;
    aircraft.updateMatrixWorld(true);
    system.setMode(CameraSystem.MODES.CHASE);
    system.snapToTarget(aircraft);
    system.chaseYaw = 0.5;
    for (let i = 0; i < hz; i++) {
      aircraft.position.z -= 65 / hz;
      aircraft.updateMatrixWorld(true);
      system.update(1 / hz, aircraft, {}, () => 0);
    }
    const result = camera.position.clone();
    aircraft.position.set(500, 3000, -2000);
    aircraft.updateMatrixWorld(true);
    system.snapToTarget(aircraft);
    const snapped = camera.position.clone();
    system.update(1 / hz, aircraft, {}, () => 0);
    assert.ok(camera.position.distanceTo(snapped) < 1e-8);
    return result;
  }
  assert.ok(run(30).distanceTo(run(144)) < 1e-8);
});

test('tail camera clamps its actual position above terrain after damping', () => {
  const camera = new THREE.PerspectiveCamera();
  const system = new CameraSystem(camera, { addEventListener() {} });
  const aircraft = new THREE.Object3D();
  aircraft.position.y = 100;
  aircraft.updateMatrixWorld(true);
  system.setMode(CameraSystem.MODES.CHASE);
  system.snapToTarget(aircraft);
  system.chaseYaw = Math.PI;
  system.update(1 / 60, aircraft, {}, (x, z) => z > 40 ? 120 : 0);
  assert.ok(camera.position.y >= 121.8);
});
