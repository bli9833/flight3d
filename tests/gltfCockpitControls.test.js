import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindGltfYokes, updateGltfYokes, bindGltfEngineControls, updateGltfEngineControls } from '../src/aircraft/GltfCockpitControls.js';

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
      assert.equal(yoke.position.z, 1.265 - aileron * .045);
    }
  }
  model.updateMatrixWorld(true);
  const actual = yokes[0].children[0].localToWorld(
    new THREE.Vector3().fromBufferAttribute(yokes[0].children[0].geometry.attributes.position, 0)
  );
  const expected = model.localToWorld(new THREE.Vector3(.29, 1.96, 1.26));
  assert.ok(actual.distanceTo(expected) < 1e-6, 'neutral restores original asset placement');
});


test('batched throttles and both pedal pairs move independently and reset without drift', () => {
  const model = new THREE.Group();
  model.rotation.y = Math.PI;
  model.position.set(4, -1.31, -11.43);
  const nested = new THREE.Group();
  nested.position.y = 1;
  model.add(nested);
  const points = [
    [-.001, 1.85, 1.19], [.023, 1.85, 1.19],
    [.376, 1.68, 1.54], [.231, 1.68, 1.54],
    [-.187, 1.68, 1.54], [-.332, 1.68, 1.54],
    [0, 1.70, 1.10] // Static quadrant remains outside all moving bounds.
  ];
  const vertices = points.flatMap(([x,y,z]) => [x,y-1,z, x+.001,y-1,z, x,y-1+.001,z]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array(vertices.length / 3 * 2).fill(.5), 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  nested.add(mesh);
  model.updateMatrixWorld(true);
  const original = points.map(([x,y,z]) => model.localToWorld(new THREE.Vector3(x,y,z)));
  const controls = bindGltfEngineControls(model);
  const parts = [...controls.throttles, ...controls.pedals];
  assert.deepEqual(parts.map(p => p.children.length), [1,1,1,1,1,1]);
  assert.equal(mesh.geometry.attributes.position.count, 3, 'quadrant stays static');
  const vertex = part => part.children[0].localToWorld(new THREE.Vector3().fromBufferAttribute(part.children[0].geometry.attributes.position, 0));
  for (const state of [{throttle:1,rudder:1}, {throttle:1,rudder:1}, {throttle:.5,rudder:-1}, {}]) {
    updateGltfEngineControls(controls, state);
    model.updateMatrixWorld(true);
    controls.throttles.forEach((part, i) => {
      const point = model.worldToLocal(vertex(part));
      if (state.throttle) assert.ok(point.z > points[i][2], 'thrust advances handle forward in asset coordinates');
    });
    controls.pedals.forEach((part, i) => {
      const point = model.worldToLocal(vertex(part));
      const direction = i % 2 ? 1 : -1;
      assert.ok(Math.abs(point.z - points[i+2][2] - direction * (state.rudder || 0) * .05) < 1e-6);
    });
  }
  parts.forEach((part, i) => {
    assert.ok(vertex(part).distanceTo(original[i]) < 1e-6, 'reset restores asset geometry');
    assert.equal(part.children[0].geometry.attributes.uv.count, 3);
  });
});
