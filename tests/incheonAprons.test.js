import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {buildApronSurfaces} from '../src/geospatial/incheonAprons.js';
import {projectToLocal} from '../src/geospatial/incheon.js';
import {pointInRing} from '../src/geospatial/incheonDressing.js';
import {INCHEON_AIRFIELD,IncheonFlightSurface} from '../src/geospatial/IncheonFlightSurface.js';
import {DEPARTURE_GATE,DEPARTURE_TAXI_ROUTE,DEPARTURE_LINEUP_ROUTE,DEPARTURE_ROUTE_SOURCES,DEPARTURE_RUNWAY,departurePushbackPose} from '../src/config/incheonDeparture.js';
const base=new URL('../public/scenery/incheon/',import.meta.url);
const metadata=JSON.parse(readFileSync(new URL('apron-source-metadata.json',base)));
const snapshots=metadata.snapshots.map(info=>({info,bytes:gunzipSync(readFileSync(new URL(info.file,base)))}));

test('complete apron source supplements missing members without changing frozen geometry',()=>{
  const old=JSON.parse(gunzipSync(readFileSync(new URL('source.osm.json.gz',base))));
  const cutoff=Date.parse(JSON.parse(readFileSync(new URL('source-metadata.json',base))).retrievedAt);
  const existing=new Map(old.elements.map(e=>[`${e.type}/${e.id}`,e]));
  const assembled=[];
  for(const {info,bytes} of snapshots) {
    assert.equal(createHash('sha256').update(bytes).digest('hex'),info.sha256);
    assert.equal(bytes.length,info.rawBytes);
    const raw=JSON.parse(bytes);
    for(const e of raw.elements) {
      assert.ok(Number.isFinite(Date.parse(e.timestamp)) && Date.parse(e.timestamp)<=cutoff,'supplement predates the original frozen source cutoff');
      const prior=existing.get(`${e.type}/${e.id}`);
      if(!prior)continue;
      assert.equal(e.version,prior.version);
      if(e.type==='node')assert.deepEqual([e.lat,e.lon],[prior.lat,prior.lon]);
      if(e.type==='way')assert.deepEqual(e.nodes,prior.nodes);
    }
    assembled.push(...buildApronSurfaces(raw));
  }
  assert.equal(assembled.length,4);
  assembled.sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true}));
  assert.deepEqual(INCHEON_AIRFIELD.surfaces.filter(s=>s.sourceId?.startsWith('relation/')),assembled);
  assert.ok(assembled.some(s=>pointInRing(DEPARTURE_GATE.x,DEPARTURE_GATE.z,s.points)),'gate lies in source apron');
  assert.ok(!assembled.some(s=>pointInRing(-381,-139,s.points)),'terminal interior is not paved over');
  assert.ok(INCHEON_AIRFIELD.surfaces.every(s=>!s.id.startsWith('simulation/')),'no authored paving remains');
});

test('route vertices and the runway entry come from identified mapped taxiways',()=>{
  const surfaces=INCHEON_AIRFIELD.surfaces.filter(s=>DEPARTURE_ROUTE_SOURCES.taxiways.includes(s.id));
  const nodes=new Set(surfaces.flatMap(s=>s.points.map(p=>JSON.stringify(p))));
  const edge=(a,b)=>[JSON.stringify(a),JSON.stringify(b)].sort().join('|');
  const edges=new Set(surfaces.flatMap(s=>s.points.slice(1).map((p,i)=>edge(s.points[i],p))));
  for(const p of [...DEPARTURE_TAXI_ROUTE,...DEPARTURE_LINEUP_ROUTE.slice(0,-1)])assert.ok(nodes.has(JSON.stringify([p.x,p.z])));
  const route=[...DEPARTURE_TAXI_ROUTE,...DEPARTURE_LINEUP_ROUTE.slice(0,-1)];
  for(let i=1;i<route.length;i++)assert.ok(edges.has(edge([route[i-1].x,route[i-1].z],[route[i].x,route[i].z])),'each taxi edge is an actual source segment');
  assert.equal(DEPARTURE_RUNWAY.designator,'33L');
  const runway=INCHEON_AIRFIELD.surfaces.find(s=>s.id===DEPARTURE_ROUTE_SOURCES.runway);
  assert.deepEqual(DEPARTURE_RUNWAY.threshold,{x:runway.points.at(-1)[0],z:runway.points.at(-1)[1]});
});

test('apron rings fail closed when a source member or boundary node is missing',()=>{
  const raw=JSON.parse(snapshots[0].bytes);
  const relation=raw.elements.find(e=>e.type==='relation');
  const missing=structuredClone(raw);missing.elements=missing.elements.filter(e=>e.type!=='way'||e.id!==relation.members[0].ref);
  assert.throws(()=>buildApronSurfaces(missing),/Incomplete apron member/);
  const noNode=structuredClone(raw);noNode.elements=noNode.elements.filter(e=>e.type!=='node');
  assert.throws(()=>buildApronSurfaces(noNode),/Missing apron boundary/);
});

test('inner holes stay unpaved instead of being filled with the apron',()=>{
  const ll=[[37.446,126.453],[37.446,126.457],[37.450,126.457],[37.450,126.453],
    [37.4475,126.4545],[37.4475,126.4555],[37.4485,126.4555],[37.4485,126.4545]];
  const elements=ll.map(([lat,lon],i)=>({type:'node',id:i+1,lat,lon}));
  elements.push({type:'way',id:10,nodes:[1,2,3,4,1]},{type:'way',id:11,nodes:[5,6,7,8,5]},
    {type:'relation',id:20,version:1,tags:{aeroway:'apron',type:'multipolygon'},members:[{type:'way',ref:10,role:'outer'},{type:'way',ref:11,role:'inner'}]});
  const [surface]=buildApronSurfaces({elements});
  assert.equal(surface.holes.length,1);
  const query=Object.create(IncheonFlightSurface.prototype);
  const hole=projectToLocal(37.448,126.455),paved=projectToLocal(37.449,126.455);
  assert.ok(query.distance(surface,...hole)>30);
  assert.equal(query.distance(surface,...paved),0);
});

test('planned 737 reverse turn keeps all three wheel footprints inside mapped pavement',()=>{
  const query=Object.create(IncheonFlightSurface.prototype);
  const paved=(x,z)=>INCHEON_AIRFIELD.surfaces.some(s=>query.distance(s,x,z)<.001);
  const contacts=[[0,-12.5],[-3.2,1.8],[3.2,1.8]];
  for(let i=0;i<=200;i++) {
    const p=departurePushbackPose(i/200);
    for(const [x,z]of contacts) {
      const wx=p.x+Math.cos(p.heading)*x-Math.sin(p.heading)*z;
      const wz=p.z+Math.sin(p.heading)*x+Math.cos(p.heading)*z;
      assert.ok(paved(wx,wz),`wheel at ${i}/200: ${wx}, ${wz}`);
    }
  }
});
