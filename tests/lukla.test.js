import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import metadata from '../public/terrain/lukla_metadata.json' with { type: 'json' };
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

  it('loads the traceable Copernicus-derived grid and computes Himalayan elevations', () => {
    const binPath = path.resolve(process.cwd(), 'public/terrain/lukla_dem.bin');
    assert.ok(fs.existsSync(binPath), 'lukla_dem.bin must exist in public/terrain');

    const buf = fs.readFileSync(binPath);
    const customElev = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    assert.strictEqual(customElev.length, metadata.gridSize * metadata.gridSize);

    const terrain = new LuklaTerrain(22000, 128, customElev);
    assert.strictEqual(terrain.isLoaded, true);

    // Height at airport center (0, 0)
    const midH = terrain.getHeight(0, 0);
    assert.ok(midH >= 2825 && midH <= 2850, `Midpoint height ${midH} should be around 2836m`);

    // Height at 5km East (Thamserku mountain ridge)
    const eastRidgeH = terrain.getHeight(5000, 0);
    assert.ok(eastRidgeH > 4000, `East ridge height ${eastRidgeH} should exceed 4,000m`);
    for (const point of metadata.dem.checkpoints) {
      assert.ok(Math.abs(terrain.getNaturalHeight(point.x, point.z) - point.sourceHeightM) < 2,
        'Reprojected grid must agree with independent source-tile elevation checkpoints');
    }
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

  it('preserves measured terrain beyond the airport instead of inventing walls and canyons', () => {
    const buf = fs.readFileSync('public/terrain/lukla_dem.bin');
    assert.strictEqual(createHash('sha256').update(buf).digest('hex'), metadata.dem.outputSha256);
    const terrain = new LuklaTerrain(22000, 255,
      new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
    const sin = Math.sin(terrain.runwayHeadingRad), cos = Math.cos(terrain.runwayHeadingRad);
    for (const s of [-3000, -1000, -500, -330, 330, 400, 500, 1000, 3000]) {
      for (const w of [-150, 0, 150]) {
        const x = s * sin + w * cos, z = -s * cos + w * sin;
        assert.strictEqual(terrain.getHeight(x, z), terrain.getNaturalHeight(x, z),
          `Outside airport grading, s=${s}, w=${w} must retain DEM elevation`);
      }
    }
    // Every source-grid sample must retain its position and north/south orientation.
    for (const [row, col] of [[0, 0], [80, 300], [256, 256], [400, 100], [512, 512]]) {
      const x = (col / (metadata.gridSize - 1) - 0.5) * metadata.worldSize;
      const z = (row / (metadata.gridSize - 1) - 0.5) * metadata.worldSize;
      assert.ok(Math.abs(terrain.getNaturalHeight(x, z) - terrain.elevations[row * metadata.gridSize + col]) < 0.01);
    }
    // No discontinuity where the former 140 m mountain-wall override ended.
    for (const s of [-313.5, -263.5, 263.5, 313.5, 403.5]) {
      const before = terrain.getHeight((s - 0.01) * sin, -(s - 0.01) * cos);
      const after = terrain.getHeight((s + 0.01) * sin, -(s + 0.01) * cos);
      assert.ok(Math.abs(after - before) < 0.1, `Continuous airport transition at s=${s}`);
    }
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

  it('uses an explicitly unloaded neutral surface until real assets arrive', () => {
    const terrain = new LuklaTerrain(22000, 128);
    assert.strictEqual(terrain.isLoaded, false);
    assert.strictEqual(terrain.getNaturalHeight(5000, 5000), terrain.midElevation);
    assert.strictEqual(terrain.getNaturalHeight(-5000, -5000), terrain.midElevation);
  });

  it('should detect collisions against Lukla control tower and terminal', () => {
    const terrain = new LuklaTerrain(22000, 128);
    const airport = new LuklaAirport();
    const detector = new CollisionDetector(terrain, airport, null, null, null);

    const sin58 = Math.sin(THREE.MathUtils.degToRad(58.0));
    const cos58 = Math.cos(THREE.MathUtils.degToRad(58.0));

    // 1. Safe on runway 06 threshold with gear down (groundH plus 3.5m wheel geometry)
    const groundH = terrain.getHeight(-210 * sin58, 210 * cos58);
    const pos = new THREE.Vector3(-210 * sin58, groundH + 3.5, 210 * cos58);
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

  it('should construct upper retaining wall at Runway 24 threshold with defined elevation (no NaN) and detect collision', () => {
    const airport = new LuklaAirport();
    assert.strictEqual(airport.threshold24Elevation, 2867.0);
    assert.ok(airport.upperWall, 'Upper retaining wall mesh must be created');
    assert.strictEqual(airport.upperWall.position.y, 2870.0, 'Upper wall elevation must equal elevation24 + 3.0m');
    assert.ok(!Number.isNaN(airport.upperWall.position.y), 'Upper wall elevation must not be NaN');

    // Retaining wall collision metadata
    assert.ok(airport.retainingWallData, 'Airport must publish retainingWallData metadata');
    assert.strictEqual(airport.retainingWallData.y, 2867.0);

    const terrain = new LuklaTerrain(22000, 128);
    const detector = new CollisionDetector(terrain, airport, null, null, null);

    // Aircraft rolling uphill heading 58° at s = 250m (on runway, gear down)
    // Nose probe extends 17.5m ahead (-Z in aircraft local space, +s along 58°) to s = 267.5m, hitting wall at s = 265m
    const sin58 = Math.sin(THREE.MathUtils.degToRad(58.0));
    const cos58 = Math.cos(THREE.MathUtils.degToRad(58.0));
    const centerPos = new THREE.Vector3(250 * sin58, 2868.0, -250 * cos58);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -THREE.MathUtils.degToRad(58.0), 0, 'YXZ'));
    const vel = new THREE.Vector3(20 * sin58, 0, -20 * cos58);

    const wallCrash = detector.checkCollision(centerPos, quat, vel, 1.0, 0.0, 0.0);
    assert.ok(wallCrash !== null, 'Collision with retaining wall must be detected even with gear down');
    assert.strictEqual(wallCrash.type, 'TERRAIN');
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

  it('should construct local high-resolution terrace mesh to preserve runway surface without coarse DEM bulging', () => {
    const terrain = new LuklaTerrain(22000, 128);
    assert.ok(terrain.localTerraceMesh, 'Local terrace mesh must exist');
    assert.ok(terrain.localTerraceGeometry, 'Local terrace geometry must exist');
    assert.strictEqual(terrain.mesh.children.includes(terrain.localTerraceMesh), true, 'Terrace mesh must be attached to terrain mesh');

    const sin58 = Math.sin(THREE.MathUtils.degToRad(58.0));
    const cos58 = Math.cos(THREE.MathUtils.degToRad(58.0));

    // Centerline point at s = 200m (x = 200*sin58, z = -200*cos58)
    const analyticalH200 = terrain.getHeight(200 * sin58, -200 * cos58);
    assert.strictEqual(Math.round(analyticalH200 * 10) / 10, 2859.5, 'Centerline height at s=200m should be ~2859.5m');

    // Find the closest vertex in localTerraceGeometry to (s = 200, w = 0)
    const lPos = terrain.localTerraceGeometry.attributes.position;
    let closestDistSq = Infinity;
    let closestH = null;

    for (let i = 0; i < lPos.count; i++) {
      const x = lPos.getX(i);
      const z = lPos.getZ(i);
      const s = x * sin58 - z * cos58;
      const w = x * cos58 + z * sin58;
      const distSq = (s - 200) * (s - 200) + w * w;
      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closestH = lPos.getY(i);
      }
    }

    assert.ok(closestDistSq < 1.0, 'Must have a fine-tessellation vertex right at s=200, w=0');
    assert.ok(Math.abs(closestH - (analyticalH200 - 0.5)) < 0.01,
      'Rendered terrace must sit below the unchanged physical runway height');
  });

  it('keeps terrain triangles below the asphalt across both thresholds and edges after DEM reload', () => {
    const terrain = new LuklaTerrain(22000, 128);
    const airport = new LuklaAirport();
    const runway = airport.group.children.find(g => g.children.some(m => m.geometry?.type === 'PlaneGeometry'));
    const asphalt = runway.children.find(m => m.geometry?.type === 'PlaneGeometry');
    const foundation = runway.children.find(m => m.geometry?.type === 'BoxGeometry');
    assert.ok(foundation.position.y + foundation.geometry.parameters.height * 0.5 <= -0.5,
      'Foundation top must stay below the asphalt plane');
    airport.group.updateMatrixWorld(true);
    terrain.mesh.updateMatrixWorld(true);
    const sin = Math.sin(terrain.runwayHeadingRad);
    const cos = Math.cos(terrain.runwayHeadingRad);
    const ray = new THREE.Raycaster();
    const checkClearance = () => {
      for (const s of [-261, -250, -10, 0, 10, 250, 261]) {
        for (const w of [-14.9, -10, 0, 10, 14.9]) {
          const x = s * sin + w * cos;
          const z = -s * cos + w * sin;
          ray.set(new THREE.Vector3(x, 4000, z), new THREE.Vector3(0, -1, 0));
          const surface = ray.intersectObject(asphalt)[0];
          const ground = ray.intersectObject(terrain.mesh, true)[0];
          assert.ok(surface && ground, `Both surfaces must exist at s=${s}, w=${w}`);
          assert.ok(surface.point.y - ground.point.y > 0.25,
            `Terrain must clear asphalt at s=${s}, w=${w}`);
          assert.ok(Math.abs(terrain.getHeight(x, z) - surface.point.y) < 0.001,
            'Physical runway height must remain aligned with asphalt');
        }
      }
    };
    checkClearance();
    const buf = fs.readFileSync(path.resolve('public/terrain/lukla_dem.bin'));
    terrain.elevations = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    terrain.isLoaded = true;
    terrain.updateGeometryElevations();
    checkClearance();
  });
});

