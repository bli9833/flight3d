import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RenderPose } from '../src/core/RenderPose.js';

test('120Hz physics renders uniform translation and rotation across display rates', () => {
  for (const hz of [60, 90, 144, 165]) {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const pose = new RenderPose(position, quaternion);
    const mesh = new THREE.Object3D();
    const axis = new THREE.Vector3(0, 1, 0);
    const physicsDt = 1 / 120;
    let accumulator = 0, physicsTime = 0, previousX, previousRotation;
    for (let frame = 0; frame < hz * 2; frame++) {
      accumulator += 1 / hz;
      while (accumulator >= physicsDt) {
        pose.reset(position, quaternion);
        physicsTime += physicsDt;
        position.x = 230 * physicsTime;
        quaternion.setFromAxisAngle(axis, physicsTime * 0.2);
        accumulator -= physicsDt;
      }
      pose.apply(mesh, position, quaternion, accumulator / physicsDt);
      if (frame > 2) {
        assert.ok(Math.abs(mesh.position.x - previousX - 230 / hz) < 1e-9, `${hz}Hz translation`);
        assert.ok(Math.abs(mesh.quaternion.angleTo(previousRotation) - 0.2 / hz) < 1e-9, `${hz}Hz rotation`);
      }
      previousX = mesh.position.x;
      previousRotation = mesh.quaternion.clone();
    }
    assert.equal(position.x, 230 * physicsTime, 'rendering must not mutate physics');
  }
});

test('reset discards old location and attitude before a frame without a physics step', () => {
  const position = new THREE.Vector3(1, 2, 3);
  const quaternion = new THREE.Quaternion();
  const pose = new RenderPose(position, quaternion);
  position.set(5000, 3000, -2000);
  quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  pose.reset(position, quaternion);
  const mesh = new THREE.Object3D();
  for (const alpha of [0, 0.3, 1]) {
    pose.apply(mesh, position, quaternion, alpha);
    assert.ok(mesh.position.distanceTo(position) < 1e-10);
    assert.ok(mesh.quaternion.angleTo(quaternion) < 1e-7);
    assert.equal(mesh.matrixWorld.elements[12], position.x);
  }
});
