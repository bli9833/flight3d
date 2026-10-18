import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LandingGear } from '../src/physics/LandingGear.js';

describe('LandingGear (Tricycle Oleo-Pneumatic Suspension & Steering)', () => {
  it('should initialize DOWN & LOCKED with 3 contact points', () => {
    const gear = new LandingGear();
    assert.strictEqual(gear.gearState, 1.0);
    assert.strictEqual(gear.contacts.length, 3);
    assert.strictEqual(gear.contacts[0].id, 'nose');
    assert.strictEqual(gear.contacts[1].id, 'mainLeft');
    assert.strictEqual(gear.contacts[2].id, 'mainRight');
  });

  it('should transition gear state smoothly during retraction and extension', () => {
    const gear = new LandingGear();
    // Retract gear
    gear.toggleGear();
    assert.strictEqual(gear.targetGearState, 0.0);

    // Step 1 second
    gear.update(1.0, new THREE.Object3D(), new THREE.Vector3(), new THREE.Vector3(), () => 0);
    assert.strictEqual(gear.isTransit, true);
    assert.ok(gear.gearState < 1.0 && gear.gearState > 0.0, 'Gear should be in transit');

    // Step 10 seconds to fully lock UP
    for (let i = 0; i < 100; i++) {
      gear.update(0.1, new THREE.Object3D(), new THREE.Vector3(), new THREE.Vector3(), () => 0);
    }
    assert.strictEqual(gear.gearState, 0.0);
    assert.strictEqual(gear.isTransit, false);

    // Extend gear back down
    gear.toggleGear();
    assert.strictEqual(gear.targetGearState, 1.0);
    for (let i = 0; i < 100; i++) {
      gear.update(0.1, new THREE.Object3D(), new THREE.Vector3(), new THREE.Vector3(), () => 0);
    }
    assert.strictEqual(gear.gearState, 1.0);
    assert.strictEqual(gear.isTransit, false);
  });

  it('should calculate speed-sensitive nosewheel steering angle', () => {
    const gear = new LandingGear();
    // Low speed taxi (5 m/s ~ 10 knots): wide steering angle
    gear.setSteering(1.0, 5.0);
    const lowSpeedSteer = Math.abs(THREE.MathUtils.radToDeg(gear.steerAngle));
    assert.ok(lowSpeedSteer > 40.0, 'Low speed taxi should allow high steering angle (>40°)');

    // High speed takeoff roll (60 m/s ~ 120 knots): restricted steering angle for stability
    gear.setSteering(1.0, 60.0);
    const highSpeedSteer = Math.abs(THREE.MathUtils.radToDeg(gear.steerAngle));
    assert.ok(highSpeedSteer < 11.0, 'High speed roll should restrict steering angle (<11°)');
  });

  it('should generate upward suspension forces when contacting ground', () => {
    const gear = new LandingGear();
    const aircraft = new THREE.Object3D();
    // Aircraft at y = 14m, ground height is 12m
    // Main gear is at y = -2.2m from CG, so tire contact is at 14 - 2.2 = 11.8m (penetrating ground by 0.2m)
    aircraft.position.set(0, 14.0, 0);
    aircraft.quaternion.set(0, 0, 0, 1);
    aircraft.updateMatrixWorld(true);

    const terrainHeightFn = () => 12.0;
    const linVel = new THREE.Vector3(0, -0.5, 0); // Descending slowly
    const angVel = new THREE.Vector3(0, 0, 0);

    const res = gear.update(0.01, aircraft, linVel, angVel, terrainHeightFn);

    assert.strictEqual(res.onGround, true, 'Aircraft gear is compressed against ground');
    assert.ok(res.forces.y > 0, 'Suspension must generate positive upward normal force');
  });
});
