import * as THREE from 'three';

// The medium GLB has nested transforms; the lite fallback batches by material.
// Split only triangles inside each yoke's measured asset-space bounds, preserving their UVs/normals.
export function bindGltfYokes(model) {
  return bindParts(model, [0.302, -0.254].map(x => ({
    name: x > 0 ? 'GLTF_Captain_Yoke' : 'GLTF_FO_Yoke',
    pivot: [x, 1.969, 1.265],
    min: [x - 0.122, 1.91, 1.23], max: [x + 0.122, 2.05, 1.29]
  })));
}

function bindParts(model, definitions) {
  const parts = [];
  model.updateMatrixWorld(true);
  const inverseModel = model.matrixWorld.clone().invert();
  const meshes = [];
  model.traverse(node => { if (node.isMesh) meshes.push(node); });
  for (const definition of definitions) {
    const pivot = new THREE.Group();
    pivot.name = definition.name;
    pivot.position.fromArray(definition.pivot);
    const bounds = new THREE.Box3(
      new THREE.Vector3().fromArray(definition.min),
      new THREE.Vector3().fromArray(definition.max)
    );
    for (const mesh of meshes) {
      const transform = new THREE.Matrix4().multiplyMatrices(inverseModel, mesh.matrixWorld);
      mesh.geometry.computeBoundingBox();
      if (!bounds.intersectsBox(mesh.geometry.boundingBox.clone().applyMatrix4(transform))) continue;
      const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      const position = source.getAttribute('position');
      const selected = [], remaining = [];
      for (let i = 0; i < position.count; i += 3) {
        const inside = [0, 1, 2].every(offset => bounds.containsPoint(
          new THREE.Vector3().fromBufferAttribute(position, i + offset).applyMatrix4(transform)
        ));
        (inside ? selected : remaining).push(i, i + 1, i + 2);
      }
      if (selected.length) {
        const extract = indices => {
          const geometry = new THREE.BufferGeometry();
          for (const [name, attribute] of Object.entries(source.attributes)) {
            const values = new attribute.array.constructor(indices.length * attribute.itemSize);
            indices.forEach((index, i) => {
              for (let k = 0; k < attribute.itemSize; k++) {
                values[i * attribute.itemSize + k] = attribute.array[index * attribute.itemSize + k];
              }
            });
            geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized));
          }
          return geometry;
        };
        const moving = new THREE.Mesh(extract(selected), mesh.material);
        moving.geometry.applyMatrix4(transform);
        moving.geometry.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
        moving.castShadow = mesh.castShadow;
        moving.receiveShadow = mesh.receiveShadow;
        pivot.add(moving);
        mesh.geometry.dispose();
        mesh.geometry = extract(remaining);
      }
      source.dispose();
    }
    model.add(pivot);
    parts.push(pivot);
  }
  return parts;
}

export function updateGltfYokes(yokes, state) {
  for (const yoke of yokes ?? []) {
    // Asset +Z points forward, opposite to aircraft +Z.
    yoke.rotation.z = (state.aileron || 0) * Math.PI / 3;
    yoke.position.z = 1.265 - (state.elevator || 0) * 0.045;
  }
}

// Measured in the supplied cockpit asset's coordinates (+Z forward). Bounds
// select the moving handles/footplates without moving the quadrant or footrests.
// Triangle extraction also supports the material-batched Draco fallback.
export function bindGltfEngineControls(model) {
  const throttles = bindParts(model, [
    { name: 'GLTF_Throttle_1', pivot: [-0.001, 1.72, 1.24],
      min: [-0.023, 1.719, 1.175], max: [0.011, 1.874, 1.265] },
    { name: 'GLTF_Throttle_2', pivot: [0.023, 1.72, 1.24],
      min: [0.013, 1.719, 1.175], max: [0.048, 1.874, 1.265] }
  ]);
  const pedals = bindParts(model, [0.376, 0.231, -0.187, -0.332].map((x, i) => ({
    name: `GLTF_Rudder_Pedal_${i + 1}`, pivot: [x, 1.635, 1.54],
    min: [x - 0.036, 1.634, 1.510], max: [x + 0.036, 1.733, 1.573]
  })));
  return { throttles, pedals };
}

export function updateGltfEngineControls(controls, state) {
  if (!controls) return;
  const throttle = THREE.MathUtils.clamp(state.throttle || 0, 0, 1);
  const rudder = THREE.MathUtils.clamp(state.rudder || 0, -1, 1);
  // Rotate forward around the fixed shaft; use absolute transforms so holding
  // an input cannot accumulate displacement and reset restores the rest pose.
  controls.throttles.forEach(lever => { lever.rotation.x = throttle * 0.70; });
  controls.pedals.forEach((pedal, i) => {
    pedal.position.z = 1.54 + (i % 2 === 0 ? -1 : 1) * rudder * 0.05;
  });
}
