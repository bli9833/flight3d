import * as THREE from 'three';

/** Small reusable tow tractor, aligned to the aircraft's nose (-Z). */
export function createDepartureTug() {
  const group = new THREE.Group();
  group.name = 'departure-tug';
  group.scale.set(1.6, 1.3, 1.6);
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf3bb32, roughness: .75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x242a30, roughness: .9 });
  const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0xffa52a, emissive: 0xff8800, emissiveIntensity: .4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x567e91, roughness: .3 });
  const box = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  box(1.8, .65, 2.8, 0, .65, 0, yellow);
  box(1.5, .85, 1.1, 0, 1.35, -.35, glass);
  box(1.7, .12, 1.3, 0, 1.83, -.35, yellow);
  const towbar = box(.12, .12, 2.5, 0, .3, 2.5, dark);
  towbar.name = 'tug-towbar';
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.17,.17,.2,12), beaconMaterial);
  beacon.position.set(0,2.01,-.35);group.add(beacon);
  const wheels = [];
  const lamps = new THREE.MeshStandardMaterial({color:0xfff5cf,emissive:0xffe6a1,emissiveIntensity:.8});
  for (const x of [-.6,.6]) box(.3,.18,.08,x,.85,-1.43,lamps);
  for (const x of [-.95, .95]) for (const z of [-.9, .9]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .22, 12), dark);
    const axle = new THREE.Group(); axle.position.set(x,.35,z);
    wheel.rotation.z = Math.PI / 2; axle.add(wheel);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(.04,.42,.08),yellow);
    spoke.position.x = Math.sign(x)*.14; axle.add(spoke);
    group.add(axle); wheels.push(axle);
  }
  group.userData.animation = { wheels, towbar, beacon, elapsed: 0,
    previous: new THREE.Vector3(), initialized: false, detached: false, detachedSeconds: 0 };
  return group;
}

/** Attached tractor follows the tow point; after uncoupling it drives clear. */
export function updateDepartureTug(group, sim, dt, detached, stageTime) {
  const state = group.userData.animation;
  state.elapsed += dt;
  if (!state.initialized || !detached) {
    group.position.set(0, -sim.gear.cgGroundHeightM, -18.5).applyQuaternion(sim.quaternion).add(sim.position);
    group.quaternion.copy(sim.quaternion);
    if (!state.initialized) state.previous.copy(group.position);
    state.initialized = true;
  }
  state.detached = detached;
  if (detached) {
    state.detachedSeconds += dt;
    // First retract the coupling; then move ahead and turn away from the taxi path.
    const progress = THREE.MathUtils.clamp((stageTime - .5) / 1.5, 0, 1);
    state.towbar.scale.z = 1 - progress;
    state.towbar.visible = progress < 1;
    if (stageTime > 2 && state.detachedSeconds < 10) {
      group.rotateY(-.12 * dt);
      group.position.addScaledVector(new THREE.Vector3(0,0,-1).applyQuaternion(group.quaternion), Math.min(3, (stageTime - 2) * 1.5) * dt);
    }
  }
  const forward = new THREE.Vector3(0,0,-1).applyQuaternion(group.quaternion);
  const travel = group.position.clone().sub(state.previous).dot(forward);
  for (const axle of state.wheels) axle.rotateX(-travel / (.35 * 1.3));
  state.beacon.material.emissiveIntensity = .3 + 2 * Math.max(0, Math.sin(state.elapsed * 8));
  state.previous.copy(group.position);
}

export function disposeDepartureTug(group) {
  const materials = new Set();
  group.removeFromParent();
  group.traverse(node => {
    node.geometry?.dispose();
    if (node.material) materials.add(node.material);
  });
  materials.forEach(material => material.dispose());
}
