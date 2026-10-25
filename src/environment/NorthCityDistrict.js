import { districtSurfaceHeight, terrainPolygons } from './CitySurface.js';

// Design limits, not road engineering standards. Keep steep mountain terrain
// empty rather than levelling it or constructing unbounded concrete podiums.
export const NORTH_DISTRICT = Object.freeze({
  x: -800, z: -2800, radius: 950, spacing: 48, roadWidth: 8,
  maxGrade: .18, maxCrossSlope: .30, maxLotSlope: .32,
  maxFoundation: 6, maxSurfaceError: 2.5, minHeight: 5,
  maxBuildings: 180, sampleStep: 4
});

export function rectangle(x, z, width, depth, rotationY = 0) {
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({
    x: x + c * u * width / 2 + s * v * depth / 2,
    z: z - s * u * width / 2 + c * v * depth / 2
  }));
}

export function insideRectangle(x, z, box, radius = 0) {
  const c = Math.cos(box.rotationY), s = Math.sin(box.rotationY);
  const dx = x - box.x, dz = z - box.z;
  return Math.abs(c * dx - s * dz) <= box.width / 2 + radius &&
    Math.abs(s * dx + c * dz) <= box.depth / 2 + radius;
}

export function rectanglesOverlap(a, b, clearance = 0) {
  const axes = box => [[Math.cos(box.rotationY), -Math.sin(box.rotationY)],
    [Math.sin(box.rotationY), Math.cos(box.rotationY)]];
  const aa = axes(a), bb = axes(b), dx = b.x - a.x, dz = b.z - a.z;
  const projection = (box, frame, axis) => Math.abs(frame[0][0] * axis[0] + frame[0][1] * axis[1]) * box.width / 2 +
    Math.abs(frame[1][0] * axis[0] + frame[1][1] * axis[1]) * box.depth / 2;
  return [...aa, ...bb].every(axis => Math.abs(dx * axis[0] + dz * axis[1]) <
    projection(a, aa, axis) + projection(b, bb, axis) + clearance);
}

function gradient(terrain, x, z) {
  return { x: (terrain.getHeight(x + 2, z) - terrain.getHeight(x - 2, z)) / 4,
    z: (terrain.getHeight(x, z + 2) - terrain.getHeight(x, z - 2)) / 4 };
}

// Sample the full area, not only a center or four corners. Include mesh triangle
// vertices/intersections so the rendered ground extrema cannot hide between samples.
export function inspectSite(terrain, box, config = NORTH_DISTRICT) {
  const polygon = rectangle(box.x, box.z, box.width, box.depth, box.rotationY);
  const c = Math.cos(box.rotationY), s = Math.sin(box.rotationY), points = [{ x: box.x, z: box.z }];
  const nx = Math.ceil(box.width / config.sampleStep), nz = Math.ceil(box.depth / config.sampleStep);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const u = (i / nx - .5) * box.width, v = (j / nz - .5) * box.depth;
    points.push({ x: box.x + c * u + s * v, z: box.z - s * u + c * v });
  }
  const pieces = terrainPolygons(terrain, polygon);
  points.push(...pieces.flat());
  let min = Infinity, max = -Infinity, slope = 0, error = 0, grade = 0, crossSlope = 0;
  const includeGradient = g => {
    slope = Math.max(slope, Math.hypot(g.x, g.z));
    grade = Math.max(grade, Math.abs(c * g.x - s * g.z));
    crossSlope = Math.max(crossSlope, Math.abs(s * g.x + c * g.z));
  };
  // A coarse rendered triangle can be steeper than the analytical surface.
  // Evaluate its plane exactly, rather than averaging across its edges.
  for (const piece of pieces) for (let i = 1; i < piece.length - 1; i++) {
    const [a, b, d] = [piece[0], piece[i], piece[i + 1]];
    const bx = b.x - a.x, bz = b.z - a.z, dx = d.x - a.x, dz = d.z - a.z;
    const determinant = bx * dz - bz * dx;
    if (Math.abs(determinant) < 1e-8) continue;
    const h = districtSurfaceHeight(terrain, a.x, a.z);
    const bh = districtSurfaceHeight(terrain, b.x, b.z) - h, dh = districtSurfaceHeight(terrain, d.x, d.z) - h;
    includeGradient({ x: (bh * dz - bz * dh) / determinant, z: (bx * dh - bh * dx) / determinant });
  }
  for (const p of points) {
    const h = terrain.getHeight(p.x, p.z), visual = districtSurfaceHeight(terrain, p.x, p.z);
    const g = gradient(terrain, p.x, p.z);
    if (![h, visual, g.x, g.z].every(Number.isFinite)) return null;
    // Airport boundary plus extended approach corridor, with full-area testing.
    if ((Math.abs(p.x) < 2400 && Math.abs(p.z) < 450) ||
        (Math.abs(p.x) < 8500 && Math.abs(p.z) < 850)) return null;
    min = Math.min(min, h, visual); max = Math.max(max, h, visual);
    includeGradient(g);
    error = Math.max(error, Math.abs(h - visual));
  }
  if (min < config.minHeight || error > config.maxSurfaceError) return null;
  return { min, max, slope, grade, crossSlope, error };
}

export function planNorthDistrict(terrain, overrides = {}) {
  const config = { ...NORTH_DISTRICT, ...overrides };
  const g = gradient(terrain, config.x, config.z);
  // Local X follows the center's contour tangent; local Z follows the gradient.
  const rotationY = overrides.rotationY ?? (Math.hypot(g.x, g.z) < 1e-6 ? 0 : Math.atan2(-g.x, -g.z));
  const c = Math.cos(rotationY), s = Math.sin(rotationY), nodes = [], edges = [];
  const n = Math.floor(config.radius / config.spacing), byGrid = new Map();
  for (let row = -n; row <= n; row++) for (let col = -n; col <= n; col++) {
    if (Math.hypot(col, row) * config.spacing > config.radius - config.spacing) continue;
    const u = col * config.spacing, v = row * config.spacing;
    const node = { id: nodes.length, col, row, x: config.x + c * u + s * v,
      z: config.z - s * u + c * v, links: [] };
    const site = inspectSite(terrain, { ...node, width: config.roadWidth, depth: config.roadWidth, rotationY }, config);
    if (!site || site.slope > config.maxCrossSlope) continue;
    nodes.push(node); byGrid.set(`${col},${row}`, node);
  }
  for (const a of nodes) for (const [dc, dr] of [[1, 0], [0, 1]]) {
    const b = byGrid.get(`${a.col + dc},${a.row + dr}`);
    if (!b) continue;
    const yaw = rotationY + (dr ? -Math.PI / 2 : 0);
    const box = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
      width: config.spacing - config.roadWidth, depth: config.roadWidth, rotationY: yaw };
    // Inspect the shared node squares too, in this street's travel direction.
    const site = inspectSite(terrain, { ...box, width: config.spacing + config.roadWidth }, config);
    if (!site || site.grade > config.maxGrade || site.crossSlope > config.maxCrossSlope) continue;
    const edge = { a: a.id, b: b.id, ...box, site };
    a.links.push(edge); b.links.push(edge); edges.push(edge);
  }
  // Only keep the largest accessible component. No orphan streets or lots.
  const visited = new Set(); let connected = [];
  for (const root of nodes) {
    if (visited.has(root.id)) continue;
    const component = [root]; visited.add(root.id);
    for (let i = 0; i < component.length; i++) for (const e of component[i].links) {
      const next = nodes[e.a === component[i].id ? e.b : e.a];
      if (!visited.has(next.id)) { visited.add(next.id); component.push(next); }
    }
    if (component.length > connected.length) connected = component;
  }
  const retained = new Set(connected.map(node => node.id));
  const streets = edges.filter(e => retained.has(e.a) && retained.has(e.b));
  const lots = [], occupied = [];
  for (const edge of streets) for (const side of [-1, 1]) {
    if (lots.length >= config.maxBuildings) continue;
    const yaw = edge.rotationY, offset = config.roadWidth / 2 + 4 + 9;
    const box = { x: edge.x + Math.sin(yaw) * offset * side,
      z: edge.z + Math.cos(yaw) * offset * side, width: 18, depth: 18, rotationY: yaw };
    // Conservative circle separation works for both perpendicular street lots.
    if (occupied.some(p => Math.hypot(p.x - box.x, p.z - box.z) < 28)) continue;
    // A lot must also clear every other street and intersection square.
    if (streets.some(e => rectanglesOverlap(box, e, 2)) ||
        connected.some(node => rectanglesOverlap(box,
          { ...node, width: config.roadWidth, depth: config.roadWidth, rotationY }, 2))) continue;
    const site = inspectSite(terrain, box, config);
    if (!site || site.slope > config.maxLotSlope || site.max - site.min + .1 > config.maxFoundation) continue;
    const index = lots.length;
    lots.push({ ...box, site, groundY: site.min - .05, visualY: site.max + .05,
      height: 18 + (index * 17 % 31), archetype: index % 5 === 0 ? 0 : index % 5 === 1 ? 2 : 1 });
    occupied.push(box);
  }
  const junctions = streets.length ? connected.map(node => ({ ...node,
    width: config.roadWidth, depth: config.roadWidth, rotationY, degree: node.links.length })) : [];
  const roadBoxes = [...streets, ...junctions];
  return { config, rotationY, nodes: junctions, streets, lots,
    polygons: roadBoxes.map(b => rectangle(b.x, b.z, b.width, b.depth, b.rotationY)),
    excludesTree: (x, z, radius) => [...roadBoxes, ...lots].some(b => insideRectangle(x, z, b, radius + 2)) };
}
