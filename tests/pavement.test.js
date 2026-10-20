import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { setPavementUVs } from '../src/environment/Pavement.js';
import { LuklaAirport } from '../src/environment/LuklaAirport.js';

test('pavement retains a three metre tile across different slabs and subdivisions', () => {
  for (const [width, length, segments] of [[3200, 60, 1], [30, 527, 32], [36, 80, 1]]) {
    const geo = new THREE.PlaneGeometry(width, length, segments, segments);
    geo.rotateX(-Math.PI / 2);
    setPavementUVs(geo);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    for (let i = 1; i < pos.count; i++) {
      assert.ok(Math.abs((uv.getX(i) - uv.getX(0)) * 3 - (pos.getX(i) - pos.getX(0))) < 0.001);
      assert.ok(Math.abs((uv.getY(i) - uv.getY(0)) * 3 + (pos.getZ(i) - pos.getZ(0))) < 0.001);
    }
  }
});

test('Lukla runway retains dimensions, shadows and depth offset with headless fallback', () => {
  for (const AirportClass of [LuklaAirport]) {
    const airport = new AirportClass();
    const runway = airport.group.getObjectByName('runway-pavement');
    assert.ok(runway);
    assert.equal(runway.receiveShadow, true);
    assert.equal(runway.material.metalness, 0);
    assert.equal(runway.material.polygonOffset, true);
    assert.equal(runway.material.map, null);
    assert.ok(runway.material.polygonOffsetFactor < 0);
    const { width, height } = runway.geometry.parameters;
    assert.deepEqual([width, height].sort((a,b) => a-b),
      [airport.runwayLength, airport.runwayWidth].sort((a,b) => a-b));
  }
});
