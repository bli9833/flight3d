import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';

describe('Aerodynamics (6-DOF Flight Physics Model)', () => {
  function createTestAircraft(rotationEuler = new THREE.Euler(0, 0, 0)) {
    const obj = new THREE.Object3D();
    obj.quaternion.setFromEuler(rotationEuler);
    return obj;
  }

  it('should compute linear lift and drag at zero alpha (cruise speed 80 m/s)', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    // Aircraft heading -Z in level flight at 80 m/s (approx 155 knots)
    const velocity = new THREE.Vector3(0, 0, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    const res = aero.computeAero(0.01, aircraft, velocity, angVel, 0, 500, 0, 0.0);

    assert.ok(Math.abs(res.alphaDeg) < 0.01, 'AoA should be zero');
    assert.ok(res.iasKnots > 150 && res.iasKnots < 160, 'IAS should be ~155 knots');
    assert.strictEqual(res.isStalled, false, 'Should not be stalled at zero AoA');
    assert.ok(res.lift > 80000, 'Zero-alpha camber produces positive lift');
    assert.ok(res.drag > 5000, 'Parasite + induced drag must be positive');
  });

  it('should increase lift proportionally with positive angle of attack', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    // 80 m/s forward (-Z), 7 m/s downward (+Y relative to flight path -> w > 0, approx +5° AoA)
    const velocity = new THREE.Vector3(0, -7, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    const res = aero.computeAero(0.01, aircraft, velocity, angVel, 0, 500, 0, 0.0);

    assert.ok(res.alphaDeg > 4.5 && res.alphaDeg < 5.5, 'AoA should be ~5 degrees');
    // At 5 deg AoA, lift should be much higher than at 0 deg
    assert.ok(res.lift > 250000, 'Lift at 5° AoA should exceed 250 kN');
  });

  it('should detect aerodynamic stall beyond critical angle of attack', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    // High angle of attack (~20°, w = 29 m/s, u = 80 m/s)
    const velocity = new THREE.Vector3(0, -32, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    const res = aero.computeAero(0.01, aircraft, velocity, angVel, 0, 500, 0, 0.0);

    assert.ok(res.alphaDeg > 18.0, 'AoA exceeds 18 degrees');
    assert.strictEqual(res.isStalled, true, 'isStalled flag must be true');
    assert.ok(res.stallSeverity > 0.0, 'Stall severity must be non-zero');
    assert.ok(res.buffetVibration > 0.0, 'Buffet vibration must be triggered');
  });

  it('should model ground effect (reduced induced drag near surface)', () => {
    const aero1 = new Aerodynamics();
    const aero2 = new Aerodynamics();
    const aircraft = createTestAircraft();
    const velocity = new THREE.Vector3(0, -7, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    // Case 1: In ground effect at 5m AGL (wingspan is 35.8m)
    const inGroundEffect = aero1.computeAero(0.01, aircraft, velocity, angVel, 50, 5, 0, 0.0);

    // Case 2: Out of ground effect at 500m AGL
    const outOfGroundEffect = aero2.computeAero(0.01, aircraft, velocity, angVel, 50, 500, 0, 0.0);

    assert.ok(inGroundEffect.cd < outOfGroundEffect.cd, 'Ground effect must reduce overall drag coefficient');
  });

  it('should increase parasite drag when flaps, gear, or spoilers are deployed', () => {
    const aeroClean = new Aerodynamics();
    const aeroDirty = new Aerodynamics();
    const aircraft = createTestAircraft();
    const velocity = new THREE.Vector3(0, 0, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    const resClean = aeroClean.computeAero(0.01, aircraft, velocity, angVel, 500, 500, 0, 0.0);

    // Deploy flaps to 30, gear to 1.0, spoilers to 1.0
    aeroDirty.setFlapPosition(5); // Flaps 30
    aeroDirty.currentFlapAngle = 30; // Instantly set angle for test
    aeroDirty.spoilers = 1.0;
    const resDirty = aeroDirty.computeAero(0.01, aircraft, velocity, angVel, 500, 500, 0, 1.0);

    assert.ok(resDirty.drag > resClean.drag * 2.0, 'Dirty config must produce more than double the drag');
  });

  it('should generate control moments and support live tuning sensitivity multipliers', () => {
    const aero = new Aerodynamics();
    const aircraft = createTestAircraft();
    const velocity = new THREE.Vector3(0, 0, -80);
    const angVel = new THREE.Vector3(0, 0, 0);

    // Baseline elevator deflection: stick back (+1.0)
    aero.elevator = 1.0;
    const resBaseline = aero.computeAero(0.01, aircraft, velocity, angVel, 500, 500, 0, 0.0);
    const baselinePitchMoment = resBaseline.momentBody.x;

    // Apply live tuning multiplier: 1.8x sensitivity
    aero.tuning.elevatorSensitivity = 1.8;
    const resTuned = aero.computeAero(0.01, aircraft, velocity, angVel, 500, 500, 0, 0.0);
    const tunedPitchMoment = resTuned.momentBody.x;

    assert.ok(Math.abs(baselinePitchMoment) > 1000, 'Elevator deflection must generate pitch moment');
    assert.ok(Math.abs(tunedPitchMoment) > Math.abs(baselinePitchMoment) * 1.5, 'Tuning sensitivity must scale pitching moment');
  });
});
