import * as THREE from 'three';

// Measured against b737-800.glb's B737 mesh coordinates: +X aft, +Y up,
// +Z port. The mesh's own rotation and the model root map these to aircraft axes.
// Clip through long wing triangles rather than selecting their centres: the
// original asset has no vertices at most of the required hinge/span boundaries.
const plane = (x, y, z, constant) => ({ x, y, z, constant });
const distance = (v, p) => v.position[0] * p.x + v.position[1] * p.y + v.position[2] * p.z + p.constant;
const bindings = new WeakMap();

function clip(polygon, boundary, inside) {
  const output = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = distance(a, boundary), db = distance(b, boundary);
    const keepA = inside ? da >= 0 : da < 0;
    const keepB = inside ? db >= 0 : db < 0;
    if (keepA) output.push(a);
    if (keepA !== keepB) {
      const t = da / (da - db);
      output.push(Object.fromEntries(Object.keys(a).map(name => [name,
        a[name].map((value, k) => THREE.MathUtils.lerp(value, b[name][k], t))
      ])));
    }
  }
  return output;
}

function triangulate(polygon, output) {
  for (let i = 1; i + 1 < polygon.length; i++) {
    const triangle = [polygon[0], polygon[i], polygon[i + 1]];
    const [a, b, c] = triangle.map(v => new THREE.Vector3(...v.position));
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16) output.push(triangle);
  }
}

function geometryFrom(triangles, attributes) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(attributes)) {
    const values = triangles.flatMap(triangle => triangle.flatMap(vertex => vertex[name]));
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize));
  }
  geometry.normalizeNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function specifications() {
  const specs = [];
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    const span = (min, max) => [plane(0, 0, sign, -min), plane(0, 0, -sign, max)];
    specs.push(
      { name: `aileron${side}`, boundaries: [...span(10, 16.6), plane(1, 0, -.4 * sign, 1.3), plane(-1, 0, 0, 8)],
        origin: [2.7, -.5, sign * 10], axis: [.4 * sign, .075 * sign, 1], input: 'aileron', gain: -.35 * sign },
      { name: `flap${side}`, boundaries: [...span(2.6, 9.8), plane(1, 0, -.2 * sign, .2), plane(-1, 0, 0, 8), plane(0, 1, 0, 1.5)],
        origin: [.32, -1.1, sign * 2.6], axis: [.2 * sign, .08 * sign, 1], input: 'flapDegree', gain: -Math.PI / 180 },
      { name: `elevator${side}`, boundaries: [...span(2, 6.8), plane(1, 0, -.21 * sign, -16.2), plane(0, -1, 0, 3)],
        origin: [16.62, 1.5, sign * 2], axis: [.21 * sign, .08 * sign, 1], input: 'elevator', gain: .45 }
    );
  }
  specs.push({ name: 'rudder', boundaries: [plane(0, 1, 0, -2.8), plane(0, -1, 0, 8.7), plane(1, -.47, 0, -13.2)],
    origin: [14.516, 2.8, 0], axis: [.47, 1, 0], input: 'rudder', gain: .45 });
  return specs;
}

export function bindGltfControlSurfaces(model) {
  const mesh = model.getObjectByName('B737');
  if (!mesh?.isMesh) return [];
  if (bindings.has(mesh)) return bindings.get(mesh);
  const source = mesh.geometry;
  const attributes = source.attributes;
  const position = attributes.position;
  let triangles = [];
  const count = source.index?.count ?? position.count;
  for (let i = 0; i < count; i += 3) {
    triangles.push([0, 1, 2].map(offset => {
      const index = source.index ? source.index.getX(i + offset) : i + offset;
      return Object.fromEntries(Object.entries(attributes).map(([name, attribute]) => [name,
        Array.from({ length: attribute.itemSize }, (_, k) => attribute.getComponent(index, k))
      ]));
    }));
  }
  const controls = [];
  for (const spec of specifications()) {
    const moving = [], remaining = [];
    for (const triangle of triangles) {
      let polygon = triangle;
      for (const boundary of spec.boundaries) {
        triangulate(clip(polygon, boundary, false), remaining);
        polygon = clip(polygon, boundary, true);
        if (!polygon.length) break;
      }
      triangulate(polygon, moving);
    }
    triangles = remaining;
    if (!moving.length) continue;
    const pivot = new THREE.Group();
    pivot.name = `GLTF_${spec.name}`;
    pivot.position.set(...spec.origin);
    const geometry = geometryFrom(moving, attributes);
    geometry.translate(...spec.origin.map(value => -value));
    const surface = new THREE.Mesh(geometry, mesh.material);
    surface.castShadow = mesh.castShadow;
    surface.receiveShadow = mesh.receiveShadow;
    pivot.add(surface);
    mesh.add(pivot);
    controls.push({ ...spec, pivot, axis: new THREE.Vector3(...spec.axis).normalize() });
  }
  mesh.geometry = geometryFrom(triangles, attributes);
  // Do not dispose the source: another instance or a shadow proxy may share it.
  bindings.set(mesh, controls);
  return controls;
}

export function updateGltfControlSurfaces(controls, state) {
  for (const control of controls ?? []) {
    const raw = state[control.input];
    const value = Number.isFinite(raw) ? raw : 0;
    const limited = control.input === 'flapDegree'
      ? THREE.MathUtils.clamp(value, 0, 40) : THREE.MathUtils.clamp(value, -1, 1);
    control.pivot.quaternion.setFromAxisAngle(control.axis, limited * control.gain);
  }
}
