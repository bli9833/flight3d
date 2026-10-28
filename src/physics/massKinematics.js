import * as THREE from 'three';
const offset = new THREE.Vector3();
const delta = new THREE.Vector3();

/** Preserve the structural velocity field when the instantaneous CG changes.
 * Quasi-static redistribution; no internal motion/slosh impulse. */
export function rebaseCgVelocity(velocity, omegaBody, quaternion, oldCg, newCg) {
  delta.set(newCg.x - oldCg.x, newCg.y - oldCg.y, newCg.z - oldCg.z);
  offset.copy(omegaBody).cross(delta).applyQuaternion(quaternion);
  velocity.add(offset);
}

/** position remains the structural model origin, velocity denotes the CG. */
export function translateModelOrigin(position, velocityCg, oldQuaternion, newQuaternion, cg, dt) {
  position.addScaledVector(velocityCg, dt);
  offset.copy(cg).applyQuaternion(oldQuaternion);
  position.add(offset);
  offset.copy(cg).applyQuaternion(newQuaternion);
  position.sub(offset);
}
