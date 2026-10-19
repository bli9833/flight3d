import * as THREE from 'three';
import { Atmosphere } from './physics/Atmosphere.js';
import { Aerodynamics } from './physics/Aerodynamics.js';
import { EngineModel } from './physics/EngineModel.js';
import { LandingGear } from './physics/LandingGear.js';
import { PFDCanvas } from './aircraft/PFDCanvas.js';
import { NDCanvas } from './aircraft/NDCanvas.js';
import { EICASCanvas } from './aircraft/EICASCanvas.js';
import { MCPCanvas } from './aircraft/MCPCanvas.js';
import { ISFDCanvas } from './aircraft/ISFDCanvas.js';
import { CDUCanvas } from './aircraft/CDUCanvas.js';
import { Boeing737 } from './aircraft/Boeing737.js';
import { Terrain } from './environment/Terrain.js';
import { WaterOcean } from './environment/WaterOcean.js';
import { Airport } from './environment/Airport.js';
import { FoliageAndCities } from './environment/FoliageAndCities.js';
import { Ships } from './environment/Ships.js';
import { SkyAtmosphere } from './environment/SkyAtmosphere.js';
import { LuklaTerrain } from './environment/LuklaTerrain.js';
import { LuklaAirport } from './environment/LuklaAirport.js';
import { FlightAudio } from './audio/FlightAudio.js';
import { FlightControls } from './controls/FlightControls.js';
import { CameraSystem } from './cameras/CameraSystem.js';
import { DiagnosticsInspector } from './ui/DiagnosticsInspector.js';
import { DemoFlightDirector } from './director/DemoFlightDirector.js';
import { CollisionDetector } from './physics/CollisionDetector.js';
import { ExplosionSystem } from './effects/ExplosionSystem.js';
import { TireSmokeSystem } from './effects/TireSmokeSystem.js';
import { TouchFlightControls } from './controls/TouchFlightControls.js';

// Expose THREE globally for test harness and browser console debugging
if (typeof window !== 'undefined') {
  window.THREE = THREE;
}

/**
 * Main Simulation Coordinator
 * Integrates 6-DOF rigid body physics, aircraft systems, procedural world, audio, and user interface.
 */
class FlightSimulator {
  constructor() {
    this.container = document.getElementById('canvas-container');

    // 1. Scene, Camera, Renderer
    this.scene = new THREE.Scene();
    // near: 0.25m and far: 45,000m combined with logarithmicDepthBuffer completely eliminates Z-fighting & screen flickering
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.25, 45000);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 2. Flight Instruments (Glass Cockpit Canvas Displays)
    this.pfdCanvas = new PFDCanvas(512, 512);
    this.ndCanvas = new NDCanvas(512, 512);
    this.eicasCanvas = new EICASCanvas(512, 512);
    this.mcpCanvas = new MCPCanvas(1024, 128);
    this.isfdCanvas = new ISFDCanvas(256, 256);
    this.cduCanvas = new CDUCanvas(512, 512);

    // 3. Boeing 737 Aircraft 3D Model
    this.aircraft = new Boeing737(
      this.pfdCanvas,
      this.ndCanvas,
      this.eicasCanvas,
      this.mcpCanvas,
      this.isfdCanvas,
      this.cduCanvas
    );
    this.scene.add(this.aircraft.group);

    // 4. Physics Engines
    this.aero = new Aerodynamics();
    this.engines = new EngineModel();
    this.gear = new LandingGear();

    // 5. Procedural World & Real-World Environments
    this.terrain = new Terrain(22000, 256);
    this.scene.add(this.terrain.mesh);

    this.water = new WaterOcean(36000);
    this.scene.add(this.water.mesh);

    this.airport = new Airport();
    this.scene.add(this.airport.group);

    this.foliage = new FoliageAndCities(this.terrain);
    this.scene.add(this.foliage.group);

    this.ships = new Ships(this.water);
    this.scene.add(this.ships.group);

    // Nepal Tenzing-Hillary (Lukla VNLK) Real-World 30m DEM Terrain & Airport
    this.luklaTerrain = new LuklaTerrain(22000, 255);
    this.luklaTerrain.mesh.visible = false;
    this.scene.add(this.luklaTerrain.mesh);

    this.luklaAirport = new LuklaAirport();
    this.luklaAirport.group.visible = false;
    this.scene.add(this.luklaAirport.group);

    this.activeAirport = 'coastal'; // 'coastal' | 'lukla'
    this.currentTerrain = this.terrain;
    this.currentAirport = this.airport;

    this.sky = new SkyAtmosphere(this.scene, this.renderer, this.water);
    this.water.syncWithAtmosphere(this.sky);

    // 6. Audio & Controls & Camera & Diagnostics
    this.audio = new FlightAudio();
    this.controls = new FlightControls(this.renderer.domElement);
    this.touchControls = new TouchFlightControls(this.controls);
    this.cameraSystem = new CameraSystem(this.camera, this.renderer.domElement);
    this.diagnostics = new DiagnosticsInspector(this);
    this.demoDirector = new DemoFlightDirector(this);

    // 7. Collision Detection & Explosion & Tire Smoke Particle Systems
    this.collisionDetector = new CollisionDetector(
      this.currentTerrain,
      this.currentAirport,
      this.foliage,
      this.ships,
      this.water
    );
    this.explosionSystem = new ExplosionSystem(this.scene, this.currentTerrain);
    this.tireSmokeSystem = new TireSmokeSystem(this.scene, this.currentTerrain);
    this.isCrashed = false;
    this.crashResult = null;
    this.lastOnGround = true;
    this.lastGearTarget = true;

    // 8. Rigid Body Physics State
    // Linear state
    this.position = new THREE.Vector3();
    this.linearVelocity = new THREE.Vector3(); // world m/s
    // Angular state
    this.quaternion = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3(); // body rad/s (p, q, r)

    // Simulation Timing
    this.clock = new THREE.Clock();
    this.physicsHz = 120;
    this.physicsDt = 1.0 / this.physicsHz;
    this.physicsAccumulator = 0;
    this.totalSimTime = 0;

    // Flight Telemetry Cache
    this.telemetry = {
      pitchDeg: 0,
      rollDeg: 0,
      headingDeg: 90,
      trackDeg: 90,
      altitudeFt: 0,
      radioAltFt: 0,
      iasKnots: 0,
      tasKnots: 0,
      groundSpeedKnots: 0,
      vsiFpm: 0,
      mach: 0,
      gForce: 1.0,
      isStalled: false,
      gearState: 1.0,
      isTransit: false,
      flapDegree: 5,
      flapIndex: 2,
      spoilers: 0,
      touchdown: false,
      onGround: true,
      x: 0,
      z: 0
    };

    // Autopilot simple leveler / heading hold
    this.apMaster = false;

    this.initControls();
    this.initUI();
    this.setAirport('lukla');

    // Resize handler
    window.addEventListener('resize', () => this.handleResize());

    // Click to start audio context
    window.addEventListener('click', () => {
      this.audio.init();
      this.audio.ensureContextRunning();
    }, { once: true });

    // Begin Animation Loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    // Auto-launch showcase demo flight on startup
    this.demoDirector.start();
  }

  initControls() {
    this.controls.onToggleGear = () => {
      this.gear.toggleGear();
    };

    this.controls.onToggleSpoilers = () => {
      this.aero.toggleSpoilers();
    };

    this.controls.onCycleFlaps = (inc) => {
      this.aero.cycleFlaps(inc);
      this.telemetry.flapIndex = this.aero.flapsIndex;
      this.telemetry.flapDegree = this.aero.currentFlapAngle;
    };

    this.controls.onToggleReverser = () => {
      this.engines.toggleReverser(this.telemetry.onGround);
    };

    this.controls.onCycleCamera = () => {
      const modeName = this.cameraSystem.cycleMode();
      this.showToast(`Camera: ${modeName}`);
    };

    this.controls.onToggleLights = () => {
      this.aircraft.lightsOn = !this.aircraft.lightsOn;
      this.aircraft.lightsGroup.visible = this.aircraft.lightsOn;
      this.showToast(`Lights: ${this.aircraft.lightsOn ? 'ON' : 'OFF'}`);
    };

    this.controls.onCycleTimeOfDay = (deltaHours) => {
      this.sky.setTimeOfDay(this.sky.timeOfDay + deltaHours, this.position, this.camera.position);
      this.water.syncWithAtmosphere(this.sky);
      const h = Math.floor(this.sky.timeOfDay);
      const m = Math.floor((this.sky.timeOfDay % 1) * 60);
      const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      this.showToast(`Time of Day: ${timeStr}`);
    };

    this.controls.onToggleAudio = () => {
      this.audio.init();
      this.audio.ensureContextRunning();
      const muted = !this.audio.isMuted;
      this.audio.setMuted(muted);
      this.showToast(`Sound: ${muted ? 'MUTED' : 'UNMUTED'}`);
    };
  }

  setPreset(type, isDemoInternal = false) {
    if (!isDemoInternal && this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }

    if (this.tireSmokeSystem) {
      this.tireSmokeSystem.clear();
    }
    this.lastOnGround = (type === 'runway');
    this.lastGearTarget = (type !== 'cruise');

    if (this.isCrashed) {
      this.isCrashed = false;
      this.crashResult = null;
      this.explosionSystem.clear();
      this.aircraft.resetCrashVisuals();
      const crashEl = document.getElementById('crash-overlay');
      if (crashEl) crashEl.style.display = 'none';
    }

    if (this.activeAirport === 'lukla') {
      const sin58 = 0.848048;
      const cos58 = 0.529919;

      if (type === 'runway') {
        // Aligned on Lukla Runway 06 Threshold (Elevation 2,805m, Heading 058°, 11.7% uphill slope)
        // At s = -210m: x = s*sin58, z = -s*cos58, groundH = 2811.3m (+2.15m gear = 2813.45m)
        this.position.set(-210.0 * sin58, 2813.45, 210.0 * cos58);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);

        // Pitch 6.71° nose-up aligned with 11.7% gradient, Heading 058° (yaw -58°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(6.71),
          -THREE.MathUtils.degToRad(58.0),
          0,
          'YXZ'
        );
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 0.0;
        this.engines.setThrottle(0.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(2); // Flaps 5
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 5.5;

        this.showToast('Preset: 루클라 활주로 06 (해발 2,805m, 11.7% 급경사 대기)');
      } else if (type === 'approach') {
        // Final Approach 2.0 NM out in Dudh Kosi Canyon (Alt 3,070m / 10,070ft)
        // Distance to threshold 06 (s = -263.5m) is 3,536.5m
        // Elevation drop to threshold (2,805m): 265m -> slope = 4.28°
        // At 69.4 m/s (135 kts), required sink rate is -5.20 m/s (-1,025 FPM)
        const distSW = -3800.0;
        this.position.set(distSW * sin58, 3070.0, -distSW * cos58);
        this.linearVelocity.set(69.4 * sin58, -5.20, -69.4 * cos58);
        this.angularVelocity.set(0, 0, 0);

        // Pitch 1.0° nose-up on 4.3° descent path, Heading 058° (yaw -58°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(1.0),
          -THREE.MathUtils.degToRad(58.0),
          0,
          'YXZ'
        );
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 0.56;
        this.engines.setThrottle(0.56);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(5); // Flaps 30 for short runway landing
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 6.2;

        this.showToast('Preset: 루클라 협곡 착륙 챌린지 (고도 10,070 FT, Rwy 06)');
      } else if (type === 'cliff') {
        // Lukla Runway 24 Downhill Cliff Dive Takeoff!
        // Starts at upper threshold 24 (s = +210m, groundH = 2860.7m + 2.15m gear = 2862.85m)
        this.position.set(210.0 * sin58, 2862.85, -210.0 * cos58);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        // Pitch nose down -6.71° along 11.7% downhill slope, Heading 238° (yaw -238°)
        const euler = new THREE.Euler(
          THREE.MathUtils.degToRad(-6.71),
          -THREE.MathUtils.degToRad(238.0),
          0,
          'YXZ'
        );
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 1.0; // TOGA 100%
        this.engines.setThrottle(1.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(2); // Flaps 5
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 4.0;

        this.showToast('Preset: 루클라 24번 활주로 절벽 가속 이륙 (11.7% 내리막 질주)');
      } else if (type === 'cruise') {
        // Scenic Himalayan Valley Cruise at 13,000 FT (3,960m)
        this.position.set(-1500, 3960, -800);
        this.linearVelocity.set(80, 0, -60);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.3);

        this.controls.throttle = 0.65;
        this.engines.setThrottle(0.65);
        this.gear.setGearTarget(false);
        this.gear.gearState = 0.0;
        this.aero.setFlapPosition(0);
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 2.5;

        this.showToast('Preset: 히말라야 산맥 순항 비행 (13,000 FT)');
      }
    } else {
      // Coastal International Airport Presets
      if (type === 'runway') {
        // Aligned on Runway 09L Threshold (Heading 090° East)
        this.position.set(-1350, 14.15, 0);
        this.linearVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.5); // Face East (+X)

        this.controls.throttle = 0.0;
        this.engines.setThrottle(0.0);
        this.engines.setReverser(false, true);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(2); // Flaps 5 for takeoff
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 4.5; // Takeoff trim

        this.showToast('Preset: Runway 09L (Ready for Takeoff)');
      } else if (type === 'approach') {
        // Final Approach 3 NM out on 3° glideslope (5.5 km west: x = -6500m, alt = 320m / 1050ft)
        this.position.set(-6500, 310, 0);
        // Speed 145 knots (74.5 m/s) heading East (+X), descending at -3.9 m/s (-770 fpm)
        this.linearVelocity.set(74.5, -3.9, 0);
        this.angularVelocity.set(0, 0, 0);

        // Pitch slightly nose-up (2.5°) with 3° descent path
        const euler = new THREE.Euler(THREE.MathUtils.degToRad(2.5), -Math.PI * 0.5, 0, 'YXZ');
        this.quaternion.setFromEuler(euler);

        this.controls.throttle = 0.52; // Approach thrust
        this.engines.setThrottle(0.52);
        this.gear.setGearTarget(true);
        this.gear.gearState = 1.0;
        this.aero.setFlapPosition(5); // Flaps 30 for landing
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 6.0;

        this.showToast('Preset: 3NM Final Approach (Runway 09L, 145 KTS, Flaps 30)');
      } else if (type === 'cruise') {
        // Scenic Coastal Cruise over Bay & Ships at 2,600 ft (800m), Speed 210 knots (108 m/s)
        this.position.set(-600, 750, 3200);
        this.linearVelocity.set(96, 0, -49); // Aligned with heading 153° (yaw -0.35pi)
        this.angularVelocity.set(0, 0, 0);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI * 0.35);

        this.controls.throttle = 0.65;
        this.engines.setThrottle(0.65);
        this.gear.setGearTarget(false);
        this.gear.gearState = 0.0;
        this.aero.setFlapPosition(0); // Clean
        this.aero.spoilers = 0.0;
        this.aero.pitchTrim = 2.5;

        this.showToast('Preset: Scenic Cruise (Bay & Ships)');
      }
    }

    this.controls.clearVirtualInputs();
    this.controls.brakes = 0.0;
    this.gear.setBrakes(0.0);
    this.physicsAccumulator = 0;

    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.aircraft.group.updateMatrixWorld(true);
    this.cameraSystem.snapToTarget(this.aircraft.group);
  }

  /**
   * Switch Active Airport Environment (Coastal International vs Nepal Lukla)
   */
  setAirport(id) {
    if (this.activeAirport === id) return;
    this.activeAirport = id;
    const isLukla = id === 'lukla';

    // Toggle 3D mesh visibility
    this.terrain.mesh.visible = !isLukla;
    this.airport.group.visible = !isLukla;
    this.water.mesh.visible = !isLukla;
    this.ships.group.visible = !isLukla;
    this.foliage.group.visible = !isLukla;

    this.luklaTerrain.mesh.visible = isLukla;
    this.luklaAirport.group.visible = isLukla;

    this.currentTerrain = isLukla ? this.luklaTerrain : this.terrain;
    this.currentAirport = isLukla ? this.luklaAirport : this.airport;

    if (this.collisionDetector) {
      if (isLukla) {
        this.collisionDetector.setEnvironment(this.luklaTerrain, this.luklaAirport, null, null, null);
      } else {
        this.collisionDetector.setEnvironment(this.terrain, this.airport, this.foliage, this.ships, this.water);
      }
    }

    if (this.explosionSystem) {
      this.explosionSystem.terrain = this.currentTerrain;
    }

    if (this.tireSmokeSystem) {
      this.tireSmokeSystem.terrain = this.currentTerrain;
    }

    // Relocate tower camera position for the active airport environment
    if (this.cameraSystem) {
      if (isLukla) {
        const t = this.luklaAirport.controlTowerData;
        this.cameraSystem.towerPos.set(t.x, t.y + t.height - 1.5, t.z);
      } else {
        this.cameraSystem.towerPos.set(120, 78, 280);
      }
    }

    // Sync cloud layer altitude with active airport elevation
    if (this.sky && typeof this.sky.setAirport === 'function') {
      this.sky.setAirport(id);
    }

    // Reconfigure cockpit navigation displays for active airport
    if (this.ndCanvas && typeof this.ndCanvas.setAirport === 'function') {
      this.ndCanvas.setAirport(id);
    }
    if (this.cduCanvas && typeof this.cduCanvas.setAirport === 'function') {
      this.cduCanvas.setAirport(id);
    }

    // Update UI preset button labels
    const btnRwy = document.getElementById('btn-preset-rwy');
    const btnApp = document.getElementById('btn-preset-app');
    const btnCru = document.getElementById('btn-preset-cru');
    const btnCliff = document.getElementById('btn-preset-cliff');

    if (isLukla) {
      if (btnRwy) btnRwy.textContent = '🛫 루클라 06 대기';
      if (btnApp) btnApp.textContent = '🛬 협곡 착륙 챌린지';
      if (btnCru) btnCru.textContent = '✈️ 히말라야 순항 (13,000 FT)';
      if (btnCliff) btnCliff.style.display = 'block';
    } else {
      if (btnRwy) btnRwy.textContent = '🛫 활주로 이륙 (09L)';
      if (btnApp) btnApp.textContent = '🛬 착륙 접근 (3 NM)';
      if (btnCru) btnCru.textContent = '✈️ 순항 비행 (6,000 FT)';
      if (btnCliff) btnCliff.style.display = 'none';
    }

    document.getElementById('btn-airport-coastal')?.classList.toggle('active', !isLukla);
    document.getElementById('btn-airport-lukla')?.classList.toggle('active', isLukla);

    if (this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }

    this.setPreset('runway');

    const desc = isLukla
      ? '네팔 텐징-힐러리 공항 (VNLK 06번 활주로, 해발 2,805m, 11.7% 급경사)'
      : '태평양 해안 국제공항 (Runway 09L, 해발 12m)';
    this.showToast(`공항 변경: ${desc}`);
  }

  /**
   * Physics Integration Substep (120 Hz)
   */
  integratePhysics(dt) {
    // If crashed, damp out velocities and rest on terrain
    if (this.isCrashed) {
      this.linearVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 2.8));
      this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 3.5));
      this.position.addScaledVector(this.linearVelocity, dt);
      const groundH = this.currentTerrain ? this.currentTerrain.getHeight(this.position.x, this.position.z) : 0.0;
      if (this.position.y < groundH + 0.8) {
        this.position.y = groundH + 0.8;
      }
      this.aircraft.group.position.copy(this.position);
      return;
    }

    // 1. Controls processing
    this.controls.update(dt, this.telemetry.iasKnots);
    this.aero.elevator = this.controls.elevator;
    this.aero.aileron = this.controls.aileron;
    this.aero.rudder = this.controls.rudder;
    this.aero.pitchTrim = this.controls.pitchTrim;

    // Autopilot simple leveler
    if (this.apMaster && Math.abs(this.controls.elevator) < 0.05 && Math.abs(this.controls.aileron) < 0.05) {
      const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
      this.aero.aileron = -euler.z * 1.5; // Wings level
      const targetPitchRad = THREE.MathUtils.degToRad(2.0);
      this.aero.elevator = (targetPitchRad - euler.x) * 2.0;
    }

    // Ground steering & brakes
    const groundSpeed = Math.sqrt(this.linearVelocity.x * this.linearVelocity.x + this.linearVelocity.z * this.linearVelocity.z);
    this.gear.setSteering(this.controls.rudder, groundSpeed);
    this.gear.setBrakes(this.controls.brakes);

    // 2. Turbofan Engines Update
    this.engines.setThrottle(this.controls.throttle);
    const altitudeMeters = this.position.y;
    const atmos = Atmosphere.getConditions(altitudeMeters);
    const tas = this.linearVelocity.length();
    const engineData = this.engines.update(dt, altitudeMeters, tas, atmos.densityRatio);

    // 3. Terrain Height & Ground Clearance
    const groundHeight = this.currentTerrain.getHeight(this.position.x, this.position.z);
    const heightAboveGround = Math.max(0, this.position.y - groundHeight);

    // 4. Landing Gear Forces & Ground Friction
    const gearResult = this.gear.update(
      dt,
      this.aircraft.group,
      this.linearVelocity,
      this.angularVelocity,
      (x, z) => this.currentTerrain.getHeight(x, z)
    );

    // 5. Aerodynamic Forces & Moments
    const aeroResult = this.aero.computeAero(
      dt,
      this.aircraft.group,
      this.linearVelocity,
      this.angularVelocity,
      altitudeMeters,
      heightAboveGround,
      engineData.totalThrust,
      gearResult.gearState
    );

    // 6. Thrust Force in World Space
    // Engine thrust acts along forward longitudinal axis (-Z in Three.js aircraft space)
    const thrustWorld = new THREE.Vector3(0, 0, -engineData.totalThrust).applyQuaternion(this.quaternion);

    // 7. Gravity Force
    const gravityWorld = new THREE.Vector3(0, -this.aero.mass * Atmosphere.G0, 0);

    // 8. Total Forces Integration: F = m * a
    const netForceWorld = new THREE.Vector3()
      .add(gravityWorld)
      .add(thrustWorld)
      .add(aeroResult.forceWorld)
      .add(gearResult.forces);

    const accelerationWorld = netForceWorld.divideScalar(this.aero.mass);
    this.linearVelocity.addScaledVector(accelerationWorld, dt);

    // Clamp near-zero velocity when parked on ground with brakes
    if (gearResult.onGround && this.controls.brakes > 0.5 && this.linearVelocity.length() < 0.4 && this.controls.throttle < 0.1) {
      this.linearVelocity.set(0, 0, 0);
    }

    this.position.addScaledVector(this.linearVelocity, dt);

    // Crash terrain penetration prevention (allow dynamic suspension stroke of up to 0.55m)
    const minSafeY = groundHeight + (gearResult.gearState > 0.5 ? 1.55 : 0.8);
    if (this.position.y < minSafeY) {
      this.position.y = minSafeY;
      if (this.linearVelocity.y < 0) this.linearVelocity.y = 0;
    }

    // 9. Total Moments Integration: M = I * alpha
    // Moment in body frame: aero moment + landing gear moment
    const netMomentBody = new THREE.Vector3()
      .add(aeroResult.momentBody)
      .add(gearResult.moments);

    // Angular acceleration: [p_dot, q_dot, r_dot] = [Mx/Ixx, My/Iyy, Mz/Izz]
    const angAccBody = new THREE.Vector3(
      netMomentBody.x * this.aero.invIyy, // Pitch (around X)
      netMomentBody.y * this.aero.invIzz, // Yaw (around Y)
      netMomentBody.z * this.aero.invIxx  // Roll (around Z)
    );

    this.angularVelocity.addScaledVector(angAccBody, dt);

    // Natural rotational damping (heavy transport inertia dissipation)
    this.angularVelocity.multiplyScalar(Math.max(0.0, 1.0 - dt * 0.35));

    // Update Aircraft Orientation Quaternion
    // Delta rotation from body angular velocity: omega x dt
    const deltaRot = new THREE.Quaternion(
      this.angularVelocity.x * dt * 0.5,
      this.angularVelocity.y * dt * 0.5,
      this.angularVelocity.z * dt * 0.5,
      1.0
    ).normalize();

    this.quaternion.multiply(deltaRot).normalize();

    // Sync Three.js aircraft mesh transform
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);

    // 10. Update Telemetry State
    const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
    const rollDeg = THREE.MathUtils.radToDeg(-euler.z);
    // Heading: forward vector (-Z in aircraft local space) projected to horizontal XZ plane
    const forwardVec = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    const headingDeg = (THREE.MathUtils.radToDeg(Math.atan2(forwardVec.x, -forwardVec.z)) + 360) % 360;

    // Track
    const trackDeg = (THREE.MathUtils.radToDeg(Math.atan2(this.linearVelocity.x, -this.linearVelocity.z)) + 360) % 360;

    // Compute authentic load factor Nz (accelerometer along body cabin vertical axis +Y)
    const nonGravForceWorld = new THREE.Vector3()
      .add(thrustWorld)
      .add(aeroResult.forceWorld)
      .add(gearResult.forces);
    const cabinCeilingWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
    const measuredGForce = nonGravForceWorld.dot(cabinCeilingWorld) / (this.aero.mass * Atmosphere.G0);

    this.telemetry = {
      pitchDeg,
      rollDeg,
      headingDeg,
      trackDeg,
      altitudeFt: Atmosphere.metersToFeet(this.position.y),
      radioAltFt: Atmosphere.metersToFeet(heightAboveGround),
      iasKnots: aeroResult.iasKnots,
      tasKnots: aeroResult.tasKnots,
      groundSpeedKnots: Atmosphere.msToKnots(groundSpeed),
      vsiFpm: Atmosphere.metersToFeet(this.linearVelocity.y) * 60.0,
      mach: aeroResult.mach,
      gForce: Math.max(-2.5, Math.min(5.5, measuredGForce)),
      isStalled: aeroResult.isStalled,
      stallSeverity: aeroResult.stallSeverity,
      buffetVibration: aeroResult.buffetVibration,
      engine1: engineData.engine1,
      engine2: engineData.engine2,
      reverserActive: engineData.reverserActive,
      gearState: gearResult.gearState,
      isTransit: gearResult.isTransit,
      compressions: gearResult.compressions,
      flapDegree: this.aero.currentFlapAngle,
      flapIndex: this.aero.flapsIndex,
      spoilers: this.aero.spoilers,
      touchdown: gearResult.touchdown,
      onGround: gearResult.onGround,
      apEngaged: this.apMaster,
      elevator: this.controls.elevator,
      aileron: this.controls.aileron,
      rudder: this.controls.rudder,
      throttle: this.controls.throttle,
      pitchTrim: this.aero.pitchTrim,
      x: this.position.x,
      z: this.position.z
    };

    // 11. Touchdown Tire Smoke & Runway Friction Particles
    if (gearResult.touchdown && gearResult.touchdownContacts && gearResult.touchdownContacts.length > 0) {
      this.tireSmokeSystem.spawnTouchdownSmoke(gearResult.touchdownContacts, this.linearVelocity);
    }
    if (gearResult.onGround && this.controls.brakes > 0.6) {
      this.tireSmokeSystem.spawnBrakingSmoke(this.gear.contacts, this.linearVelocity, this.controls.brakes);
    }

    // 12. Cinematic Camera Cuts: Automatic temporary gear view for Takeoff, Touchdown, and Gear Retract/Extend
    const gsKnots = Atmosphere.msToKnots(groundSpeed);
    if (this.lastOnGround && !gearResult.onGround && gsKnots > 75) {
      // Takeoff liftoff
      this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
      this.showToast('🎥 랜딩 기어 뷰: 이륙 상승 (Takeoff Climb)');
    } else if (((!this.lastOnGround && gearResult.onGround && gsKnots > 45) || gearResult.touchdown) && this.totalSimTime > 2.0) {
      // Touchdown landing
      this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 5.0);
      this.showToast('🎥 랜딩 기어 뷰: 활주로 접지 & 서스펜션 완충 (Touchdown)');
    }

    const currentGearTarget = this.gear.targetGearState > 0.5;
    if (this.lastGearTarget !== currentGearTarget && this.totalSimTime > 1.0) {
      if (!currentGearTarget) {
        // Gear retracting
        this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
        this.showToast('🎥 랜딩 기어 뷰: 기어 수납 (Gear Retracting)');
      } else {
        // Gear extending
        this.cameraSystem.showTemporaryView(CameraSystem.MODES.GEAR, 4.5);
        this.showToast('🎥 랜딩 기어 뷰: 기어 전개 (Gear Extending)');
      }
      this.lastGearTarget = currentGearTarget;
    }
    this.lastOnGround = gearResult.onGround;

    // 13. Check Multi-Obstacle Collisions (Terrain, Water, Tower, Buildings, Trees, Ships)
    if (!this.isCrashed) {
      const crash = this.collisionDetector.checkCollision(
        this.position,
        this.quaternion,
        this.linearVelocity,
        gearResult.gearState,
        pitchDeg,
        rollDeg
      );

      if (crash) {
        this.triggerCrash(crash);
      }
    }
  }

  triggerCrash(crashResult) {
    if (this.isCrashed) return;
    this.isCrashed = true;
    this.crashResult = crashResult;

    // 1. Spawn Visual Explosion Particles, Fireball, Smoke & Dynamic Light Flash
    this.explosionSystem.spawnExplosion(crashResult);

    // 2. Procedural Audio Detonation & Metal Crunch Sound
    this.audio.playExplosion(crashResult.type === 'WATER');

    // 3. Aircraft Structural Damage Visuals
    this.aircraft.triggerCrashVisuals(crashResult.type);

    // 4. Catastrophic Camera Trauma Shake
    this.cameraSystem.addTrauma(1.0);

    // 5. Halt Demo Flight if active
    if (this.demoDirector && this.demoDirector.isActive) {
      this.demoDirector.stop();
    }

    // 6. Kill Engines and Damp Kinetic Energy
    this.engines.setThrottle(0.0);
    this.controls.throttle = 0.0;
    this.linearVelocity.multiplyScalar(0.25);
    if (this.linearVelocity.y < 0) this.linearVelocity.y = 0;

    // 7. Show Crash UI Overlay
    this.showCrashUI(crashResult);
  }

  resetCrash() {
    this.isCrashed = false;
    this.crashResult = null;
    this.explosionSystem.clear();
    this.aircraft.resetCrashVisuals();

    const crashEl = document.getElementById('crash-overlay');
    if (crashEl) crashEl.style.display = 'none';

    this.setPreset('runway');
    this.showToast('기체 수리 완료: 활주로 09L에서 재시작되었습니다.');
  }

  showCrashUI(crashResult) {
    const overlay = document.getElementById('crash-overlay');
    const title = document.getElementById('crash-title');
    const desc = document.getElementById('crash-desc');
    const speed = document.getElementById('crash-speed');
    const type = document.getElementById('crash-type');

    if (title) title.textContent = crashResult.name;
    if (desc) desc.textContent = crashResult.description;
    if (speed) speed.textContent = `${Math.round(crashResult.speedKnots)} KT`;
    if (type) type.textContent = crashResult.type;

    if (overlay) overlay.style.display = 'flex';
  }

  /**
   * Deterministic Simulation Step (for automated test harness & replay)
   * Runs the exact 120Hz physics substepping for the requested duration in simulation time.
   * @param {number} simSeconds 
   * @returns {object} updated telemetry state
   */
  stepSimulation(simSeconds) {
    const numSubsteps = Math.max(1, Math.round(simSeconds * this.physicsHz));
    for (let i = 0; i < numSubsteps; i++) {
      if (this.demoDirector && this.demoDirector.isActive) {
        this.demoDirector.update(this.physicsDt);
      }
      this.integratePhysics(this.physicsDt);
      this.totalSimTime += this.physicsDt;
    }
    const isCockpit = this.cameraSystem.mode === CameraSystem.MODES.COCKPIT;
    this.aircraft.setCockpitMode(isCockpit);
    this.aircraft.update(this.physicsDt, this.telemetry);
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.aircraft.group.updateMatrixWorld(true);
    this.cameraSystem.update(this.physicsDt, this.aircraft.group, this.telemetry);
    this.sky.updateSun(this.position, this.camera.position);
    this.explosionSystem.update(simSeconds);
    this.tireSmokeSystem.update(simSeconds);
    this.touchControls.updateUI(this.telemetry);
    this.updateHUD();
    return this.telemetry;
  }

  /**
   * Main Frame Loop
   */
  animate() {
    requestAnimationFrame(this.animate);

    const frameDelta = Math.min(0.1, this.clock.getDelta());
    this.physicsAccumulator += frameDelta;
    this.totalSimTime += frameDelta;

    // High-rate substepping for rock-solid flight physics
    while (this.physicsAccumulator >= this.physicsDt) {
      if (this.demoDirector && this.demoDirector.isActive) {
        this.demoDirector.update(this.physicsDt);
      }
      this.integratePhysics(this.physicsDt);
      this.physicsAccumulator -= this.physicsDt;
    }

    // 1. Update 3D Aircraft Model & Articulations
    this.aircraft.update(frameDelta, this.telemetry);
    this.aircraft.group.position.copy(this.position);
    this.aircraft.group.quaternion.copy(this.quaternion);
    this.aircraft.group.updateMatrixWorld(true);

    // 2. Update Flight Instrument Canvas Displays
    this.pfdCanvas.updateData(this.telemetry);
    this.pfdCanvas.render();

    this.ndCanvas.updateData(this.telemetry);
    this.ndCanvas.render();

    this.eicasCanvas.updateData(this.telemetry);
    this.eicasCanvas.render();

    this.mcpCanvas.updateData(this.telemetry);
    this.isfdCanvas.updateData(this.telemetry);
    this.cduCanvas.updateData(this.telemetry);

    // 3. Update Environment Animations & Explosion Particles
    if (this.activeAirport !== 'lukla') {
      this.water.update(frameDelta);
      this.ships.update(frameDelta, this.totalSimTime);
    }
    if (this.currentAirport) {
      this.currentAirport.update(frameDelta, this.position, this.totalSimTime);
    }
    this.sky.updateSun(this.position, this.camera.position);
    this.explosionSystem.update(frameDelta);
    this.tireSmokeSystem.update(frameDelta);

    // 4. Update Cockpit Visibility & Audio
    const isCockpit = this.cameraSystem.mode === CameraSystem.MODES.COCKPIT;
    this.aircraft.setCockpitMode(isCockpit);
    this.audio.update(frameDelta, this.telemetry, isCockpit);

    // 6. Update Camera System & Dynamic FOV (60° in cockpit eliminates fisheye speed distortion)
    const targetFov = isCockpit ? 60 : 54;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
    this.cameraSystem.update(frameDelta, this.aircraft.group, this.telemetry);

    // 7. Update HTML HUD & Diagnostics Inspector & Touch Controls
    this.updateHUD();
    this.touchControls.updateUI(this.telemetry);
    this.diagnostics.update(frameDelta, this.telemetry);

    // 8. Render 3D Scene
    this.renderer.render(this.scene, this.camera);
  }

  updateHUD() {
    const elIas = document.getElementById('hud-ias');
    const elAlt = document.getElementById('hud-alt');
    const elHdg = document.getElementById('hud-hdg');
    const elVsi = document.getElementById('hud-vsi');
    const elN1 = document.getElementById('hud-n1');
    const elFlaps = document.getElementById('hud-flaps');
    const elGear = document.getElementById('hud-gear');
    const elSpoilers = document.getElementById('hud-spoilers');
    const elGForce = document.getElementById('hud-g');
    const elStall = document.getElementById('hud-stall');
    const elCam = document.getElementById('hud-cam');

    if (elIas) elIas.textContent = `${Math.round(this.telemetry.iasKnots)} KT`;
    if (elAlt) elAlt.textContent = `${Math.round(this.telemetry.altitudeFt)} FT`;
    if (elHdg) elHdg.textContent = `${Math.round(this.telemetry.headingDeg).toString().padStart(3, '0')}°`;
    if (elVsi) elVsi.textContent = `${Math.round(this.telemetry.vsiFpm)} FPM`;
    if (elN1) elN1.textContent = `${Math.round(this.telemetry.engine1 ? this.telemetry.engine1.n1 : 22)}%`;
    if (elFlaps) elFlaps.textContent = `${Math.round(this.telemetry.flapDegree)}°`;
    if (elGear) {
      elGear.textContent = this.telemetry.gearState > 0.95 ? 'DOWN' : (this.telemetry.gearState < 0.05 ? 'UP' : 'TRANS');
      elGear.className = this.telemetry.gearState > 0.95 ? 'status-green' : (this.telemetry.gearState < 0.05 ? 'status-dim' : 'status-amber');
    }
    if (elSpoilers) {
      elSpoilers.textContent = this.telemetry.spoilers > 0.1 ? 'EXT' : 'ARM';
      elSpoilers.className = this.telemetry.spoilers > 0.1 ? 'status-amber' : 'status-green';
    }
    if (elGForce) elGForce.textContent = `${this.telemetry.gForce.toFixed(2)} G`;
    if (elStall) {
      elStall.style.display = this.telemetry.isStalled ? 'block' : 'none';
    }
    if (elCam) elCam.textContent = this.cameraSystem.getModeName();
  }

  showToast(msg) {
    const toast = document.getElementById('toast-msg');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2500);
  }

  initUI() {
    // Airport Selector UI buttons
    document.getElementById('btn-airport-coastal')?.addEventListener('click', () => this.setAirport('coastal'));
    document.getElementById('btn-airport-lukla')?.addEventListener('click', () => this.setAirport('lukla'));

    // Quick clickable UI buttons
    document.getElementById('btn-preset-rwy')?.addEventListener('click', () => this.setPreset('runway'));
    document.getElementById('btn-preset-app')?.addEventListener('click', () => this.setPreset('approach'));
    document.getElementById('btn-preset-cru')?.addEventListener('click', () => this.setPreset('cruise'));
    document.getElementById('btn-preset-cliff')?.addEventListener('click', () => this.setPreset('cliff'));

    document.getElementById('btn-flaps-ext')?.addEventListener('click', () => this.controls.onCycleFlaps(1));
    document.getElementById('btn-flaps-ret')?.addEventListener('click', () => this.controls.onCycleFlaps(-1));
    document.getElementById('btn-gear')?.addEventListener('click', () => this.controls.onToggleGear());
    document.getElementById('btn-spoilers')?.addEventListener('click', () => this.controls.onToggleSpoilers());
    document.getElementById('btn-reverser')?.addEventListener('click', () => this.controls.onToggleReverser());
    document.getElementById('btn-cam')?.addEventListener('click', () => this.controls.onCycleCamera());
    document.getElementById('btn-time')?.addEventListener('click', () => this.controls.onCycleTimeOfDay(3.0));
    document.getElementById('btn-sound')?.addEventListener('click', () => this.controls.onToggleAudio());
    document.getElementById('btn-diag')?.addEventListener('click', () => this.diagnostics.toggle());
    document.getElementById('btn-touch-toggle')?.addEventListener('click', () => {
      this.touchControls.toggle();
      const state = this.touchControls.enabled ? 'ON' : 'OFF';
      this.showToast(`터치 조작 컨트롤: ${state}`);
    });
    document.getElementById('btn-ap')?.addEventListener('click', () => {
      this.apMaster = !this.apMaster;
      this.showToast(`Autopilot: ${this.apMaster ? 'ENGAGED' : 'DISENGAGED'}`);
    });

    // Initialize Demo Director UI bindings
    this.demoDirector.initUI();

    // Flight Guide Modal
    const helpModal = document.getElementById('help-modal');
    document.getElementById('btn-help')?.addEventListener('click', () => {
      helpModal?.classList.toggle('visible');
    });
    document.getElementById('btn-help-close')?.addEventListener('click', () => {
      helpModal?.classList.remove('visible');
    });

    // Crash Restart Button & Keyboard Shortcuts [Space / R / Enter]
    document.getElementById('btn-crash-restart')?.addEventListener('click', () => {
      this.resetCrash();
    });

    window.addEventListener('keydown', (e) => {
      if (this.isCrashed && (e.code === 'Space' || e.code === 'KeyR' || e.code === 'Enter')) {
        this.resetCrash();
      }
    });
  }

  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Start Simulator when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.simulator = new FlightSimulator();
});
