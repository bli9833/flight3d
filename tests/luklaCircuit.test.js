import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { LuklaCircuitScenario } from '../src/director/scenarios/LuklaCircuitScenario.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

function createMockSimulator() {
  const virtualInputs = {};
  let presetCalled = false;
  return {
    activeAirport: 'lukla',
    position: new THREE.Vector3(0, 2800, 0),
    angularVelocity: new THREE.Vector3(0, 0, 0),
    telemetry: {
      altitudeFt: 9300,
      radioAltFt: 0,
      iasKnots: 0,
      pitchDeg: -6.71,
      rollDeg: 0,
      headingDeg: 238,
      onGround: true,
      gearState: 1.0,
      isTransit: false
    },
    controls: {
      brakes: 0.0,
      parkingBrake: false,
      setParkingBrake: function(v) {
        this.parkingBrake = Boolean(v);
        if (this.parkingBrake) this.brakes = 1.0;
      },
      setVirtualInput: (k, v) => { virtualInputs[k] = v; },
      clearVirtualInputs: () => {
        for (const k of Object.keys(virtualInputs)) delete virtualInputs[k];
      },
      getVirtualInput: (k) => virtualInputs[k]
    },
    engines: {
      setThrottle: () => {},
      setReverser: () => {}
    },
    gear: {
      brakes: 0.0,
      setBrakes: function(v) { this.brakes = v; },
      setGearTarget: () => {}
    },
    aero: {
      spoilers: 0,
      setFlapPosition: () => {}
    },
    sky: {
      setTimeOfDay: () => {},
      getSunDirection: () => new THREE.Vector3(0, 1, 0)
    },
    cameraSystem: {
      mode: CameraSystem.MODES.COCKPIT,
      setMode: function(m) { this.mode = m; },
      lookPitch: 0,
      lookYaw: 0
    },
    setAirport: function(id) { this.activeAirport = id; },
    setPreset: () => { presetCalled = true; },
    getPresetCalled: () => presetCalled,
    showToast: () => {}
  };
}

describe('LuklaCircuitScenario (Continuous Circuit Flight without Teleportation)', () => {
  it('should initialize and execute Lukla circuit without ever teleporting during flight', () => {
    const sim = createMockSimulator();
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    assert.strictEqual(director.isActive, true);
    assert.strictEqual(director.currentStage, LuklaCircuitScenario.STAGES.CLIFF_TAKEOFF);
    assert.strictEqual(sim.getPresetCalled(), true, 'Takeoff positions at Runway 24 cliff threshold');

    // Reset preset tracker to ensure no mid-flight teleportation occurs
    let midflightPresetCalled = false;
    sim.setPreset = () => { midflightPresetCalled = true; };

    // 1. Advance to Canyon Climb
    director.stageTimer = 9.0;
    sim.telemetry.iasKnots = 130;
    sim.telemetry.radioAltFt = 100;
    director.update(0.1);
    assert.strictEqual(director.currentStage, LuklaCircuitScenario.STAGES.CANYON_CLIMB);
    assert.strictEqual(midflightPresetCalled, false, 'Canyon climb stage must not teleport');

    // 2. Advance to 180° Canyon Turnaround (Himalayan Cruise)
    director.stageTimer = 10.0;
    director.update(0.1);
    assert.strictEqual(director.currentStage, LuklaCircuitScenario.STAGES.HIMALAYAN_CRUISE);
    assert.strictEqual(midflightPresetCalled, false, '180° turnaround stage must NEVER teleport');

    // 3. Advance to Canyon Approach
    director.stageTimer = 9.5;
    director.update(0.1);
    assert.strictEqual(director.currentStage, LuklaCircuitScenario.STAGES.CANYON_APPROACH);
    assert.strictEqual(midflightPresetCalled, false, 'Final approach stage must NEVER teleport');

    // 4. Advance to Uphill Touchdown
    // Position aircraft over Threshold 06: s = -200m
    sim.position.set(-200 * 0.848048, 2810, 200 * 0.529919);
    sim.telemetry.onGround = true;
    director.update(0.1);
    assert.strictEqual(director.currentStage, LuklaCircuitScenario.STAGES.UPHILL_TOUCHDOWN);
    assert.strictEqual(midflightPresetCalled, false, 'Touchdown stage must not teleport');

    // 5. Complete rollout when stopped
    sim.telemetry.iasKnots = 2;
    director.stageTimer = 8.5;
    director.update(0.1);
    assert.strictEqual(director.isActive, false);
    assert.strictEqual(sim.controls.parkingBrake, true, 'Parking brake must be set upon Lukla rollout completion to prevent backward slope rollback');
    assert.strictEqual(sim.controls.brakes, 1.0);
    assert.strictEqual(sim.gear.brakes, 1.0);
    assert.strictEqual(midflightPresetCalled, false, 'The entire circuit must complete with zero mid-flight teleportation');
  });

  it('should guide a coordinated 180° left turn during canyon turnaround stage', () => {
    const sim = createMockSimulator();
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    director.setStage(LuklaCircuitScenario.STAGES.HIMALAYAN_CRUISE);

    // Initial heading 228° (South-West)
    sim.telemetry.headingDeg = 228;
    sim.telemetry.rollDeg = 0;
    sim.telemetry.iasKnots = 138;
    sim.position.set(-2200 * 0.848048, 3010, 2200 * 0.529919);
    director.stageTimer = 4.0;

    director.update(0.1);

    // Should command negative aileron (left bank) to sweep heading towards 058°
    const aileronCmd = sim.controls.getVirtualInput('aileron');
    assert.ok(aileronCmd < -0.05, `Expected negative aileron for left bank, got ${aileronCmd}`);

    // Throttle should be held active (~0.65) to maintain ~140 knots in turn
    const throttleCmd = sim.controls.getVirtualInput('throttle');
    assert.ok(throttleCmd >= 0.55 && throttleCmd <= 0.85, `Expected cruise throttle ~0.65, got ${throttleCmd}`);
  });
});
