import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Atmosphere } from '../src/physics/Atmosphere.js';

describe('Atmosphere (ISA Standard Atmosphere Model)', () => {
  it('should return standard sea-level values at 0m altitude', () => {
    const seaLevel = Atmosphere.getConditions(0);
    assert.ok(Math.abs(seaLevel.temperature - 288.15) < 0.01, 'Sea level temp should be 288.15 K');
    assert.ok(Math.abs(seaLevel.pressure - 101325.0) < 1.0, 'Sea level pressure should be 101,325 Pa');
    assert.ok(Math.abs(seaLevel.density - 1.225) < 0.005, 'Sea level density should be 1.225 kg/m^3');
    assert.ok(Math.abs(seaLevel.speedOfSound - 340.29) < 0.5, 'Sea level speed of sound should be ~340.3 m/s');
    assert.ok(Math.abs(seaLevel.densityRatio - 1.0) < 0.001, 'Density ratio at sea level should be 1.0');
  });

  it('should model tropospheric temperature lapse (6.5 K / 1000m)', () => {
    const at5000m = Atmosphere.getConditions(5000);
    const expectedTemp = 288.15 - 0.0065 * 5000; // 255.65 K
    assert.ok(Math.abs(at5000m.temperature - expectedTemp) < 0.01);
    assert.ok(at5000m.pressure < 101325.0, 'Pressure must drop with altitude');
    assert.ok(at5000m.density < 1.225, 'Density must drop with altitude');
    assert.ok(at5000m.speedOfSound < 340.0, 'Speed of sound drops as temperature drops');
  });

  it('should maintain isothermal conditions in lower stratosphere (> 11,000m)', () => {
    const atTropo = Atmosphere.getConditions(11000);
    const atStrato = Atmosphere.getConditions(14000);
    assert.ok(Math.abs(atTropo.temperature - atStrato.temperature) < 0.01, 'Stratosphere is isothermal');
    assert.ok(atStrato.pressure < atTropo.pressure, 'Stratosphere pressure continues exponential decay');
    assert.ok(atStrato.density < atTropo.density, 'Stratosphere density continues decay');
  });

  it('should convert between TAS and IAS correctly with density ratio', () => {
    const tas = 100.0; // 100 m/s
    const densityRatio = 0.5; // High altitude
    const ias = Atmosphere.tasToIas(tas, densityRatio);
    assert.ok(ias < tas, 'IAS must be lower than TAS in thin air');
    assert.ok(Math.abs(ias - (100 * Math.sqrt(0.5))) < 0.01);

    const backToTas = Atmosphere.iasToTas(ias, densityRatio);
    assert.ok(Math.abs(backToTas - tas) < 0.01, 'Roundtrip TAS -> IAS -> TAS must match');
  });

  it('should perform unit conversions accurately', () => {
    // 1 m/s = 1.94384 knots
    assert.ok(Math.abs(Atmosphere.msToKnots(100) - 194.384) < 0.01);
    assert.ok(Math.abs(Atmosphere.knotsToMs(194.384) - 100) < 0.01);

    // 1 meter = 3.28084 feet
    assert.ok(Math.abs(Atmosphere.metersToFeet(1000) - 3280.84) < 0.1);
    assert.ok(Math.abs(Atmosphere.feetToMeters(3280.84) - 1000) < 0.1);
  });
});
