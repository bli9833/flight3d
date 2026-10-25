import * as THREE from 'three';

// Terrain uses PlaneGeometry's (00, 01, 10) / (01, 11, 10) diagonal.
export function districtSurfaceHeight(terrain, x, z) {
  const { size, segments, geometry } = terrain;
  if (!geometry || !size || !segments) return terrain.getHeight(x, z);
  const u = (x / size + .5) * segments, v = (z / size + .5) * segments;
  const col = Math.floor(u), row = Math.floor(v);
  if (col < 0 || row < 0 || col >= segments || row >= segments) return terrain.getHeight(x, z);
  const p = geometry.attributes.position, a = row * (segments + 1) + col;
  const h00 = p.getY(a), h10 = p.getY(a + 1), h01 = p.getY(a + segments + 1), h11 = p.getY(a + segments + 2);
  const fx = u - col, fz = v - row;
  return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz :
    h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

// CCW polygons in the x/z plane. Clipping at EVERY terrain triangle edge makes
// the entire road face coplanar with the ground, including ridge crossings.
function clip(polygon, a, b) {
  const side = p => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const sp = side(p), sq = side(q);
    if (sp >= -1e-8) result.push(p);
    if ((sp > 1e-8 && sq < -1e-8) || (sp < -1e-8 && sq > 1e-8)) {
      const t = sp / (sp - sq);
      result.push({ x: p.x + t * (q.x - p.x), z: p.z + t * (q.z - p.z) });
    }
  }
  return result;
}

export function terrainPolygons(terrain, polygon) {
  if (!terrain.geometry || !terrain.size || !terrain.segments) return [polygon];
  const { size, segments } = terrain, step = size / segments;
  const xs = polygon.map(p => p.x), zs = polygon.map(p => p.z);
  const firstX = Math.max(0, Math.floor((Math.min(...xs) + size / 2) / step));
  const lastX = Math.min(segments - 1, Math.floor((Math.max(...xs) + size / 2) / step));
  const firstZ = Math.max(0, Math.floor((Math.min(...zs) + size / 2) / step));
  const lastZ = Math.min(segments - 1, Math.floor((Math.max(...zs) + size / 2) / step));
  const result = [];
  for (let col = firstX; col <= lastX; col++) for (let row = firstZ; row <= lastZ; row++) {
    const x = col * step - size / 2, z = row * step - size / 2;
    const a = { x, z }, b = { x: x + step, z }, c = { x, z: z + step }, d = { x: x + step, z: z + step };
    for (const triangle of [[a, b, c], [c, b, d]]) {
      let piece = polygon;
      for (let i = 0; i < 3 && piece.length; i++) piece = clip(piece, triangle[i], triangle[(i + 1) % 3]);
      if (piece.length >= 3) result.push(piece);
    }
  }
  return result;
}

export function surfaceGeometry(terrain, polygons, offset = .12) {
  const vertices = [];
  for (const polygon of polygons) for (const piece of terrainPolygons(terrain, polygon)) {
    for (let i = 1; i < piece.length - 1; i++) {
      const [a, b, c] = [piece[0], piece[i + 1], piece[i]]; // upward normals
      if (Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) < 1e-8) continue;
      for (const p of [a, b, c]) vertices.push(p.x, districtSurfaceHeight(terrain, p.x, p.z) + offset, p.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}
