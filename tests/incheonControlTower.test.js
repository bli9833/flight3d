import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { pointInRing, segmentDistance } from '../src/geospatial/incheonDressing.js';
import { createControlTower, INCHEON_TOWER } from '../src/environment/IncheonControlTower.js';

const flat = () => 0;
const sloped = (x, z) => 7 + x * 0.001 + z * 0.0005;

test('tower reaches the published 100.4 m height above the sampled floor', () => {
  const { group, collider } = createControlTower(flat);
  assert.equal(collider.top, 0.05 + INCHEON_TOWER.totalHeightMeters);
  const box = new THREE.Box3().setFromObject(group);
  assert.ok(Math.abs(box.max.y - collider.top) < 1.1, `roof/mast peak ${box.max.y} should sit at the collider top`);
  assert.ok(Math.abs(box.min.y - 0.05) < 0.01, 'podium rests on the terrain floor');
});

test('floor follows terrain without tilting the tower', () => {
  const { collider, cab } = createControlTower(sloped);
  const expected = sloped(INCHEON_TOWER.x, INCHEON_TOWER.z) + 0.05;
  assert.ok(Math.abs(collider.bounds.min.y - expected) < 1e-9);
  assert.ok(Math.abs(collider.top - expected - INCHEON_TOWER.totalHeightMeters) < 1e-9);
  assert.ok(Math.abs(cab.y - expected - INCHEON_TOWER.cabEyeMeters) < 1e-9);
});

test('glazed cab overhangs the shaft so the landmark reads as a control tower', () => {
  const { group } = createControlTower(flat);
  const width = name => {
    const mesh = group.getObjectByName(name);
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(mesh);
    return box.max.x - box.min.x;
  };
  assert.ok(width('cab') > width('shaft'), 'cab band must be wider than the shaft');
  assert.ok(width('console') > width('shaft'), 'cab support console flares over the shaft');
  assert.equal(group.getObjectByName('cab').material.type, 'MeshLambertMaterial');
});

test('collider ring matches the octagonal footprint and is closed', () => {
  const { collider } = createControlTower(flat);
  const ring = collider.points;
  assert.equal(ring.length, 9);
  assert.deepEqual(ring[0], ring.at(-1));
  assert.ok(pointInRing(INCHEON_TOWER.x, INCHEON_TOWER.z, ring));
  for (let i = 0; i < ring.length - 1; i++) {
    const d = Math.hypot(ring[i][0] - INCHEON_TOWER.x, ring[i][1] - INCHEON_TOWER.z);
    assert.ok(Math.abs(d - 10.5) < 1e-9, 'footprint vertices sit on one circle');
  }
});

test('tower site clears every frozen-patch building and airfield surface', () => {
  const patch = JSON.parse(readFileSync(new URL('../public/scenery/incheon/patch.json', import.meta.url)));
  const airfield = JSON.parse(readFileSync(new URL('../src/config/incheonAirfield.json', import.meta.url)));
  const rings = patch.features.filter(f => f.kind === 'building').flatMap(f => f.parts);
  const { x, z } = INCHEON_TOWER;
  let nearest = Infinity;
  for (const ring of rings) {
    assert.equal(pointInRing(x, z, ring), false, 'tower must not stand inside a building');
    for (let i = 0; i < ring.length - 1; i++) nearest = Math.min(nearest, segmentDistance(x, z, ring[i], ring[i + 1]));
  }
  assert.ok(nearest > 14, `nearest building edge ${nearest} m must clear the 10.5 m footprint`);
  let nearestPavement = Infinity;
  for (const surface of airfield.surfaces) {
    if (surface.area) assert.equal(pointInRing(x, z, surface.points), false, 'tower must not stand on pavement');
    for (let i = 0; i < surface.points.length - 1; i++) {
      nearestPavement = Math.min(nearestPavement, segmentDistance(x, z, surface.points[i], surface.points[i + 1]));
    }
  }
  assert.ok(nearestPavement > 100, `nearest pavement ${nearestPavement} m keeps the tower off the airfield`);
});
