import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Terrain } from '../src/environment/Terrain.js';
import { FoliageAndCities } from '../src/environment/FoliageAndCities.js';
import { CollisionDetector } from '../src/physics/CollisionDetector.js';
import { NORTH_DISTRICT, inspectSite, planNorthDistrict, insideRectangle, rectanglesOverlap } from '../src/environment/NorthCityDistrict.js';
import { districtSurfaceHeight, surfaceGeometry } from '../src/environment/CitySurface.js';

const compact = { radius: 180, maxBuildings: 30 };
const flat = { getHeight: () => 25 };

test('district is deterministic, connected, and bounds grade, plinths and canopy clearance', () => {
  const terrain = new Terrain(22000, 256);
  const heightBefore = terrain.getHeight(-800, -2800);
  const plan = planNorthDistrict(terrain), again = planNorthDistrict(terrain);
  assert.deepEqual(plan.lots, again.lots);
  assert.ok(plan.lots.length >= 10 && plan.lots.length <= NORTH_DISTRICT.maxBuildings);
  const seen = new Set([plan.nodes[0].id]);
  for (let i = 0; i < plan.nodes.length; i++) for (const e of plan.streets) {
    if (seen.has(e.a)) seen.add(e.b);
    if (seen.has(e.b)) seen.add(e.a);
    assert.ok(e.site.grade <= plan.config.maxGrade);
    assert.ok(e.site.crossSlope <= plan.config.maxCrossSlope);
    assert.ok(e.site.error <= plan.config.maxSurfaceError);
  }
  assert.equal(seen.size, plan.nodes.length);
  assert.ok(plan.nodes.some(n => n.degree === 1), 'dead ends have explicit square caps');
  assert.ok(plan.nodes.some(n => n.degree >= 3), 'junctions use a shared square');
  for (const lot of plan.lots) {
    assert.ok(lot.visualY - lot.groundY <= plan.config.maxFoundation);
    assert.ok(lot.site.slope <= plan.config.maxLotSlope);
    assert.ok(lot.site.min >= plan.config.minHeight);
    const dense = inspectSite(terrain, lot, { ...plan.config, sampleStep: .5 });
    assert.ok(lot.visualY >= dense.max && lot.groundY <= dense.min, 'dense independent footprint audit');
    assert.ok(plan.excludesTree(lot.x, lot.z, 0));
    assert.ok(plan.streets.some(e => Math.hypot(e.x - lot.x, e.z - lot.z) < 30));
    for (const road of [...plan.streets, ...plan.nodes]) assert.ok(!rectanglesOverlap(lot, road));
    for (const other of plan.lots) if (lot !== other) assert.ok(!rectanglesOverlap(lot, other));
  }
  const street = plan.streets[0];
  const x = street.x + Math.sin(street.rotationY) * (street.depth / 2 + 3);
  const z = street.z + Math.cos(street.rotationY) * (street.depth / 2 + 3);
  assert.ok(!insideRectangle(x, z, street));
  assert.ok(plan.excludesTree(x, z, 4), 'tree crown clears roads even when trunk is outside');
  assert.equal(terrain.getHeight(-800, -2800), heightBefore);
});

test('site grades include coarse rendered triangle slopes even on flat analytical terrain', () => {
  const terrain = { getHeight: () => 25, size: 8000, segments: 800,
    geometry: { attributes: { position: { getY: index => {
      const x = (index % 801) * 10 - 4000;
      return 25 + .22 * Math.max(-10, Math.min(10, x + 800));
    } } } } };
  const site = inspectSite(terrain, { x: -795, z: -2800, width: 4, depth: 4, rotationY: 0 });
  assert.ok(site && site.error < NORTH_DISTRICT.maxSurfaceError);
  assert.ok(site.grade > NORTH_DISTRICT.maxGrade, 'rendered 22% grade exceeds 18% road limit');
  assert.ok(Math.abs(site.grade - .22) < 1e-8);
});

test('full footprint rejects water, steep slopes, local ridges, invalid heights and airport corridors', () => {
  for (const getHeight of [() => 0, (x, z) => 1000 + x * .8 + z * .8, () => NaN]) {
    const plan = planNorthDistrict({ getHeight }, compact);
    assert.equal(plan.lots.length, 0);
    assert.equal(plan.streets.length, 0);
  }
  assert.equal(planNorthDistrict(flat, { ...compact, x: 0, z: 0 }).lots.length, 0);
  const box = { x: -800, z: -2800, width: 18, depth: 18, rotationY: 0 };
  assert.equal(inspectSite({ getHeight: x => x < -805 ? 0 : 25 }, box), null, 'wet edge rejects a dry center');
  const ridge = inspectSite({ getHeight: (x, z) => 25 + 10 * Math.exp(-((x + 800) ** 2 + (z + 2800) ** 2) / 12) }, box);
  assert.ok(ridge.max - ridge.min > NORTH_DISTRICT.maxFoundation, 'interior ridge is sampled');
  const valid = planNorthDistrict({ getHeight: (x, z) => 150 + .02 * x + .01 * z }, compact);
  assert.ok(valid.lots.length > 0);
});

test('height and foundation limit boundaries cannot silently accept invalid sites', () => {
  const box = { x: -800, z: -2800, width: 18, depth: 18, rotationY: 0 };
  assert.ok(inspectSite({ getHeight: () => 5 }, box));
  assert.equal(inspectSite({ getHeight: () => 4.999 }, box), null);
  const plane = { getHeight: x => 1000 + .1 * x };
  assert.ok(planNorthDistrict(plane, { ...compact, maxFoundation: 2 }).lots.length > 0);
  assert.equal(planNorthDistrict(plane, { ...compact, maxFoundation: 1 }).lots.length, 0);
});

test('road triangle interiors follow the actual rendered terrain across grid and diagonal edges', () => {
  const terrain = new Terrain(22000, 256), plan = planNorthDistrict(terrain);
  const geometry = surfaceGeometry(terrain, plan.polygons), p = geometry.attributes.position;
  assert.ok(p.count > 0);
  for (let i = 0; i < p.count; i += 3) {
    // Both vertex and interior checks are necessary: merely lifting vertices can
    // cut straight through a terrain ridge between them.
    for (const weights of [[1, 0, 0], [.2, .3, .5], [1 / 3, 1 / 3, 1 / 3]]) {
      let x = 0, y = 0, z = 0;
      weights.forEach((w, j) => { x += w * p.getX(i + j); y += w * p.getY(i + j); z += w * p.getZ(i + j); });
      assert.ok(Math.abs(y - districtSurfaceHeight(terrain, x, z) - .12) < .001);
    }
    assert.ok(geometry.attributes.normal.getY(i) > 0);
  }
});

test('north collision follows rotated local volume and persists through LOD round trips and rebuild', () => {
  const city = new FoliageAndCities(new Terrain(22000, 256), () => .5);
  const north = city.buildingData.filter(b => b.district === 'north');
  assert.ok(north.length > 0);
  const detector = new CollisionDetector(null, null, city, null, null);
  const snapshot = JSON.stringify(city.buildingData);
  const b = north[0], position = new THREE.Vector3(b.x, b.visualY - .02, b.z);
  const probe = pos => [{ pos, radius: 0, desc: 'test' }];
  assert.ok(detector.checkCityBuildings(position, probe(position)), 'solid plinth below facade');
  const outside = new THREE.Vector3(b.x + b.width / 2 - .01, b.visualY + 5, b.z + b.depth / 2 - .01);
  const single = new CollisionDetector(null, null, { buildingData: [b] }, null, null);
  assert.equal(single.checkCityBuildings(outside, probe(outside)), null, 'empty rotated AABB corner stays clear');
  const roof = new THREE.Vector3(b.x, b.y + b.height + .01, b.z);
  assert.equal(single.checkCityBuildings(roof, probe(roof)), null);
  for (const camera of [position, new THREE.Vector3(0, 10000, 0), position]) {
    city.updateCityLod(camera);
    assert.equal(city.cityArchetypes.reduce((n, a) => n + a.near.count + a.far.count, 0), city.buildingData.length);
    assert.ok(city.cityFoundations.count <= city.cityFoundations.instanceMatrix.count);
    assert.equal(JSON.stringify(city.buildingData), snapshot);
  }
  for (const building of north) {
    const batch = city.cityArchetypes[building.archetype];
    const record = batch.records.find(r => r.x === building.x && r.z === building.z);
    city.cityFoundations.geometry.computeBoundingBox();
    batch.far.geometry.computeBoundingBox();
    const bounds = city.cityFoundations.geometry.boundingBox.clone().applyMatrix4(record.foundationMatrix);
    const far = batch.far.geometry.boundingBox.clone().applyMatrix4(record.farMatrix);
    assert.ok(Math.abs(bounds.min.y - building.y) < 1e-5);
    assert.ok(Math.abs(bounds.max.y - building.visualY) < 1e-5);
    assert.ok(Math.abs(far.max.y - building.y - building.height) < 1e-5);
  }
  for (const t of city.treeData) assert.ok(!city.northDistrict.excludesTree(t.x, t.z, t.radius));
  detector.setEnvironment(null, null, { buildingData: [] }, null, null);
  assert.equal(detector.checkCityBuildings(position, probe(position)), null);
  detector.setEnvironment(null, null, city, null, null);
  assert.ok(detector.checkCityBuildings(position, probe(position)));
});
