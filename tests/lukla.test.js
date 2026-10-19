import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { LuklaTerrain } from '../src/environment/LuklaTerrain.js';
import { LuklaAirport } from '../src/environment/LuklaAirport.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { LandingGear } from '../src/physics/LandingGear.js';

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

  it('should construct LuklaAirport 3D elements, collision bounds, and keep facilities off the runway', () => {
    const airport = new LuklaAirport();
    assert.ok(airport.group instanceof THREE.Group);
    assert.strictEqual(airport.runwayLength, 527.0);
    assert.strictEqual(airport.runwayWidth, 30.0);

    // Check collision metadata exists
    assert.ok(airport.terminalData);
    assert.ok(airport.controlTowerData);
    assert.strictEqual(airport.controlTowerData.height, 16.0);

    // Verify terminal and tower are safely clear of the 30m runway centerline (|w| > 25m)
    const sin58 = Math.sin(THREE.MathUtils.degToRad(58.0));
    const cos58 = Math.cos(THREE.MathUtils.degToRad(58.0));
    const termW = airport.terminalData.x * cos58 + airport.terminalData.z * sin58;
    const towerW = airport.controlTowerData.x * cos58 + airport.controlTowerData.z * sin58;
    assert.ok(Math.abs(termW) > 25.0, `Terminal lateral position (${termW.toFixed(1)}m) must be outside runway clearance`);
    assert.ok(Math.abs(towerW) > 25.0, `Tower lateral position (${towerW.toFixed(1)}m) must be outside runway clearance`);

    // Verify isOnRunway containment
    assert.strictEqual(airport.isOnRunway(0, 0), true, 'Runway midpoint must be recognized as runway');
    assert.strictEqual(airport.isOnRunway(-210 * sin58, 210 * cos58), true, 'Runway 06 threshold must be recognized as runway');
    // Coordinates inside coastal box but outside Lukla runway
    assert.strictEqual(airport.isOnRunway(500, 200), false, 'Surrounding mountain terrain must NOT be recognized as runway');

    // Check dynamic updates support both 2-arg and 3-arg signatures without producing NaN
    airport.update(0.016, 1.0);
    assert.ok(airport.beaconLights.length > 0);
    assert.strictEqual(typeof airport.beaconLights[0].intensity, 'number');
    assert.ok(!Number.isNaN(airport.beaconLights[0].intensity));

    airport.update(0.016, new THREE.Vector3(0, 2800, 0), 2.5);
    assert.ok(!Number.isNaN(airport.beaconLights[0].intensity));
    if (airport.windsock) {
      assert.ok(!Number.isNaN(airport.windsock.rotation.y));
    }
  });

  it('should ensure procedural fallback terrain is safely clear of the approach corridor', () => {
    const terrain = new LuklaTerrain(22000, 128);
    const sin58 = Math.sin(THREE.MathUtils.degToRad(58.0));
    const cos58 = Math.cos(THREE.MathUtils.degToRad(58.0));

    // Approach preset start position: s = -3800m, w = 0m
    const appX = -3800.0 * sin58;
    const appZ = 3800.0 * cos58;
    const fallbackH = terrain.getHeight(appX, appZ);

    // Initial approach altitude is 3,070m; fallback terrain must be safely below this altitude
    assert.ok(fallbackH < 2600.0, `Procedural fallback height ${fallbackH}m must leave clear airspace below 3,070m`);
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
      new THREE.Euler(THREE.MathUtils.degToRad(6.71), -THREE.MathUtils.degToRad(58.0), 0, 'YXZ')
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

    // 3. Collision with rotated terminal building corner
    // Local corner of 44x24m terminal rotated by 32°
    const rotY = airport.terminalData.rotationY;
    const cosR = Math.cos(rotY);
    const sinR = Math.sin(rotY);
    // Point at local (lx = 18m, lz = 10m) inside rotated building
    const cornerX = airport.terminalData.x + 18 * cosR + 10 * sinR;
    const cornerZ = airport.terminalData.z - 18 * sinR + 10 * cosR;
    const terminalCornerPos = new THREE.Vector3(cornerX, airport.terminalData.y + 5, cornerZ);
    const termCrash = detector.checkCollision(terminalCornerPos, quat, vel, 1.0, 0.0, 0.0);
    assert.ok(termCrash !== null, 'Collision with rotated terminal corner must be detected');
    assert.strictEqual(termCrash.type, 'BUILDING');
  });

  it('should construct upper retaining wall at Runway 24 threshold with defined elevation (no NaN)', () => {
    const airport = new LuklaAirport();
    assert.strictEqual(airport.threshold24Elevation, 2867.0);
    assert.ok(airport.upperWall, 'Upper retaining wall mesh must be created');
    assert.strictEqual(airport.upperWall.position.y, 2870.0, 'Upper wall elevation must equal elevation24 + 3.0m');
    assert.ok(!Number.isNaN(airport.upperWall.position.y), 'Upper wall elevation must not be NaN');
  });

  it('should impart sloped surface normal forces in landing gear physics on Lukla runway', () => {
    const gear = new LandingGear();
    const terrain = new LuklaTerrain(22000, 128);

    const sin58 = Math.sin(THREE.MathUtils.degToRad(58.0));
    const cos58 = Math.cos(THREE.MathUtils.degToRad(58.0));

    // Position aircraft on Runway 24 facing downhill (heading 238°)
    // Surface slopes downhill at 11.7% (~6.71° pitch)
    const mesh = new THREE.Object3D();
    const groundH = terrain.getHeight(0, 0);
    mesh.position.set(0, groundH + 2.1, 0);
    mesh.quaternion.setFromEuler(new THREE.Euler(0, THREE.MathUtils.degToRad(238.0), 0, 'YXZ'));
    mesh.updateMatrixWorld(true);

    const linearVel = new THREE.Vector3(0, 0, 0);
    const angularVel = new THREE.Vector3(0, 0, 0);

    // Update with terrain height and normal callback
    const res = gear.update(
      0.016,
      mesh,
      linearVel,
      angularVel,
      (x, z) => terrain.getHeight(x, z),
      (x, z) => terrain.getNormal(x, z)
    );

    assert.strictEqual(res.onGround, true, 'Gear should be compressed on sloped runway');
    assert.ok(res.forces.y > 100000, 'Suspension normal force should support aircraft weight');

    // On an 11.7% sloped runway oriented at 58°/238°, normal force must have a horizontal component
    // that accelerates the aircraft downhill towards Threshold 06 (-s direction)
    const horizForce = Math.sqrt(res.forces.x * res.forces.x + res.forces.z * res.forces.z);
    assert.ok(horizForce > 10000, `Horizontal surface normal force (${horizForce.toFixed(0)}N) should be significant on 11.7% slope`);

    // Force along runway axis s = fx * sin58 - fz * cos58 should push downhill (negative s)
    const forceAlongS = res.forces.x * sin58 - res.forces.z * cos58;
    assert.ok(forceAlongS < 0, `Force along runway axis (${forceAlongS.toFixed(0)}N) must be directed downhill (-s toward cliff)`);
  });
});

