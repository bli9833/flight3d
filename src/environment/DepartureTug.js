import * as THREE from 'three';

/** Small reusable tow tractor, aligned to the aircraft's nose (-Z). */
export function createDepartureTug() {
  const group = new THREE.Group();
  group.name = 'departure-tug';
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf3bb32, roughness: .75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x242a30, roughness: .9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x567e91, roughness: .3 });
  const box = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  box(1.8, .65, 2.8, 0, .65, 0, yellow);
  box(1.5, .85, 1.1, 0, 1.35, -.35, glass);
  box(1.7, .12, 1.3, 0, 1.83, -.35, yellow);
  box(.12, .12, 2.5, 0, .3, 2.5, dark);
  for (const x of [-.95, .95]) for (const z of [-.9, .9]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .22, 12), dark);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(x, .35, z); group.add(wheel);
  }
  return group;
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
