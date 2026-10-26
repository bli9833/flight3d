import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three';
import { IncheonTerrain } from '../src/geospatial/IncheonTerrain.js';
import { projectToLocal } from '../src/geospatial/incheon.js';
import { drapeSurface, placeBuilding, terrainGeometry } from '../src/previews/incheonGeometry.js';

const asset = name => readFileSync(new URL(`../public/scenery/incheon/${name}`, import.meta.url));
const metadata = JSON.parse(asset('terrain-metadata.json'));
const coast = JSON.parse(asset('coastline.json'));
const grids = Object.fromEntries(Object.entries(metadata.grids).map(([name, descriptor]) => {
  const bytes = asset(descriptor.file);
  return [name, Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4))];
}));
const terrain = new IncheonTerrain(metadata, grids, coast);

test('bundled natural, graded, coast and mask assets match frozen checksums', () => {
  for (const descriptor of Object.values(metadata.grids)) {
    const bytes = asset(descriptor.file);
    assert.equal(bytes.length, descriptor.gridSize ** 2 * 4);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256);
  }
  for (const [name, sha] of Object.entries(metadata.assetSha256)) assert.equal(createHash('sha256').update(asset(name)).digest('hex'), sha);
  assert.equal(createHash('sha256').update(gunzipSync(asset('coast-source.osm.json.gz'))).digest('hex'), metadata.coast.sourceSha256);
  assert.equal(createHash('sha256').update(asset('patch.json')).digest('hex'), metadata.grading.patchSha256);
  assert.throws(() => new IncheonTerrain(metadata, { ...grids, 'local-graded': new Float32Array(1) }, coast), /Invalid terrain grid/);
  const corrupt = grids['local-graded'].slice(); corrupt[4] = NaN;
  assert.throws(() => new IncheonTerrain(metadata, { ...grids, 'local-graded': corrupt }, coast), /Invalid terrain grid/);
});

test('terrain nodes preserve source coordinates, row orientation and declared meter heights', () => {
  assert.equal(metadata.origin.latitude, 37.448);
  assert.equal(metadata.origin.longitude, 126.455);
  for (const checkpoint of metadata.dem.checkpoints) {
    const [x, z] = projectToLocal(checkpoint.latitude, checkpoint.longitude);
    assert.ok(Math.hypot(x - checkpoint.x, z - checkpoint.z) <= 0.02);
    assert.ok(Math.abs(terrain.getNaturalHeight(x, z) - checkpoint.heightM) < 0.001);
  }
  // Independent local source sample at T1 reference, not forced to airport elevation.
  assert.ok(Math.abs(terrain.getNaturalHeight(0, 0) - 7.41918) < 0.001);
  assert.ok(metadata.grids['regional-natural'].maxM > 250);
  for (const [x, z] of [[6001, 0], [0, -6001], [NaN, 0]]) assert.throws(() => terrain.getHeight(x, z), /bounds/);
});

test('grading remains local, fades to unchanged patch edges and retains raw DSM separately', () => {
  for (let i = -1000; i <= 1000; i += 12.5) {
    for (const [x, z] of [[i, -1000], [i, 1000], [-1000, i], [1000, i]]) {
      assert.equal(terrain.getHeight(x, z), terrain.getNaturalHeight(x, z));
    }
  }
  for (const [x, z] of [[-3000, 0], [2500, -3100], [6000, 6000]]) assert.equal(terrain.getHeight(x, z), terrain.getNaturalHeight(x, z));
  const natural = grids['local-natural'];
  const graded = grids['local-graded'];
  const changed = natural.reduce((sum, h, i) => sum + (Math.abs(h - graded[i]) > .01 ? 1 : 0), 0);
  assert.equal(changed, metadata.grading.changedSamples);
  assert.ok(changed > 1000 && changed < natural.length);
  assert.ok(Math.max(...natural) > Math.max(...graded));
  const terminal = metadata.grading.buildingPads.find(p => p.id === 'relation/3917466');
  assert.equal(terminal.baseM, 7);
});

test('coastline land/water classification agrees with separate airport/sea checkpoints', () => {
  for (const p of metadata.coast.checkpoints) assert.equal(terrain.isLand(p.x, p.z), p.land, p.name);
  assert.ok(metadata.coast.faceCount >= 2);
  assert.ok(coast.lines.length > 0);
  for (const line of coast.lines) assert.ok(line.flat().every(v => Number.isFinite(v) && Math.abs(v) <= 6000));
  // Exercise lake holes as well as multiple disjoint islands.
  const square = [[0,0],[10,0],[10,10],[0,10],[0,0]];
  const hole = [[2,2],[8,2],[8,8],[2,8],[2,2]];
  const withHole = new IncheonTerrain(metadata, grids, { land: { type: 'Polygon', coordinates: [square, hole] } });
  assert.equal(withHole.isLand(1, 1), true);
  assert.equal(withHole.isLand(5, 5), false);
});

test('wide ground surfaces get interior samples and building foundations follow the same height sampler', () => {
  const ground = (x, z) => 5 + 3 * Math.exp(-(x*x + z*z) / 500);
  const input = new THREE.PlaneGeometry(100, 100); input.rotateX(-Math.PI / 2);
  const draped = drapeSurface(input, ground, .35, 12.5);
  const positions = draped.attributes.position;
  assert.ok(positions.count > 6, 'large faces must be subdivided before draping');
  let highest = 0;
  for (let i = 0; i < positions.count; i++) {
    assert.ok(Math.abs(positions.getY(i) - ground(positions.getX(i), positions.getZ(i)) - .35) < 0.00001);
    highest = Math.max(highest, positions.getY(i));
  }
  assert.ok(highest > 8, 'interior hill must not be cut by a flat corner-only overlay');
  const box = new THREE.BoxGeometry(20, 10, 20); box.translate(0, 5, 0);
  const placed = placeBuilding(box, ground, 10);
  const y = box.attributes.position;
  let roofs = 0, foundations = 0;
  for (let i = 0; i < y.count; i++) {
    if (y.getY(i) > placed.floor) { assert.ok(Math.abs(y.getY(i) - placed.floor - 10) < 0.00001); roofs++; }
    else { assert.ok(Math.abs(y.getY(i) - ground(y.getX(i), y.getZ(i))) < 0.00001); foundations++; }
  }
  assert.ok(roofs && foundations);
  draped.dispose(); box.dispose();
});

test('regional mesh leaves a matching central hole and shares boundary height with local detail', () => {
  const regional = terrainGeometry(12000, 240, (x, z) => terrain.getHeight(x, z), true);
  const local = terrainGeometry(2000, 160, (x, z) => terrain.getHeight(x, z));
  const positions = regional.attributes.position;
  const ids = regional.index.array;
  for (let i = 0; i < ids.length; i += 3) {
    const x = (positions.getX(ids[i]) + positions.getX(ids[i+1]) + positions.getX(ids[i+2])) / 3;
    const z = (positions.getZ(ids[i]) + positions.getZ(ids[i+1]) + positions.getZ(ids[i+2])) / 3;
    assert.ok(Math.abs(x) >= 1000 || Math.abs(z) >= 1000, 'no overlapping regional triangle in detail square');
  }
  for (const geometry of [regional, local]) {
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if ((Math.abs(p.getX(i)) === 1000 && Math.abs(p.getZ(i)) <= 1000)
        || (Math.abs(p.getZ(i)) === 1000 && Math.abs(p.getX(i)) <= 1000)) {
        assert.ok(Math.abs(p.getY(i) - terrain.getHeight(p.getX(i), p.getZ(i))) < 0.00001);
      }
    }
    geometry.dispose();
  }
});
