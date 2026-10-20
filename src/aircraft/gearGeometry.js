import * as THREE from 'three';

// Subtract axis-aligned bay volumes in aircraft space. Split crossing triangles
// rather than dropping them, preserving UVs, normals and material groups.
export function cutGearBays(mesh, aircraft, bays) {
  aircraft.updateMatrixWorld(true);
  const toAircraft = new THREE.Matrix4().copy(aircraft.matrixWorld).invert().multiply(mesh.matrixWorld);
  const source = mesh.geometry;
  const names = Object.keys(source.attributes);
  const output = Object.fromEntries(names.map(name => [name, []]));
  const position = new THREE.Vector3();
  const planes = bays.map(box => [
    [0, 1, box.min.x], [0, -1, -box.max.x],
    [1, 1, box.min.y], [1, -1, -box.max.y],
    [2, 1, box.min.z], [2, -1, -box.max.z]
  ]);
  const vertex = index => {
    const attributes = {};
    for (const name of names) {
      const attr = source.attributes[name];
      attributes[name] = Array.from({ length: attr.itemSize }, (_, i) => attr.getComponent(index, i));
    }
    position.fromArray(attributes.position).applyMatrix4(toAircraft);
    return { attributes, point: position.toArray() };
  };
  const interpolate = (a, b, t) => ({
    point: a.point.map((value, i) => THREE.MathUtils.lerp(value, b.point[i], t)),
    attributes: Object.fromEntries(names.map(name => [name,
      a.attributes[name].map((value, i) => THREE.MathUtils.lerp(value, b.attributes[name][i], t))]))
  });
  const split = (polygon, [axis, sign, offset]) => {
    const inside = [], outside = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = a.point[axis] * sign - offset, db = b.point[axis] * sign - offset;
      (da >= 0 ? inside : outside).push(a);
      if ((da >= 0) !== (db >= 0)) {
        const crossing = interpolate(a, b, da / (da - db));
        inside.push(crossing); outside.push(crossing);
      }
    }
    return { inside, outside };
  };
  const geometry = new THREE.BufferGeometry();
  const count = source.index ? source.index.count : source.attributes.position.count;
  let lastMaterial = -1, groupStart = 0, emitted = 0;
  for (let index = 0; index < count; index += 3) {
    let polygons = [[0, 1, 2].map(i => vertex(source.index ? source.index.getX(index + i) : index + i))];
    for (const boxPlanes of planes) {
      const kept = [];
      for (const polygon of polygons) {
        let remainder = polygon;
        for (const plane of boxPlanes) {
          if (remainder.length < 3) break;
          const parts = split(remainder, plane);
          if (parts.outside.length >= 3) kept.push(parts.outside);
          remainder = parts.inside;
        }
        // The remainder is inside all six planes: remove it.
      }
      polygons = kept;
    }
    const material = source.groups.find(group => index >= group.start && index < group.start + group.count)?.materialIndex ?? 0;
    if (material !== lastMaterial) {
      if (emitted > groupStart) geometry.addGroup(groupStart, emitted - groupStart, lastMaterial);
      lastMaterial = material; groupStart = emitted;
    }
    for (const polygon of polygons) {
      for (let i = 1; i < polygon.length - 1; i++) {
        for (const v of [polygon[0], polygon[i], polygon[i + 1]]) {
          for (const name of names) output[name].push(...v.attributes[name]);
          emitted++;
        }
      }
    }
  }
  if (emitted > groupStart) geometry.addGroup(groupStart, emitted - groupStart, lastMaterial);
  for (const name of names) geometry.setAttribute(name,
    new THREE.Float32BufferAttribute(output[name], source.attributes[name].itemSize));
  geometry.normalizeNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  mesh.geometry = geometry;
}
