import { SIM_CONFIG } from '../config/simConfig.js';

export function clampFrameDelta(delta) {
  return Number.isFinite(delta) ? Math.max(0, Math.min(SIM_CONFIG.physics.maxFrameDelta, delta)) : 0;
}

export function stepPhysics(simulation) {
  if (simulation.devRunner?.blocksPhysics) return;
  if (simulation.demoDirector?.isActive) {
    simulation.demoDirector.update(simulation.physicsDt);
  }
  simulation.renderPose.reset(simulation.position, simulation.quaternion);
  simulation.devRunner?.beforePhysics();
  simulation.integratePhysics(simulation.physicsDt);
  simulation.devRunner?.afterPhysics(simulation.physicsDt);
}

export function advancePhysicsFrame(simulation, delta) {
  simulation.physicsAccumulator += clampFrameDelta(delta);
  while (simulation.physicsAccumulator >= simulation.physicsDt) {
    stepPhysics(simulation);
    simulation.physicsAccumulator -= simulation.physicsDt;
    if (simulation.devRunner?.blocksPhysics) { simulation.physicsAccumulator = 0; break; }
  }
}
