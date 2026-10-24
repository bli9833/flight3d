import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Cessna172 } from '../src/aircraft/Cessna172.js';
import { CESSNA_172, BOEING_737_800 } from '../src/config/aircraftConfigs.js';

describe('Cessna 172 Skyhawk Aircraft Model', () => {
  it('should initialize procedural hierarchy with all subassemblies', () => {
    const c172 = new Cessna172();
    assert.ok(c172.group instanceof THREE.Group);
    assert.strictEqual(c172.group.name, 'Aircraft_Cessna172');

    assert.ok(c172.fuselageGroup, 'Fuselage group must exist');
    assert.ok(c172.wingGroup, 'High-wing group must exist');
    assert.ok(c172.tailGroup, 'Tail empennage group must exist');
    assert.ok(c172.gearGroup, 'Landing gear group must exist');
    assert.ok(c172.propellerGroup, 'Propeller group must exist');
    assert.ok(c172.lightsGroup, 'Lights group must exist');
    assert.ok(c172.cockpit, 'Cockpit interface must exist for engine compatibility');
  });

  it('should have all articulated control surfaces and steerable gear', () => {
    const c172 = new Cessna172();
    assert.ok(c172.aileronL, 'Left aileron exists');
    assert.ok(c172.aileronR, 'Right aileron exists');
    assert.ok(c172.flapL, 'Left flap exists');
    assert.ok(c172.flapR, 'Right flap exists');
    assert.ok(c172.elevatorL, 'Left elevator exists');
    assert.ok(c172.elevatorR, 'Right elevator exists');
    assert.ok(c172.rudder, 'Rudder exists');
    assert.ok(c172.noseFork, 'Steerable nose fork exists');
  });

  it('should animate propeller spin and blur disk based on engine state', () => {
    const c172 = new Cessna172();
    const initialAngle = c172.propAngle;

    // Simulate idle running
    c172.update(0.1, { engine1N1: 30.0 });
    assert.ok(c172.propAngle > initialAngle, 'Propeller spins forward during engine idle');
    assert.strictEqual(c172.propBlurDisk.material.opacity, 0.0, 'Blur disk is transparent at low RPM');

    // Simulate full throttle (TOGA 100% N1)
    for (let i = 0; i < 10; i++) {
      c172.update(0.1, { engine1N1: 100.0 });
    }
    assert.ok(c172.propBlurDisk.material.opacity > 0.1, 'Blur disk fades in at high RPM');
  });

  it('should deflect ailerons, elevators, rudder, and flaps according to flight controls', () => {
    const c172 = new Cessna172();

    // Command right bank (aileron = 1.0)
    c172.update(0.016, { aileron: 1.0, elevator: 0.0, rudder: 0.0, flapDegree: 0 });
    assert.ok(c172.aileronL.rotation.x < 0, 'Left aileron deflects down to increase lift');
    assert.ok(c172.aileronR.rotation.x > 0, 'Right aileron deflects up to dump lift');

    // Command pitch up (stick back, elevator = 1.0)
    c172.update(0.016, { aileron: 0.0, elevator: 1.0, rudder: 0.0, flapDegree: 0 });
    assert.ok(c172.elevatorL.rotation.x < 0, 'Elevator deflects up for pitch up');
    assert.ok(c172.elevatorR.rotation.x < 0, 'Right elevator tracks left elevator');

    // Command right yaw (rudder = 1.0)
    c172.update(0.016, { aileron: 0.0, elevator: 0.0, rudder: 1.0, flapDegree: 0 });
    assert.ok(c172.rudder.rotation.y < 0, 'Rudder deflects trailing edge left');

    // Command flaps 20 degrees
    c172.update(0.016, { aileron: 0.0, elevator: 0.0, rudder: 0.0, flapDegree: 20 });
    assert.ok(c172.flapL.rotation.x > 0.3, 'Flap L deploys downward');
    assert.ok(c172.flapR.rotation.x > 0.3, 'Flap R deploys downward');

    // Steer nose wheel on ground
    c172.update(0.016, { rudder: 1.0, onGround: true });
    assert.ok(Math.abs(c172.noseFork.rotation.y) > 0.1, 'Nose gear steers with rudder on ground');

    // Nose wheel centers in the air
    c172.update(0.016, { rudder: 1.0, onGround: false });
    assert.strictEqual(c172.noseFork.rotation.y, 0, 'Nose gear centers when airborne');
  });

  it('should toggle cockpit mode cleanly and prevent interior clipping', () => {
    const c172 = new Cessna172();
    assert.strictEqual(c172.fuselageGroup.visible, true);

    c172.setCockpitMode(true, true);
    assert.strictEqual(c172.fuselageGroup.visible, false, 'Fuselage exterior hidden in cockpit view');
    assert.strictEqual(c172.cockpit.group.visible, true, 'Cockpit interior shown in cockpit view');

    c172.setCockpitMode(false, false);
    assert.strictEqual(c172.fuselageGroup.visible, true, 'Fuselage exterior restored in exterior view');
    assert.strictEqual(c172.cockpit.group.visible, false, 'Cockpit interior hidden in exterior view');
  });

  it('should manage crash visuals and light state', () => {
    const c172 = new Cessna172();
    assert.strictEqual(c172.isCrashed, false);
    assert.strictEqual(c172.lightsGroup.visible, true);

    c172.triggerCrashVisuals('terrain');
    assert.strictEqual(c172.isCrashed, true);
    assert.strictEqual(c172.lightsGroup.visible, false, 'Lights extinguish on impact');

    c172.resetCrashVisuals();
    assert.strictEqual(c172.isCrashed, false);
    assert.strictEqual(c172.lightsGroup.visible, true, 'Lights and airframe restored on reset');
  });
});
