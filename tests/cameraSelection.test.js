import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraSystem } from '../src/cameras/CameraSystem.js';
import { FlightControls } from '../src/controls/FlightControls.js';

test('auto cycles real views, pauses for temporary cuts, and stops on manual selection', () => {
  const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
  const aircraft = new THREE.Object3D();
  aircraft.position.y = 500;
  aircraft.updateMatrixWorld();
  system.setMode(CameraSystem.MODES.AUTO);
  assert.match(system.getModeName(), /^AUTO/);
  system.update(9, aircraft);
  assert.equal(system.mode, CameraSystem.MODES.CHASE);
  system.showTemporaryView(CameraSystem.MODES.GEAR, 3);
  system.update(3, aircraft);
  assert.equal(system.mode, CameraSystem.MODES.CHASE);
  system.update(1, aircraft);
  assert.equal(system.mode, CameraSystem.MODES.DRONE);
  system.setMode(CameraSystem.MODES.FLYBY);
  system.update(20, aircraft);
  assert.equal(system.mode, CameraSystem.MODES.FLYBY);
  assert.equal(system.autoSwitch, false);
  system.setMode(CameraSystem.MODES.DRONE);
  system.cycleMode();
  assert.equal(system.autoSwitch, false);
  assert.equal(system.mode, CameraSystem.MODES.FLYBY);
  system.cycleMode();
  assert.equal(system.mode, CameraSystem.MODES.WING);
  assert.equal(system.autoSwitch, false);
});

test('camera shortcuts map digits and numpad, ignoring repeats, modifiers and editing', () => {
  const controls = Object.create(FlightControls.prototype);
  const selected = [];
  controls.onSelectCamera = mode => selected.push(mode);
  controls.onCycleCamera = () => selected.push('cycle');
  for (let digit = 1; digit <= 8; digit++) {
    controls.handleKeyDown({ code: `Digit${digit}` });
  }
  controls.handleKeyDown({ code: 'Numpad8' });
  controls.handleKeyDown({ code: 'KeyC' });
  const expected = [0, 1, 2, 3, 4, 5, 6, 7, 7, 'cycle'];
  assert.deepEqual(selected, expected);
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { altKey: true },
    { metaKey: true }, { target: { isContentEditable: true } },
    { target: { closest: () => ({}) } }]) {
    controls.handleKeyDown({ code: 'Digit1', ...extra });
  }
  assert.deepEqual(selected, expected);
});


test('explicit camera selection overrides manual look while automatic cuts respect it', () => {
  const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
  const aircraft = new THREE.Object3D();
  aircraft.position.y = 500;
  aircraft.updateMatrixWorld();
  system.setMode(CameraSystem.MODES.AUTO, true);
  system.applyMouseDelta(10, 0);
  system.update(12, aircraft);
  assert.equal(system.mode, CameraSystem.MODES.CHASE);
  assert.equal(system.userLookOverridden, true);
  assert.equal(system.setMode(CameraSystem.MODES.WING), false);
  assert.equal(system.setMode(CameraSystem.MODES.WING, true), true);
  assert.equal(system.autoSwitch, false);
  assert.equal(system.userLookOverridden, false);
  system.applyMouseDelta(10, 0);
  system.cycleMode();
  assert.equal(system.mode, CameraSystem.MODES.COCKPIT);
  assert.equal(system.userLookOverridden, false);
});

for (let mode = 0; mode < 7; mode++) {
  test(`manual view ${mode} survives automatic cuts, look reset and demo changes`, () => {
    const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
    const aircraft = new THREE.Object3D();
    aircraft.position.y = 500;
    system.showTemporaryView(CameraSystem.MODES.GEAR, 5, () => assert.fail('cancelled cut callback'));
    system.setMode(mode, true);
    system.resetLook();
    for (const automatedMode of [CameraSystem.MODES.DRONE, CameraSystem.MODES.GEAR, CameraSystem.MODES.COCKPIT]) {
      assert.equal(system.setMode(automatedMode), false);
      system.showTemporaryView(CameraSystem.MODES.GEAR, 5);
      system.update(12, aircraft);
      assert.equal(system.mode, mode);
      assert.equal(system.temporaryViewTimer, 0);
      assert.equal(system.savedMode, null);
    }
    system.setMode(CameraSystem.MODES.AUTO, true);
    assert.equal(system.setMode(CameraSystem.MODES.COCKPIT), false);
    system.update(10, aircraft);
    assert.equal(system.mode, CameraSystem.MODES.DRONE);
    system.showTemporaryView(CameraSystem.MODES.GEAR, 3);
    assert.equal(system.mode, CameraSystem.MODES.GEAR);
    system.update(3, aircraft);
    assert.equal(system.mode, CameraSystem.MODES.DRONE);
    system.update(14, aircraft);
    assert.equal(system.mode, CameraSystem.MODES.FLYBY);
    system.cycleMode();
    system.showTemporaryView(CameraSystem.MODES.GEAR, 3);
    system.update(20, aircraft);
    assert.equal(system.mode, CameraSystem.MODES.CHASE);
  });
}

test('opens on an exterior view because the cockpit interior streams in separately', () => {
  const camera = new THREE.PerspectiveCamera();
  const system = new CameraSystem(camera, null);
  assert.equal(system.mode, CameraSystem.MODES.CHASE);
  assert.equal(camera.near, 0.25, 'Exterior near plane must be used before any cockpit entry');
});

test('camera cuts and recentering retain the active aircraft chase framing', () => {
  const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
  system.loadAircraftConfig({ id: 'C172', cockpit: { chaseDistance: 14, chaseHeight: 3.2, defaultLookPitchRad: -0.05 } });
  system.setMode(CameraSystem.MODES.FLYBY);
  system.setMode(CameraSystem.MODES.CHASE);
  assert.equal(system.chaseDistance, 14);
  assert.equal(system.chaseHeight, 3.2);
  assert.equal(system.lookPitch, -0.05);
  system.chaseDistance = 80;
  system.resetLook();
  assert.equal(system.chaseDistance, 14);
  system.loadAircraftConfig({ id: 'B738', cockpit: { chaseDistance: 55, chaseHeight: 10.5 } });
  system.setMode(CameraSystem.MODES.CHASE);
  assert.equal(system.chaseDistance, 55);
  assert.equal(system.chaseHeight, 10.5);
});

test('custom view updater receives a bound queryGroundHeight helper', () => {
  const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
  system.setTerrain({ getHeight: (x, z) => 10 + x * 0.1 + z * 0.01 });
  let observed = null;
  system.setCustomViewUpdater(({ queryGroundHeight }) => {
    observed = queryGroundHeight(50, 100);
    return false;
  });
  const aircraft = new THREE.Object3D();
  aircraft.position.y = 500;
  aircraft.updateMatrixWorld();
  system.update(0.1, aircraft);
  assert.equal(observed, 16, 'queryGroundHeight must keep its receiver when handed to the updater');
});


test('scenic auto adapts at cut boundaries and never tours distant towers or idle gear', () => {
  const system = new CameraSystem(new THREE.PerspectiveCamera(), null);
  const aircraft = new THREE.Object3D();
  const M = CameraSystem.MODES;
  system.setTerrain(() => 400);
  aircraft.position.y = 900;
  system.setMode(M.AUTO, true);
  for (const [seconds, mode] of [[10, M.DRONE], [13, M.DRONE], [1, M.FLYBY], [8, M.WING], [12, M.CHASE]]) {
    system.update(seconds, aircraft, { onGround: false });
    assert.equal(system.mode, mode);
    assert.equal(system.autoSwitch, true);
  }
  aircraft.position.y = 450; // 50m above elevated terrain, not 450m AGL.
  system.update(10, aircraft, { onGround: false });
  assert.equal(system.mode, M.FLYBY);
  system.update(8, aircraft, { onGround: false });
  assert.equal(system.mode, M.CHASE);
  system.update(10, aircraft, { onGround: true });
  assert.equal(system.mode, M.DRONE);
  system.applyMouseDelta(20, 0);
  system.update(30, aircraft, { onGround: true });
  assert.equal(system.mode, M.DRONE, 'manual look holds the shot');
  system.cycleMode();
  assert.equal(system.mode, M.CHASE);
  assert.equal(system.autoSwitch, false);
});
