import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

function create(mode) {
  const camera = new THREE.PerspectiveCamera();
  const system = new CameraSystem(camera, { addEventListener() {} });
  const aircraft = new THREE.Object3D();
  aircraft.position.y = 3000;
  aircraft.updateMatrixWorld(true);
  system.setMode(mode);
  system.snapToTarget(aircraft);
  return { camera, system, aircraft };
}

for (const mode of [CameraSystem.MODES.DRONE, CameraSystem.MODES.FLYBY]) {
  test(`moving camera ${mode} matches stationary framing through uneven frames and view changes`, () => {
    const moving = create(mode), stationary = create(mode);
    const velocity = new THREE.Vector3(70, -2, -80);
    const state = { onGround: mode === CameraSystem.MODES.FLYBY, groundSpeed: 8 };
    for (let frame = 0; frame < 500; frame++) {
      const dt = [1 / 144, 1 / 30, 1 / 60, 0.08][frame % 4];
      // Visit another mode and return; hidden tracking history must stay coherent.
      if (frame === 200 || frame === 220) {
        for (const shot of [moving, stationary]) {
          shot.system.setMode(frame === 200 ? CameraSystem.MODES.WING : mode);
        }
      }
      moving.aircraft.position.addScaledVector(velocity, dt);
      moving.aircraft.updateMatrixWorld(true);
      for (const shot of [moving, stationary]) shot.system.update(dt, shot.aircraft, state, () => 0);
      const movingOffset = moving.camera.position.clone().sub(moving.aircraft.position);
      const stationaryOffset = stationary.camera.position.clone().sub(stationary.aircraft.position);
      assert.ok(movingOffset.distanceTo(stationaryOffset) < 1e-8, `frame ${frame}: translation must not alter framing`);
      assert.ok(moving.camera.quaternion.angleTo(stationary.camera.quaternion) < 1e-7);
    }
  });
}

test('airborne and rollout flyby shots remain fixed in world space', () => {
  for (const onGround of [false, true]) {
    const { camera, system, aircraft } = create(CameraSystem.MODES.FLYBY);
    system.update(1 / 60, aircraft, { onGround, groundSpeed: 60 }, () => 0);
    const initial = camera.position.clone();
    for (let frame = 0; frame < 50; frame++) {
      aircraft.position.z -= 0.5;
      aircraft.updateMatrixWorld(true);
      system.update(1 / 60, aircraft, { onGround, groundSpeed: 60 }, () => 0);
      assert.ok(camera.position.distanceTo(initial) < 1e-9);
    }
  }
});
