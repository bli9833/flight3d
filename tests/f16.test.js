import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { F16, F16_SCALE, F16_CENTER_X, splitF16Gear } from '../src/aircraft/F16.js';
import { F16_FALCON } from '../src/config/aircraftConfigs.js';
import { CollisionDetector, F16_COLLISION_PROBES } from '../src/physics/CollisionDetector.js';

const bytes = readFileSync(new URL('../public/models/f-16.glb', import.meta.url));
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binaryStart = 28 + jsonLength;
function deployedGearGeometry() {
  const primitive = gltf.meshes[gltf.nodes.find(n => n.name === 'Object_16').mesh].primitives[0];
  const geometry = new THREE.BufferGeometry();
  const accessor = gltf.accessors[primitive.attributes.POSITION];
  const view = gltf.bufferViews[accessor.bufferView];
  const start = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const positions = new Float32Array(accessor.count * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = bytes.readFloatLE(start + i * 4);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const index = gltf.accessors[primitive.indices];
  const iv = gltf.bufferViews[index.bufferView];
  const offset = binaryStart + (iv.byteOffset ?? 0) + (index.byteOffset ?? 0);
  const indices = Array.from({ length: index.count }, (_, i) => index.componentType === 5125
    ? bytes.readUInt32LE(offset + i * 4) : bytes.readUInt16LE(offset + i * 2));
  geometry.setIndex(indices);
  const transform = new THREE.Matrix4().makeTranslation(0, 0, F16_CENTER_X * F16_SCALE)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeScale(F16_SCALE, F16_SCALE, F16_SCALE))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return geometry.applyMatrix4(transform);
}

test('supplied F16 gear separates into three nonempty legs without losing triangles', () => {
  const geometry = deployedGearGeometry();
  const parts = splitF16Gear(geometry);
  assert.equal(Object.values(parts).reduce((n, p) => n + p.attributes.position.count, 0), geometry.index.count);
  for (const part of Object.values(parts)) {
    assert.ok(part.attributes.position.count > 100);
    assert.ok([...part.attributes.position.array].every(Number.isFinite));
  }
  assert.ok(parts.nose.boundingBox.max.z < 0);
  assert.ok(parts.mainLeft.boundingBox.min.x < 0);
  assert.ok(parts.mainRight.boundingBox.max.x > 0);
});

test('gear retracts and extends repeatedly from continuous telemetry without accumulating rotation', () => {
  const aircraft = Object.create(F16.prototype);
  aircraft.group = new THREE.Group();
  aircraft.gearLegs = {};
  aircraft.gearExtension = 1;
  aircraft.lightsOn = true;
  aircraft.stowedGear = new THREE.Group();
  aircraft.installGear(new THREE.Mesh(deployedGearGeometry(), new THREE.MeshStandardMaterial()));
  for (const extension of [1, .5, 0, .25, 1, 0, 1]) {
    aircraft.update(.016, { gearState: extension });
    for (const leg of Object.values(aircraft.gearLegs)) {
      assert.equal(leg.visible, extension > 0);
      assert.ok(Number.isFinite(leg.rotation.x + leg.rotation.z));
      if (extension === 1) assert.equal(Math.abs(leg.rotation.x) + Math.abs(leg.rotation.z), 0);
    }
    assert.equal(aircraft.stowedGear.visible, extension < .999);
  }
});

test('F16 uses its own contact envelope, cockpit, and noncommercial source attribution', () => {
  const detector = Object.create(CollisionDetector.prototype);
  detector.loadAircraftConfig(F16_FALCON);
  assert.equal(detector.probePoints.length, F16_COLLISION_PROBES.length);
  assert.ok(detector.probePoints.every(p => Math.abs(p.pos.x) < 5 && Math.abs(p.pos.z) < 9));
  assert.ok(F16_FALCON.landingGear.bodySupportPoints.every(p => Math.abs(p.position[2]) <= 8));
  assert.ok(gltf.nodes.some(n => n.name.startsWith('F-16-cockpit')));
  assert.equal(gltf.asset.extras.author.split(' ')[0], 'bohmerang');
  assert.match(gltf.asset.extras.license, /CC-BY-NC-SA-4.0/);
});
