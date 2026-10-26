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
    const stitchedPositions = Array.from(positions.array);
    const stitchedUV = Array.from(geometry.attributes.uv.array);
    for (let i = 0; i < index.length; i += 3) {
      const cx = (positions.getX(index[i]) + positions.getX(index[i+1]) + positions.getX(index[i+2])) / 3;
      const cz = (positions.getZ(index[i]) + positions.getZ(index[i+1]) + positions.getZ(index[i+2])) / 3;
      if (Math.abs(cx) < 1000 && Math.abs(cz) < 1000) continue;
      let stitched = false;
      for (let edge = 0; edge < 3; edge++) {
        const a = index[i+edge], b = index[i+(edge+1)%3], apex = index[i+(edge+2)%3];
        const ax = positions.getX(a), az = positions.getZ(a);
        const bx = positions.getX(b), bz = positions.getZ(b);
        const seamX = Math.abs(ax)===1000 && ax===bx && Math.abs(az)<=1000 && Math.abs(bz)<=1000;
        const seamZ = Math.abs(az)===1000 && az===bz && Math.abs(ax)<=1000 && Math.abs(bx)<=1000;
        if (!seamX && !seamZ) continue;
        // The local 2km/160-segment mesh has an edge vertex every 12.5m.
        // Split only the regional triangle's seam edge, keeping its winding.
        const subdivisions = Math.hypot(bx-ax,bz-az)/12.5;
        if (!Number.isInteger(subdivisions) || subdivisions<1) throw new Error('Regional seam must align with local 12.5m grid');
        let previous = a;
        for (let step = 1; step <= subdivisions; step++) {
          let next = b;
          if (step < subdivisions) {
            const x = ax+(bx-ax)*step/subdivisions, z = az+(bz-az)*step/subdivisions;
            next = stitchedPositions.length/3;
            stitchedPositions.push(x,getHeight(x,z),z);
            stitchedUV.push(x/size+.5,.5-z/size);
          }
          filtered.push(previous,next,apex);
          previous = next;
        }
        stitched = true;
        break;
      }
      if (!stitched) filtered.push(index[i], index[i+1], index[i+2]);
    }
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(stitchedPositions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(stitchedUV,2));
    geometry.deleteAttribute('normal'); // Vertex count grew; recompute a matching buffer below.
    geometry.setIndex(filtered);
  }
  geometry.computeVertexNormals();
  return geometry;
}
