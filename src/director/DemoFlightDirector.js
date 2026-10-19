import * as THREE from 'three';
import { CameraSystem } from '../cameras/CameraSystem.js';

/**
 * Autonomous Cinematic Demo Flight Director
 * 
 * Orchestrates a comprehensive showcase demonstration of the simulator:
 * 1. Pre-Flight Drone Orbit Inspection (Elevated 360° Drone View, Flaps 5, Golden Morning)
 * 2. Runway 09L Takeoff Roll (Cockpit View, TOGA 100%, Vr rotation)
 * 3. Liftoff & Climb (Chase Exterior View, Gear Retraction, Mountains & City)
 * 4. Scenic Coastal Banking Turn (Wing View, 20° Bank over Bay & Hills)
 * 5. Ocean Fleet & Waves Cruise (Cinematic Flyby View, Gerstner Waves & Ships)
 * 6. 3NM Final Approach on 3° Glideslope (Cockpit View, PAPI 2 White 2 Red Guidance)
 * 7. Flare, Touchdown, Spoilers & Reverse Thrust Rollout (Chase/Gear View, Safe Stop)
 * 8. Post-Landing Drone Orbit Showcase (Elevated 360° Drone View, Safe Stop Inspection)
 * 9. Seamless Handover to User Manual Flight
 */
export class DemoFlightDirector {
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

  constructor(simulator) {
    this.sim = simulator;
    this.isActive = false;
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

  start() {
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

    this.setStage(DemoFlightDirector.STAGES.PREFLIGHT_ORBIT);
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

    switch (newStage) {
      case DemoFlightDirector.STAGES.PREFLIGHT_ORBIT:
        this.updateBanner(
          '🚁 [1/8] 비행 전 드론 서클 점검 (Pre-Flight Drone Inspection)',
          '활주로 09L 대기 • 보잉 737 기체 외형 360° 공중 점검 • 플랩 5° 및 엔진 가동 준비'
        );
        // Setup runway preset parked
        this.sim.setPreset('runway', true);
        this.sim.cameraSystem.setMode(CameraSystem.MODES.DRONE);
        this.sim.cameraSystem.resetDroneOrbit(1.8, 38.0, 11.5);
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
        this.sim.sky.setTimeOfDay(7.2); // Golden morning
        this.sim.water.setSunDirection(this.sim.sky.getSunDirection());

        // Full TOGA thrust, release brakes
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
        // Rotate smoothly at 2.2°/s
        this.sim.controls.setVirtualInput('elevator', 0.65);
        break;

      case DemoFlightDirector.STAGES.COASTAL_BANK:
        this.updateBanner(
          '⛰️ [4/8] 해안가 선회 비행 (Scenic Coastal Banking Turn)',
          '우측 20° 선회 • 굴곡 산맥 지형, 3,500+ 그루 식생 및 500+ 채 도심 빌딩 조망'
        );
        this.sim.cameraSystem.setMode(CameraSystem.MODES.WING);
        this.sim.aero.setFlapPosition(0); // Clean
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
        // Switch to approach preset
        this.sim.setPreset('approach', true);
        this.sim.cameraSystem.setMode(CameraSystem.MODES.COCKPIT);
        this.sim.sky.setTimeOfDay(17.6); // Sunset dusk
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
        this.sim.cameraSystem.resetDroneOrbit(this.sim.cameraSystem.droneOrbitAngle, 38.0, 11.5);
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

  update(dt) {
    if (!this.isActive) return;

    this.stageTimer += dt;
    this.totalTimer += dt;
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

        // Once liftoff confirmed, retract gear and hold 12° climb pitch
        if (!tel.onGround && tel.radioAltFt > 10.0) {
          if (tel.gearState > 0.1 && !tel.isTransit) {
            this.sim.gear.setGearTarget(false);
          }
          const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
          const pitchErr = 12.0 - tel.pitchDeg;
          const elevatorCmd = 0.18 + pitchErr * 0.035 - pitchRateDeg * 0.02;
          this.sim.controls.setVirtualInput('elevator', Math.max(0.08, Math.min(0.35, elevatorCmd)));
        }

        // Once gear is retracting, let the gear cam view showcase retraction (~6.0s), then switch to exterior chase
        if (this.stageTimer > 6.0 && this.sim.cameraSystem.mode !== CameraSystem.MODES.CHASE) {
          this.sim.cameraSystem.setMode(CameraSystem.MODES.CHASE);
        }

        // When reaching 650 FT AGL, begin coastal banking turn
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

        // Closed-loop bank angle target clamped between -20° and +20°
        const targetBankDeg = Math.max(-20.0, Math.min(20.0, hdgDiff * 0.65));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));

        // Back-pressure elevator to hold ~10° climb pitch and maintain altitude
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const targetPitch = 10.0;
        const pitchErr = targetPitch - tel.pitchDeg;
        const elevatorCmd = 0.12 + pitchErr * 0.035 - pitchRateDeg * 0.02;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.15, Math.min(0.25, elevatorCmd)));
        this.sim.controls.setVirtualInput('rudder', Math.max(-0.10, Math.min(0.10, targetBankDeg * 0.005)));

        // Gradually transition time-of-day towards sunset
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

        // Heading 155° tracking with bank clamped to safe ±12°
        const targetHeading = 155.0;
        const hdgDiff = ((targetHeading - tel.headingDeg + 540) % 360) - 180;
        const targetBankDeg = Math.max(-12.0, Math.min(12.0, hdgDiff * 0.5));
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const rollErr = targetBankDeg - tel.rollDeg;
        const aileronCmd = rollErr * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.25, Math.min(0.25, aileronCmd)));
        this.sim.controls.setVirtualInput('rudder', 0.0);
        this.sim.controls.setVirtualInput('throttle', 0.65);

        // Switch to chase camera halfway through ocean cruise
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

        // Pitch guidance with full glideslope authority
        const altDiff = idealAltFt - tel.altitudeFt;
        const targetPitchDeg = Math.max(-1.0, Math.min(6.5, 2.8 + altDiff * 0.035));
        const pitchDiff = targetPitchDeg - tel.pitchDeg;
        const pitchRateDeg = THREE.MathUtils.radToDeg(this.sim.angularVelocity.x);
        const elevatorCmd = pitchDiff * 0.08 - pitchRateDeg * 0.03;
        this.sim.controls.setVirtualInput('elevator', Math.max(-0.35, Math.min(0.45, elevatorCmd)));

        // Lateral guidance (keep z centered on runway centerline 0)
        const targetRoll = Math.max(-10.0, Math.min(10.0, -this.sim.position.z * 0.15));
        const rollDiff = targetRoll - tel.rollDeg;
        const rollRateDeg = -THREE.MathUtils.radToDeg(this.sim.angularVelocity.z);
        const aileronCmd = rollDiff * 0.035 - rollRateDeg * 0.025;
        this.sim.controls.setVirtualInput('aileron', Math.max(-0.20, Math.min(0.20, aileronCmd)));

        // Throttle management for V_ref (142 KT) with glideslope energy compensation
        const speedErr = 142 - tel.iasKnots;
        const energyComp = altDiff > 25 ? 0.12 : (altDiff < -25 ? -0.08 : 0.0);
        this.sim.controls.setVirtualInput('throttle', Math.max(0.35, Math.min(0.75, 0.48 + speedErr * 0.025 + energyComp)));

        // Flare at 30 FT AGL strictly past the runway threshold (x >= -1600m)
        const isOverRunway = this.sim.position.x >= -1600;
        if (!this.approachFlarInitiated && isOverRunway && tel.radioAltFt <= 30.0 && tel.radioAltFt > 0) {
          this.approachFlarInitiated = true;
          this.sim.controls.setVirtualInput('throttle', 0.0);
          this.sim.engines.setThrottle(0.0);
          this.sim.controls.setVirtualInput('elevator', 0.14); // Gentle flare
        }

        // Detect touchdown strictly over paved runway tarmac
        if (isOverRunway && (tel.onGround || (this.approachFlarInitiated && tel.radioAltFt <= 12.5))) {
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
        this.sim.controls.setVirtualInput('rudder', -this.sim.position.z * 0.02); // Keep center
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
