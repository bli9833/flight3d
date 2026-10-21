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
    // Aircraft at y = 15.0m, ground height is 12m
    // Main gear contact is at y = -3.30m from CG, penetrating ground to compress suspension
    aircraft.position.set(0, 15.0, 0);
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

describe('Landing gear impact and failure envelope', () => {
  const pose = y => {
    const mesh = new THREE.Object3D();
    mesh.position.set(0, y, 0);
    mesh.updateMatrixWorld(true);
    return mesh;
  };
  it('captures a severe impact at wheel height before any positional correction and retains damage until reset', () => {
    const gear = new LandingGear();
    const mesh = pose(4.2);
    gear.update(1 / 120, mesh, new THREE.Vector3(0, -20, -65), new THREE.Vector3(), () => 0);
    assert.equal(gear.failure, null, 'No impact before wheel contact');
    mesh.position.y = 3.75;
    mesh.updateMatrixWorld(true);
    let result = gear.update(1 / 120, mesh, new THREE.Vector3(0, -20, -65), new THREE.Vector3(), () => 0);
    assert.equal(result.failure.reason, 'impact');
    assert.equal(result.failure.sinkRate, 20);
    result = gear.update(1 / 120, mesh, new THREE.Vector3(), new THREE.Vector3(), () => 0);
    assert.ok(result.failure, 'Velocity changes cannot erase existing gear damage');
    gear.resetContacts();
    result = gear.update(1 / 120, mesh, new THREE.Vector3(0, -1, -65), new THREE.Vector3(), () => 0);
    assert.equal(result.failure, null);
  });
  it('emits a touchdown event at shallow first contact without waiting for 3cm penetration', () => {
    const gear = new LandingGear();
    const result = gear.update(1 / 120, pose(3.779), new THREE.Vector3(0, -1, -60), new THREE.Vector3(), () => 0);
    assert.equal(result.touchdown, true);
    assert.equal(result.touchdownContacts.length, 2);
    assert.ok(result.touchdownContacts.every(c => c.compression < 0.03));
    assert.equal(result.failure, null);
  });
  it('uses surface-normal velocity on a slope, not world vertical speed', () => {
    const normal = new THREE.Vector3(-0.1176, 1, 0).normalize();
    for (const tangent of [false, true]) {
      const gear = new LandingGear();
      const mesh = pose(3.75);
      mesh.quaternion.setFromEuler(new THREE.Euler(Math.atan(0.1176), -Math.PI / 2, 0, 'YXZ'));
      mesh.updateMatrixWorld(true);
      const velocity = new THREE.Vector3(65, tangent ? 65 * 0.1176 : 0, 0);
      const result = gear.update(1 / 120, mesh, velocity, new THREE.Vector3(), x => x * 0.1176, () => normal);
      assert.equal(result.onGround, true);
      if (tangent) assert.equal(result.failure, null, 'Following the grade is safe');
      else assert.ok(result.failure.sinkRate > 7.5, 'Level flight strikes the uphill runway');
    }
  });
  it('includes angular motion when the nose gear hits and detects a bottomed-out strut', () => {
    const gear = new LandingGear();
    let result = gear.update(1 / 120, pose(3.6), new THREE.Vector3(0, 0, -60),
      new THREE.Vector3(-0.3, 0, 0), () => 0);
    assert.equal(result.failure.contact, 'nose');
    assert.ok(result.failure.sinkRate > 3.7);
    gear.resetContacts();
    result = gear.update(1 / 120, pose(2.5), new THREE.Vector3(), new THREE.Vector3(), () => 0);
    assert.equal(result.failure.reason, 'bottom-out');
  });
});
