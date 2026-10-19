import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

describe('CameraSystem Mouse Look & Camera Gaze Controls', () => {
  const mockDom = {
    addEventListener: () => {},
    style: {}
  };

  it('should initialize default mouse look parameters and states', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);

    assert.strictEqual(camSys.chaseYaw, 0);
    assert.strictEqual(camSys.chasePitch, 0);
    assert.strictEqual(camSys.chaseDistance, 55.0);
    assert.strictEqual(camSys.lookYaw, 0);
    assert.strictEqual(camSys.lookPitch, -0.18);
    assert.strictEqual(camSys.wingLookYaw, 0);
    assert.strictEqual(camSys.wingLookPitch, 0);
    assert.strictEqual(camSys.isDragging, false);
    assert.strictEqual(camSys.pointerLocked, false);
    assert.strictEqual(camSys.enableCursorTrack, true);
  });

  it('should update chase orbit angles and clamp pitch on mouse delta in CHASE mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.CHASE);

    // Initial angles are zero
    assert.strictEqual(camSys.chaseYaw, 0);
    assert.strictEqual(camSys.chasePitch, 0);

    // Drag right (dx = 100) -> chaseYaw decreases
    camSys.applyMouseDelta(100, 0);
    assert.ok(camSys.chaseYaw < 0, `chaseYaw (${camSys.chaseYaw}) should be negative after dragging right`);

    // Drag left (dx = -200) -> chaseYaw increases
    camSys.applyMouseDelta(-200, 0);
    assert.ok(camSys.chaseYaw > 0, `chaseYaw (${camSys.chaseYaw}) should be positive after dragging left`);

    // Pitch elevation clamp: drag up (dy = -500)
    camSys.applyMouseDelta(0, -500);
    assert.ok(camSys.chasePitch >= -1.1, `chasePitch should be clamped to at least -1.1`);

    // Pitch lower clamp: drag down (dy = 500)
    camSys.applyMouseDelta(0, 500);
    assert.ok(camSys.chasePitch <= 0.28, `chasePitch should be clamped to at most 0.28`);
  });

  it('should orbit camera around aircraft position in CHASE mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.CHASE);

    const aircraft = new THREE.Object3D();
    aircraft.position.set(0, 50, 0);
    aircraft.updateMatrixWorld(true);

    // Snap and update directly behind (chaseYaw = 0)
    camSys.snapToTarget(aircraft);
    camSys.update(0.016, aircraft, { onGround: false });

    // Initial behind position: Z should be positive (behind tail), X approx 0
    assert.ok(camera.position.z > 30, `Camera Z should be behind aircraft`);
    assert.ok(Math.abs(camera.position.x) < 2.0, `Camera X should be centered`);

    // Orbit 90 degrees to right side (yaw = Math.PI / 2)
    camSys.chaseYaw = Math.PI / 2;
    camSys.snapToTarget(aircraft);
    camSys.update(0.016, aircraft, { onGround: false });

    // With chaseYaw = Math.PI / 2, camera should orbit to positive X side
    assert.ok(camera.position.x > 30, `Camera X (${camera.position.x}) should be positive on right side orbit`);
  });

  it('should update cockpit look yaw and pitch with limits in COCKPIT mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.COCKPIT);

    // Drag left (dx = -100) -> lookYaw increases
    camSys.applyMouseDelta(-100, 0);
    assert.ok(camSys.lookYaw > 0, 'lookYaw should turn left');

    // Drag up/down pitch clamping
    camSys.applyMouseDelta(0, -1000);
    assert.ok(camSys.lookPitch <= Math.PI * 0.45, 'lookPitch should be clamped to upper limit');

    camSys.applyMouseDelta(0, 2000);
    assert.ok(camSys.lookPitch >= -Math.PI * 0.45, 'lookPitch should be clamped to lower limit');
  });

  it('should detect when pilot is looking away from forward panel', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.COCKPIT);

    // At default look (-0.18 pitch, 0 yaw), pilot is looking straight forward
    assert.strictEqual(camSys.isLookingAwayFromCenter(), false);

    // Turn head to the left window (yaw = 0.8 rad)
    camSys.lookYaw = 0.8;
    assert.strictEqual(camSys.isLookingAwayFromCenter(), true);

    // Reset back to center
    camSys.resetLook();
    assert.strictEqual(camSys.isLookingAwayFromCenter(), false);

    // Tilt head up at overhead panel
    camSys.lookPitch = 0.5;
    assert.strictEqual(camSys.isLookingAwayFromCenter(), true);
  });

  it('should update wing view look angles on mouse delta in WING mode', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.WING);

    assert.strictEqual(camSys.wingLookYaw, 0);
    assert.strictEqual(camSys.wingLookPitch, 0);

    camSys.applyMouseDelta(50, -30);
    assert.ok(camSys.wingLookYaw < 0, 'wingLookYaw should adjust on horizontal drag');
    assert.ok(camSys.wingLookPitch > 0, 'wingLookPitch should adjust on vertical drag');
  });

  it('should smoothly interpolate cursor position tracking on mouse move', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);
    camSys.setMode(CameraSystem.MODES.CHASE);

    const aircraft = new THREE.Object3D();
    aircraft.position.set(0, 100, 0);
    aircraft.updateMatrixWorld(true);

    // Cursor on far right (clientX = 1920, screen width = 1920)
    camSys.setCursorPosition(1920, 540, 1920, 1080);
    assert.ok(camSys.targetCursorNormX > 0.9, 'targetCursorNormX should be near 1.0');

    // Run frame update to interpolate
    camSys.update(0.05, aircraft, { onGround: false });
    assert.ok(camSys.cursorNormX > 0, 'cursorNormX should smoothly advance towards target');
  });

  it('should reset all camera look angles and zoom to default with resetLook()', () => {
    const camera = new THREE.PerspectiveCamera();
    const camSys = new CameraSystem(camera, mockDom);

    // Mutate various look parameters
    camSys.chaseYaw = 1.2;
    camSys.chasePitch = -0.5;
    camSys.chaseDistance = 90.0;
    camSys.lookYaw = 0.7;
    camSys.lookPitch = 0.3;
    camSys.wingLookYaw = -0.4;
    camSys.wingLookPitch = 0.2;
    camSys.gearLookYaw = 0.3;
    camSys.gearLookPitch = -0.2;
    camSys.cursorNormX = 0.8;
    camSys.targetCursorNormX = 0.8;

    // Reset look
    camSys.resetLook();

    assert.strictEqual(camSys.chaseYaw, 0);
    assert.strictEqual(camSys.chasePitch, 0);
    assert.strictEqual(camSys.chaseDistance, 55.0);
    assert.strictEqual(camSys.lookYaw, 0);
    assert.strictEqual(camSys.lookPitch, -0.18);
    assert.strictEqual(camSys.wingLookYaw, 0);
    assert.strictEqual(camSys.wingLookPitch, 0);
    assert.strictEqual(camSys.gearLookYaw, 0);
    assert.strictEqual(camSys.gearLookPitch, 0);
    assert.strictEqual(camSys.cursorNormX, 0);
    assert.strictEqual(camSys.targetCursorNormX, 0);
  });
});
