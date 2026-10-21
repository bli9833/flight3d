import { Vector3, Quaternion } from 'three';

// Render one physics step behind, interpolating only the displayed transform.
// Physics, collisions and telemetry always retain the current fixed-step state.
export class RenderPose {
  constructor(position, quaternion) {
    this.previousPosition = new Vector3();
    this.previousQuaternion = new Quaternion();
    this.reset(position, quaternion);
  }

  reset(position, quaternion) {
    this.previousPosition.copy(position);
    this.previousQuaternion.copy(quaternion);
  }

  apply(target, position, quaternion, alpha) {
    const fraction = Math.max(0, Math.min(1, alpha));
    target.position.lerpVectors(this.previousPosition, position, fraction);
    target.quaternion.slerpQuaternions(this.previousQuaternion, quaternion, fraction);
    target.updateMatrixWorld(true);
  }
}
