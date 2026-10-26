import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IncheonTerrain } from '../src/geospatial/IncheonTerrain.js';
import { terrainGeometry } from '../src/previews/incheonGeometry.js';

const asset = name => readFileSync(new URL(`../public/scenery/incheon/${name}`, import.meta.url));
const metadata = JSON.parse(asset('terrain-metadata.json'));
const grids = Object.fromEntries(Object.entries(metadata.grids).map(([name, descriptor]) => {
  const bytes = asset(descriptor.file);
  return [name, Float32Array.from({ length: bytes.length/4 }, (_,i) => bytes.readFloatLE(i*4))];
}));
const terrain = new IncheonTerrain(metadata,grids,JSON.parse(asset('coastline.json')));

// Compare the actual triangle edges on each side of the seam, not the sampler.
function seamEdges(geometry) {
  const p = geometry.attributes.position;
  const index = geometry.index.array;
  const result = new Map();
  for (let i=0;i<index.length;i+=3) for (let j=0;j<3;j++) {
    const a = index[i+j], b = index[i+(j+1)%3];
    const sameX = Math.abs(p.getX(a))===1000 && p.getX(a)===p.getX(b) && Math.abs(p.getZ(a))<=1000 && Math.abs(p.getZ(b))<=1000;
    const sameZ = Math.abs(p.getZ(a))===1000 && p.getZ(a)===p.getZ(b) && Math.abs(p.getX(a))<=1000 && Math.abs(p.getX(b))<=1000;
    if (!sameX && !sameZ) continue;
    const start = [p.getX(a),p.getY(a),p.getZ(a)];
    const end = [p.getX(b),p.getY(b),p.getZ(b)];
    const key = [start.join(','),end.join(',')].sort().join('|');
    result.set(key,(result.get(key)??0)+1);
  }
  return result;
}

for (const mode of ['graded','natural']) test(`${mode} terrain shares every actual seam edge, including intermediate local vertices`,()=>{
  const height = mode==='natural' ? (x,z)=>terrain.getNaturalHeight(x,z) : (x,z)=>terrain.getHeight(x,z);
  const regional=terrainGeometry(12000,240,height,true);
  const local=terrainGeometry(2000,160,height);
  const outside=seamEdges(regional), inside=seamEdges(local);
  assert.equal(inside.size,640);
  assert.equal(outside.size,inside.size,'regional boundary must include all 12.5m local subdivisions');
  assert.deepEqual([...outside.keys()].sort(),[...inside.keys()].sort());
  assert.ok([...outside.values(),...inside.values()].every(count=>count===1),'each seam segment has one face on each side');
  // Review's on-land regression point must be a real regional boundary vertex.
  const p=regional.attributes.position;
  assert.equal(regional.attributes.normal.count,p.count,'new boundary vertices need a full normal buffer');
  assert.equal(regional.attributes.uv.count,p.count,'new boundary vertices need coast-mask UVs');
  assert.ok(regional.attributes.normal.array.every(Number.isFinite));
  const ids=regional.index.array;
  for(let i=0;i<ids.length;i+=3){
    const a=ids[i],b=ids[i+1],c=ids[i+2];
    const upward=(p.getZ(b)-p.getZ(a))*(p.getX(c)-p.getX(a))-(p.getX(b)-p.getX(a))*(p.getZ(c)-p.getZ(a));
    assert.ok(upward>0,'stitched triangles preserve upward winding without degenerate faces');
  }
  const found=Array.from({length:p.count},(_,i)=>i).find(i=>p.getX(i)===-1000&&p.getZ(i)===-812.5);
  assert.notEqual(found,undefined);
  assert.ok(Math.abs(p.getY(found)-height(-1000,-812.5))<.00001);
  assert.ok(regional.index.count/3<113000,'refine the seam only, not the full regional grid');
  regional.dispose();local.dispose();
});
