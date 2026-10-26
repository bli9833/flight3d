import * as THREE from 'three';

/** Tessellate wide surfaces before draping: edge-only lifting would cut hills. */
export function drapeSurface(input, getHeight, offset, maxEdge = 25) {
  if (!(maxEdge >= 1)) throw new Error('Invalid drape spacing');
  const flat = input.index ? input.toNonIndexed() : input;
  const source = flat.attributes.position.array;
  const vertices = [];
  for (let i = 0; i < source.length; i += 9) {
    const stack = [[...Array.from(source.slice(i, i+9))]];
    while (stack.length) {
      const t = stack.pop();
      const p = [[t[0], t[2]], [t[3], t[5]], [t[6], t[8]]];
      const lengths = p.map((a, j) => Math.hypot(a[0]-p[(j+1)%3][0], a[1]-p[(j+1)%3][1]));
      const edge = lengths.indexOf(Math.max(...lengths));
      if (lengths[edge] > maxEdge) {
        const a = p[edge]; const b = p[(edge+1)%3]; const c = p[(edge+2)%3];
        const m = [(a[0]+b[0])/2, (a[1]+b[1])/2];
        stack.push([a[0], 0, a[1], m[0], 0, m[1], c[0], 0, c[1]],
          [m[0], 0, m[1], b[0], 0, b[1], c[0], 0, c[1]]);
      } else {
        for (const [x, z] of p) vertices.push(x, getHeight(x, z) + offset, z);
      }
    }
  }
  if (flat !== input) flat.dispose();
  input.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Rigid floor/roof, ground-following foundation; never translate onto DSM roofs. */
export function placeBuilding(geometry, getHeight, height) {
  const positions = geometry.attributes.position;
  // Sample all generated vertices, not only source ring points.
  let floor = -Infinity;
  for (let i = 0; i < positions.count; i++) floor = Math.max(floor, getHeight(positions.getX(i), positions.getZ(i)));
  floor += 0.05;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i); const z = positions.getZ(i);
    positions.setY(i, positions.getY(i) < height / 2 ? getHeight(x, z) : floor + height);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return { geometry, floor };
}

/** Sample shared boundary heights and leave a hole for the local detail mesh. */
export function terrainGeometry(size, segments, getHeight, omitCenter = false) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) positions.setY(i, getHeight(positions.getX(i), positions.getZ(i)));
  if (omitCenter) {
    const filtered = [];
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const cx = (positions.getX(index[i]) + positions.getX(index[i+1]) + positions.getX(index[i+2])) / 3;
      const cz = (positions.getZ(index[i]) + positions.getZ(index[i+1]) + positions.getZ(index[i+2])) / 3;
      if (Math.abs(cx) < 1000 && Math.abs(cz) < 1000) continue;
      filtered.push(index[i], index[i+1], index[i+2]);
    }
    geometry.setIndex(filtered);
  }
  geometry.computeVertexNormals();
  return geometry;
}
