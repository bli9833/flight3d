import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { INCHEON_PATCH, projectToLocal, clipLine, clipRing, buildingHeight, buildIncheonPatch } from '../src/geospatial/incheon.js';

test('local frame uses meter-scale east and south without inventing terrain elevation', () => {
  const { latitude, longitude } = INCHEON_PATCH.origin;
  assert.deepEqual(projectToLocal(latitude, longitude), [0, 0]);
  const east = projectToLocal(latitude, longitude + 0.001);
  const north = projectToLocal(latitude + 0.001, longitude);
  assert.ok(east[0] > 88 && east[0] < 89 && Math.abs(east[1]) < 0.01);
  assert.ok(north[1] < -110 && north[1] > -112 && Math.abs(north[0]) < 0.01);
  assert.throws(() => projectToLocal(NaN, longitude));
  assert.throws(() => projectToLocal(91, longitude));
});

test('clipping retains crossing roads but never joins disconnected outside excursions', () => {
  assert.deepEqual(clipLine([[-2000, 0], [2000, 0]]), [[[-1000, 0], [1000, 0]]]);
  assert.deepEqual(clipLine([[-500, 0], [1500, 0], [1500, 500], [-500, 500]]),
    [[[-500, 0], [1000, 0]], [[1000, 500], [-500, 500]]]);
  assert.deepEqual(clipLine([[1200, 0], [1200, 500]]), []);
  const ring = clipRing([[-2000, -2000], [2000, -2000], [2000, 2000], [-2000, 2000], [-2000, -2000]]);
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring.at(-1));
  assert.ok(ring.flat().every(v => Math.abs(v) <= 1000));
  assert.deepEqual(clipRing([[0, 0], [1, 0], [2, 0], [0, 0]]), []);
});

test('heights distinguish unverified tags, floor estimates and explicit placeholders', () => {
  assert.deepEqual(buildingHeight({ height: '20 m' }), { meters: 20, source: 'osm-height' });
  assert.deepEqual(buildingHeight({ height: '100 ft' }), { meters: 30.48, source: 'osm-height' });
  assert.deepEqual(buildingHeight({ 'building:levels': '4' }), { meters: 12, source: 'levels-estimate' });
  for (const height of ['20;30', '-1', 'NaN', '9999']) assert.equal(buildingHeight({ height }).source, 'placeholder');
  assert.equal(buildingHeight({ 'building:levels': '3;4' }).source, 'placeholder');
});

const snapshotBytes = gunzipSync(readFileSync(new URL('../public/scenery/incheon/source.osm.json.gz', import.meta.url)));
const raw = JSON.parse(snapshotBytes);
const patch = buildIncheonPatch(raw);
const bundled = JSON.parse(readFileSync(new URL('../public/scenery/incheon/patch.json', import.meta.url)));

test('frozen real data rebuilds exactly and source hash matches; no network required', () => {
  const { source, ...geometry } = bundled;
  assert.deepEqual(patch, geometry);
  assert.equal(createHash('sha256').update(snapshotBytes).digest('hex'), source.sha256);
  assert.equal(snapshotBytes.length, source.rawBytes);
  assert.ok(patch.features.some(f => f.kind === 'road'));
  assert.ok(patch.features.some(f => f.kind === 'building'));
  const ids = patch.features.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of patch.features) {
    for (const part of f.parts) {
      assert.ok(part.flat().every(v => Number.isFinite(v) && Math.abs(v) <= 1000));
      if (f.area) assert.deepEqual(part[0], part.at(-1));
    }
  }
});

test('terminal fragmented outer ways are assembled, while inner holes/incomplete relations stay excluded', () => {
  const terminal = patch.features.find(f => f.id === 'relation/3917466');
  assert.equal(terminal.name, '인천국제공항 제1여객터미널');
  assert.equal(terminal.height.source, 'levels-estimate');
  assert.ok(terminal.parts[0].length > 50);
  const missingMember = structuredClone(raw);
  missingMember.elements = missingMember.elements.filter(e => !(e.type === 'way' && e.id === 294776921));
  assert.ok(!buildIncheonPatch(missingMember).features.some(f => f.id === terminal.id));
  const hole = structuredClone(raw);
  hole.elements.find(e => e.type === 'relation' && e.id === 3917466).members[0].role = 'inner';
  assert.ok(!buildIncheonPatch(hole).features.some(f => f.id === terminal.id));
  assert.throws(() => buildIncheonPatch({ elements: [] }), /requires real buildings and roads/);
  assert.throws(() => buildIncheonPatch({ elements: raw.elements, remark: 'timeout' }), /incomplete/);
});
