import { projectToLocal } from './incheon.js';
import { pointInRing } from './incheonDressing.js';

/** Join only known OSM way endpoints. Missing/open geometry is never filled. */
function ringsFor(members, ways, nodes) {
  const remaining = members.map(member => ways.get(member.ref)?.nodes?.slice());
  if (remaining.some(ids => !ids || ids.length < 2)) throw new Error('Incomplete apron member way');
  const rings = [];
  while (remaining.length) {
    const chain = remaining.shift();
    while (chain[0] !== chain.at(-1)) {
      const index = remaining.findIndex(ids => ids[0] === chain.at(-1) || ids.at(-1) === chain.at(-1));
      if (index < 0) throw new Error('Open apron ring');
      const next = remaining.splice(index,1)[0];
      if (next[0] !== chain.at(-1)) next.reverse();
      chain.push(...next.slice(1));
    }
    if (chain.length < 4) throw new Error('Degenerate apron ring');
    rings.push(chain.map(id => {
      const node = nodes.get(id);
      if (!node || !Number.isFinite(node.lat) || !Number.isFinite(node.lon)) throw new Error('Missing apron boundary node');
      return projectToLocal(node.lat,node.lon);
    }));
  }
  return rings;
}

/** Keep source boundaries and inner holes; do not buffer, hull or widen them. */
export function buildApronSurfaces(raw) {
  if (!Array.isArray(raw.elements) || raw.remark) throw new Error('Incomplete apron source');
  const nodes = new Map(raw.elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
  const ways = new Map(raw.elements.filter(e=>e.type==='way').map(e=>[e.id,e]));
  const surfaces = [];
  for (const relation of raw.elements.filter(e=>e.type==='relation' && e.tags?.aeroway==='apron')) {
    if (relation.tags.type !== 'multipolygon' || !relation.members?.length
      || relation.members.some(m=>m.type!=='way' || !['outer','inner',''].includes(m.role))) throw new Error('Unsupported apron relation');
    const outer = ringsFor(relation.members.filter(m=>m.role!=='inner'),ways,nodes);
    const inner = ringsFor(relation.members.filter(m=>m.role==='inner'),ways,nodes);
    if (!outer.length) throw new Error('Missing apron outer ring');
    const holes = outer.map(()=>[]);
    for (const ring of inner) {
      const owners = outer.map((boundary,index)=>pointInRing(ring[0][0],ring[0][1],boundary)?index:-1).filter(i=>i>=0);
      if (owners.length !== 1) throw new Error('Unassigned apron inner ring');
      holes[owners[0]].push(ring);
    }
    outer.forEach((points,index)=>surfaces.push({
      id:`relation/${relation.id}/${index}`, sourceId:`relation/${relation.id}`, sourceVersion:relation.version,
      kind:'apron',name:relation.tags.name??'',ref:relation.tags.ref??'',area:true,
      points,holes:holes[index],
    }));
  }
  return surfaces;
}
