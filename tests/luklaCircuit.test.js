import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { LuklaCircuitScenario } from '../src/director/scenarios/LuklaCircuitScenario.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { EngineModel } from '../src/physics/EngineModel.js';

const STAGES = LuklaCircuitScenario.STAGES;
function setup() {
  const inputs = {};
  const sim = {
    activeAirport: 'lukla', position: new THREE.Vector3(),
    linearVelocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    telemetry: { pitchDeg: 7, rollDeg: 0, headingDeg: 58, iasKnots: 110,
      radioAltFt: 0, onGround: true, gearState: 1, isTransit: false },
    aero: new Aerodynamics(), gear: new LandingGear(), engines: new EngineModel(),
    controls: { setVirtualInput: (k, v) => { assert.ok(Number.isFinite(v)); inputs[k] = v; },
      clearVirtualInputs: () => {}, setParkingBrake(v) { this.parkingBrake = v; } },
    cameraSystem: { setMode() {} }, sky: { setTimeOfDay() {} }, showToast() {},
    setPreset() { this.presetCalls = (this.presetCalls || 0) + 1; }
  };
  const director = new DemoFlightDirector(sim);
  director.start('lukla');
  const place = (s, y = 2950, w = 0) => sim.position.set(s * 0.848048 + w * 0.529919, y, -s * 0.529919 + w * 0.848048);
  return { sim, director, scenario: director.luklaScenario, inputs, place };
}

describe('Lukla continuous circuit and truthful completion', () => {
  it('uses explicit light loading and physical transitions without midflight preset changes', () => {
    const { sim, director, scenario, place } = setup();
    assert.equal(sim.aero.mass, 43000);
    director.stageTimer = 60;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CLIFF_TAKEOFF);
    place(-400, 2850);
    sim.telemetry.onGround = false;
    sim.telemetry.radioAltFt = 100;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CANYON_CLIMB);
    director.stageTimer = 60;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CANYON_CLIMB);
    place(-2700);
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.HIMALAYAN_CRUISE);
    director.stageTimer = 20;
    sim.telemetry.headingDeg = 238;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.HIMALAYAN_CRUISE);
    sim.telemetry.headingDeg = 58;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CANYON_APPROACH);
    place(-210, 2815, -5);
    sim.telemetry.radioAltFt = 0;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.CANYON_APPROACH, 'Height alone is not contact');
    sim.telemetry.onGround = true;
    for (const c of sim.gear.contacts) c.isGrounded = true;
    director.update(0.1);
    assert.equal(director.currentStage, STAGES.UPHILL_TOUCHDOWN);
    assert.equal(scenario.result.airborne, true);
    assert.equal(sim.presetCalls, 1);
  });

  it('requires actual ground speed, runway position and two continuous seconds of wheel support', () => {
    const { sim, director, scenario, place } = setup();
    scenario.result.airborne = true;
    director.touchdownConfirmed = true;
    director.setStage(STAGES.UPHILL_TOUCHDOWN);
    for (const c of sim.gear.contacts) c.isGrounded = true;
    place(100, 2851, -5);
    sim.linearVelocity.set(20, 0, 0);
    sim.telemetry.iasKnots = 0; // Wind/telemetry cannot substitute for stopped wheels.
    director.stageTimer = 100;
    director.update(3);
    assert.equal(director.isActive, true);
    sim.linearVelocity.set(0, 0, 0);
    place(250, 2868, -5);
    director.update(3);
    assert.equal(director.isActive, true, 'Past the safe stop envelope');
    place(100, 2851, -5);
    director.update(1);
    sim.gear.contacts[0].isGrounded = false;
    director.update(0.1);
    sim.gear.contacts[0].isGrounded = true;
    director.update(1);
    assert.equal(director.isActive, true, 'Loss of support resets the stop timer');
    director.update(1.01);
    assert.equal(director.isActive, false);
    assert.equal(scenario.result.status, 'completed');
    assert.equal(sim.controls.parkingBrake, true);
    assert.equal(sim.gear.brakes, 1);
  });

  it('cannot start a circuit against the unloaded terrain fallback', () => {
    const { sim, director, scenario } = setup();
    sim.currentTerrain = { isLoaded: false };
    director.start('lukla');
    assert.equal(director.isActive, false);
    assert.equal(scenario.result.status, 'failed');
    assert.equal(scenario.result.reason, 'DEM not loaded');
    assert.equal(sim.presetCalls, 1, 'Rejected start must not spawn another flight');
  });

  it('reports a crash as failure even if stopped with an expired stage timer', () => {
    const { sim, director, scenario } = setup();
    director.setStage(STAGES.UPHILL_TOUCHDOWN);
    director.stageTimer = 100;
    sim.isCrashed = true;
    director.update(3);
    assert.equal(director.isActive, false);
    assert.equal(scenario.result.status, 'failed');
  });
});
