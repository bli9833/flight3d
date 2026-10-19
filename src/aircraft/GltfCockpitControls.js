import * as THREE from 'three';

// The medium GLB has nested transforms; the lite fallback batches by material.
// Split only triangles inside each yoke's measured asset-space bounds, preserving their UVs/normals.
export function bindGltfYokes(model) {
  const yokes = [];
  model.updateMatrixWorld(true);
  const inverseModel = model.matrixWorld.clone().invert();
  const meshes = [];
  model.traverse(node => { if (node.isMesh) meshes.push(node); });
  for (const x of [0.302, -0.254]) {
    const pivot = new THREE.Group();
    pivot.name = x > 0 ? 'GLTF_Captain_Yoke' : 'GLTF_FO_Yoke';
    pivot.position.set(x, 1.969, 1.265);
    const bounds = new THREE.Box3(
      new THREE.Vector3(x - 0.122, 1.91, 1.23),
      new THREE.Vector3(x + 0.122, 2.05, 1.29)
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
    yokes.push(pivot);
  }
  return yokes;
}

export function updateGltfYokes(yokes, state) {
  for (const yoke of yokes ?? []) {
    // Asset +Z points forward, opposite to aircraft +Z.
    yoke.rotation.z = (state.aileron || 0) * Math.PI / 3;
    yoke.position.z = 1.265 + (state.elevator || 0) * 0.045;
  }
}
