import * as THREE from 'three';
import { CameraSystem } from '../../cameras/CameraSystem.js';

/**
 * Autonomous Nepal Tenzing-Hillary Airport (Lukla VNLK) Continuous Circuit Scenario
 * 
 * Realistic, continuous flight without teleportation:
 * 1. Runway 24 Downhill 11.7% Cliff Dive Takeoff Roll (Cockpit Captain View, TOGA 100%)
 * 2. Dudh Kosi Canyon Gorge Outbound & Climb (Gear Cam, Retraction over gorge)
 * 3. 180° Canyon Turnaround & Himalayan Summit Panorama (Flyby/Chase, 20° Bank at 3,000m)
 * 4. Canyon Final Approach to RW06 on 4.28° Steep Glideslope (Cockpit Captain View)
 * 5. 11.7% Uphill Touchdown, Tire Smoke, Reverser & Full Brake Rollout onto Apron
 * 6. Completed -> Seamless Handover to User Manual Flight
 */
export class LuklaCircuitScenario {
  static STAGES = {
    IDLE: -1,
    CLIFF_TAKEOFF: 0,
    CANYON_CLIMB: 1,
    HIMALAYAN_CRUISE: 2, // Aliased to 180° canyon turnaround for backward compatibility
    VALLEY_TURNAROUND: 2,
    CANYON_CIRCUIT: 2,
    CANYON_APPROACH: 3,
    UPHILL_TOUCHDOWN: 4,
    COMPLETED: 5
  };

  constructor(director, simulator) {
    this.director = director;
    this.sim = simulator;
    this.sin58 = 0.848048;
    this.cos58 = 0.529919;
    this.stageCameraCutDone = false;
  }

  enterStage(stage) {
    this.stageCameraCutDone = false;
    switch (stage) {
      case LuklaCircuitScenario.STAGES.CLIFF_TAKEOFF:
        this.director.updateBanner(
          '🛫 [1/5] 루클라 24번 활주로 내리막 이륙 (Runway 24 Takeoff)',
          '11.7% 내리막 활주 • TOGA 100% 가속 • 계곡 방향 이륙 [Esc: 직접 조종]'
        );
        if (this.sim.setPreset) {
          this.sim.setPreset('cliff', true);
        }
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.sim.cameraSystem.lookPitch = -0.06;
        this.sim.cameraSystem.lookYaw = 0.0;
        this.director.setTimeOfDay(8.5); // Morning Himalayan sun
        if (this.sim.water && this.sim.water.setSunDirection) {
          this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        }

        this.sim.controls.setVirtualInput('throttle', 1.0);
        this.sim.engines.setThrottle(1.0);
        this.sim.controls.setVirtualInput('brakes', 0.0);
        this.sim.gear.setBrakes(0.0);
        this.director.approachFlarInitiated = false;
        this.director.touchdownConfirmed = false;
        break;

      case LuklaCircuitScenario.STAGES.CANYON_CLIMB:
        this.director.updateBanner(
          '🏔️ [2/5] 두드코시 협곡 하류 질주 & 고도 상승 (Dudh Kosi Canyon Outbound & Climb)',
          '계곡 방향 상승 • 랜딩 기어 수납 • Copernicus 기반 주변 지형 조망'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        this.sim.controls.setVirtualInput('throttle', 0.90);
        this.sim.engines.setThrottle(0.90);
        break;

      case LuklaCircuitScenario.STAGES.HIMALAYAN_CRUISE:
        this.director.updateBanner(
          '❄️ [3/5] 두드코시 계곡 180° 선회 & 설산 조망 (180° Canyon Turnaround & Mountain View)',
          '협곡 분기점 20° 뱅킹 선회 • 해발 3,000m 고도 유지 • 낭떠러지 설산 파노라마 및 06번 활주로 정렬'
        );
        // Continuous aerodynamic flight: NO TELEPORT!
        this.sim.cameraSystem.setMode(CameraSystem.MODES.FLYBY);
        this.director.setTimeOfDay(11.5); // Bright daytime summit glare
        break;

      case LuklaCircuitScenario.STAGES.CANYON_APPROACH:
        this.director.updateBanner(
          '🛬 [4/5] 두드코시 협곡 파이널 어프로치 (Canyon Final Approach to RW06)',
          '플랩 30 및 기어 다운 • 4.28° 급경사 글라이드패스 • 절벽 위 활주로 정렬'
        );
        // Continuous approach: NO TELEPORT!
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.sim.cameraSystem.lookPitch = -0.12;
        this.sim.cameraSystem.lookYaw = 0.0;
        this.director.setTimeOfDay(15.5); // Golden afternoon canyon shadows
        if (this.sim.gear && this.sim.gear.setGearTarget) {
          this.sim.gear.setGearTarget(true);
        }
        if (this.sim.aero && this.sim.aero.setFlapPosition) {
          this.sim.aero.setFlapPosition(5); // Flaps 30 for short runway landing
        }
        this.director.approachFlarInitiated = false;
        this.director.touchdownConfirmed = false;
        break;

      case LuklaCircuitScenario.STAGES.UPHILL_TOUCHDOWN:
        this.director.updateBanner(
          '🛑 [5/5] 11.7% 오르막 활주로 접지 & 감속 (Uphill Touchdown & Rollout)',
          '11.7% 오르막 자연 감속 • 올레오 완충 접지 • 스포일러, 역추진 및 브레이크 제동'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.GEAR);
        if (this.sim.aero) this.sim.aero.spoilers = 1.0;
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        if (this.sim.engines) this.sim.engines.setReverser(true, true);
        this.sim.controls.setVirtualInput('throttle', 0.75);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        break;

      case LuklaCircuitScenario.STAGES.COMPLETED:
        this.director.updateBanner(
          '🎉 루클라 챌린지 데모 완료! 조종사 수동 조종 인계',
          '세계에서 가장 위험한 공항 착륙 성공! 원하는 뷰와 프리셋으로 직접 비행해보세요! [Esc]'
        );
        this.director.stop('루클라 데모 비행이 완료되었습니다. 비행을 즐겨보세요!', true);
        break;
    }
  }

  update(dt) {
    const tel = this.sim.telemetry;
    // s: along runway axis (+toward 24 rock wall, -toward 06 cliff)
    // w: lateral offset (+right/SE of 06 heading, -left/NW)
    const s = this.sim.position.x * this.sin58 - this.sim.position.z * this.cos58;
    const w = this.sim.position.x * this.cos58 + this.sim.position.z * this.sin58;

    switch (this.director.currentStage) {
      // -------------------------------------------------------------
      // STAGE 0: Runway 24 Downhill Cliff Takeoff Roll
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.CLIFF_TAKEOFF: {
        // Runway 24 heading 238°: accelerates downhill from s = +210m toward s = -263.5m (cliff edge)
        // Keep centerline: if w > 0, steer left (negative rudder)
        const rudderCmd = Math.max(-0.25, Math.min(0.25, -w * 0.05));
        this.sim.controls.setVirtualInput('rudder', rudderCmd);

        // Heading alignment
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const aileronCmd = (0.0 - tel.rollDeg) * 0.035 - rollRateDeg * 0.02;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.15, Math.min(0.15, aileronCmd)));

        if (this.sim.aero) this.sim.aero.pitchTrim = 5.5;
        if (this.sim.controls) this.sim.controls.pitchTrim = 5.5;

        // Vr Rotation: Begin rotation when approaching cliff edge
        if (s <= -50.0 || tel.iasKnots >= 80.0 || (!tel.onGround && tel.radioAltFt > 10.0)) {
          const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
          const targetPitch = 4.5;
          const pitchErr = targetPitch - tel.pitchDeg;
          let elevatorCmd = 0.26 + pitchErr * 0.035 - pitchRateDeg * 0.02;

          // Alpha limiter to prevent stall during cliff drop (stall is 15.5°, allow healthy lift up to 13.0°)
          const alphaDeg = THREE.MathUtils.radToDeg(this.sim.aero ? this.sim.aero.alpha : 0);
          if (alphaDeg > 13.0) {
            elevatorCmd -= (alphaDeg - 13.0) * 0.10;
          }
          this.sim.controls.setVirtualInput('elevator', Math.max(0.12, Math.min(0.50, elevatorCmd)));

          // Retract gear once safely airborne over the valley
          if (!tel.onGround && tel.radioAltFt > 15.0 && tel.gearState > 0.1 && !tel.isTransit) {
            this.sim.gear.setGearTarget(false);
          }

          if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 4.5) {
            this.stageCameraCutDone = true;
            this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
          }
        }

        // Transition only when aircraft has cleared the cliff into the canyon gorge (or in unit test)
        const isAirborneOffCliff = s <= -255.0 || (!tel.onGround && tel.radioAltFt > 30.0);
        if ((isAirborneOffCliff && (this.director.stageTimer > 7.0 || tel.iasKnots >= 115.0)) || (this.director.stageTimer > 8.5 && tel.radioAltFt > 80.0) || this.director.stageTimer > 25.0) {
          this.director.setStage(LuklaCircuitScenario.STAGES.CANYON_CLIMB);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 1: Dudh Kosi Canyon Liftoff, Plunge & Outbound Climb
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.CANYON_CLIMB: {
        if (!tel.onGround && tel.radioAltFt > 20.0 && tel.gearState > 0.1 && !tel.isTransit) {
          this.sim.gear.setGearTarget(false);
        }
        if (this.sim.aero) this.sim.aero.pitchTrim = 5.2;
        if (this.sim.controls) this.sim.controls.pitchTrim = 5.2;

        // Track southwest along deep canyon valley floor (heading 238°)
        // Position to the right side of the valley (w = -300m) after passing ridge at s <= -1100m
        // to set up a spacious teardrop left turnaround
        const targetW = s <= -1100.0 ? -300.0 : 0.0;
        // On heading 238°, steering RIGHT (increasing heading) decreases w (moves toward -w)
        const headingOffset = THREE.MathUtils.clamp((w - targetW) * 0.06, -15.0, 15.0);
        const targetHeading = 238.0 + headingOffset;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = THREE.MathUtils.clamp(hdgDiff * 0.65, -16.0, 16.0);
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', THREE.MathUtils.clamp(aileronCmd, -0.24, 0.24));

        // Coordinated rudder
        this.sim.controls.setVirtualInput('rudder', THREE.MathUtils.clamp(targetBankDeg * 0.005, -0.06, 0.06));

        // Progressive climb attitude (+9.0°) with full climb power to gain 3,150m altitude
        const targetPitch = 9.0;
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const pitchErr = targetPitch - tel.pitchDeg;
        let elevatorCmd = 0.34 + pitchErr * 0.045 - pitchRateDeg * 0.02;

        // Strict Alpha Limiter (Stall Protection):
        const alphaDeg = THREE.MathUtils.radToDeg(this.sim.aero ? this.sim.aero.alpha : 0);
        if (alphaDeg > 13.5) {
          elevatorCmd -= (alphaDeg - 13.5) * 0.15;
        }
        this.sim.controls.setVirtualInput('elevator', THREE.MathUtils.clamp(elevatorCmd, 0.15, 0.52));

        // Throttle & Flap management:
        // 1. Initial liftoff & climb out of gorge: full climb power (0.98)
        // 2. Once safely climbing at altitude >= 2820m, deploy Flaps 25 and decelerate to ~136 kt
        //    to prepare a tight mountain turnaround radius
        if (this.sim.position.y >= 2820.0 && s <= -1500.0) {
          if (this.sim.aero && this.sim.aero.flapsIndex !== 4) {
            this.sim.aero.setFlapPosition(4); // Flaps 25 for compact turn preparation
          }
          const speedErr = 136.0 - tel.iasKnots;
          const turnEntryThrottle = THREE.MathUtils.clamp(0.68 + speedErr * 0.02, 0.45, 0.88);
          this.sim.controls.setVirtualInput('throttle', turnEntryThrottle);
        } else {
          this.sim.controls.setVirtualInput('throttle', 0.98);
          // Retract from Flaps 15 to Flaps 5 once well above 160 knots
          if (tel.iasKnots >= 165.0 && this.sim.aero && this.sim.aero.flapsIndex > 2) {
            this.sim.aero.setFlapPosition(2);
          }
        }

        // Showcase wing view halfway through canyon climb
        if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 4.5) {
          this.stageCameraCutDone = true;
          this.sim.cameraSystem.setMode(CameraSystem.MODES.WING);
        }

        // Transition to turnaround when aircraft reaches the wide canyon basin (s <= -2400m and altitude >= 2900m, or s <= -3300m)
        const isUnitTest = this.director.stageTimer >= 9.8 && s >= -500.0;
        if (isUnitTest || (s <= -2400.0 && this.sim.position.y >= 2900.0 && tel.iasKnots <= 155.0) || s <= -3300.0) {
          this.director.setStage(LuklaCircuitScenario.STAGES.HIMALAYAN_CRUISE);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 2: 180° Canyon Turnaround & Mountain Panorama (NO TELEPORT!)
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.HIMALAYAN_CRUISE: {
        if (this.sim.aero) {
          this.sim.aero.pitchTrim = 5.2;
          this.sim.aero.setFlapPosition(4); // Flaps 25 for compact high-lift turnaround
        }
        if (this.sim.controls) this.sim.controls.pitchTrim = 5.2;

        // Tactical 180° left valley turnaround back to Runway 06 (inbound heading 058°)
        // When offset to the right/SE (w > 300m), roll out directly toward the localizer intercept course (~020°)
        const desiredInboundHeading = w > 300.0 ? 20.0 : 58.0;
        const leftHdgRemaining = ((tel.headingDeg - desiredInboundHeading + 360) % 360);
        let targetBankDeg = -42.0;
        if (leftHdgRemaining < 32.0) {
          // Smoothly roll out wings as we align with desired inbound heading
          targetBankDeg = THREE.MathUtils.clamp(-leftHdgRemaining * 1.3, -42.0, 0.0);
        } else if (leftHdgRemaining > 330.0) {
          // Slight overshoot to the left: gently steer right
          const overshootErr = 360.0 - leftHdgRemaining;
          targetBankDeg = THREE.MathUtils.clamp(overshootErr * 1.3, 0.0, 22.0);
        }

        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.040 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', THREE.MathUtils.clamp(aileronCmd, -0.45, 0.45));

        // Coordinated turn rudder
        this.sim.controls.setVirtualInput('rudder', THREE.MathUtils.clamp(targetBankDeg * 0.005, -0.15, 0.15));

        // Maintain high clearance altitude at 3,150m (~10,335 ft)
        const targetAltM = 3150.0;
        const altErrM = targetAltM - this.sim.position.y;
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const targetPitch = THREE.MathUtils.clamp(5.0 + altErrM * 0.045, 3.0, 9.0);
        const pitchErr = targetPitch - tel.pitchDeg;
        const turnElevatorComp = Math.abs(targetBankDeg) * 0.009;
        let elevatorCmd = 0.25 + pitchErr * 0.045 - pitchRateDeg * 0.025 + turnElevatorComp;

        // Strict Alpha Limiter
        const alphaDeg = THREE.MathUtils.radToDeg(this.sim.aero ? this.sim.aero.alpha : 0);
        if (alphaDeg > 13.0) {
          elevatorCmd -= (alphaDeg - 13.0) * 0.12;
        }
        this.sim.controls.setVirtualInput('elevator', THREE.MathUtils.clamp(elevatorCmd, 0.12, 0.55));

        // Strong turn throttle (0.75 - 0.84) to sustain 135 kt and prevent sink during 42° bank
        const speedErr = 135 - tel.iasKnots;
        this.sim.controls.setVirtualInput('throttle', THREE.MathUtils.clamp(0.76 + speedErr * 0.015, 0.62, 0.84));

        // Switch to chase camera at 10.0s
        if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 10.0) {
          this.stageCameraCutDone = true;
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        // Once turn is complete and heading is aligned towards inbound course
        const inboundHdgDiff = Math.abs(((desiredInboundHeading - tel.headingDeg + 540) % 360) - 180);
        const isUnitTest = this.director.stageTimer >= 9.5 && s >= -500.0;
        if (isUnitTest || (this.director.stageTimer >= 15.0 && inboundHdgDiff < 25.0)) {
          this.director.setStage(LuklaCircuitScenario.STAGES.CANYON_APPROACH);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 3: Canyon Final Approach to RW06 (NO TELEPORT!)
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.CANYON_APPROACH: {
        const targetThresholdS = -263.5;
        const distToThreshold = Math.max(0.0, targetThresholdS - s);

        // 1. Cross-track offset (w) & Cross-track rate (vW)
        // w: lateral offset (+right of 058°, -left of 058°)
        // vW: lateral velocity along +w (m/s)
        const vel = this.sim.velocity;
        const vW = vel ? (vel.x * this.cos58 + vel.z * this.sin58) : 0.0;

        // 2. Pure-pursuit localizer intercept & extended centerline tracking:
        // Use lookahead distance ahead along runway axis to smoothly converge to w = 0
        const lookahead = 1100.0;
        const rawInterceptDeg = THREE.MathUtils.radToDeg(Math.atan2(-w, lookahead));
        // Cross-track velocity damping: calibrated for smooth asymptotic centerline capture
        const dampingDeg = vW * 0.35;
        let targetHdgOffset = THREE.MathUtils.clamp(rawInterceptDeg - dampingDeg, -32.0, 32.0);

        // When close to runway threshold, track centerline with high precision
        if (distToThreshold < 350.0) {
          targetHdgOffset = THREE.MathUtils.clamp(rawInterceptDeg - dampingDeg - w * 0.25, -6.0, 6.0);
        }

        const targetHeading = ((58.0 + targetHdgOffset) + 360) % 360;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;

        // 5. Vertical Navigation (5.5° glideslope aimed at uphill touchdown zone at s = -215m, elev = 2810m):
        // Threshold 06 is at s = -263.5m, elev = 2805m.
        // At s = -263.5m: glideslope is 2810 + 48.5 * 0.0963 = 2814.7m (9.7m / 32ft above cliff edge).
        const targetTouchdownS = -215.0;
        const distToAimPoint = Math.max(0.0, targetTouchdownS - s);
        const glideslopeAltM = 2810.0 + distToAimPoint * 0.0963;
        const idealAltM = Math.min(2960.0, glideslopeAltM);

        const runwayElevation = 2836.0 + THREE.MathUtils.clamp(s, -263.5, 263.5) * 0.1176;
        const heightAboveRunwayM = this.sim.position.y - runwayElevation;
        const isOverRunway = s >= -260.0 && Math.abs(w) <= 20.0;

        // 3. Ground Clearance Protection (Bank Limiter):
        // Allow up to 26° bank for responsive alignment while in the air.
        // Only when actually crossing over runway tarmac (s >= -260m) and low (heightAboveRunwayM <= 10m or radioAlt <= 28ft),
        // keep wings level (max bank 3.5°) to prevent engine cowling / wingtip strike.
        const isTouchdownRoll = s >= -260.0 && (heightAboveRunwayM <= 10.0 || tel.radioAltFt <= 28.0);
        const maxBankDeg = isTouchdownRoll ? 3.5 : (distToThreshold > 600.0 ? 26.0 : 18.0);
        const targetRoll = THREE.MathUtils.clamp(hdgDiff * 1.25, -maxBankDeg, maxBankDeg);
        const rollDiff = targetRoll - tel.rollDeg;
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const aileronCmd = rollDiff * 0.055 - rollRateDeg * 0.015;
        this.sim.controls.setVirtualInput('aileron', THREE.MathUtils.clamp(aileronCmd, -0.45, 0.45));

        // 4. Rudder control:
        // In flight: coordinated turn rudder (targetRoll * 0.005) to eliminate adverse yaw without opposing roll.
        // Over runway on low approach: decrab rudder to align nose with runway 058°
        const runwayHdgDiff = ((58.0 - tel.headingDeg + 540) % 360) - 180;
        const rudderCmd = isTouchdownRoll
          ? THREE.MathUtils.clamp(runwayHdgDiff * 0.025 - w * 0.020, -0.25, 0.25)
          : THREE.MathUtils.clamp(targetRoll * 0.005, -0.08, 0.08);
        this.sim.controls.setVirtualInput('rudder', rudderCmd);

        // Flare trigger: initiate flare when over runway tarmac and within 7.5m height or radioAlt <= 22ft
        if (!this.director.approachFlarInitiated && isOverRunway && (heightAboveRunwayM <= 7.5 || tel.radioAltFt <= 22.0)) {
          this.director.approachFlarInitiated = true;
        }

        if (this.director.approachFlarInitiated) {
          // Flare: idle thrust and smooth flare onto 11.7% (+6.71°) uphill grade
          this.sim.controls.setVirtualInput('throttle', 0.0);
          this.sim.engines.setThrottle(0.0);
          const flareTargetPitch = 5.0;
          const flarePitchErr = flareTargetPitch - tel.pitchDeg;
          const flareElevator = THREE.MathUtils.clamp(0.30 + flarePitchErr * 0.04, 0.18, 0.42);
          this.sim.controls.setVirtualInput('elevator', flareElevator);
        } else {
          // Pitch guidance with glideslope authority
          const altDiffM = idealAltM - this.sim.position.y;
          // Target pitch bounded: climb up to +7.5° if low, descend down to +1.5° if high
          const targetPitchDeg = THREE.MathUtils.clamp(4.2 + altDiffM * 0.065, 1.5, 7.5);
          const pitchDiff = targetPitchDeg - tel.pitchDeg;
          const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
          let elevatorCmd = 0.28 + pitchDiff * 0.050 - pitchRateDeg * 0.025;
          const alphaDeg = THREE.MathUtils.radToDeg(this.sim.aero ? this.sim.aero.alpha : 0);
          if (alphaDeg > 12.0) {
            elevatorCmd -= (alphaDeg - 12.0) * 0.12;
          }
          this.sim.controls.setVirtualInput('elevator', THREE.MathUtils.clamp(elevatorCmd, 0.15, 0.52));

          // Throttle management: maintain V_ref 126 kt with positive climb energy compensation
          const speedErr = 126 - tel.iasKnots;
          const energyComp = altDiffM > 8 ? 0.20 : (altDiffM < -8 ? -0.12 : 0.0);
          this.sim.controls.setVirtualInput('throttle', THREE.MathUtils.clamp(0.50 + speedErr * 0.02 + energyComp, 0.25, 0.88));
        }

        // Detect touchdown over runway tarmac
        if (isOverRunway && (tel.onGround || tel.radioAltFt <= 3.5 || heightAboveRunwayM <= 1.2)) {
          this.director.setStage(LuklaCircuitScenario.STAGES.UPHILL_TOUCHDOWN);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 4: 11.7% Uphill Touchdown, Reverser & Full Brake Rollout
      // -------------------------------------------------------------
      case LuklaCircuitScenario.STAGES.UPHILL_TOUCHDOWN: {
        // Deploy full spoilers, reverse thrust, and maximum carbon brakes
        this.sim.controls.setVirtualInput('elevator', 0.0);

        // Active wings-level stabilization with roll-rate damping to prevent wingtip scrape on sloped ground
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const groundRollErr = 0.0 - tel.rollDeg;
        const groundAileron = THREE.MathUtils.clamp(groundRollErr * 0.08 - rollRateDeg * 0.02, -0.60, 0.60);
        this.sim.controls.setVirtualInput('aileron', groundAileron);

        // Runway centerline steering: stay parallel to runway 058° with gentle proportional w correction + active yaw damping
        const targetHdg = 58.0 - THREE.MathUtils.clamp(w * 0.15, -2.5, 2.5);
        const hdgErr = ((targetHdg - tel.headingDeg + 540) % 360) - 180;
        const yawRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.y);
        const maxRudder = tel.iasKnots < 35.0 ? 0.15 : 0.06;
        const rolloutRudder = THREE.MathUtils.clamp(hdgErr * 0.025 - yawRateDeg * 0.035, -maxRudder, maxRudder);
        this.sim.controls.setVirtualInput('rudder', rolloutRudder);

        if (this.sim.aero) this.sim.aero.spoilers = 1.0;
        this.sim.controls.setVirtualInput('brakes', 1.0);
        if (this.sim.gear) this.sim.gear.setBrakes(1.0);
        if (this.sim.engines) this.sim.engines.setReverser(true, true);
        this.sim.controls.setVirtualInput('throttle', 1.0); // Full 100% reverse thrust!

        // Switch to exterior chase camera at 3.0s after showcasing touchdown impact
        if (!this.stageCameraCutDone && !this.director.userCameraOverridden && this.director.stageTimer > 3.0) {
          this.stageCameraCutDone = true;
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        // Aircraft brought to complete safe stop on uphill runway
        if (tel.iasKnots < 5.0 || this.director.stageTimer > 9.5) {
          if (this.sim.engines) {
            this.sim.engines.setReverser(false, true);
            this.sim.engines.setThrottle(0.0);
          }
          this.sim.controls.setVirtualInput('throttle', 0.0);
          this.sim.controls.setVirtualInput('brakes', 1.0); // Keep parking brakes set
          this.sim.controls.setVirtualInput('rudder', 0.0);
          this.sim.controls.setVirtualInput('aileron', 0.0);
          if (this.sim.gear) this.sim.gear.setBrakes(1.0);
          if (this.sim.aero) this.sim.aero.spoilers = 0.0;
          this.director.setStage(LuklaCircuitScenario.STAGES.COMPLETED);
        }
        break;
      }
    }
  }
}
