import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { buildDressingData,generatePlanting,pointInRing,segmentDistance,roadWidth } from '../src/geospatial/incheonDressing.js';
import { createBuildingMaterials,createTexturedBuildings,createPlantingInstances,splitBuilding,GROUND_TEXTURE_SIZE } from '../src/previews/incheonCityAssets.js';

const asset=name=>readFileSync(new URL(`../public/scenery/incheon/${name}`,import.meta.url));
const raw=gunzipSync(asset('source.osm.json.gz'));
const dressing=JSON.parse(asset('dressing.json'));
const patch=JSON.parse(asset('patch.json'));

test('parking outline derivative rebuilds offline and excludes parking towers',()=>{
  const {sourceSha256,...data}=dressing;
  assert.equal(sourceSha256,createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(buildDressingData(JSON.parse(raw)),data);
  assert.equal(dressing.areas.filter(a=>a.kind==='parking').length,26);
  assert.equal(dressing.areas.filter(a=>a.kind==='airfield').length,1);
  for(const id of ['way/1378328403','way/1378328404']) assert.ok(!dressing.areas.some(a=>a.id===id));
  for(const a of dressing.areas){assert.deepEqual(a.ring[0],a.ring.at(-1));assert.ok(a.ring.flat().every(v=>Number.isFinite(v)&&Math.abs(v)<=1000));}
  assert.throws(()=>buildDressingData({elements:[]}),/No surface parking/);
  assert.throws(()=>buildDressingData({elements:[],remark:'timeout'}),/Incomplete/);
});

test('point/range helpers handle interior and perpendicular/endpoint distances',()=>{
  const square=[[0,0],[10,0],[10,10],[0,10],[0,0]];
  assert.equal(pointInRing(5,5,square),true);assert.equal(pointInRing(11,5,square),false);
  assert.equal(segmentDistance(5,3,[0,0],[10,0]),3);
  assert.equal(segmentDistance(13,4,[0,0],[10,0]),5);
  assert.equal(segmentDistance(3,4,[0,0],[0,0]),5);
});

test('illustrative planting is deterministic, capped and stays out of airport/parking/roads/buildings/water',()=>{
  const trees=generatePlanting(patch,dressing);
  assert.ok(trees.length>0&&trees.length<=320);
  assert.deepEqual(generatePlanting(patch,dressing),trees);
  assert.deepEqual(generatePlanting(patch,dressing,20),trees.slice(0,20));
  assert.deepEqual(generatePlanting(patch,dressing,0),[]);
  assert.throws(()=>generatePlanting(patch,dressing,1001));
  const greens=patch.features.filter(f=>f.kind==='park'||f.landuse==='grass').flatMap(f=>f.parts);
  for(const tree of trees){
    assert.ok(greens.some(ring=>pointInRing(tree.x,tree.z,ring)));
    for(const area of dressing.areas.filter(a=>['parking','airfield'].includes(a.kind))) assert.equal(pointInRing(tree.x,tree.z,area.ring),false);
    for(const feature of patch.features){
      const clearance=feature.kind==='road'?roadWidth(feature)/2+3.5:feature.kind==='building'?5:feature.kind==='water'?6:['runway','taxiway','apron'].includes(feature.kind)?85:null;
      if(clearance===null) continue;
      for(const ring of feature.parts){
        if(feature.area) assert.equal(pointInRing(tree.x,tree.z,ring),false);
        for(let i=1;i<ring.length;i++) assert.ok(segmentDistance(tree.x,tree.z,ring[i-1],ring[i])>=clearance-.01,feature.id);
      }
    }
  }
});

test('facade splits preserve source envelope and use world-scaled UVs with three shared materials',()=>{
  const geometry=new THREE.BoxGeometry(80,12,20);geometry.translate(0,13,0);
  const split=splitBuilding(geometry,7);
  geometry.computeBoundingBox();const bounds=geometry.boundingBox;
  const combined=new THREE.Box3();
  for(const part of Object.values(split)){part.computeBoundingBox();combined.union(part.boundingBox);assert.ok(part.attributes.uv.array.every(Number.isFinite));}
  assert.ok(combined.min.distanceTo(bounds.min)<.00001&&combined.max.distanceTo(bounds.max)<.00001);
  const u=split.walls.attributes.uv;
  assert.ok(Math.max(...Array.from({length:u.count},(_,i)=>Math.abs(u.getX(i))))>=5,'80m walls must repeat windows, not stretch one facade');
  const materials=createBuildingMaterials();
  const group=createTexturedBuildings(Array.from({length:43},(_,i)=>({feature:{id:`way/${i}`,height:{meters:i%2?8:12}},geometry,floor:7})),materials);
  assert.equal(group.children.length,3,'building count does not create per-building draws');
  assert.ok(GROUND_TEXTURE_SIZE<=2048);
  for(const material of Object.values(materials)){if(material.map){assert.ok(material.map.image.width<=256);material.map.dispose();}material.dispose();}
  group.children.forEach(mesh=>mesh.geometry.dispose());Object.values(split).forEach(g=>g.dispose());geometry.dispose();
});

test('one opaque instancing batch places every tree on the shared height sampler',()=>{
  const trees=generatePlanting(patch,dressing,20);
  const mesh=createPlantingInstances(trees,(x,z)=>4+x*.001-z*.002);
  assert.equal(mesh.count,trees.length);assert.equal(mesh.material.transparent,false);
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3();
  trees.forEach((tree,i)=>{mesh.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);assert.ok(Math.abs(position.y-(4+tree.x*.001-tree.z*.002))<.00001);});
  mesh.geometry.dispose();mesh.material.dispose();
});
