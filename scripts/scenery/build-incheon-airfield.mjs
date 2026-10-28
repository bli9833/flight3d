import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildApronSurfaces } from '../../src/geospatial/incheonAprons.js';
import { projectToLocal } from '../../src/geospatial/incheon.js';
const base = new URL('../../public/scenery/incheon/', import.meta.url);
const bytes = gunzipSync(await readFile(new URL('source.osm.json.gz', base)));
const source = JSON.parse(await readFile(new URL('source-metadata.json', base)));
if (createHash('sha256').update(bytes).digest('hex') !== source.sha256 || bytes.length !== source.rawBytes) throw new Error('Source mismatch');
const raw = JSON.parse(bytes);
const nodes = new Map(raw.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
const surfaces = [];
for (const way of raw.elements.filter(e => e.type === 'way' && ['runway', 'taxiway', 'apron'].includes(e.tags?.aeroway))) {
  if (!way.nodes?.length || way.nodes.some(id => !nodes.has(id))) continue;
  const points = way.nodes.map(id => { const n = nodes.get(id); return projectToLocal(n.lat, n.lon); });
  if (points.some(p => p.some(v => Math.abs(v) > 5800))) continue;
  const area = way.tags.aeroway === 'apron' || way.tags.area === 'yes';
  if (area && way.nodes[0] !== way.nodes.at(-1)) continue;
  surfaces.push({ id: `way/${way.id}`, kind: way.tags.aeroway, ref: way.tags.ref ?? '', area,
    width: Number(way.tags.width) || (way.tags.aeroway === 'runway' ? 60 : 18), points });
}
const apronMetadata = JSON.parse(await readFile(new URL('apron-source-metadata.json',base)));
for (const snapshot of apronMetadata.snapshots) {
  const bytes = gunzipSync(await readFile(new URL(snapshot.file,base)));
  if (createHash('sha256').update(bytes).digest('hex') !== snapshot.sha256 || bytes.length !== snapshot.rawBytes) throw new Error('Apron source mismatch');
  const complete = JSON.parse(bytes);
  for (const element of complete.elements) {
    if (!Number.isFinite(Date.parse(element.timestamp)) || Date.parse(element.timestamp)>Date.parse(source.retrievedAt)) throw new Error('Apron member is newer than frozen source cutoff');
    const existing = raw.elements.find(e=>e.type===element.type && e.id===element.id);
    if (existing && existing.version !== element.version) throw new Error('Apron snapshot drifts from frozen source');
  }
  surfaces.push(...buildApronSurfaces(complete));
}
surfaces.sort((a,b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
const runway = surfaces.find(s => s.ref === '15R/33L');
if (!runway || surfaces.filter(s => s.kind === 'runway').length !== 2) throw new Error('Missing complete runways');
const [x,z] = runway.points[0], end = runway.points.at(-1);
const headingDeg = (Math.atan2(end[0]-x, z-end[1])*180/Math.PI+360)%360;
const data = { schemaVersion: 1, sourceSha256: source.sha256, elevationM: 7,
  apronSources: apronMetadata.snapshots.map(({relationId,relationVersion,sha256})=>({relationId,relationVersion,sha256})),
  approach: { threshold: { x,z }, end: { x:end[0], z:end[1] }, headingDeg, gsAngleDeg:3, elevationFt:7/0.3048 }, surfaces };
await writeFile(new URL('../../src/config/incheonAirfield.json', import.meta.url), JSON.stringify(data)+'\n');
console.log({ surfaces: surfaces.length, runway: data.approach });
