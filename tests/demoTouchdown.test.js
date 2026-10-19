import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

test('demo waits for wheel contact before deploying rollout controls', () => {
  const inputs = {};
  const sim = {
    position: new THREE.Vector3(-1300, 15.8, 0),
    angularVelocity: new THREE.Vector3(),
    telemetry: { altitudeFt: 52, radioAltFt: 12.4, iasKnots: 142,
      pitchDeg: 2, rollDeg: 0, onGround: false, touchdown: false },
    controls: { setVirtualInput: (name, value) => { inputs[name] = value; } },
    engines: { setThrottle: () => {} },
    cameraSystem: { setMode(mode) { this.mode = mode; } }
  };
  const director = new DemoFlightDirector(sim);
  director.isActive = true;
  director.currentStage = DemoFlightDirector.STAGES.FINAL_APPROACH;
  director.approachFlarInitiated = true;
  for (const radioAltFt of [12.4, 12, 11.8]) {
    sim.telemetry.radioAltFt = radioAltFt;
    director.update(1 / 120);
    assert.equal(director.currentStage, DemoFlightDirector.STAGES.FINAL_APPROACH,
      'Radio altitude alone cannot prove wheel contact');
    assert.equal(sim.cameraSystem.mode, undefined);
  }
  sim.telemetry.onGround = true;
  director.update(1 / 120);
  assert.equal(director.currentStage, DemoFlightDirector.STAGES.TOUCHDOWN_ROLLOUT);
  assert.equal(sim.cameraSystem.mode, CameraSystem.MODES.GEAR);
});
