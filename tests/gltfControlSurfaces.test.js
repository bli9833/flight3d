import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { bindGltfControlSurfaces, updateGltfControlSurfaces } from '../src/aircraft/GltfControlSurfaces.js';

// Load the real asset's geometry without requiring DOM image decoding in Node.
function asset() {
  const bytes = fs.readFileSync(new URL('../public/models/b737-800.glb', import.meta.url));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binary = 28 + length;
  const primitive = json.meshes.find(mesh => mesh.name === 'B737').primitives[0];
  const read = index => {
    const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView];
    const Type = accessor.componentType === 5126 ? Float32Array : Uint16Array;
    const size = { VEC3: 3, VEC2: 2, SCALAR: 1 }[accessor.type];
    const offset = binary + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const data = bytes.subarray(offset, offset + accessor.count * size * Type.BYTES_PER_ELEMENT);
    return new THREE.BufferAttribute(new Type(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), size);
  };
  const geometry = new THREE.BufferGeometry();
  for (const [name, index] of Object.entries(primitive.attributes)) {
    geometry.setAttribute({ POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv' }[name], read(index));
  }
  geometry.setIndex(read(primitive.indices));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = 'B737';
  mesh.quaternion.fromArray(json.nodes.find(node => node.name === 'B737').rotation);
  const model = new THREE.Group();
  model.rotation.y = Math.PI / 2;
  model.add(mesh);
  return { model, mesh };
}

function area(geometry) {
  const p = geometry.attributes.position, indices = geometry.index;
  let sum = 0;
  for (let i = 0; i < (indices?.count ?? p.count); i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, indices ? indices.getX(i + k) : i + k));
    sum += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return sum;
}

function trailingPoint(control) {
  const p = control.pivot.children[0].geometry.attributes.position;
  let index = 0;
  for (let i = 1; i < p.count; i++) if (p.getX(i) > p.getX(index)) index = i;
  return new THREE.Vector3().fromBufferAttribute(p, index);
}

test('real GLB splits all seven surfaces while preserving neutral geometry, UVs and material', () => {
  const { model, mesh } = asset();
  const original = mesh.geometry;
  const originalArea = area(original);
  const originalBounds = new THREE.Box3().setFromObject(model);
  const controls = bindGltfControlSurfaces(model);
  assert.equal(controls.length, 7);
  assert.strictEqual(bindGltfControlSurfaces(model), controls, 'binding is idempotent');
  let total = area(mesh.geometry);
  for (const control of controls) {
    const moving = control.pivot.children[0];
    assert.ok(moving.geometry.attributes.position.count > 6, `${control.name} has actual asset triangles`);
    assert.strictEqual(moving.material, mesh.material);
    assert.equal(moving.geometry.attributes.position.count, moving.geometry.attributes.uv.count);
    assert.ok([...moving.geometry.attributes.normal.array].every(Number.isFinite));
    total += area(moving.geometry);
  }
  assert.ok(Math.abs(total - originalArea) / originalArea < 1e-6, 'no overlapping or missing triangle area');
  const bounds = new THREE.Box3().setFromObject(model);
  assert.ok(bounds.min.distanceTo(originalBounds.min) < 1e-5);
  assert.ok(bounds.max.distanceTo(originalBounds.max) < 1e-5);
  assert.ok(mesh.geometry.attributes.position.count > 0, 'airframe remains present');
  assert.ok(original.index, 'shared original geometry is unchanged');
});

test('hold/reverse/release moves the rendered surfaces in aircraft axes and restores neutral', () => {
  const { model } = asset();
  const controls = bindGltfControlSurfaces(model);
  const points = controls.map(trailingPoint);
  const sample = () => {
    model.updateMatrixWorld(true);
    return controls.map((control, i) => control.pivot.localToWorld(points[i].clone()));
  };
  const neutral = sample();
  for (const input of [1, 1, -1, 0]) {
    updateGltfControlSurfaces(controls, { aileron: input, elevator: input, rudder: input, flapDegree: Math.max(0, input) * 40 });
    const positions = sample();
    controls.forEach((control, i) => {
      if (input === 0) assert.ok(positions[i].distanceTo(neutral[i]) < 1e-5, `${control.name} returns to neutral`);
      else if (control.input !== 'flapDegree' || input > 0) assert.ok(positions[i].distanceTo(neutral[i]) > .01, `${control.name} visibly moves`);
      const dy = positions[i].y - neutral[i].y;
      if (input > 0 && control.name === 'aileronL') assert.ok(dy < 0, 'right roll lowers port aileron');
      if (input > 0 && control.name === 'aileronR') assert.ok(dy > 0, 'right roll raises starboard aileron');
      if (input > 0 && control.input === 'elevator') assert.ok(dy > 0, 'pull-up raises elevator trailing edges');
      if (input > 0 && control.input === 'flapDegree') assert.ok(dy < 0, 'flaps extend down');
      if (input > 0 && control.input === 'rudder') assert.ok(positions[i].x > neutral[i].x, 'right pedal deflects rudder trailing edge right in aircraft body frame');
    });
  }
  updateGltfControlSurfaces(controls, { aileron: NaN, elevator: Infinity, rudder: -Infinity, flapDegree: NaN });
  assert.ok(controls.every(control => control.pivot.quaternion.angleTo(new THREE.Quaternion()) < 1e-7));
});
