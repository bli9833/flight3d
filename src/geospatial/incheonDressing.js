import { clipRing, projectToLocal } from './incheon.js';

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]; const b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0]-a[0]) * (z-a[1]) / (b[1]-a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function segmentDistance(x, z, a, b) {
  const dx = b[0]-a[0]; const dz = b[1]-a[1];
  const length2 = dx*dx + dz*dz;
  const t = length2 ? Math.max(0, Math.min(1, ((x-a[0])*dx + (z-a[1])*dz) / length2)) : 0;
  return Math.hypot(x-a[0]-t*dx, z-a[1]-t*dz);
}

export function roadWidth(feature) {
  const explicit = Number(feature.width);
  if (explicit > 0 && explicit <= 100) return explicit;
  if (feature.kind === 'runway') return 45;
  if (feature.kind === 'taxiway') return 18;
  return { motorway: 15, motorway_link: 8, trunk: 13, primary: 12, secondary: 10,
    tertiary: 8, residential: 6, service: 4, footway: 2, path: 2, steps: 2 }[feature.highway] ?? 5;
}

/** Simple complete outlines; unspecified parking is explicitly assumed surface. */
export function buildDressingData(raw) {
  if (!Array.isArray(raw.elements) || raw.remark) throw new Error('Incomplete OSM response');
  const nodes = new Map(raw.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const areas = [];
  const excluded = { complex: 0, incomplete: 0, notSurface: 0, outside: 0 };
  for (const element of raw.elements) {
    const tags = element.tags ?? {};
    const kind = tags.amenity === 'parking' ? 'parking' : tags.leisure === 'garden' ? 'garden'
      : tags.aeroway === 'aerodrome' ? 'airfield' : null;
    if (!kind) continue;
    if (kind === 'parking' && (tags.building || tags.covered === 'yes' || ['multi-storey', 'underground', 'rooftop'].includes(tags.parking))) {
      excluded.notSurface++; continue;
    }
    if (element.type === 'node') continue;
    if (element.type !== 'way') { excluded.complex++; continue; }
    const ids = element.nodes;
    if (!ids || ids.length < 4 || ids[0] !== ids.at(-1) || ids.some(id => !nodes.has(id))) {
      excluded.incomplete++; continue;
    }
    const projected = ids.map(id => { const node = nodes.get(id); return projectToLocal(node.lat, node.lon); });
    const ring = clipRing(projected);
    if (!ring.length) { excluded.outside++; continue; }
    areas.push({ id: `way/${element.id}`, kind, name: tags.name ?? '', ring,
      surfaceType: tags.parking ?? 'unspecified', outlineSource: 'OSM', markingsSource: 'illustrative' });
  }
  areas.sort((a,b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  if (!areas.some(a => a.kind === 'parking')) throw new Error('No surface parking outlines');
  return { schemaVersion: 1, areas, excluded,
    limitations: ['OSM outline, not surveyed parking layout', 'Parking rows and landscaping are illustrative', 'Complex parking relations excluded'] };
}

function randomAt(x, z) {
  let h = (Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  return (h >>> 0) / 4294967296;
}

/** Bounded illustrative planting, restricted to mapped green areas and exclusions. */
export function generatePlanting(patch, dressing, limit = 320) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 1000) throw new Error('Invalid planting cap');
  const greens = [...patch.features.filter(f => f.kind === 'park' || f.landuse === 'grass').flatMap(f => f.parts),
    ...dressing.areas.filter(a => a.kind === 'garden').map(a => a.ring)];
  const blockers = [];
  for (const feature of patch.features) {
    let clearance = feature.kind === 'building' ? 5 : feature.kind === 'water' ? 6
      : ['runway', 'taxiway', 'apron'].includes(feature.kind) ? 85 : feature.kind === 'road' ? roadWidth(feature)/2 + 3.5 : null;
    if (clearance === null) continue;
    for (const ring of feature.parts) blockers.push({ ring, area: feature.area, clearance,
      bounds: ring.reduce((b,p) => [Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])], [Infinity, Infinity, -Infinity, -Infinity]) });
  }
  for (const area of dressing.areas.filter(a => ['parking','airfield'].includes(a.kind))) blockers.push({ ring: area.ring, area: true, clearance: area.kind==='airfield'?10:3,
    bounds: area.ring.reduce((b,p) => [Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])], [Infinity, Infinity, -Infinity, -Infinity]) });
  const clear = (x,z) => {
    for (const block of blockers) {
      const [minx,minz,maxx,maxz] = block.bounds;
      if (x < minx-block.clearance || x > maxx+block.clearance || z < minz-block.clearance || z > maxz+block.clearance) continue;
      if (block.area && pointInRing(x,z,block.ring)) return false;
      for (let i=1;i<block.ring.length;i++) if (segmentDistance(x,z,block.ring[i-1],block.ring[i]) < block.clearance) return false;
    }
    return true;
  };
  const candidates = [];
  for (let z=-980;z<=980;z+=18) for (let x=-980;x<=980;x+=18) {
    const r = randomAt(x,z);
    const px = x + (r-.5)*8;
    const pz = z + (randomAt(z,x)-.5)*8;
    if (!greens.some(ring => pointInRing(px,pz,ring)) || !clear(px,pz)) continue;
    candidates.push({ x: +px.toFixed(2), z: +pz.toFixed(2), scale: +(0.5 + r*.23).toFixed(3), order:r });
  }
  return candidates.sort((a,b) => a.order-b.order).slice(0,limit).map(({order,...tree}) => tree);
}
