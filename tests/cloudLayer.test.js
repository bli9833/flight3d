import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CloudLayer, createCloudAtlas } from '../src/environment/CloudLayer.js';
import { SkyAtmosphere } from '../src/environment/SkyAtmosphere.js';

test('atlas is reproducible, has four distinct shapes and transparent gutters', () => {
  const a = createCloudAtlas(64);
  const b = createCloudAtlas(64);
  assert.deepEqual(a.image.data, b.image.data);
  const shapes = [];
  for (let tile = 0; tile < 4; tile++) {
    const alpha = [];
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const value = a.image.data[(y * 256 + tile * 64 + x) * 4 + 3];
        if (x === 0 || x === 63 || y === 0 || y === 63) assert.equal(value, 0);
        alpha.push(value);
      }
    }
    assert.ok(alpha.some(v => v > 200));
    assert.ok(alpha.some(v => v > 0 && v < 100));
    shapes.push(alpha.join(','));
  }
  assert.equal(new Set(shapes).size, 4);
  a.dispose(); b.dispose();
});

test('clouds stay bounded, preserve departure corridor, and sort with tile identity per camera', () => {
  const layer = new CloudLayer();
  assert.ok(layer.count > 150 && layer.count <= 180);
  const camera = new THREE.PerspectiveCamera();
  for (const cloud of layer.clouds) {
    assert.ok(Math.abs(cloud.position.x) >= 4000 || Math.abs(cloud.position.z) >= 2500);
    assert.ok(cloud.position.y >= 2800 && cloud.position.y <= 3600);
  }
  for (const [x, y, z] of [[0, 0, 0], [12000, 5000, -4000], [-8000, 7000, 3000]]) {
    layer.position.y = y === 7000 ? 3400 : 0;
    layer.updateMatrixWorld(true);
    camera.position.set(x, y, z);
    camera.lookAt(0, 3200, 0);
    camera.updateMatrixWorld(true);
    layer.sortForCamera(camera);
    for (let i = 0; i < layer.count; i++) {
      if (i) assert.ok(layer.clouds[i - 1].depth <= layer.clouds[i].depth);
      assert.equal(layer.tiles.getX(i), layer.clouds[i].tile);
      const matrix = new THREE.Matrix4();
      layer.getMatrixAt(i, matrix);
      assert.ok(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(layer.clouds[i].position) < 0.002);
    }
  }
  layer.dispose();
});

test('cloud lighting follows day, sunset, night and repeated airport changes', () => {
  const sky = new SkyAtmosphere(new THREE.Scene());
  const brightness = hour => {
    sky.setTimeOfDay(hour);
    const u = sky.cloudLayer.material.uniforms;
    return u.sunColor.value.r + u.ambientColor.value.r;
  };
  const noon = brightness(12);
  sky.setTimeOfDay(18);
  const sunset = sky.cloudLayer.material.uniforms.sunColor.value;
  assert.ok(sunset.r > sunset.b * 2);
  assert.ok(brightness(0) < noon * 0.1);
  for (const airport of ['lukla', 'coastal', 'lukla', 'incheon']) {
    sky.setAirport(airport);
    assert.equal(sky.cloudsGroup.position.y, airport === 'lukla' ? 3400 : 0);
    assert.equal(sky.cloudsGroup.children.length, 1);
  }
  sky.cloudLayer.dispose();
});
