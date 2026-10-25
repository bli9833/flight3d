import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DeveloperModeController } from '../src/dev/DeveloperModeController.js';
import { DevScenarioRunner } from '../src/dev/DevScenarioRunner.js';
import { DEV_SCENARIOS } from '../src/dev/scenarios/index.js';
import { GameFlowController } from '../src/ui/GameFlowController.js';
import { setLanguage, t } from '../src/i18n/index.js';

function fixture(definition = {}) {
  const mode = new DeveloperModeController();
  const sim = {
    activeAirport: 'coastal', currentAircraftId: 'B738',
    position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    aircraft: { modelLoaded: true, group: new THREE.Group(), cockpit: {} },
    currentTerrain: {}, cameraSystem: { mode: 2, setMode(n) { this.mode = n; }, snapToTarget() {} },
    controls: { releaseAllKeys() {}, clearVirtualInputs() {}, setTouchStick() {}, setTouchRudder() {}, setTouchBrakes() {} },
    autopilot: { disengage() {} }, telemetry: {}, gameFlow: new GameFlowController(),
    shadowDemo: { stop() {} }, demoDirector: { stop() {} }, renderPose: { reset() {} }, syncFlowUi() {},
    gear: { contacts: [0, 1, 2].map(() => ({ damageState: 'normal' })), bodyDamage: { belly: 0 } },
    setPreset() { this.resets = (this.resets || 0) + 1; this.devRunner?.stop(); },
  };
  const definitions = { test: { airports: ['coastal'], aircraft: ['B738'], kind: 'physical',
    setup() {}, duration: 1, check: 'normal', ...definition } };
  const runner = new DevScenarioRunner(sim, mode, definitions);
  sim.devRunner = runner;
  return { sim, mode, runner };
}

test('default-off gate rejects direct calls, unsupported aircraft and airport', () => {
  const { sim, mode, runner } = fixture();
  assert.equal(runner.start('test'), false);
  mode.enable(); sim.currentAircraftId = 'C172';
  assert.equal(runner.start('test'), false);
  sim.currentAircraftId = 'B738'; sim.activeAirport = 'lukla';
  assert.equal(runner.start('test'), false);
  assert.equal(runner.start('missing'), false);
});

test('pending load can be cancelled without a stale start; timed-out load fails', () => {
  const { sim, mode, runner } = fixture(); mode.enable(); sim.aircraft.modelLoaded = false;
  runner.start('test'); runner.updatePreparation(10); runner.stop();
  sim.aircraft.modelLoaded = true; runner.updatePreparation(30);
  assert.equal(runner.status, 'idle'); assert.equal(runner.active, null);
  sim.aircraft.modelLoaded = false;
  runner.start('test'); runner.updatePreparation(30);
  assert.equal(runner.result.reason, 'dev.reason.loading');
});

test('shadow waits for shader-ready signal even when cockpit children exist', () => {
  const { sim, mode, runner } = fixture({ kind: 'visual' }); mode.enable();
  sim.aircraft.cockpit.gltfCockpitGroup = { children: [{}] };
  runner.start('test'); runner.updatePreparation(1);
  assert.equal(runner.status, 'preparing');
  sim.aircraft.cockpit.gltfCockpitLoaded = true;
  runner.updatePreparation(0);
  assert.equal(runner.status, 'inspecting');
  runner.afterPhysics(30); assert.equal(runner.result, null);
});

test('disabling a mode invokes cancellation; unknown inherited keys are denied', () => {
  let cancelled = 0;
  const mode = new DeveloperModeController(() => cancelled++);
  mode.enable(); mode.disable();
  assert.equal(mode.enabled, false); assert.equal(cancelled, 1);
  const f = fixture(); f.mode.enable();
  assert.equal(f.runner.start('toString'), false);
});

test('result waits for real samples, restart clears old result, stop resets once', () => {
  const { sim, mode, runner } = fixture(); mode.enable();
  runner.start('test'); runner.updatePreparation(0);
  assert.equal(runner.status, 'running'); assert.equal(runner.result, null);
  assert.equal(sim.cameraSystem.trauma, 0);
  runner.afterPhysics(.5); assert.equal(runner.result, null);
  runner.afterPhysics(.5); assert.equal(runner.result.status, 'passed');
  assert.equal(runner.result.observation.samples, 2);
  const result = runner.result; runner.afterPhysics(10); assert.deepEqual(runner.result, result);
  runner.restart(); assert.equal(runner.result, null); assert.equal(runner.elapsed, 0);
  const resets = sim.resets; runner.stop(); runner.stop();
  assert.equal(sim.cameraSystem.trauma, 0);
  assert.equal(sim.resets, resets + 1); assert.equal(sim.controls.aircraftControlsDisabled, false);
  assert.equal(sim.cameraSystem.mode, 2);
});

test('expected crash passes, wrong crash fails, missing crash times out', () => {
  for (const [actual, expectedStatus] of [['WATER', 'passed'], ['TREE', 'failed'], [null, 'timeout']]) {
    const { sim, mode, runner } = fixture({ expectedCrash: 'WATER' }); mode.enable();
    runner.start('test'); runner.updatePreparation(0);
    sim.isCrashed = Boolean(actual); sim.crashResult = { type: actual };
    runner.afterPhysics(1);
    assert.equal(runner.result.status, expectedStatus);
  }
});

test('invalid state cannot pass; setup failure is recoverable', () => {
  const { sim, mode, runner } = fixture(); mode.enable();
  runner.start('test'); runner.updatePreparation(0); sim.position.x = NaN;
  runner.afterPhysics(1); assert.equal(runner.result.reason, 'dev.reason.invalid');
  const broken = fixture({ setup() { throw new Error('missing obstacle'); } });
  broken.mode.enable(); broken.runner.start('test'); broken.runner.updatePreparation(0);
  assert.equal(broken.runner.result.status, 'failed');
  broken.runner.stop(); assert.equal(broken.runner.active, null);
});

test('an untyped crash cannot accidentally equal an absent expected crash', () => {
  const { sim, mode, runner } = fixture(); mode.enable();
  runner.start('test'); runner.updatePreparation(0);
  sim.isCrashed = true; sim.crashResult = {};
  runner.afterPhysics(1);
  assert.equal(runner.result.status, 'failed');
});

test('controlled stop must remain stopped without abrasion for ten seconds', () => {
  const { sim, mode, runner } = fixture({ check: 'stop' }); mode.enable();
  runner.start('test'); runner.updatePreparation(0);
  sim.landingStopped = true; sim.telemetry.bodyContacts = ['belly']; sim.gear.bodyDamage.belly = .2;
  runner.afterPhysics(1); assert.equal(runner.result, null);
  runner.afterPhysics(9); assert.equal(runner.result, null);
  sim.gear.bodyDamage.belly = .21; runner.afterPhysics(1);
  assert.equal(runner.result.reason, 'dev.reason.rest');
});

test('catalog is localized, finite, and separates injection from physical reproduction', () => {
  for (const language of ['en', 'ko']) {
    setLanguage(language);
    for (const d of Object.values(DEV_SCENARIOS)) {
      assert.notEqual(t(d.labelKey), d.labelKey);
      assert.notEqual(t(d.descriptionKey), d.descriptionKey);
      if (d.kind !== 'visual') assert.ok(Number.isFinite(d.duration) && d.duration > 0);
    }
  }
  assert.equal(DEV_SCENARIOS['left-collapse'].kind, 'injection');
  assert.equal(DEV_SCENARIOS.hard.kind, 'physical');
  setLanguage('en');
});
