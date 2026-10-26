import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { buildDressingData } from '../../src/geospatial/incheonDressing.js';

const root = new URL('../../public/scenery/incheon/', import.meta.url);
const raw = gunzipSync(await readFile(new URL('source.osm.json.gz', root)));
const source = JSON.parse(await readFile(new URL('source-metadata.json', root)));
if (createHash('sha256').update(raw).digest('hex') !== source.sha256) throw new Error('OSM snapshot checksum mismatch');
const dressing = { ...buildDressingData(JSON.parse(raw)), sourceSha256: source.sha256 };
await writeFile(new URL('dressing.json', root), `${JSON.stringify(dressing)}\n`);
console.log(JSON.stringify({ areas:dressing.areas.length, excluded:dressing.excluded }));
