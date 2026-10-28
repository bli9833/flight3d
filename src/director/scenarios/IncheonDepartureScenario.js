import * as THREE from 'three';
import { CessnaDemoScenario } from './CessnaDemoScenario.js';
import { INCHEON_AIRFIELD } from '../../geospatial/IncheonFlightSurface.js';
import { DEPARTURE_TAXI_ROUTE, DEPARTURE_LINEUP_ROUTE, DEPARTURE_GATE } from '../../config/incheonDeparture.js';
import { createDepartureTug, disposeDepartureTug } from '../../environment/DepartureTug.js';
import { flyVerticalPath } from '../PilotControlLaws.js';
import { CameraSystem } from '../../cameras/CameraSystem.js';
import { t } from '../../i18n/index.js';

const clamp = THREE.MathUtils.clamp;
const STAGES = { GATE: 50, PUSHBACK: 51, DISCONNECT: 52, TAXI: 53, HOLD: 54, LINEUP: 55, CLEARANCE: 56, TAKEOFF: 57, COMPLETED: 58 };
const names = ['gate', 'pushback', 'disconnect', 'taxi', 'hold', 'lineup', 'clearance', 'takeoff'];
const first = DEPARTURE_TAXI_ROUTE[0];
export { DEPARTURE_GATE };

/** One gate reset; towing forces, wheel steering and flight controls thereafter. */
export class IncheonDepartureScenario extends CessnaDemoScenario {
  static STAGES = STAGES;

  enterStage(stage) {
    const sim = this.sim;
    if (stage === STAGES.GATE) {
      this.stop();
      sim.setPreset('runway', true);
      sim.position.set(DEPARTURE_GATE.x, INCHEON_AIRFIELD.elevationM + sim.gear.cgGroundHeightM, DEPARTURE_GATE.z);
      sim.linearVelocity.set(0, 0, 0);
      sim.angularVelocity.set(0, 0, 0);
      sim.quaternion.setFromEuler(new THREE.Euler(0, -DEPARTURE_GATE.heading, 0, 'YXZ'));
      sim.aircraft.group.position.copy(sim.position);
      sim.aircraft.group.quaternion.copy(sim.quaternion);
      sim.renderPose?.reset(sim.position, sim.quaternion);
      sim.aero.setFlapPosition(0);
      sim.aero.currentFlapAngle = 0;
      sim.controls.setParkingBrake(false);
      this.result = { status: 'running', airborne: false, stages: [], radio: [], taxiPoints: 0 };
      this.index = 0;
      this.settleTime = 0;
      this.force = new THREE.Vector3(); this.moment = new THREE.Vector3();
      this.tug = createDepartureTug(); sim.scene.add(this.tug);
      this.director.setTimeOfDay(9);
    }
    if (stage === STAGES.TAXI) { this.removeTug(); this.index = 0; }
    if (stage === STAGES.LINEUP) this.index = 0;
    const name = names[stage - STAGES.GATE];
    if (name) {
      this.result.stages.push(name);
      this.result.radio.push(t(`departure.radio.${name}`));
      this.director.updateBanner(() => t(`departure.stage.${name}`), () => t(`departure.radio.${name}`));
      if (!this.director.userCameraOverridden) sim.cameraSystem?.setMode(stage === STAGES.GATE || stage === STAGES.PUSHBACK
        ? CameraSystem.MODES.DRONE : CameraSystem.MODES.CHASE);
    }
    if (stage === STAGES.COMPLETED) {
      this.result.status = 'completed'; this.result.elapsedSeconds = this.director.totalTimer;
      this.director.stop(() => t('departure.complete'), false, { preserveThrottle: true });
    }
  }

  removeTug() { if (this.tug) disposeDepartureTug(this.tug); this.tug = null; }
  stop() {
    this.removeTug();
    if (this.result.status === 'running') this.result.status = 'cancelled';
  }

  towingForces() {
    if (this.director.currentStage !== STAGES.PUSHBACK || !this.sim.gear.onGround) return null;
    const sim = this.sim;
    const dx = first.x - sim.position.x, dz = first.z - sim.position.z;
    const distance = Math.hypot(dx, dz);
    const speed = Math.min(1.5, distance * .35);
    const scale = distance > .01 ? speed / distance : 0;
    const maxForce = sim.aero.mass * 1.5;
    this.force.set((dx * scale - sim.linearVelocity.x) * sim.aero.mass * 2, 0,
      (dz * scale - sim.linearVelocity.z) * sim.aero.mass * 2).clampLength(0, maxForce);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(sim.quaternion);
    // Tow straight out of the stand. Trying to yaw the main wheels sideways
    // here fights their lateral grip; the aircraft turns with nosewheel steering
    // under its own power after disconnect instead.
    const targetHeading = DEPARTURE_GATE.heading;
    const currentHeading = Math.atan2(forward.x, -forward.z);
    const error = Math.atan2(Math.sin(targetHeading - currentHeading), Math.cos(targetHeading - currentHeading));
    this.moment.set(0, (-error * 2 - sim.angularVelocity.y * 3) / sim.aero.invIzz, 0);
    return { force: this.force, moment: this.moment };
  }

  /** Follow a polyline with a short lookahead and speed reduction for turns/stops. */
  taxi(route, stopping) {
    const sim = this.sim, pos = sim.position;
    let target = route[this.index];
    let distance = Math.hypot(target.x - pos.x, target.z - pos.z);
    while (distance < 6 && this.index < route.length - 1) {
      this.index++; target = route[this.index];
      distance = Math.hypot(target.x - pos.x, target.z - pos.z);
    }
    const bearing = Math.atan2(target.x - pos.x, -(target.z - pos.z)) * 180 / Math.PI;
    const error = ((bearing - sim.telemetry.headingDeg + 540) % 360) - 180;
    const final = this.index === route.length - 1;
    const speed = Math.hypot(sim.linearVelocity.x, sim.linearVelocity.z);
    const desired = final && stopping ? Math.min(4, distance * .35) : Math.abs(error) > 25 ? 2.5 : 6;
    sim.controls.setVirtualInput('rudder', clamp(error * .045 + sim.angularVelocity.y * 1.8, -.85, .85));
    sim.controls.setVirtualInput('throttle', clamp(.12 + (desired - speed) * .13, 0, .4));
    sim.controls.setVirtualInput('brakes', speed > desired + .3 ? clamp((speed - desired) * .4, 0, 1) : 0);
    if (final && distance < 3) {
      sim.controls.setVirtualInput('throttle', 0);
      sim.controls.setVirtualInput('brakes', 1);
      return speed < .4;
    }
    return false;
  }

  update(dt) {
    const sim = this.sim, d = this.director, stage = d.currentStage;
    sim.controls.setVirtualInput('throttle', 0);
    sim.controls.setVirtualInput('brakes', 1);
    sim.controls.setVirtualInput('elevator', 0);
    sim.controls.setVirtualInput('aileron', 0);
    sim.controls.setVirtualInput('rudder', 0);
    if (this.tug) {
      this.tug.position.set(0, -sim.gear.cgGroundHeightM, -6).applyQuaternion(sim.quaternion).add(sim.position);
      this.tug.quaternion.copy(sim.quaternion);
    }
    if (stage === STAGES.GATE && d.stageTimer > 6) d.setStage(STAGES.PUSHBACK);
    else if (stage === STAGES.PUSHBACK) {
      sim.controls.setVirtualInput('brakes', 0);
      const stopped = Math.hypot(sim.position.x - first.x, sim.position.z - first.z) < .7 && sim.linearVelocity.length() < .3;
      this.settleTime = stopped ? this.settleTime + dt : 0;
      if (this.settleTime > 1) d.setStage(STAGES.DISCONNECT);
    } else if (stage === STAGES.DISCONNECT && d.stageTimer > 6) d.setStage(STAGES.TAXI);
    else if (stage === STAGES.TAXI) {
      if (this.taxi(DEPARTURE_TAXI_ROUTE, true)) d.setStage(STAGES.HOLD);
      this.result.taxiPoints = this.index;
    } else if (stage === STAGES.HOLD && d.stageTimer > 8) d.setStage(STAGES.LINEUP);
    else if (stage === STAGES.LINEUP) {
      if (this.taxi(DEPARTURE_LINEUP_ROUTE, true) && Math.abs(((INCHEON_AIRFIELD.approach.headingDeg - sim.telemetry.headingDeg + 540) % 360) - 180) < 8) d.setStage(STAGES.CLEARANCE);
    } else if (stage === STAGES.CLEARANCE && d.stageTimer > 6) d.setStage(STAGES.TAKEOFF);
    else if (stage === STAGES.TAKEOFF) {
      const runwayHeading = INCHEON_AIRFIELD.approach.headingDeg;
      const error = ((runwayHeading - sim.telemetry.headingDeg + 540) % 360) - 180;
      sim.controls.setVirtualInput('brakes', 0);
      sim.controls.setVirtualInput('throttle', 1);
      if (sim.gear.onGround) sim.controls.setVirtualInput('rudder', clamp(error * .04, -.4, .4));
      else this.holdHeading(runwayHeading, 5);
      if (sim.telemetry.iasKnots >= 55) flyVerticalPath(sim, 3, 78, sim.telemetry, 0, 9);
      sim.controls.setVirtualInput('throttle', 1);
      const height = sim.position.y - INCHEON_AIRFIELD.elevationM;
      if (!sim.gear.onGround && height > 15) this.result.airborne = true;
      if (this.result.airborne && height > 80) d.setStage(STAGES.COMPLETED);
    }
    if (d.stageTimer > 1500 || d.totalTimer > 1800) {
      this.result.status = 'failed'; this.result.reason = 'Guidance timeout';
      d.stop(() => t('departure.failed'));
    }
  }
}
