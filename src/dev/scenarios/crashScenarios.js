import * as THREE from 'three';

/** Real approach fixtures: CollisionDetector, rather than this setup, decides the crash. */
export function setupCrash(sim, type) {
  sim.controls.throttle = 0;
  sim.autopilot.disengage();
  sim.angularVelocity.set(0, 0, 0);
  sim.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  if (type === 'TOWER') {
    sim.position.set(120, 65, 360);
    sim.linearVelocity.set(0, 0, -85);
    sim.quaternion.identity();
  } else if (type === 'WATER') {
    sim.position.set(400, 5, 4200);
    sim.linearVelocity.set(60, -22, 0);
  } else if (type === 'BUILDING') {
    const b = sim.foliage.buildingData.find(item => item.height > 60);
    if (!b) throw new Error('No building fixture');
    const x = b.x - 45;
    sim.position.set(x, Math.max(sim.terrain.getHeight(x, b.z) + 15, b.y + b.height * .5), b.z);
    sim.linearVelocity.set(75, 0, 0);
  } else if (type === 'TREE') {
    const tree = sim.foliage.treeData.find(item => item.height > 10
      && Math.abs(sim.terrain.getHeight(item.x - 15, item.z) - sim.terrain.getHeight(item.x, item.z)) < .3);
    if (!tree) throw new Error('No tree fixture');
    sim.position.set(tree.x - 12, tree.y + tree.height * .65, tree.z);
    sim.linearVelocity.set(55, 0, 0);
  } else {
    let site;
    for (let z = -6000; z <= -1500 && !site; z += 100) {
      for (let x = -7000; x <= 7000; x += 100) {
        const h = sim.terrain.getHeight(x, z);
        if (h > 120 && sim.terrain.getHeight(x + 17.5, z) > h + 8
          && !sim.foliage.treeData.some(t => Math.hypot(t.x - x, t.z - z) < 60)
          && !sim.foliage.buildingData.some(b => Math.hypot(b.x - x, b.z - z) < 100)) {
          site = { x, y: h + 4, z }; break;
        }
      }
    }
    if (!site) throw new Error('No unobstructed terrain fixture');
    sim.position.set(site.x, site.y, site.z);
    sim.linearVelocity.set(90, 0, 0);
  }
}
