import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

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
    }),
    getElementById: () => ({
      style: {},
      textContent: '',
      addEventListener: noop,
      classList: { add: noop, remove: noop, toggle: noop }
    })
  };
  globalThis.window = {
    addEventListener: noop,
    innerWidth: 1920,
    innerHeight: 1080
  };
}

import { CameraSystem } from '../src/cameras/CameraSystem.js';

describe('FLYBY (Front View / Cinematic Flyby) Ground Safety & Framing', () => {
  const mockDom = { addEventListener: () => {} };
  const mockTerrainHeight = (x, z) => 12.0; // Flat RKSS airport elevation

  it('should position camera above runway at showcase distance when landed or parked', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSystem = new CameraSystem(camera, mockDom);
    camSystem.setTerrain(mockTerrainHeight);

    const aircraft = new THREE.Object3D();
    // Aircraft parked on Runway 09L facing East (+X)
    aircraft.position.set(-500, 14.15, 0);
    aircraft.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.5); // Heading 090° East
    aircraft.updateMatrixWorld(true);

    camSystem.setMode(CameraSystem.MODES.FLYBY);
    assert.strictEqual(camSystem.mode, CameraSystem.MODES.FLYBY);

    // Update with onGround = true, groundSpeed = 0 (landed/parked)
    camSystem.update(0.016, aircraft, { onGround: true, groundSpeed: 0, iasKnots: 0 });

    // 1. Camera MUST be above runway elevation (12.0m), NEVER underground or negative!
    assert.ok(camera.position.y >= 14.0, `Camera Y (${camera.position.y}) must be well above runway elevation (12m)`);
    assert.ok(camera.position.y > 0, 'Camera Y must never be negative (underground/underwater)');

    // 2. Camera should be ahead of the aircraft (+X when facing East)
    assert.ok(camera.position.x > aircraft.position.x, 'Camera X should be positioned ahead of aircraft facing East');

    // 3. Camera should be at a showcase distance (~40-55m), NOT 300m away
    const distanceToPlane = camera.position.distanceTo(aircraft.position);
    assert.ok(distanceToPlane >= 35.0 && distanceToPlane <= 60.0, `Showcase distance (${distanceToPlane.toFixed(1)}m) should be between 35m and 60m`);

    // 4. Camera should look at aircraft
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const toPlane = aircraft.position.clone().sub(camera.position).normalize();
    assert.ok(forward.dot(toPlane) > 0.95, 'Camera forward vector should point directly at the aircraft');
  });

  it('should never clip below undulating terrain during low altitude flight in FLYBY mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSystem = new CameraSystem(camera, mockDom);

    // Hill terrain at 45m elevation ahead
    const hillTerrain = (x, z) => 45.0;
    camSystem.setTerrain(hillTerrain);

    const aircraft = new THREE.Object3D();
    // Low flying aircraft at 50m altitude
    aircraft.position.set(0, 50.0, 0);
    aircraft.quaternion.set(0, 0, 0, 1); // Facing North (-Z)
    aircraft.updateMatrixWorld(true);

    camSystem.setMode(CameraSystem.MODES.FLYBY);
    camSystem.update(0.016, aircraft, { onGround: false, groundSpeed: 70, iasKnots: 140 });

    // Camera height MUST be clamped safely above the 45m hill
    assert.ok(camera.position.y >= 45.0 + 4.0, `Camera Y (${camera.position.y}) must stay above the 45m hill (+4m clearance)`);
  });

  it('should position camera at runway edge during high-speed rollout', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSystem = new CameraSystem(camera, mockDom);
    camSystem.setTerrain(mockTerrainHeight);

    const aircraft = new THREE.Object3D();
    aircraft.position.set(0, 14.15, 0);
    aircraft.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.5); // Facing East (+X)
    aircraft.updateMatrixWorld(true);

    camSystem.setMode(CameraSystem.MODES.FLYBY);
    // Rollout at 25 m/s (~50 knots)
    camSystem.update(0.016, aircraft, { onGround: true, groundSpeed: 25, iasKnots: 50 });

    // Camera should be positioned at runway edge (Z offset ~20m from centerline 0)
    assert.ok(Math.abs(camera.position.z) > 15.0, `Camera Z (${camera.position.z}) should be offset near runway edge`);
    // Height should be spectator eye level above runway (12.0 + 1.8 = 13.8)
    assert.ok(Math.abs(camera.position.y - 13.8) < 0.2, `Camera Y (${camera.position.y}) should be ~13.8m`);
    // Positioned ahead along runway (+X)
    assert.ok(camera.position.x > aircraft.position.x + 80.0, 'Camera should be well ahead of rolling aircraft');
  });

  it('should correctly snapToTarget in FLYBY mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSystem = new CameraSystem(camera, mockDom);
    camSystem.setTerrain(mockTerrainHeight);

    const aircraft = new THREE.Object3D();
    aircraft.position.set(200, 14.15, 0);
    aircraft.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.5);
    aircraft.updateMatrixWorld(true);

    camSystem.setMode(CameraSystem.MODES.FLYBY);
    camSystem.snapToTarget(aircraft);

    assert.ok(camera.position.y >= 14.0, 'Snapped Camera Y must be above ground');
    assert.ok(camera.position.x > aircraft.position.x, 'Snapped Camera X must be ahead of aircraft');
    const dist = camera.position.distanceTo(aircraft.position);
    assert.ok(dist >= 35.0 && dist <= 60.0, 'Snapped Camera distance should be showcase distance');
  });
});
