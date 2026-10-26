// Stage-one inspection coordinates; not surveyed airport reference coordinates.
export const INCHEON_PATCH = Object.freeze({
  origin: { latitude: 37.448, longitude: 126.455 },
  halfSizeMeters: 1000,
  sourceBbox: [126.442, 37.438, 126.468, 37.458],
});

const radians = value => value * Math.PI / 180;
const rounded = value => Math.round(value * 100) / 100 || 0;

function ecef(latitude, longitude) {
  const lat = radians(latitude);
  const lon = radians(longitude);
  const e2 = 6.6943799901413165e-3; // WGS84 eccentricity squared.
  const n = 6378137 / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - e2) * Math.sin(lat)];
}

/** WGS84 -> local east/south tangent plane, meters. No elevation is inferred. */
export function projectToLocal(latitude, longitude, origin = INCHEON_PATCH.origin) {
  if (![latitude, longitude, origin.latitude, origin.longitude].every(Number.isFinite)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Invalid WGS84 coordinate');
  const position = ecef(latitude, longitude);
  const center = ecef(origin.latitude, origin.longitude);
  const [dx, dy, dz] = position.map((value, i) => value - center[i]);
  const lat = radians(origin.latitude);
  const lon = radians(origin.longitude);
  return [rounded(-Math.sin(lon) * dx + Math.cos(lon) * dy),
    rounded(Math.sin(lat) * Math.cos(lon) * dx + Math.sin(lat) * Math.sin(lon) * dy - Math.cos(lat) * dz)];
}

/** Clip a polyline into disconnected pieces; never bridge an outside excursion. */
export function clipLine(points, halfSize = INCHEON_PATCH.halfSizeMeters) {
  const pieces = [];
  let current = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const delta = [b[0] - a[0], b[1] - a[1]];
    let first = 0;
    let last = 1;
    let outside = false;
    for (const [p, q] of [[-delta[0], a[0] + halfSize], [delta[0], halfSize - a[0]],
      [-delta[1], a[1] + halfSize], [delta[1], halfSize - a[1]]]) {
      if (p === 0) { if (q < 0) outside = true; continue; }
      const ratio = q / p;
      if (p < 0) first = Math.max(first, ratio); else last = Math.min(last, ratio);
    }
    if (outside || first >= last) { current = null; continue; }
    const start = a.map((v, axis) => rounded(v + first * delta[axis]));
    const end = a.map((v, axis) => rounded(v + last * delta[axis]));
    if (start[0] === end[0] && start[1] === end[1]) continue;
    const previous = current?.at(-1);
    if (!previous || previous[0] !== start[0] || previous[1] !== start[1]) {
      current = [start];
      pieces.push(current);
    }
    current.push(end);
    if (last < 1) current = null;
  }
  return pieces;
}

/** Sutherland–Hodgman clipping of a simple closed way (multipolygons excluded). */
export function clipRing(points, halfSize = INCHEON_PATCH.halfSizeMeters) {
  let ring = points.slice(0, -1);
  for (const [axis, sign] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
    const output = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const insideA = a[axis] * sign <= halfSize;
      const insideB = b[axis] * sign <= halfSize;
      if (insideA) output.push(a);
      if (insideA !== insideB) {
        const t = (sign * halfSize - a[axis]) / (b[axis] - a[axis]);
        output.push(a.map((v, j) => rounded(v + t * (b[j] - v))));
      }
    }
    ring = output;
  }
  ring = ring.filter((point, i) => i === 0 || point[0] !== ring[i - 1][0] || point[1] !== ring[i - 1][1]);
  if (ring.length < 3) return [];
  const area = ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  return Math.abs(area) < 0.02 ? [] : [...ring, ring[0]];
}

export function buildingHeight(tags) {
  // OSM height without a suffix is in meters; reject compound/ambiguous values.
  const match = String(tags.height ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(m|ft)?$/);
  const meters = match ? Number(match[1]) * (match[2] === 'ft' ? 0.3048 : 1) : NaN;
  if (meters > 0 && meters <= 600) return { meters: rounded(meters), source: 'osm-height' };
  const levels = /^\d+(?:\.\d+)?$/.test(tags['building:levels'] ?? '') ? Number(tags['building:levels']) : NaN;
  if (levels > 0 && levels <= 150) return { meters: rounded(levels * 3), source: 'levels-estimate' };
  return { meters: 8, source: 'placeholder' };
}

function classify(tags) {
  if (tags.building && tags.building !== 'no') return { kind: 'building', area: true };
  if (['runway', 'taxiway', 'apron', 'terminal'].includes(tags.aeroway)) return { kind: tags.aeroway, area: tags.aeroway === 'apron' || tags.area === 'yes' };
  if (tags.highway && !['proposed', 'construction'].includes(tags.highway)) return { kind: 'road', area: tags.area === 'yes' };
  if (tags.leisure === 'park') return { kind: 'park', area: true };
  if (tags.natural === 'water') return { kind: 'water', area: true };
  if (tags.landuse && !['construction', 'proposed'].includes(tags.landuse)) return { kind: 'landuse', area: true };
  return null;
}

// Assemble complete outer-only multipolygons. Never fill unknown inner holes.
function relationRings(relation, ways, nodes) {
  if (relation.tags?.type !== 'multipolygon' || !relation.members?.length
    || relation.members.some(m => m.type !== 'way' || !['outer', ''].includes(m.role))) return null;
  const remaining = relation.members.map(m => ways.get(m.ref)?.nodes?.slice());
  if (remaining.some(ids => !ids || ids.length < 2)) return null;
  const rings = [];
  while (remaining.length) {
    const chain = remaining.shift();
    while (chain[0] !== chain.at(-1)) {
      const index = remaining.findIndex(ids => ids[0] === chain.at(-1) || ids.at(-1) === chain.at(-1));
      if (index < 0) return null;
      const next = remaining.splice(index, 1)[0];
      if (next[0] !== chain.at(-1)) next.reverse();
      chain.push(...next.slice(1));
    }
    const ring = chain.map(id => nodes.get(id));
    if (ring.length < 4 || ring.some(p => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) return null;
    rings.push(ring);
  }
  return rings;
}

/** Convert a frozen OSM map API or Overpass response into a bounded preview. */
export function buildIncheonPatch(raw) {
  if (!Array.isArray(raw.elements) || raw.remark) throw new Error('Missing or incomplete OSM response');
  const nodes = new Map(raw.elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const ways = new Map(raw.elements.filter(e => e.type === 'way').map(e => [e.id, e]));
  const features = [];
  const stats = { selectedWays: 0, selectedRelations: 0, outsideFeatures: 0, invalidFeatures: 0, excludedRelations: 0 };
  const seen = new Set();
  for (const element of raw.elements) {
    if (!['way', 'relation'].includes(element.type)) continue;
    const tags = element.tags ?? {};
    const classification = classify(tags);
    if (!classification) continue;
    const sourceId = `${element.type}/${element.id}`;
    if (!Number.isSafeInteger(element.id) || seen.has(sourceId)) throw new Error('Invalid or duplicate OSM feature');
    seen.add(sourceId);
    let geometries;
    if (element.type === 'relation') {
      geometries = relationRings(element, ways, nodes);
      if (!classification.area || !geometries) { stats.excludedRelations++; continue; }
      stats.selectedRelations++;
    } else {
      stats.selectedWays++;
      geometries = [element.geometry ?? element.nodes?.map(id => nodes.get(id))];
    }
    if (geometries.some(geometry => !geometry || geometry.length < 2 || geometry.some(p => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)))) {
      stats.invalidFeatures++;
      continue;
    }
    const parts = [];
    for (const geometry of geometries) {
      const points = geometry.map(p => projectToLocal(p.lat, p.lon));
      const closed = geometry.length > 3 && geometry[0].lat === geometry.at(-1).lat && geometry[0].lon === geometry.at(-1).lon;
      if (classification.area && !closed) { stats.invalidFeatures++; continue; }
      parts.push(...(classification.area ? [clipRing(points)].filter(p => p.length) : clipLine(points)));
    }
    if (!parts.length) { stats.outsideFeatures++; continue; }
    const feature = { id: sourceId, ...classification, parts };
    // Retain inspection provenance, not arbitrary source tags/HTML.
    for (const key of ['name', 'ref', 'highway', 'landuse', 'building', 'bridge', 'tunnel', 'layer', 'width']) {
      if (tags[key] !== undefined) feature[key] = String(tags[key]);
    }
    if (feature.kind === 'building') feature.height = buildingHeight(tags);
    features.push(feature);
  }
  features.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  if (!features.some(f => f.kind === 'building') || !features.some(f => f.kind === 'road')) throw new Error('Patch requires real buildings and roads');
  return { schemaVersion: 1, ...INCHEON_PATCH, coordinateFrame: '+X east, +Z south; meters; flat preview Y=0',
    attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0',
    licenseUrl: 'https://www.openstreetmap.org/copyright',
    limitations: ['No measured terrain or coastline', 'Simple ways and complete outer-only multipolygons; inner holes/incomplete relations excluded',
      'Road widths are visual defaults unless tagged; bridges/tunnels remain flattened',
      'OSM heights are unverified; levels × 3m and 8m fallback are illustrative'],
    stats, features };
}
