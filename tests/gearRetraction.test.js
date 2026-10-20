import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Boeing737 } from '../src/aircraft/Boeing737.js';
import { LandingGear } from '../src/physics/LandingGear.js';
import { cutGearBays } from '../src/aircraft/gearGeometry.js';

if (typeof document === 'undefined') {
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop: noop }) });
  globalThis.document = { createElement: () => ({ getContext: () => ctx, width: 64, height: 64 }) };
}

const canvas = { getContext: () => null, canvas: {} };
const makeAircraft = (profile = 'fallback') => {
  const aircraft = new Boeing737(canvas, canvas, canvas);
  if (profile === 'loaded') {
    aircraft.group.remove(aircraft.gearGroup);
    aircraft.buildLandingGear('loaded');
  }
  return aircraft;
};
const bounds = object => new THREE.Box3().setFromObject(object);
const pose = (aircraft, state) => {
  aircraft.update(1 / 120, { gearState: state });
  aircraft.group.updateMatrixWorld(true);
};

for (const profile of ['fallback', 'loaded']) describe(`Rigid landing gear retraction (${profile})`, () => {
  it('keeps dimensions and fixed door hinges through a full cycle and mid-cycle reversal', () => {
    const aircraft = makeAircraft(profile);
    const legs = [aircraft.noseGearGroup, aircraft.mainGearLGroup, aircraft.mainGearRGroup];
    const hinges = aircraft.gearDoors.map(({ obj }) => obj.position.clone());
    const wheel = aircraft.mainTruckL.children.find(child => child.isGroup);
    const radius = bounds(wheel).getSize(new THREE.Vector3()).z;
    const states = [...Array.from({ length: 101 }, (_, i) => 1 - i / 100), 0.3, 0.6, 0.4, 0.2, 0,
      ...Array.from({ length: 101 }, (_, i) => i / 100)];
    const poses = new Map();
    for (const state of states) {
      pose(aircraft, state);
      for (const leg of legs) assert.deepEqual(leg.scale.toArray(), [1, 1, 1]);
      aircraft.gearDoors.forEach(({ obj }, i) => {
        assert.equal(obj.parent, aircraft.gearGroup);
        assert.deepEqual(obj.position.toArray(), hinges[i].toArray());
      });
      assert.ok(Math.abs(bounds(wheel).getSize(new THREE.Vector3()).z - radius) < 1e-7);
      // All moving main-gear geometry stays below the measured wing underside,
      // behind the engines, and on its own side of the aircraft.
      for (const [leg, side] of [[legs[1], -1], [legs[2], 1]]) {
        const box = bounds(leg);
        assert.ok(box.max.y < -1.48, `wing clearance at state ${state}`);
        assert.ok(box.min.z > 1, `engine clearance at state ${state}`);
        assert.ok(side < 0 ? box.max.x < 0 : box.min.x > 0, 'legs must not cross the centerline');
      }
      const signature = legs.flatMap(leg => leg.matrix.elements);
      if (poses.has(state)) assert.deepEqual(signature, poses.get(state), 'reversal must retrace the same pose');
      poses.set(state, signature);
    }
  });

  it('folds main wheels inward and preserves every extended axle center and loaded tire clearance', () => {
    const aircraft = makeAircraft(profile);
    const physics = new LandingGear();
    const trucks = [aircraft.noseTruck, aircraft.mainTruckL, aircraft.mainTruckR];
    for (const compression of [0, 0.3, 0.9, 0]) {
      aircraft.update(1 / 120, { gearState: 1, compressions: {
        nose: compression, mainLeft: compression, mainRight: compression
      } });
      aircraft.group.updateMatrixWorld(true);
      trucks.forEach((truck, i) => {
        const wheels = truck.children.filter(child => child.isGroup).slice(0, 2);
        const center = wheels.reduce((sum, wheel) => sum.add(wheel.getWorldPosition(new THREE.Vector3())), new THREE.Vector3()).multiplyScalar(0.5);
        const expected = physics.contacts[i].localPos.clone(); expected.y += compression;
        assert.ok(center.distanceTo(expected) < 1e-9);
      });
      const ground = physics.contacts[0].localPos.y + compression - physics.contacts[0].wheelRadius;
      for (const { obj } of aircraft.gearDoors) assert.ok(bounds(obj).min.y > ground, 'door must stay above loaded nose tire bottom');
    }
    pose(aircraft, 0);
    for (const truck of trucks.slice(1)) {
      const wheel = truck.children.find(child => child.isGroup);
      assert.ok(Math.abs(wheel.getWorldPosition(new THREE.Vector3()).x) < 2, 'stowed hub belongs in belly bay');
    }
  });

  it('keeps every stowed main-wheel vertex below the actual fairing roof', () => {
    const aircraft = makeAircraft(profile);
    pose(aircraft, 0);
    const ray = new THREE.Raycaster();
    const point = new THREE.Vector3();
    let checked = 0;
    for (const truck of [aircraft.mainTruckL, aircraft.mainTruckR]) {
      for (const wheel of truck.children.filter(child => child.isGroup).slice(0, 2)) {
        wheel.traverse(mesh => {
          if (!mesh.isMesh) return;
          const vertices = mesh.geometry.attributes.position;
          for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld);
            ray.set(new THREE.Vector3(point.x, 10, point.z), new THREE.Vector3(0, -1, 0));
            const roof = ray.intersectObject(aircraft.gearBayGroup, true)[0];
            assert.ok(roof, 'wheel must be enclosed by a fairing roof');
            assert.ok(point.y < roof.point.y - 0.02, 'tire must not emerge through the fairing');
            checked++;
          }
        });
      }
    }
    assert.ok(checked > 100);
  });

  it('contains the stowed nose assembly behind its closed doors', () => {
    const aircraft = makeAircraft(profile);
    pose(aircraft, 0);
    const panels = aircraft.gearDoors.map(({ obj }) => obj.children[0]);
    const ray = new THREE.Raycaster();
    const point = new THREE.Vector3();
    const volume = aircraft.gearBayVolumes[0];
    let checked = 0;
    aircraft.noseGearGroup.traverse(mesh => {
      if (!mesh.isMesh) return;
      const vertices = mesh.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld);
        assert.ok(volume.containsPoint(point), 'stowed nose geometry must fit the bay volume');
        ray.set(new THREE.Vector3(point.x, -10, point.z), new THREE.Vector3(0, 1, 0));
        const door = ray.intersectObjects(panels, true)[0];
        assert.ok(door, 'stowed geometry must be covered by the closed doors');
        assert.ok(point.y > door.point.y + 0.01, 'stowed parts must not penetrate the closed door skin');
        checked++;
      }
    });
    assert.ok(checked > 100, 'check actual mesh vertices, not an empty hierarchy');
  });

  it('opens doors before folding and keeps them open until the nose leg is deployed', () => {
    const aircraft = makeAircraft(profile);
    pose(aircraft, 0.18);
    assert.equal(Math.abs(aircraft.noseGearGroup.rotation.x), Math.PI / 2);
    for (const { obj, maxAngle } of aircraft.gearDoors) assert.equal(Math.abs(obj.rotation.z), maxAngle);
    pose(aircraft, 0);
    for (const { obj } of aircraft.gearDoors) assert.equal(Math.abs(obj.rotation.z), 0);
    pose(aircraft, 1);
    assert.equal(Math.abs(aircraft.noseGearGroup.rotation.x), 0);
  });

  it('fits closed nose doors to the actual GLB skin and contains the stowed wheels above them', async () => {
    const bytes = await readFile(new URL('../public/models/b737-800.glb', import.meta.url));
    const loader = new GLTFLoader();
    loader.register(() => ({ name: 'GEOMETRY_ONLY_TEST', loadTexture: () => Promise.resolve(null) }));
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const aircraft = makeAircraft(profile);
    if (profile !== 'loaded') {
      aircraft.group.remove(aircraft.gearGroup); aircraft.buildLandingGear('loaded');
    }
    aircraft.gltfModel = gltf.scene;
    aircraft.gltfModel.rotation.y = Math.PI / 2;
    aircraft.gltfGroup.add(aircraft.gltfModel);
    aircraft.group.updateMatrixWorld(true);
    aircraft.fitNoseDoorsToSkin();
    const ray = new THREE.Raycaster();
    const panels = aircraft.gearDoors.map(({ obj }) => obj.children[0]);
    pose(aircraft, 0);
    const wheels = aircraft.noseTruck.children.filter(child => child.isGroup).slice(0, 2);
    assert.ok(Math.min(...wheels.map(wheel => bounds(wheel).min.y)) > -2.14);
    for (const x of [-0.45, -0.15, 0.15, 0.45]) for (const z of [-14.4, -13.8, -13, -12.1]) {
      ray.set(new THREE.Vector3(x, -10, z), new THREE.Vector3(0, 1, 0));
      const skin = ray.intersectObject(aircraft.gltfModel, true)[0];
      const door = ray.intersectObjects(panels, true)[0];
      assert.ok(skin && door, 'skin and door samples must exist');
      assert.ok(Math.abs(skin.point.y - door.point.y - 0.012) < 0.008, 'closed door follows skin');
    }
    const mesh = aircraft.gltfModel.getObjectByName('B737');
    cutGearBays(mesh, aircraft.group, aircraft.gearBayVolumes);
    ray.set(new THREE.Vector3(0, -10, -13.5), new THREE.Vector3(0, 1, 0));
    assert.ok(ray.intersectObject(mesh, true)[0].point.y > 0, 'nose aperture must open through the bottom skin');
    // The cutting volume must never remove the upper wing surface.
    ray.set(new THREE.Vector3(3.2, 10, 0), new THREE.Vector3(0, -1, 0));
    assert.ok(Math.abs(ray.intersectObject(mesh, true)[0].point.y - (-0.856)) < 0.01);
  });
});

describe('Bay geometry subtraction', () => {
  it('splits crossing faces, preserves material groups and interpolates UVs', () => {
    const aircraft = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    aircraft.add(mesh);
    cutGearBays(mesh, aircraft, [new THREE.Box3(new THREE.Vector3(-0.5, -1, -0.5), new THREE.Vector3(0.5, 1, 0.5))]);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(mesh).length, 0);
    ray.ray.origin.x = 1;
    const hit = ray.intersectObject(mesh)[0];
    assert.ok(hit);
    assert.ok(Math.abs(hit.uv.x - 0.75) < 1e-6);
    assert.equal(mesh.geometry.groups.reduce((sum, group) => sum + group.count, 0), mesh.geometry.attributes.position.count);
  });
});
