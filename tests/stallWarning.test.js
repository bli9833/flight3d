import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { AIRCRAFT_REGISTRY, CESSNA_172, F16_FALCON } from '../src/config/aircraftConfigs.js';

function sample(aero, alpha, speed = 80, rotation = new THREE.Quaternion(), dt = 1 / 120) {
  const a = THREE.MathUtils.degToRad(alpha);
  const velocity = new THREE.Vector3(0, -speed * Math.sin(a), -speed * Math.cos(a)).applyQuaternion(rotation);
  return aero.computeAero(dt, { quaternion: rotation }, velocity, new THREE.Vector3(), 0, 1000, 0, 0);
}

describe('aircraft stall warning sensors', () => {
  it('calibrates the C172 horn 5–10 kt before the model stall across flap detents', () => {
    for (const flap of CESSNA_172.aerodynamics.flapAngles) {
      const aero = new Aerodynamics(CESSNA_172);
      aero.currentFlapAngle = flap; aero.flapsIndex = aero.flapAngles.indexOf(flap);
      const result = sample(aero, 0);
      const cl0 = aero.CL0_clean + 0.95 * flap / 40;
      const clMax = cl0 + aero.CLa * (aero.alphaStallClean + THREE.MathUtils.degToRad(2 * flap / 40));
      const clWarning = cl0 + aero.CLa * THREE.MathUtils.degToRad(result.stallWarningAlphaDeg);
      const speed = cl => Math.sqrt(2 * CESSNA_172.massProperties.maxTakeoffWeightKg * 9.80665 / (1.225 * aero.wingArea * cl)) * 1.94384;
      const margin = speed(clWarning) - speed(clMax);
      assert.ok(margin >= 5 && margin <= 10, `flaps ${flap}: margin ${margin}`);
      assert.equal(sample(aero, result.stallWarningAlphaDeg - 0.1).isStallWarning, false);
      assert.equal(sample(aero, result.stallWarningAlphaDeg + 0.1).isStallWarning, true);
    }
  });

  it('warns in fast inverted descending flight, then clears on unloaded acceleration', () => {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.0, 0, Math.PI, 'YXZ'));
    for (const config of Object.values(AIRCRAFT_REGISTRY)) {
      const aero = new Aerodynamics(config);
      const alpha = config.aerodynamics.alphaStallDeg + 8;
      const a = THREE.MathUtils.degToRad(alpha);
      const velocity = new THREE.Vector3(0, -150 * Math.sin(a), -150 * Math.cos(a)).applyQuaternion(rotation);
      assert.ok(velocity.y < 0, 'test trajectory descends in world coordinates');
      const high = sample(aero, alpha, 150, rotation);
      assert.equal(high.isStallWarning, true, config.id);
      assert.equal(high.isStalled, true);
      const recovered = sample(aero, 2, 200, rotation);
      assert.equal(recovered.isStallWarning, false, 'sensor clears without waiting for reattachment');
      assert.equal(recovered.isStalled, true, 'separated flow still has memory');
      for (let i = 0; i < 240; i++) sample(aero, 2, 200, rotation);
      assert.equal(aero.isStalled, false);
    }
  });

  it('does not treat negative-AoA separation as a positive-AoA sensor warning', () => {
    for (const config of Object.values(AIRCRAFT_REGISTRY)) {
      const result = sample(new Aerodynamics(config), -40);
      assert.equal(result.isStalled, true);
      assert.equal(result.isStallWarning, false);
      assert.equal(result.isPreStall, false);
    }
  });

  it('uses the F16 gear handle immediately, including transit and reversal', () => {
    const aero = new Aerodynamics(F16_FALCON);
    aero.gearHandleDown = true;
    assert.equal(sample(aero, 15.1).isPreStall, true, 'gear still retracted, handle down');
    assert.equal(sample(aero, 14.9).isStallWarning, false);
    aero.gearHandleDown = false;
    assert.equal(sample(aero, 16).isStallWarning, false);
    aero.gearHandleDown = true;
    assert.equal(sample(aero, 16).isStallWarning, true);
    aero.loadConfig(CESSNA_172);
    assert.equal(aero.isStallWarning, false);
    assert.equal(aero.gearHandleDown, undefined);
  });

  it('inhibits warnings with negligible airflow and leaves forces independent of warning tuning', () => {
    for (const config of Object.values(AIRCRAFT_REGISTRY)) {
      assert.equal(sample(new Aerodynamics(config), 40, 2).isStallWarning, false);
      const a = new Aerodynamics(config), b = new Aerodynamics({ ...config, stallWarning: { marginDeg: 12 } });
      const x = sample(a, 8), y = sample(b, 8);
      assert.deepEqual(x.forceWorld, y.forceWorld);
      assert.deepEqual(x.momentBody, y.momentBody);
    }
  });
});
