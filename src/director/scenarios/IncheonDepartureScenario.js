import * as THREE from 'three';
import { CameraSystem } from '../../cameras/CameraSystem.js';

/** Scripted ground handling, followed by the simulator's normal takeoff physics. */
export class IncheonDepartureScenario {
  static STAGES = { IDLE: -1, BOARDING: 0, BRIDGE: 1, PUSHBACK: 2, TAXI: 3, HOLD: 4, LINEUP: 5, TAKEOFF: 6, CLIMB: 7, COMPLETED: 8 };
  constructor(director, sim) { this.director = director; this.sim = sim; }
  get controlsGround() { return this.director.isActive && this.director.currentStage < 6; }

  enterStage(stage) {
    const s = this.sim;
    const messages = [
      ['탑승층 · Gate 101 승객 탑승', '인천공항 간략화 훈련장 · 실제 배치/방위와 다름 · 탑승교로 승객 이동'],
      ['탑승 완료 · 탑승교 분리', '운항팀: 도어 닫힘, 탑승교 분리 중. 푸시백 준비.'],
      ['푸시백 승인', 'ICN Ground: KOREAN 101, pushback approved. / 조종사: Pushback approved, KOREAN 101.'],
      ['유도로 A 지상활주', 'ICN Ground: Taxi via Alpha, hold short runway 09L. / 조종사: Alpha, hold short 09L.'],
      ['활주로 대기선 · 관제탑 교신', 'ICN Tower: KOREAN 101, hold short, departing traffic. / 조종사: Holding short.'],
      ['진입 및 정대', 'ICN Tower: Runway 09L, line up and wait. / 조종사: Line up and wait, 09L.'],
      ['이륙 허가 · 이륙 활주', 'ICN Tower: Wind calm, runway 09L cleared for takeoff. / 조종사: Cleared for takeoff, 09L.'],
      ['로테이션 · 초기 상승', '조종사: Positive climb, gear up. / ICN Tower: Contact departure. Good day.'],
    ];
    if (stage === 0) {
      s.controls.clearVirtualInputs?.();
      s.apMaster = false;
      s.setPreset('runway', true);
      s.incheonAirport.tug.visible = false;
      s.incheonAirport.setBridgeRetraction(0);
      s.incheonAirport.setBoardingProgress(0);
      s.cameraSystem.setMode(CameraSystem.MODES.DRONE);
      s.cameraSystem.resetDroneOrbit?.(-Math.PI * 0.45, 65, 24);
      s.controls.setParkingBrake?.(false);
      this.pose(-90, 240, Math.PI / 2);
    }
    if (messages[stage]) this.director.updateBanner(`[${stage + 1}/8] ${messages[stage][0]}`, messages[stage][1]);
    if (stage === 3 || stage === 6) s.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
    if (stage === 6) {
      s.incheonAirport.tug.visible = false;
      s.controls.setVirtualInput('brakes', 0);
      s.gear.setBrakes(0);
      s.controls.setVirtualInput('throttle', 1);
      s.engines.setThrottle(1);
    }
    if (stage === 8) this.director.stop('인천 출발 완료 · 직접 조종으로 전환합니다.', false, { preserveThrottle: true });
  }

  pose(x, z, yaw, speed = 0) {
    const s = this.sim;
    s.position.set(x, s.currentTerrain.getHeight(x, z) + 3.5, z);
    s.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    s.linearVelocity.set(-Math.sin(yaw) * speed, 0, -Math.cos(yaw) * speed);
    s.angularVelocity.set(0, 0, 0);
    Object.assign(s.telemetry, { onGround: true, iasKnots: 0, groundSpeedKnots: Math.abs(speed) * 1.94384, pitchDeg: 0, rollDeg: 0, headingDeg: (360 - yaw * 180 / Math.PI) % 360, altitudeFt: s.position.y * 3.28084, radioAltFt: 0, vsiFpm: 0, gearState: 1, gForce: 1, isStalled: false, touchdown: false });
  }

  update(dt) {
    const s = this.sim, t = this.director.stageTimer, stage = this.director.currentStage;
    const durations = [10, 6, 16, 100, 8, 14];
    const p = Math.min(1, t / durations[stage]);
    if (this.controlsGround) {
      s.controls.setVirtualInput('throttle', 0);
      s.controls.setVirtualInput('elevator', 0);
      s.controls.setVirtualInput('aileron', 0);
      s.controls.setVirtualInput('rudder', 0);
      s.controls.setVirtualInput('brakes', 1);
      s.engines.setThrottle(0);
      if (stage <= 1) this.pose(-90, 240, Math.PI / 2);
      if (stage === 0) s.incheonAirport.setBoardingProgress(p);
      if (stage === 1) s.incheonAirport.setBridgeRetraction(p);
      if (stage === 2) {
        this.pose(-90 + 65 * p, 240, Math.PI / 2, -65 / 16);
        s.incheonAirport.tug.visible = true;
        s.incheonAirport.tug.position.set(s.position.x - 23, 12, 240);
      }
      // Apron to parallel taxiway, west to the holding point.
      if (stage === 3) {
        const points = [[-25,240], [15,200], [15,140], [-25,100], [-1250,100], [-1350,70]];
        const lengths = [57,60,57,1225,104];
        let distance = p * lengths.reduce((a,b) => a+b, 0), i = 0;
        while (i < lengths.length - 1 && distance > lengths[i]) distance -= lengths[i++];
        const a = points[i], b = points[i+1], q = distance / lengths[i];
        const yaw = Math.atan2(-(b[0]-a[0]), -(b[1]-a[1]));
        const previousYaw = i === 0 ? Math.PI/2 : Math.atan2(-(a[0]-points[i-1][0]), -(a[1]-points[i-1][1]));
        const turn = Math.atan2(Math.sin(yaw-previousYaw), Math.cos(yaw-previousYaw));
        let taxiYaw = previousYaw + turn*Math.min(1, distance/25);
        if (i === lengths.length - 1) {
          const arrivalTurn = THREE.MathUtils.clamp((distance - (lengths[i]-25))/25, 0, 1);
          taxiYaw *= 1-arrivalTurn;
        }
        this.pose(a[0]+(b[0]-a[0])*q, a[1]+(b[1]-a[1])*q, taxiYaw, 15);
        s.incheonAirport.tug.visible = false;
      }
      if (stage === 4) this.pose(-1350,70,0);
      if (stage === 5) {
        // Continuous curved lead-in finishing eastbound at the runway start.
        const angle = p * Math.PI / 2;
        this.pose(-1350 + 70 * (1-Math.cos(angle)), 70 - 70*Math.sin(angle), -angle, 7.85);
      }
      if (p >= 1) this.director.setStage(stage + 1);
      return;
    }
    if (stage === 6 && s.telemetry.iasKnots >= 132) this.director.setStage(7);
    if (stage === 7) {
      const tel = s.telemetry;
      const pitchRate = THREE.MathUtils.radToDeg(s.angularVelocity.x);
      s.controls.setVirtualInput('elevator', tel.onGround ? 0.65 : THREE.MathUtils.clamp(0.18 + (12-tel.pitchDeg)*0.035-pitchRate*0.02, 0.08, 0.35));
      s.controls.setVirtualInput('aileron', THREE.MathUtils.clamp(-tel.rollDeg*0.035 + THREE.MathUtils.radToDeg(s.angularVelocity.z)*0.02, -0.2, 0.2));
      if (!tel.onGround && tel.radioAltFt > 30) s.gear.setGearTarget(false);
      if (tel.radioAltFt > 500) this.director.setStage(8);
    }
  }

  stop() { this.sim.incheonAirport.tug.visible = false; }
}
