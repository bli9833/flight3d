import * as THREE from 'three';
import { CameraSystem } from '../cameras/CameraSystem.js';

/**
 * Autonomous Cinematic Demo Flight Director
 * 
 * Supports both:
 * 1. Nepal Tenzing-Hillary Airport (Lukla VNLK):
 *    - Runway 24 Downhill 11.7% Cliff Dive Takeoff Roll (Cockpit View, TOGA 100%)
 *    - Dudh Kosi Canyon Plunge & Liftoff (Gear Cam, Retraction over 600m Gorge)
 *    - Canyon Banking & Climb (Wing / Chase View over real 30m DEM terrain)
 *    - 13,000 FT Himalayan Peaks Scenic Cruise (Flyby View, Snowy 6,000m+ Summits)
 *    - Canyon Final Approach to RW06 on 4.28° Steep Glideslope (Cockpit Captain View)
 *    - 11.7% Uphill Touchdown, Tire Smoke, Reverser & Full Brake Rollout onto Apron
 * 
 * 2. Coastal International Airport (Runway 09L):
 *    - Pre-Flight Drone Orbit Inspection (Elevated 360° Drone View, Flaps 5, Golden Morning)
 *    - Runway 09L Takeoff Roll (Cockpit View, TOGA 100%, Vr rotation)
 *    - Liftoff & Climb (Chase Exterior View, Gear Retraction, Mountains & City)
 *    - Scenic Coastal Banking Turn (Wing View, 20° Bank over Bay & Hills)
 *    - Ocean Waves & Shipping Fleet Cruise (Cinematic Flyby View, Gerstner Waves & Ships)
 *    - 3NM Final Approach on 3° Glideslope (Cockpit View, PAPI Guidance)
 *    - Flare, Touchdown, Spoilers & Reverse Thrust Rollout (Gear/Chase View, Safe Stop)
 *    - Post-Landing Drone Orbit Showcase (Elevated 360° Drone View, Safe Stop Inspection)
 *    - Seamless Handover to User Manual Flight
 */
export class DemoFlightDirector {
  static LUKLA_STAGES = {
    IDLE: -1,
    CLIFF_TAKEOFF: 0,
    CANYON_CLIMB: 1,
    HIMALAYAN_CRUISE: 2,
    CANYON_APPROACH: 3,
    UPHILL_TOUCHDOWN: 4,
    COMPLETED: 5
  };

  static STAGES = {
    IDLE: -1,
    PREFLIGHT_ORBIT: 0,
    TAKEOFF_ROLL: 1,
    ROTATION_CLIMB: 2,
    COASTAL_BANK: 3,
    OCEAN_CRUISE: 4,
    FINAL_APPROACH: 5,
    TOUCHDOWN_ROLLOUT: 6,
    POSTFLIGHT_ORBIT: 7,
    COMPLETED: 8
  };

  static COASTAL_STAGES = DemoFlightDirector.STAGES;

  constructor(simulator) {
    this.sim = simulator;
    this.isActive = false;
    this.activeDemoAirport = this.sim?.activeAirport || 'lukla';
    this.currentStage = DemoFlightDirector.STAGES.IDLE;
    this.stageTimer = 0;
    this.totalTimer = 0;

    // UI element references
    this.bannerEl = null;
    this.titleEl = null;
    this.descEl = null;
    this.skipBtn = null;
    this.closeBtn = null;
    this.openBtn = null;
    this.badgeEl = null;
    this.pillTextEl = null;
    this.isBannerMinimized = false;

    // Approach tracking state
    this.approachFlarInitiated = false;
    this.touchdownConfirmed = false;

    // Audio initial click flag
    this.audioInitiated = false;
  }

  initUI() {
    this.bannerEl = document.getElementById('demo-banner');
    this.titleEl = document.getElementById('demo-stage-title');
    this.descEl = document.getElementById('demo-stage-desc');
    this.skipBtn = document.getElementById('btn-skip-demo');
    this.closeBtn = document.getElementById('btn-demo-close');
    this.openBtn = document.getElementById('btn-demo-open');
    this.badgeEl = this.bannerEl?.querySelector('.demo-badge');
    this.pillTextEl = document.getElementById('demo-pill-text');

    if (this.skipBtn) {
      this.skipBtn.addEventListener('click', () => {
        this.stop('직접 조종 모드로 전환되었습니다.');
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeBanner();
      });
    }

    if (this.badgeEl) {
      this.badgeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeBanner();
      });
      this.badgeEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.closeBanner();
        }
      });
    }

    if (this.openBtn) {
      this.openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openBanner();
      });
    }

    const replayBtn = document.getElementById('btn-demo');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => {
        if (this.isActive) {
          if (this.isBannerMinimized) {
            this.openBanner();
          } else {
            this.closeBanner();
          }
        } else {
          this.start();
        }
      });
    }

    // Keyboard cancel/restart/toggle listeners
    window.addEventListener('keydown', (e) => {
      if (this.isActive) {
        if (e.code === 'Escape') {
          this.stop('데모 비행 종료: 직접 조종으로 전환되었습니다.');
        } else if (e.code === 'KeyP') {
          this.toggleBanner();
        } else if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          // Touching flight control keys automatically hands over control
          this.stop('조종 입력 감지: 조종사 수동 조종으로 전환되었습니다.');
        }
      } else if (e.code === 'KeyP') {
        this.start();
      }
    });
  }

  closeBanner() {
    this.isBannerMinimized = true;
    if (this.bannerEl) {
      this.bannerEl.style.display = 'none';
    }
    if (this.isActive && this.openBtn) {
      this.openBtn.style.display = 'inline-flex';
    }
  }

  openBanner() {
    this.isBannerMinimized = false;
    if (this.openBtn) {
      this.openBtn.style.display = 'none';
    }
    if (this.isActive && this.bannerEl) {
      this.bannerEl.style.display = 'flex';
    }
  }

  toggleBanner() {
    if (this.isBannerMinimized) {
      this.openBanner();
    } else {
      this.closeBanner();
    }
  }

  start(targetAirport = null) {
    const airport = targetAirport || this.sim.activeAirport || (this.sim.luklaAirport ? 'lukla' : 'coastal');
    if (this.sim.setAirport && this.sim.activeAirport !== airport) {
      this.sim.setAirport(airport);
    }

    this.activeDemoAirport = airport;
    this.isActive = true;
    this.totalTimer = 0;
    this.approachFlarInitiated = false;
    this.touchdownConfirmed = false;
    this.isBannerMinimized = false;

    if (this.bannerEl) {
      this.bannerEl.style.display = 'flex';
    }
    if (this.openBtn) {
      this.openBtn.style.display = 'none';
    }

    // Ensure audio starts on first user interaction or when allowed
    if (!this.audioInitiated && this.sim.audio) {
      this.sim.audio.init();
      this.sim.audio.ensureContextRunning();
      this.audioInitiated = true;
    }

    if (this.activeDemoAirport === 'lukla') {
      this.setStage(DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);
    } else {
      this.setStage(DemoFlightDirector.COASTAL_STAGES.PREFLIGHT_ORBIT);
    }
  }

  stop(message = null) {
    if (!this.isActive) return;
    this.isActive = false;
    this.currentStage = DemoFlightDirector.STAGES.IDLE;
    this.isBannerMinimized = false;

    // Clear programmatic virtual inputs
    this.sim.controls.clearVirtualInputs();

    if (this.bannerEl) {
      this.bannerEl.style.display = 'none';
    }
    if (this.openBtn) {
      this.openBtn.style.display = 'none';
    }

    if (message) {
      this.sim.showToast(message);
    }
  }

  setStage(newStage) {
    this.currentStage = newStage;
    this.stageTimer = 0;

    if (this.activeDemoAirport === 'lukla') {
      this.setLuklaStage(newStage);
    } else {
      this.setCoastalStage(newStage);
    }
  }

  update(dt) {
    if (!this.isActive) return;

    this.stageTimer += dt;
    this.totalTimer += dt;

    if (this.activeDemoAirport === 'lukla') {
      this.updateLukla(dt);
    } else {
      this.updateCoastal(dt);
    }
  }

  // =========================================================================
  // NEPAL LUKLA (VNLK) DEMO FLIGHT STAGES
  // =========================================================================

  setLuklaStage(newStage) {
    switch (newStage) {
      case DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF:
        this.updateBanner(
          '⚡ [1/5] 루클라 24번 활주로 절벽 질주 이륙 (Runway 24 Cliff Takeoff)',
          '11.7% 급경사 내리막 질주 • TOGA 100% 추력 가속 • 600m 셰르파 절벽 다이빙 이륙'
        );
        this.sim.setPreset('cliff', true);
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.sim.cameraSystem.lookPitch = -0.12;
        this.sim.cameraSystem.lookYaw = 0.0;
        this.sim.sky.setTimeOfDay(8.5); // Crisp morning mountain light
        this.sim.controls.setVirtualInput('throttle', 1.0);
        this.sim.engines.setThrottle(1.0);
        this.sim.controls.setVirtualInput('elevator', -0.05); // Keep nose down during slope roll
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);
        this.sim.controls.setVirtualInput('brakes', 0.0);
        this.sim.gear.setBrakes(0.0);
        this.approachFlarInitiated = false;
        this.touchdownConfirmed = false;
        break;

      case DemoFlightDirector.LUKLA_STAGES.CANYON_CLIMB:
        this.updateBanner(
          '🏔️ [2/5] 두드코시 협곡 상승 & 선회 (Dudh Kosi Canyon Climb)',
          'V자 협곡 능선 선회 • 랜딩 기어 접기 • 30m DEM 실제 지형 및 울창한 수목 조망'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        this.sim.controls.setVirtualInput('throttle', 0.90);
        this.sim.engines.setThrottle(0.90);
        break;

      case DemoFlightDirector.LUKLA_STAGES.HIMALAYAN_CRUISE:
        this.updateBanner(
          '❄️ [3/5] 히말라야 13,000 FT 고고도 순항 (Himalayan Peak Cruise)',
          '해발 4,000m 고공 비행 • 만년설 고봉(해발 6,000m+) 및 협곡 파노라마 감상'
        );
        this.sim.setPreset('cruise', true);
        this.sim.cameraSystem.setMode(CameraSystem.MODES.FLYBY);
        this.sim.sky.setTimeOfDay(10.5); // Bright daytime summit glare
        break;

      case DemoFlightDirector.LUKLA_STAGES.CANYON_APPROACH:
        this.updateBanner(
          '🛬 [4/5] 두드코시 협곡 파이널 어프로치 (Canyon Final Approach to RW06)',
          '플랩 30 및 기어 다운 • 4.28° 급경사 글라이드패스 • 절벽 위 활주로 정렬'
        );
        this.sim.setPreset('approach', true);
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.sim.cameraSystem.lookPitch = -0.12;
        this.sim.cameraSystem.lookYaw = 0.0;
        this.sim.sky.setTimeOfDay(15.5); // Golden afternoon canyon shadows
        this.approachFlarInitiated = false;
        this.touchdownConfirmed = false;
        break;

      case DemoFlightDirector.LUKLA_STAGES.UPHILL_TOUCHDOWN:
        this.updateBanner(
          '🛑 [5/5] 11.7% 오르막 활주로 접지 & 암벽 앞 감속 (Uphill Touchdown & Rollout)',
          '11.7% 오르막 자연 감속 • 올레오 완충 접지 • 스포일러, 역추진 및 브레이크 제동'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.GEAR);
        this.sim.aero.spoilers = 1.0;
        this.sim.controls.setVirtualInput('brakes', 1.0);
        this.sim.gear.setBrakes(1.0);
        this.sim.engines.setReverser(true, true);
        this.sim.controls.setVirtualInput('throttle', 0.75);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        break;

      case DemoFlightDirector.LUKLA_STAGES.COMPLETED:
        this.updateBanner(
          '🎉 루클라 챌린지 데모 완료! 조종사 수동 조종 인계',
          '세계에서 가장 위험한 공항 착륙 성공! 원하는 뷰와 프리셋으로 직접 비행해보세요! [Esc]'
        );
        this.stop('루클라 데모 비행이 완료되었습니다. 비행을 즐겨보세요!');
        break;
    }
  }

  updateLukla(dt) {
    const tel = this.sim.telemetry;
    const sin58 = 0.848048;
    const cos58 = 0.529919;
    // s: along runway axis (+toward 24 rock wall, -toward 06 cliff)
    // w: lateral offset (+right of 06 heading)
    const s = this.sim.position.x * sin58 - this.sim.position.z * cos58;
    const w = this.sim.position.x * cos58 + this.sim.position.z * sin58;

    switch (this.currentStage) {
      // -------------------------------------------------------------
      // LUKLA STAGE 0: Runway 24 Downhill Cliff Takeoff Roll
      // -------------------------------------------------------------
      case DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF: {
        // Runway 24 heading 238°: accelerates downhill from s = +210m toward s = -263.5m (cliff edge)
        // Keep centerline: if w > 0, steer left (negative rudder)
        const rudderCmd = Math.max(-0.25, Math.min(0.25, -w * 0.05));
        this.sim.controls.setVirtualInput('rudder', rudderCmd);

        // Heading alignment
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const aileronCmd = (0.0 - tel.rollDeg) * 0.035 - rollRateDeg * 0.02;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.15, Math.min(0.15, aileronCmd)));

        // Once approaching or clearing the cliff edge (s <= -230m or radioAltFt > 30)
        if (s <= -230.0 || this.stageTimer > 6.0 || tel.radioAltFt > 30.0) {
          // Pitch up smoothly into climb over canyon
          const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
          const pitchErr = 7.0 - tel.pitchDeg;
          const elevatorCmd = 0.22 + pitchErr * 0.035 - pitchRateDeg * 0.02;
          this.sim.controls.setVirtualInput('elevator', Math.max(0.1, Math.min(0.35, elevatorCmd)));

          // Retract gear once airborne
          if (!tel.onGround && tel.radioAltFt > 15.0 && tel.gearState > 0.1 && !tel.isTransit) {
            this.sim.gear.setGearTarget(false);
          }

          // Switch to exterior chase view as aircraft plunges over the cliff into the valley
          if (this.stageTimer > 4.5 && this.sim.cameraSystem.mode !== CameraSystem.MODES.CHASE) {
            this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
          }
        }

        if (this.stageTimer > 8.5 || (tel.iasKnots >= 125 && tel.radioAltFt > 80.0)) {
          this.setStage(DemoFlightDirector.LUKLA_STAGES.CANYON_CLIMB);
        }
        break;
      }

      // -------------------------------------------------------------
      // LUKLA STAGE 1: Dudh Kosi Canyon Liftoff, Plunge & Banking Climb
      // -------------------------------------------------------------
      case DemoFlightDirector.LUKLA_STAGES.CANYON_CLIMB: {
        // Retract gear only once safely airborne over the gorge (never on the runway)
        if (!tel.onGround && tel.radioAltFt > 20.0 && tel.gearState > 0.1 && !tel.isTransit) {
          this.sim.gear.setGearTarget(false);
        }

        // Bank ~15° along canyon (heading 215°)
        const targetHeading = 215.0;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = Math.max(-15.0, Math.min(15.0, hdgDiff * 0.5));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));

        // Pitch climb ~8°
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const pitchErr = 8.0 - tel.pitchDeg;
        const elevatorCmd = 0.15 + pitchErr * 0.035 - pitchRateDeg * 0.02;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.1, Math.min(0.30, elevatorCmd)));
        this.sim.controls.setVirtualInput('throttle', 0.88);

        // Showcase wing view halfway through canyon climb
        if (this.stageTimer > 4.5 && this.sim.cameraSystem.mode !== CameraSystem.MODES.WING) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.WING);
        }

        if (this.stageTimer > 9.5) {
          this.setStage(DemoFlightDirector.LUKLA_STAGES.HIMALAYAN_CRUISE);
        }
        break;
      }

      // -------------------------------------------------------------
      // LUKLA STAGE 2: 13,000 FT Peaks Scenic Cruise
      // -------------------------------------------------------------
      case DemoFlightDirector.LUKLA_STAGES.HIMALAYAN_CRUISE: {
        // Fly level at 13,000 FT MSL
        const targetAlt = 13000;
        const altErr = targetAlt - tel.altitudeFt;
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const elevatorCmd = altErr * 0.0015 - pitchRateDeg * 0.02;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.15, Math.min(0.20, elevatorCmd)));

        // Heading 054° tracking with bank clamped to ±10°
        const targetHeading = 54.0;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = Math.max(-10.0, Math.min(10.0, hdgDiff * 0.5));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.20, Math.min(0.20, aileronCmd)));
        this.sim.controls.setVirtualInput('throttle', 0.65);

        // Switch to chase camera at 4.5s
        if (this.stageTimer > 4.5 && this.sim.cameraSystem.mode !== CameraSystem.MODES.CHASE) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        if (this.stageTimer > 9.0) {
          this.setStage(DemoFlightDirector.LUKLA_STAGES.CANYON_APPROACH);
        }
        break;
      }

      // -------------------------------------------------------------
      // LUKLA STAGE 3: Canyon Final Approach to RW06
      // -------------------------------------------------------------
      case DemoFlightDirector.LUKLA_STAGES.CANYON_APPROACH: {
        // Track 4.28° glidepath to Threshold 06 (s = -263.5m, alt = 2805m)
        const targetThresholdS = -263.5;
        const distToThreshold = Math.max(0, targetThresholdS - s);
        const idealAltM = 2805.0 + distToThreshold * Math.tan(THREE.MathUtils.degToRad(4.28));

        // Pitch guidance with glideslope authority
        const altDiffM = idealAltM - this.sim.position.y;
        const targetPitchDeg = Math.max(-2.5, Math.min(4.5, 1.0 + altDiffM * 0.04));
        const pitchDiff = targetPitchDeg - tel.pitchDeg;
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const elevatorCmd = pitchDiff * 0.08 - pitchRateDeg * 0.03;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.35, Math.min(0.40, elevatorCmd)));

        // Lateral guidance (keep w centered on runway centerline 0)
        const targetRoll = Math.max(-10.0, Math.min(10.0, -w * 0.25));
        const rollDiff = targetRoll - tel.rollDeg;
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const aileronCmd = rollDiff * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));

        // Throttle management for V_ref (135 KT)
        const speedErr = 135 - tel.iasKnots;
        const energyComp = altDiffM > 10 ? 0.08 : (altDiffM < -10 ? -0.08 : 0.0);
        this.sim.controls.setVirtualInput('throttle', Math.max(0.35, Math.min(0.70, 0.54 + speedErr * 0.02 + energyComp)));

        // Flare over cliff threshold (s >= -330m) at low radio altitude
        const isNearThreshold = s >= -330.0;
        if (!this.approachFlarInitiated && isNearThreshold && tel.radioAltFt <= 30.0 && tel.radioAltFt > 0) {
          this.approachFlarInitiated = true;
          this.sim.controls.setVirtualInput('throttle', 0.0);
          this.sim.engines.setThrottle(0.0);
          this.sim.controls.setVirtualInput('elevator', 0.16); // Gentle flare onto uphill slope
        }

        // Detect touchdown over runway tarmac (s >= -263.5m)
        if (s >= -263.5 && (tel.onGround || (this.approachFlarInitiated && tel.radioAltFt <= 6.0))) {
          this.setStage(DemoFlightDirector.LUKLA_STAGES.UPHILL_TOUCHDOWN);
        }
        break;
      }

      // -------------------------------------------------------------
      // LUKLA STAGE 4: 11.7% Uphill Touchdown, Reverser & Full Brake Rollout
      // -------------------------------------------------------------
      case DemoFlightDirector.LUKLA_STAGES.UPHILL_TOUCHDOWN: {
        // Deploy full spoilers, reverse thrust, and maximum carbon brakes
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        // Keep centerline on runway
        this.sim.controls.setVirtualInput('rudder', Math.max(-0.2, Math.min(0.2, -w * 0.04)));
        this.sim.aero.spoilers = 1.0;
        this.sim.controls.setVirtualInput('brakes', 1.0);
        this.sim.gear.setBrakes(1.0);
        this.sim.engines.setReverser(true, true);
        this.sim.controls.setVirtualInput('throttle', 0.75);

        // Switch to exterior chase camera at 3.5s after showcasing touchdown impact
        if (this.stageTimer > 3.5 && this.sim.cameraSystem.mode !== CameraSystem.MODES.GEAR) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        // Aircraft brought to complete safe stop on uphill runway
        if (tel.iasKnots < 5.0 || this.stageTimer > 8.0) {
          this.sim.engines.setReverser(false, true);
          this.sim.controls.setVirtualInput('throttle', 0.0);
          this.sim.aero.spoilers = 0.0;
          this.setStage(DemoFlightDirector.LUKLA_STAGES.COMPLETED);
        }
        break;
      }
    }
  }

  // =========================================================================
  // COASTAL INTERNATIONAL DEMO FLIGHT STAGES
  // =========================================================================

  setCoastalStage(newStage) {
    switch (newStage) {
      case DemoFlightDirector.STAGES.PREFLIGHT_ORBIT:
        this.updateBanner(
          '🚁 [1/8] 비행 전 드론 서클 점검 (Pre-Flight Drone Inspection)',
          '활주로 09L 대기 • 보잉 737 기체 외형 360° 공중 점검 • 플랩 5° 및 엔진 가동 준비'
        );
        this.sim.setPreset('runway', true);
        this.sim.cameraSystem.setMode(CameraSystem.MODES.DRONE);
        this.sim.cameraSystem.resetDroneOrbit?.(1.8, 38.0, 11.5);
        this.sim.sky.setTimeOfDay(7.2); // Golden morning
        this.sim.water.setSunDirection(this.sim.sky.getSunDirection());

        // Keep parked on runway with brakes applied & idle thrust
        this.sim.controls.setVirtualInput('throttle', 0.0);
        this.sim.engines.setThrottle(0.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);
        this.sim.controls.setVirtualInput('brakes', 1.0);
        this.sim.gear.setBrakes(1.0);
        this.sim.aero.setFlapPosition(2); // Flaps 5 for takeoff
        break;

      case DemoFlightDirector.STAGES.TAKEOFF_ROLL:
        this.updateBanner(
          '🛫 [2/8] 활주로 이륙 활주 (Runway 09L Takeoff Roll)',
          'TOGA 100% 추력 가속 • 보잉 글래스 콕핏(MCP, PFD, ND, ISFD) 계기 감상'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.sim.sky.setTimeOfDay(7.2);
        this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        this.sim.controls.setVirtualInput('brakes', 0.0);
        this.sim.gear.setBrakes(0.0);
        this.sim.controls.setVirtualInput('throttle', 1.0);
        this.sim.engines.setThrottle(1.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);
        break;

      case DemoFlightDirector.STAGES.ROTATION_CLIMB:
        this.updateBanner(
          '✈️ [3/8] V_r 로테이션 & 이륙 상승 (Rotation & Initial Climb)',
          '133 KT 부드러운 기수 인상(2.2°/s) • 랜딩 기어 접기 • 기체 외형 및 도심 전경'
        );
        this.sim.controls.setVirtualInput('elevator', 0.65);
        break;

      case DemoFlightDirector.STAGES.COASTAL_BANK:
        this.updateBanner(
          '⛰️ [4/8] 해안가 선회 비행 (Scenic Coastal Banking Turn)',
          '우측 20° 선회 • 굴곡 산맥 지형, 3,500+ 그루 식생 및 500+ 채 도심 빌딩 조망'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.WING);
        this.sim.aero.setFlapPosition(0);
        break;

      case DemoFlightDirector.STAGES.OCEAN_CRUISE:
        this.updateBanner(
          '🚢 [5/8] 해상 선박 & 거스트너 파도 수면 순항 (Ocean Waves & Fleet Cruise)',
          '햇빛 반사 수면 • 컨테이너 화물선, 대형 유람선 및 쾌속 모터보트 웨이크 감상'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.FLYBY);
        break;

      case DemoFlightDirector.STAGES.FINAL_APPROACH:
        this.updateBanner(
          '🛬 [6/8] 3NM 최종 착륙 접근 (Runway 09L Final Approach)',
          'PAPI 4등식 3.0° 활공각 유도(2 White 2 Red) • ALS 진입 스트로브 • 플랩 30 전개'
        );
        this.sim.setPreset('approach', true);
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.sim.sky.setTimeOfDay(17.6);
        this.sim.water.setSunDirection(this.sim.sky.getSunDirection());
        this.approachFlarInitiated = false;
        this.touchdownConfirmed = false;
        break;

      case DemoFlightDirector.STAGES.TOUCHDOWN_ROLLOUT:
        this.updateBanner(
          '🛑 [7/8] 활주로 접지 & 역추진 제동 (Touchdown & Reverser Rollout)',
          '랜딩 기어 뷰: 올레오 서스펜션 완충 접지 • 타이어 연기 • 스포일러 & 역추진 제동'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.GEAR);
        break;

      case DemoFlightDirector.STAGES.POSTFLIGHT_ORBIT:
        this.updateBanner(
          '🚁 [8/8] 안전 착륙 완료 & 드론 서클 쇼케이스 (Touchdown Complete • Drone Orbit View)',
          '활주로 정지 완료 • 스포일러/역추진 격납 • 보잉 737 기체 전경 드론 조망 [Esc: 직접 조종]'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.DRONE);
        this.sim.cameraSystem.resetDroneOrbit?.(this.sim.cameraSystem.droneOrbitAngle, 38.0, 11.5);
        this.sim.controls.setVirtualInput('brakes', 1.0);
        this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        this.sim.engines.setThrottle(0.0);
        break;

      case DemoFlightDirector.STAGES.COMPLETED:
        this.updateBanner(
          '🎉 데모 시연 완료! 조종사 수동 조종 인계',
          '이제 원하는 프리셋과 카메라 뷰를 선택하여 직접 비행을 즐겨보세요! [Esc]'
        );
        this.stop('데모 비행 시연이 완료되었습니다. 비행을 즐겨보세요!');
        break;
    }
  }

  updateCoastal(dt) {
    const tel = this.sim.telemetry;

    switch (this.currentStage) {
      // -------------------------------------------------------------
      // STAGE 0: Pre-Flight Drone Orbit Inspection
      // -------------------------------------------------------------
      case DemoFlightDirector.STAGES.PREFLIGHT_ORBIT: {
        // Hold parked position on runway for 6.0 seconds while drone orbits around aircraft
        this.sim.controls.setVirtualInput('brakes', 1.0);
        this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        this.sim.engines.setThrottle(0.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);

        if (this.stageTimer >= 6.0) {
          this.setStage(DemoFlightDirector.STAGES.TAKEOFF_ROLL);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 1: Runway Takeoff Roll
      // -------------------------------------------------------------
      case DemoFlightDirector.STAGES.TAKEOFF_ROLL: {
        // Accelerate until Vr (133 KT)
        if (tel.iasKnots >= 132 || this.stageTimer > 23.0) {
          this.setStage(DemoFlightDirector.STAGES.ROTATION_CLIMB);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 2: Rotation & Climb
      // -------------------------------------------------------------
      case DemoFlightDirector.STAGES.ROTATION_CLIMB: {
        // Wings-level stabilization during climb with roll-rate damping
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = 0.0 - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.02;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.2, Math.min(0.2, aileronCmd)));

        if (!tel.onGround && tel.radioAltFt > 10.0) {
          if (tel.gearState > 0.1 && !tel.isTransit) {
            this.sim.gear.setGearTarget(false);
          }
          const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
          const pitchErr = 12.0 - tel.pitchDeg;
          const elevatorCmd = 0.18 + pitchErr * 0.035 - pitchRateDeg * 0.02;
          this.sim.controls.setVirtualInput('elevator', Math.max(0.08, Math.min(0.35, elevatorCmd)));
        }

        if (this.stageTimer > 6.0 && this.sim.cameraSystem.mode !== CameraSystem.MODES.CHASE) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        if (tel.altitudeFt > 650 || this.stageTimer > 12.0) {
          this.setStage(DemoFlightDirector.STAGES.COASTAL_BANK);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 3: Coastal Banking Turn
      // -------------------------------------------------------------
      case DemoFlightDirector.STAGES.COASTAL_BANK: {
        // Coordinated 20° bank turn towards South-East (Heading ~155°)
        const targetHeading = 155.0;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = Math.max(-20.0, Math.min(20.0, hdgDiff * 0.65));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));

        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const targetPitch = 10.0;
        const pitchErr = targetPitch - tel.pitchDeg;
        const elevatorCmd = 0.12 + pitchErr * 0.035 - pitchRateDeg * 0.02;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.15, Math.min(0.25, elevatorCmd)));
        this.sim.controls.setVirtualInput('rudder', Math.max(-0.10, Math.min(0.10, targetBankDeg * 0.005)));

        const sunTime = 7.2 + Math.min(10.0, this.stageTimer * 0.8);
        this.sim.sky.setTimeOfDay(sunTime);
        this.sim.water.setSunDirection(this.sim.sky.getSunDirection());

        if (this.stageTimer > 11.0) {
          this.setStage(DemoFlightDirector.STAGES.OCEAN_CRUISE);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 4: Ocean Waves & Shipping Fleet Cruise
      // -------------------------------------------------------------
      case DemoFlightDirector.STAGES.OCEAN_CRUISE: {
        // Fly level over bay at 1,200ft, speed 205 knots
        const targetAlt = 1200;
        const altErr = targetAlt - tel.altitudeFt;
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const elevatorCmd = altErr * 0.002 - pitchRateDeg * 0.02;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.15, Math.min(0.20, elevatorCmd)));

        const targetHeading = 155.0;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = Math.max(-12.0, Math.min(12.0, hdgDiff * 0.5));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));
        this.sim.controls.setVirtualInput('rudder', 0.0);
        this.sim.controls.setVirtualInput('throttle', 0.65);

        if (this.stageTimer > 5.5 && this.sim.cameraSystem.mode !== CameraSystem.MODES.CHASE) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        if (this.stageTimer > 10.5) {
          this.setStage(DemoFlightDirector.STAGES.FINAL_APPROACH);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 5: 3NM Final Approach with PAPI
      // -------------------------------------------------------------
      case DemoFlightDirector.STAGES.FINAL_APPROACH: {
        // Track 3° glideslope down to Runway 09L threshold (x = -1350m, alt = 47ft / 14m)
        const targetTouchdownX = -1250;
        const distToThreshold = targetTouchdownX - this.sim.position.x;
        const idealAltFt = Math.max(47, (distToThreshold * Math.tan(THREE.MathUtils.degToRad(3.0))) * 3.28084 + 47);

        const altDiff = idealAltFt - tel.altitudeFt;
        const targetPitchDeg = Math.max(-1.0, Math.min(6.5, 2.8 + altDiff * 0.035));
        const pitchDiff = targetPitchDeg - tel.pitchDeg;
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const elevatorCmd = pitchDiff * 0.08 - pitchRateDeg * 0.03;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.35, Math.min(0.45, elevatorCmd)));

        const targetRoll = Math.max(-10.0, Math.min(10.0, -this.sim.position.z * 0.15));
        const rollDiff = targetRoll - tel.rollDeg;
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const aileronCmd = rollDiff * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.20, Math.min(0.20, aileronCmd)));

        const speedErr = 142 - tel.iasKnots;
        const energyComp = altDiff > 25 ? 0.12 : (altDiff < -25 ? -0.08 : 0.0);
        this.sim.controls.setVirtualInput('throttle', Math.max(0.35, Math.min(0.75, 0.48 + speedErr * 0.025 + energyComp)));

        const isOverRunway = this.sim.position.x >= -1600;
        if (!this.approachFlarInitiated && isOverRunway && tel.radioAltFt <= 30.0 && tel.radioAltFt > 0) {
          this.approachFlarInitiated = true;
          this.sim.controls.setVirtualInput('throttle', 0.0);
          this.sim.engines.setThrottle(0.0);
          this.sim.controls.setVirtualInput('elevator', 0.14);
        }

        if (isOverRunway && (tel.onGround || (this.approachFlarInitiated && tel.radioAltFt <= 8.5))) {
          this.setStage(DemoFlightDirector.STAGES.TOUCHDOWN_ROLLOUT);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 6: Touchdown & Reverser Rollout
      // -------------------------------------------------------------
      case DemoFlightDirector.STAGES.TOUCHDOWN_ROLLOUT: {
        // Deploy full spoilers, reverse thrust, and maximum brakes
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', -this.sim.position.z * 0.02);
        this.sim.aero.spoilers = 1.0;
        this.sim.controls.setVirtualInput('brakes', 1.0);
        this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        this.sim.engines.setThrottle(0.0);

        // Switch to exterior chase camera at 4.5s after showcasing touchdown impact and tire smoke
        if (this.stageTimer > 4.5 && this.sim.cameraSystem.mode === CameraSystem.MODES.GEAR) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        // Aircraft brought to complete safe stop -> transition to post-flight drone orbit view
        if (tel.iasKnots < 5.0 || this.stageTimer > 12.0) {
          this.sim.engines.setReverser(false, true);
          this.sim.aero.spoilers = 0.0;
          this.setStage(DemoFlightDirector.STAGES.POSTFLIGHT_ORBIT);
        }
        break;
      }

      // -------------------------------------------------------------
      // STAGE 7: Post-Landing Drone Orbit Showcase
      // -------------------------------------------------------------
      case DemoFlightDirector.STAGES.POSTFLIGHT_ORBIT: {
        // Hold safe parked position on runway for 7.0 seconds while drone orbits around aircraft
        this.sim.controls.setVirtualInput('brakes', 1.0);
        this.sim.gear.setBrakes(1.0);
        this.sim.controls.setVirtualInput('throttle', 0.0);
        this.sim.engines.setThrottle(0.0);
        this.sim.controls.setVirtualInput('elevator', 0.0);
        this.sim.controls.setVirtualInput('aileron', 0.0);
        this.sim.controls.setVirtualInput('rudder', 0.0);

        if (this.stageTimer >= 7.0) {
          this.setStage(DemoFlightDirector.STAGES.COMPLETED);
        }
        break;
      }
    }
  }

  updateBanner(title, desc) {
    if (this.titleEl) this.titleEl.textContent = title;
    if (this.descEl) this.descEl.textContent = desc;
    if (this.pillTextEl) {
      const match = title.match(/\[(\d+\/\d+)\]/);
      this.pillTextEl.textContent = match
        ? `🎬 AUTO DEMO [${match[1]}] [안내 열기 ▾]`
        : `🎬 AUTO DEMO [안내 열기 ▾]`;
    }
  }
}
