import { roadWidth } from './incheonDressing.js';

const VEHICULAR = new Set(['motorway','motorway_link','trunk','trunk_link','primary','secondary','tertiary','tertiary_link','residential','unclassified','service']);
const key = p => p.join(',');

/** Closed directed OSM road cycles. Only shared road vertices connect; visual segment crossings do not. */
export function buildTrafficRoutes(patch, raw) {
  const ways = new Map(raw.elements.filter(e=>e.type==='way').map(e=>[`way/${e.id}`,e]));
  const graph = new Map();
  const add = edge => { const k=key(edge.a); if(!graph.has(k))graph.set(k,[]);graph.get(k).push(edge); };
  for (const road of patch.features) {
    const tags=ways.get(road.id)?.tags;
    if (road.kind!=='road'||road.area||!VEHICULAR.has(road.highway)||!tags)continue;
    if ((road.bridge && road.bridge!=='no') || (road.tunnel && road.tunnel!=='no') || Number(road.layer||0)!==0
      || tags.covered==='yes' || tags.indoor==='yes'
      || ['no','private'].includes(tags.access) || ['no','private'].includes(tags.motor_vehicle))continue;
    const oneWay=tags.oneway==='yes'||tags.oneway==='1'||tags.oneway==='-1';
    const width=roadWidth(road);
    if(width<(oneWay?3.6:6))continue;
    for (const part of road.parts) for(let i=1;i<part.length;i++) {
      let a=part[i-1],b=part[i];
      if(tags.oneway==='-1')[a,b]=[b,a];
      const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(length<1)continue;
      const offset=oneWay?0:Math.min(1.8,width/4);
      add({a,b,length,offset,id:road.id});
      if(!oneWay)add({a:b,b:a,length,offset,id:road.id});
    }
  }
  for(const edges of graph.values())edges.sort((a,b)=>a.id.localeCompare(b.id)||key(a.b).localeCompare(key(b.b)));
  const routes=[],seen=new Set(),usedEdges=new Set();
  // Bounded DFS: small independent cycles, no U-turn at a dead end.
  for(const start of [...graph.keys()].sort()) {
    let budget=1500;
    const visit=(node,edges,visited,length)=>{
      if(--budget<0||edges.length>35||length>1500)return;
      if(node===start && edges.length) {
        if(length<180 || edges.length<3)return;
        const ids=edges.map(e=>key(e.a));
        const canonical=ids.map((_,i)=>[...ids.slice(i),...ids.slice(0,i)].join('|')).sort()[0];
        if(seen.has(canonical))return;
        const edgeKeys=edges.map(e=>[key(e.a),key(e.b)].sort().join('|'));
        if(edgeKeys.some(k=>usedEdges.has(k)))return;
        seen.add(canonical);edgeKeys.forEach(k=>usedEdges.add(k));
        routes.push({id:`route-${routes.length}`,length,edges:edges.map(({a,b,offset,id})=>({a,b,offset,sourceId:id}))});
        return;
      }
      if(visited.has(node))return;
      const nextVisited=new Set(visited).add(node);
      for(const edge of graph.get(node)||[]) {
        if(edges.length && key(edge.b)===key(edges.at(-1).a))continue;
        visit(key(edge.b),[...edges,edge],nextVisited,length+edge.length);
        if(routes.length>=32)return;
      }
    };
    visit(start,[],new Set(),0);
    if(routes.length>=32)break;
  }
  if(!routes.length)throw new Error('No connected ground-road cycles');
  return {schemaVersion:1,routes};
}

/** Offset each road node into its right-hand lane with a bounded miter join. */
export function lanePoints(route) {
  return route.edges.map((edge,i)=>{
    const previous=route.edges[(i+route.edges.length-1)%route.edges.length];
    const normal=e=>{const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1],l=Math.hypot(dx,dz);return [-dz/l,dx/l];};
    const n=normal(edge),p=normal(previous),dot=n[0]*p[0]+n[1]*p[1];
    const factor=edge.offset/Math.max(.6,1+dot);
    return [edge.a[0]+(n[0]+p[0])*factor,edge.a[1]+(n[1]+p[1])*factor];
  });
}

export function prepareTrafficRoute(route, getHeight, isSafe=()=>true) {
  const points=lanePoints(route),segments=[];
  let length=0;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(distance<.1)continue;
    // Grade and elevation samples are fixed at load time, never queried per frame.
    const count=Math.max(1,Math.ceil(distance/4));
    for(let j=0;j<count;j++) {
      const x=a[0]+(b[0]-a[0])*j/count,z=a[1]+(b[1]-a[1])*j/count;
      const bx=a[0]+(b[0]-a[0])*(j+1)/count,bz=a[1]+(b[1]-a[1])*(j+1)/count;
      const y=getHeight(x,z),by=getHeight(bx,bz),span=distance/count;
      if(![x,z,y,bx,bz,by].every(Number.isFinite)||Math.abs(by-y)/span>.15||!isSafe(x,z)||!isSafe(bx,bz))return null;
      segments.push({x,z,y,bx,bz,by,start:length,length:span});length+=span;
    }
  }
  if(length<180)return null;
  const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0]));
  const minZ=Math.min(...points.map(p=>p[1])),maxZ=Math.max(...points.map(p=>p[1]));
  return {id:route.id,segments,length,center:{x:(minX+maxX)/2,z:(minZ+maxZ)/2},radius:Math.hypot(maxX-minX,maxZ-minZ)/2};
}

/** Analytic distance along a closed lane: independent of render frame grouping. */
export function sampleTrafficPose(route, distance, out={}) {
  const d=((distance%route.length)+route.length)%route.length;
  let low=0,high=route.segments.length-1;
  while(low<high){const mid=Math.floor((low+high+1)/2);if(route.segments[mid].start<=d)low=mid;else high=mid-1;}
  const s=route.segments[low],u=(d-s.start)/s.length;
  out.x=s.x+(s.bx-s.x)*u;out.z=s.z+(s.bz-s.z)*u;out.y=s.y+(s.by-s.y)*u;
  out.yaw=-Math.atan2(s.bx-s.x,-(s.bz-s.z));
  out.pitch=Math.atan2(s.by-s.y,s.length);
  return out;
}
