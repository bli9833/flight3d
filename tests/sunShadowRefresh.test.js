import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SunShadowRefresh } from '../src/environment/SunShadowRefresh.js';

/**
 * A sun over one box, with the refresh answering the question three would otherwise ask
 * every frame. `rebuild()` stands in for a render: it clears the flag the way the shadow
 * pass does, asks the refresh, and checks that the two agree.
 */
function rig() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.castShadow = true;
  light.position.set(0, 600, 0);
  const caster = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  caster.castShadow = true;
  caster.position.set(2, 3, 4);
  scene.add(light, light.target, caster);
  const refresh = new SunShadowRefresh(light);
  light.shadow.autoUpdate = false;
  // The renderer only allocates a real target on the first pass; this test needs a truthy
  // placeholder so the "nothing to reuse" branch stays out of the way.
  light.shadow.map = { dispose() {} };
  const rebuild = () => {
    light.shadow.needsUpdate = false;
    const needed = refresh.beforeRender(scene, camera);
    assert.equal(light.shadow.needsUpdate, needed, 'The flag must match the answer');
    return needed;
  };
  return { scene, camera, light, caster, refresh, rebuild };
}

describe('SunShadowRefresh', () => {
  it('rebuilds until it has a map of its own, then reuses it', () => {
    const { scene, light, caster, refresh, rebuild } = rig();
    assert.equal(rebuild(), true, 'Nothing has been recorded yet');
    assert.equal(rebuild(), true, 'The casters were only now sampled');
    assert.equal(rebuild(), false, 'An identical scene must not rebuild');
    caster.position.set(2, 3, 4.5);
    caster.updateMatrixWorld(true);
    assert.equal(rebuild(), true, 'A moved caster changes the map');
    assert.equal(rebuild(), false, 'And settles again');
    light.shadow.map = null;
    assert.equal(rebuild(), true, 'A disposed map must rebuild');
    light.shadow.map = { dispose() {} };
    assert.equal(rebuild(), true, 'A fresh target is filled before it can be reused');
    assert.equal(rebuild(), false, 'And then it is reused');
    refresh.invalidate();
    assert.equal(rebuild(), true, 'invalidate() forces the next pass');
    assert.equal(rebuild(), false, 'And only the next one');
  });

  it('rebuilds when a caster hides, appears or changes geometry', () => {
    const { scene, caster, rebuild } = rig();
    rebuild();
    rebuild();
    caster.visible = false;
    assert.equal(rebuild(), true, 'Hiding a caster changes the map');
    caster.visible = true;
    assert.equal(rebuild(), true, 'Showing it again changes the map');
    rebuild();

    const extra = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    extra.castShadow = true;
    scene.add(extra);
    assert.equal(rebuild(), true, 'A new caster changes the map');
    rebuild();
    extra.geometry = new THREE.SphereGeometry(0.5);
    assert.equal(rebuild(), true, 'Swapped geometry changes the map');
  });

  it('rebuilds when the light or its box changes even with frozen casters', () => {
    const { light, rebuild } = rig();
    rebuild();
    rebuild();
    light.position.set(0, 600, 40);
    assert.equal(rebuild(), true, 'A new sun direction changes the projection');
    rebuild();
    light.target.position.set(10, 0, 0);
    assert.equal(rebuild(), true, 'A moved focus changes the projection');
    rebuild();
    light.shadow.camera.right = 64;
    assert.equal(rebuild(), true, 'A wider ortho box changes what is rendered');
    rebuild();
    light.shadow.bias = -0.0001;
    assert.equal(rebuild(), true, 'A new bias must re-encode the depth pass');
    assert.equal(rebuild(), false, 'Settling again stops the rebuilds');
  });

  it('leaves the pass alone to three while autoUpdate is on', () => {
    const { scene, light, caster, rebuild } = rig();
    rebuild();
    rebuild();
    light.shadow.autoUpdate = true;
    assert.equal(rebuild(), true, 'Three rebuilds it every frame anyway');
    assert.equal(light.shadow.needsUpdate, true, 'And the flag says so');
    assert.equal(rebuild(), true, 'Still no reuse while three owns the pass');
    light.shadow.autoUpdate = false;
    assert.equal(rebuild(), true, 'Handing the pass back re-learns the casters');
    caster.position.set(2, 3, 4);
    caster.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    assert.equal(rebuild(), false, 'Nothing moved while it was switched off');
  });

  it('ignores nodes that cannot cast into the map', () => {
    const { scene, caster, rebuild } = rig();
    rebuild();
    rebuild();
    const listener = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    scene.add(listener);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    receiver.receiveShadow = true;
    scene.add(receiver);
    receiver.position.set(9, 9, 9);
    receiver.updateMatrixWorld(true);
    assert.equal(rebuild(), false, 'A non-caster must not force a rebuild');

    caster.castShadow = false;
    assert.equal(rebuild(), true, 'Dropping a caster from the pass changes the map');
    caster.castShadow = true;
    assert.equal(rebuild(), true, 'Restoring it changes the map again');
  });

  it('detects motion hidden behind an invisible ancestor', () => {
    const { scene, rebuild } = rig();
    rebuild();
    rebuild();
    const sealed = new THREE.Group();
    sealed.visible = false;
    const buried = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    buried.castShadow = true;
    sealed.add(buried);
    scene.add(sealed);
    assert.equal(rebuild(), false, 'A hidden subtree contributes nothing');
    buried.position.set(5, 5, 5);
    buried.updateMatrixWorld(true);
    assert.equal(rebuild(), false, 'Motion inside a hidden subtree stays ignored');
    sealed.visible = true;
    assert.equal(rebuild(), true, 'Revealing it changes the map');
  });

  it('detects an instanced caster repopulated without moving its mesh', () => {
    const { scene, rebuild } = rig();
    rebuild();
    rebuild();
    const crown = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 8);
    crown.castShadow = true;
    crown.count = 0;
    scene.add(crown);
    assert.equal(rebuild(), true, 'A new batch changes the map');
    crown.count = 5;
    crown.instanceMatrix.needsUpdate = true;
    assert.equal(rebuild(), true, 'Drawing more instances changes the map');
    crown.count = 5;
    assert.equal(rebuild(), false, 'Re-sampling the same batch stays quiet');
  });

  it('absorbs contact jitter and rebuilds once the drift is visible', () => {
    const { caster, rebuild } = rig();
    rebuild();
    rebuild();
    caster.position.x += 1e-5;
    caster.updateMatrixWorld(true);
    assert.equal(rebuild(), false, 'Noise far below a texel must not rebuild');
    // Drift is compared against the pose the on-screen map was built from, not the previous
    // frame, so a slow creep cannot stay invisible by keeping each step small.
    let quiet = 0;
    for (let frame = 0; frame < 60; frame++) {
      caster.position.x += 1e-5;
      caster.updateMatrixWorld(true);
      if (!rebuild()) quiet++;
    }
    assert.ok(quiet < 60, 'A creep that adds up has to rebuild');
    caster.position.x += 0.02;
    caster.updateMatrixWorld(true);
    assert.equal(rebuild(), true, 'Two centimetres is most of a texel');
  });

  it('settles a frame in motion from the light alone', () => {
    const { scene, camera, light, caster, refresh, rebuild } = rig();
    rebuild();
    rebuild();
    rebuild();
    let walks = 0;
    const traverse = scene.traverse.bind(scene);
    scene.traverse = visit => { walks++; return traverse(visit); };
    light.position.set(0, 600, 20);
    caster.position.set(9, 9, 9);
    assert.equal(refresh.beforeRender(scene, camera), true, 'A moving light means a new map');
    assert.equal(walks, 0, 'The header settles flight without walking the scene graph');
  });

  it('rebuilds when the view camera stops seeing a caster', () => {
    const { camera, rebuild } = rig();
    rebuild();
    rebuild();
    // three gates the sun pass on the camera being rendered with, not on the shadow box, so
    // a camera that starts or stops seeing a layer changes which casters are in the map
    // without moving the light, the box, or a single mesh.
    camera.layers.set(5);
    assert.equal(rebuild(), true, 'A camera that no longer sees the caster changes the pass');
    camera.layers.enable(0);
    assert.equal(rebuild(), true, 'And seeing it again changes it back');
    assert.equal(rebuild(), false, 'Settling again stops the rebuilds');
  });
});
