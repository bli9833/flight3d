import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { LuklaTerrain } from '../src/environment/LuklaTerrain.js';
import { LuklaAirport } from '../src/environment/LuklaAirport.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';

describe('Nepal Tenzing-Hillary Airport (Lukla VNLK) Real-World Terrain & Systems', () => {
  it('should initialize LuklaTerrain with procedural fallback and accurate specifications', () => {
    const terrain = new LuklaTerrain(22000, 128);
    assert.strictEqual(terrain.size, 22000);
    assert.strictEqual(terrain.runwayLength, 527.0);
    assert.strictEqual(terrain.runwayWidth, 30.0);
    assert.strictEqual(terrain.threshold06Elevation, 2805.0);
    assert.strictEqual(terrain.threshold24Elevation, 2867.0);

    // Midpoint elevation should be average of thresholds
    assert.strictEqual(terrain.midElevation, 2836.0);
  });

  it('should load real 30m DEM binary asset and compute realistic Himalayan elevations', () => {
    const binPath = path.resolve(process.cwd(), 'public/terrain/lukla_dem_256.bin');
    assert.ok(fs.existsSync(binPath), 'lukla_dem_256.bin must exist in public/terrain');

    const buf = fs.readFileSync(binPath);
    const customElev = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    assert.strictEqual(customElev.length, 256 * 256);

    const terrain = new LuklaTerrain(22000, 128, customElev);
    assert.strictEqual(terrain.isLoaded, true);

    // Height at airport center (0, 0)
    const midH = terrain.getHeight(0, 0);
    assert.ok(midH >= 2825 && midH <= 2850, `Midpoint height ${midH} should be around 2836m`);

    // Height at 5km East (Thamserku mountain ridge)
    const eastRidgeH = terrain.getHeight(5000, 0);
    assert.ok(eastRidgeH > 4000, `East ridge height ${eastRidgeH} should exceed 4,000m`);
  });

  it('should carve an exact 11.7% sloped runway between Threshold 06 and 24', () => {
    const terrain = new LuklaTerrain(22000, 128);

    const sin58 = Math.sin(THREE.MathUtils.degToRad(58.0));
    const cos58 = Math.cos(THREE.MathUtils.degToRad(58.0));

    // Threshold 06 (s = -263.5m)
    const p06X = -263.5 * sin58;
    const p06Z = 263.5 * cos58;
    const h06 = terrain.getHeight(p06X, p06Z);
    assert.strictEqual(Math.round(h06), 2805, 'Threshold 06 elevation should be 2,805m');

    // Threshold 24 (s = +263.5m)
    const p24X = 263.5 * sin58;
    const p24Z = -263.5 * cos58;
    const h24 = terrain.getHeight(p24X, p24Z);
    assert.strictEqual(Math.round(h24), 2867, 'Threshold 24 elevation should be 2,867m');

    // Midpoint (s = 0)
    const hMid = terrain.getHeight(0, 0);
    assert.strictEqual(Math.round(hMid), 2836, 'Midpoint elevation should be 2,836m');

    // Check gradient: (2867 - 2805) / 527 = 62 / 527 = 11.76%
    const gradient = (h24 - h06) / 527.0;
    assert.ok(Math.abs(gradient - 0.1176) < 0.005, 'Runway gradient must be 11.76%');
  });

  it('should model the cliff drop at Threshold 06 and rock wall at Threshold 24', () => {
    const terrain = new LuklaTerrain(22000, 128);
    const sin58 = Math.sin(THREE.MathUtils.degToRad(58.0));
    const cos58 = Math.cos(THREE.MathUtils.degToRad(58.0));

    // 50m off the edge of Threshold 06 (s = -313.5m): should plunge into canyon
    const cliffX = -313.5 * sin58;
    const cliffZ = 313.5 * cos58;
    const cliffH = terrain.getHeight(cliffX, cliffZ);
    const h06 = terrain.getHeight(-263.5 * sin58, 263.5 * cos58);
    assert.ok(cliffH < h06 - 30, `Cliff height ${cliffH} should drop significantly below threshold ${h06}`);

    // 30m beyond Threshold 24 (s = +293.5m): should climb into mountain retaining wall
    const wallX = 293.5 * sin58;
    const wallZ = -293.5 * cos58;
    const wallH = terrain.getHeight(wallX, wallZ);
    const h24 = terrain.getHeight(263.5 * sin58, -263.5 * cos58);
    assert.ok(wallH > h24 + 10, `Wall height ${wallH} should climb above threshold ${h24}`);
  });

  it('should compute valid surface normals for physics', () => {
    const terrain = new LuklaTerrain(22000, 128);
    const norm = terrain.getNormal(0, 0);

    // Normal vector must be normalized
    assert.ok(Math.abs(norm.length() - 1.0) < 0.01);
    // Y component must point upwards
    assert.ok(norm.y > 0.85);
  });

  it('should construct LuklaAirport 3D elements and collision bounds', () => {
    const airport = new LuklaAirport();
    assert.ok(airport.group instanceof THREE.Group);
    assert.strictEqual(airport.runwayLength, 527.0);
    assert.strictEqual(airport.runwayWidth, 30.0);

    // Check collision metadata
    assert.ok(airport.terminalData);
    assert.ok(airport.controlTowerData);
    assert.strictEqual(airport.controlTowerData.height, 16.0);

    // Check dynamic updates
    airport.update(0.016, 1.0);
    assert.ok(airport.beaconLights.length > 0);
  });

  it('should detect collisions against Lukla control tower and terminal', () => {
    const terrain = new LuklaTerrain(22000, 128);
    const airport = new LuklaAirport();
    const detector = new CollisionDetector(terrain, airport, null, null, null);

    const sin58 = Math.sin(THREE.MathUtils.degToRad(58.0));
    const cos58 = Math.cos(THREE.MathUtils.degToRad(58.0));

    // 1. Safe on runway 06 threshold with gear down (groundH ~2811.3m + 2.15m gear = 2813.45m)
    const groundH = terrain.getHeight(-210 * sin58, 210 * cos58);
    const pos = new THREE.Vector3(-210 * sin58, groundH + 2.15, 210 * cos58);
    const quat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(6.71), -THREE.MathUtils.degToRad(58.0) - Math.PI * 0.5, 0, 'YXZ')
    );
    const vel = new THREE.Vector3(50 * sin58, 0, -50 * cos58);

    const safeResult = detector.checkCollision(pos, quat, vel, 1.0, 6.71, 0.0);
    assert.strictEqual(safeResult, null, 'Safe on runway should not trigger crash');

    // 2. Direct hit into Lukla Control Tower
    const towerPos = new THREE.Vector3(
      airport.controlTowerData.x,
      airport.controlTowerData.y + 6,
      airport.controlTowerData.z
    );
    const crashResult = detector.checkCollision(towerPos, quat, vel, 1.0, 0.0, 0.0);
    assert.ok(crashResult !== null, 'Collision with control tower must be detected');
    assert.strictEqual(crashResult.type, 'TOWER');
  });
});
