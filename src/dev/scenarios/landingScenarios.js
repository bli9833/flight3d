import * as THREE from 'three';

// SI units. Based on the landing acceptance harness. Single-main-gear failures
// start at 30 m/s: at 40 m/s the asymmetric contact exits the runway before rest.
export const LANDING_CASES = {
  normal: { setup: [1, 4, 1], duration: 10, check: 'normal' },
  hard: { setup: [1, 3.9, 11], duration: 3, check: 'collapse' },
  asymmetric: { setup: [1, 3.9, 11, 0.1], duration: 1 / 120, check: 'asymmetric' },
  unlocked: { setup: [0.8, 3, 2], duration: 3, check: 'collapse' },
  'left-collapse': { setup: [1, 3.5, 0, 0, ['mainLeft'], 30], duration: 35, check: 'stop' },
  'right-collapse': { setup: [1, 3.5, 0, 0, ['mainRight'], 30], duration: 35, check: 'stop' },
  'both-collapse': { setup: [1, 3.5, 0, 0, ['mainLeft', 'mainRight']], duration: 40, check: 'stop' },
  'nose-collapse': { setup: [1, 3.5, 0, 0, ['nose'], 30], duration: 30, check: 'stop' },
  belly: { setup: [0, 3.3, 1], duration: 40, check: 'stop' },
  catastrophic: { setup: [0, 3, 20], duration: 1, check: 'crash' },
};

export function setupLanding(sim, [gear, y, sink, roll = 0, failed = [], speed = 60, pitch = 0]) {
  sim.controls.throttle = 0;
  sim.engines.n1.fill(22); sim.engines.n2.fill(62);
  sim.engines.egt.fill(420); sim.engines.fuelFlow.fill(350);
  sim.controls.setParkingBrake(false);
  sim.controls.virtualBrakes = 1;
  sim.autopilot.disengage();
  sim.gear.gearState = gear;
  sim.gear.targetGearState = gear > 0 ? 1 : 0;
  sim.position.set(-1000, sim.currentTerrain.getHeight(-1000, 0) + y, 0);
  for (const c of sim.gear.contacts) {
    if (failed.includes(c.id)) { c.damage = 1; c.damageState = 'collapsed'; }
  }
  sim.quaternion.setFromEuler(new THREE.Euler(pitch, -Math.PI / 2, roll, 'YXZ'));
  sim.linearVelocity.set(speed, -sink, 0);
  sim.angularVelocity.set(0, 0, 0);
}

export function landingVerdict(kind, observation) {
  if (kind === 'crash') return observation.crashed;
  if (kind === 'normal') return !observation.crashed && !observation.damaged;
  if (kind === 'collapse') return observation.collapsed > 0;
  if (kind === 'asymmetric') return observation.collapsed === 1;
  return !observation.crashed && observation.bodyContact && observation.bodyDamage
    && observation.stopped && observation.speed < 0.5;
}
