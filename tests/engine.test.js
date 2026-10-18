import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EngineModel } from '../src/physics/EngineModel.js';
import { Atmosphere } from '../src/physics/Atmosphere.js';

describe('EngineModel (Twin CFM56-7B Turbofan Simulation)', () => {
  it('should initialize at ground idle (22% N1, 62% N2)', () => {
    const engines = new EngineModel();
    assert.strictEqual(engines.numEngines, 2);
    assert.strictEqual(engines.throttleCommand, 0.0);
    assert.strictEqual(engines.n1[0], 22.0);
    assert.strictEqual(engines.n1[1], 22.0);
    assert.strictEqual(engines.n2[0], 62.0);
    assert.strictEqual(engines.n2[1], 62.0);
    assert.strictEqual(engines.reverserActive, false);
  });

  it('should model realistic spool-up latency from idle to TOGA', () => {
    const engines = new EngineModel();
    engines.setThrottle(1.0); // TOGA

    // Step 0.5 seconds at sea level
    engines.update(0.5, 0, 0, 1.0);
    assert.ok(engines.n1[0] > 22.0, 'N1 must begin spooling up');
    assert.ok(engines.n1[0] < 80.0, 'N1 should not immediately snap to 100% due to rotor inertia');

    // Step 5 seconds to allow full spool
    for (let t = 0; t < 50; t++) {
      engines.update(0.1, 0, 0, 1.0);
    }
    assert.ok(engines.n1[0] > 98.0, 'N1 should reach near 100% TOGA after spool time');
    assert.ok(engines.thrust[0] > 110000, 'Each engine should produce near max static thrust (>110 kN)');
  });

  it('should model realistic spool-down latency from TOGA to idle', () => {
    const engines = new EngineModel();
    engines.setThrottle(1.0);
    for (let t = 0; t < 50; t++) {
      engines.update(0.1, 0, 0, 1.0);
    }
    assert.ok(engines.n1[0] > 98.0);

    // Retard throttle to idle
    engines.setThrottle(0.0);
    engines.update(0.5, 0, 0, 1.0);
    assert.ok(engines.n1[0] < 95.0, 'N1 should begin dropping');
    assert.ok(engines.n1[0] > 25.0, 'N1 should not immediately drop to 22%');

    // Allow full spool down (approx 6 seconds)
    for (let t = 0; t < 60; t++) {
      engines.update(0.1, 0, 0, 1.0);
    }
    assert.ok(Math.abs(engines.n1[0] - 22.0) < 1.0, 'N1 returns to ~22% idle');
  });

  it('should restrict thrust reversers to ground operation only', () => {
    const engines = new EngineModel();
    // In air (onGround = false)
    engines.setReverser(true, false);
    assert.strictEqual(engines.reverserActive, false, 'Reverser must not engage in flight');

    // On ground (onGround = true)
    engines.setReverser(true, true);
    assert.strictEqual(engines.reverserActive, true, 'Reverser engages on ground');

    // Step to deploy buckets
    for (let t = 0; t < 20; t++) {
      engines.update(0.1, 0, 20, 1.0);
    }
    assert.ok(engines.reverserDeployment > 0.9, 'Reverser sleeves deploy');
    assert.ok(engines.thrust[0] < 0, 'Reverser produces negative (braking) thrust');
  });

  it('should calculate altitude thrust lapse (density drop)', () => {
    const seaEngines = new EngineModel();
    seaEngines.setThrottle(1.0);
    for (let t = 0; t < 50; t++) seaEngines.update(0.1, 0, 100, 1.0);

    const highEngines = new EngineModel();
    highEngines.setThrottle(1.0);
    const highAtmos = Atmosphere.getConditions(10000); // 10,000m (~33,000ft)
    for (let t = 0; t < 50; t++) highEngines.update(0.1, 10000, 100, highAtmos.densityRatio);

    assert.ok(highEngines.thrust[0] < seaEngines.thrust[0] * 0.5, 'Thrust at 10km should be less than 50% of sea level');
    assert.ok(highEngines.fuelFlow[0] < seaEngines.fuelFlow[0], 'Fuel flow decreases with reduced air density');
  });
});
