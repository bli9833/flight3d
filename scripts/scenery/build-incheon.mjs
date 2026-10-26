import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildIncheonPatch } from '../../src/geospatial/incheon.js';

// Offline by default. A frozen response avoids live API drift in builds/tests.
const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.argv.length > 2) throw new Error('This builder uses the documented frozen snapshot; no arguments accepted');
const input = path.join(root, 'public/scenery/incheon/source.osm.json.gz');
const output = path.join(root, 'public/scenery/incheon/patch.json');
const bytes = await readFile(input);
const unpacked = input.endsWith('.gz') ? gunzipSync(bytes) : bytes;
const raw = JSON.parse(unpacked);
const source = JSON.parse(await readFile(path.join(root, 'public/scenery/incheon/source-metadata.json'), 'utf8'));
if (createHash('sha256').update(unpacked).digest('hex') !== source.sha256 || unpacked.length !== source.rawBytes) {
  throw new Error('Frozen source checksum/size mismatch');
}
const patch = buildIncheonPatch(raw);
patch.source = source;
await writeFile(output, `${JSON.stringify(patch)}\n`);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(JSON.stringify(patch)),
  counts: patch.features.reduce((counts, f) => { counts[f.kind] = (counts[f.kind] ?? 0) + 1; return counts; }, {}),
  heights: patch.features.filter(f => f.height).reduce((counts, f) => { counts[f.height.source] = (counts[f.height.source] ?? 0) + 1; return counts; }, {}),
  ...patch.stats }, null, 2));
