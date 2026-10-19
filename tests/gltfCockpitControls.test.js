import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindGltfYokes, updateGltfYokes } from '../src/aircraft/GltfCockpitControls.js';

test('nested and batched GLB yokes preserve rest geometry and follow hold/reverse/release', () => {
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  model.position.set(0, -1.31, -11.43);
  const nested = new THREE.Group();
  nested.position.y = 1;
  model.add(nested);
  const geometry = new THREE.BufferGeometry();
  // Captain yoke, first officer yoke, and unrelated panel share one mesh.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    .29,.96,1.26, .31,.96,1.26, .30,.98,1.26,
    -.26,.96,1.26, -.24,.96,1.26, -.25,.98,1.26,
    0,.80,1.45, .02,.80,1.45, .01,.82,1.45
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array(18).fill(.5), 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  nested.add(mesh);
  const yokes = bindGltfYokes(model);
  assert.deepEqual(yokes.map(y => y.children.length), [1, 1]);
  assert.equal(mesh.geometry.attributes.position.count, 3, 'panel remains static');
  assert.equal(yokes[0].children[0].geometry.attributes.uv.count, 3);
  for (const aileron of [1, 1, -1, 0]) {
    updateGltfYokes(yokes, { aileron, elevator: aileron });
    for (const yoke of yokes) {
      assert.equal(yoke.rotation.z, aileron * Math.PI / 3);
      assert.equal(yoke.position.z, 1.265 + aileron * .045);
    }
  }
  model.updateMatrixWorld(true);
  const actual = yokes[0].children[0].localToWorld(
    new THREE.Vector3().fromBufferAttribute(yokes[0].children[0].geometry.attributes.position, 0)
  );
  const expected = model.localToWorld(new THREE.Vector3(.29, 1.96, 1.26));
  assert.ok(actual.distanceTo(expected) < 1e-6, 'neutral restores original asset placement');
});
