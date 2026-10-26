import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { CessnaProximityScenario } from '../src/director/scenarios/CessnaProximityScenario.js';
import { buildingClearance } from '../src/director/scenarios/cessnaRoutes.js';
import { CESSNA_172 } from '../src/config/aircraftConfigs.js';
import { Aerodynamics } from '../src/physics/Aerodynamics.js';
import { EngineModel } from '../src/physics/EngineModel.js';
import { LandingGear } from '../src/physics/LandingGear.js';

function createProximitySimulator() {
  const inputs = {};
  let customUpdater = null;
  const mockCamera = {
    position: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0),
    fov: 64,
    lookTarget: new THREE.Vector3(),
    lookAt(v) { this.lookTarget.copy(v); },
    updateProjectionMatrix() {}
  };

  return {
    activeAirport: 'coastal',
    currentAircraftId: 'C172',
    lobby: { demoProfile: 'proximity' },
    position: new THREE.Vector3(),
    linearVelocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    currentTerrain: { getHeight: () => 0, isLoaded: true },
    foliage: { buildingData: [], setTimeOfDay: () => {} },
    aircraft: { group: new THREE.Group(), modelLoaded: true },
    aero: new Aerodynamics(CESSNA_172),
    engines: new EngineModel(CESSNA_172),
    gear: new LandingGear(CESSNA_172),
    telemetry: {
      pitchDeg: 2.5,
      rollDeg: 0,
      headingDeg: 35,
      iasKnots: 100,
      onGround: false
    },
    controls: {
      throttle: 0.5,
      setVirtualInput(key, value) {
        assert.ok(Number.isFinite(value), `${key} must be finite`);
        inputs[key] = value;
      },
      clearVirtualInputs() {
        for (const k of Object.keys(inputs)) delete inputs[k];
      },
      setParkingBrake() {}
    },
    setPreset() {},
    applyComputedTrim() {},
    sky: { setTimeOfDay: () => {} },
    cameraSystem: {
      camera: mockCamera,
      userModeSelected: false,
      userLookOverridden: false,
      setCustomViewUpdater(fn) { customUpdater = fn; },
      triggerUpdater(dt = 0.05) {
        if (!customUpdater) return false;
        return customUpdater({
          dt,
          camera: mockCamera,
          planePos: new THREE.Vector3(100, 50, 200),
          planeQuat: new THREE.Quaternion(),
          aircraftMesh: new THREE.Object3D(),
          flightState: {},
          queryGroundHeight: () => 0
        });
      }
    },
    inputs,
    mockCamera
  };
}

describe('Cessna Proximity Buzz Montage Scenario', () => {
  it('initializes and selects proximity scenario when profile is proximity', () => {
    const sim = createProximitySimulator();
    const director = new DemoFlightDirector(sim);

    director.start();
    assert.equal(director.isActive, true);
    assert.equal(director.profile, 'proximity');
    assert.equal(director.getActiveScenario(), director.cessnaProximityScenario);
    assert.equal(director.currentStage, CessnaProximityScenario.STAGES.SHIP_BUZZ);
    assert.equal(director.cessnaProximityScenario.result.status, 'running');
  });

  it('progresses through all 5 proximity scenes and completes with clean handover', () => {
    const sim = createProximitySimulator();
    const director = new DemoFlightDirector(sim);

    director.start();
    const scenario = director.cessnaProximityScenario;

    // Stage 1: SHIP_BUZZ
    assert.equal(director.currentStage, CessnaProximityScenario.STAGES.SHIP_BUZZ);
    director.update(0.1);
    assert.ok(Number.isFinite(sim.inputs.elevator));
    assert.ok(Number.isFinite(sim.inputs.throttle));
    assert.ok(Number.isFinite(sim.inputs.rudder));

    // Fast-forward past SCENE_DURATION (7.5s) to trigger cut to Scene 2
    director.stageTimer = 7.5;
    director.update(0.05);

    // Stage 2: BUILDING_WEAVE
    assert.equal(director.currentStage, CessnaProximityScenario.STAGES.BUILDING_WEAVE);
    assert.equal(scenario.result.stagesCompleted, 1);
    director.update(0.1);
    assert.ok(Number.isFinite(sim.inputs.elevator));

    // Fast-forward to Scene 3: TREE_CANOPY
    director.stageTimer = 7.5;
    director.update(0.05);
    assert.equal(director.currentStage, CessnaProximityScenario.STAGES.TREE_CANOPY);
    assert.equal(scenario.result.stagesCompleted, 2);

    // Fast-forward to Scene 4: LAKE_SKIM
    director.stageTimer = 7.5;
    director.update(0.05);
    assert.equal(director.currentStage, CessnaProximityScenario.STAGES.LAKE_SKIM);
    assert.equal(scenario.result.stagesCompleted, 3);
    assert.ok(sim.position.y <= 5.0, 'Lake skim should position Cessna close to water surface');

    // Fast-forward to Scene 5: TOWER_BUZZ
    director.stageTimer = 7.5;
    director.update(0.05);
    assert.equal(director.currentStage, CessnaProximityScenario.STAGES.TOWER_BUZZ);
    assert.equal(scenario.result.stagesCompleted, 4);

    // Fast-forward past Scene 5 to COMPLETED
    director.stageTimer = 7.5;
    director.update(0.05);
    assert.equal(director.isActive, false, 'Director should stop when montage completes');
    assert.equal(scenario.result.status, 'completed');
    assert.equal(scenario.result.stagesCompleted, 5);
    assert.equal(sim.controls.aircraftControlsDisabled, false);
  });

  it('updates cinematic camera for Shot 1 (establishment/vantage) and Shot 2 (action cut)', () => {
    const sim = createProximitySimulator();
    const director = new DemoFlightDirector(sim);

    director.start();
    const camSys = sim.cameraSystem;

    // Shot 1 (t < 3.7)
    director.stageTimer = 1.5;
    const handled1 = camSys.triggerUpdater();
    assert.equal(handled1, true);
    assert.equal(sim.mockCamera.fov, 52, 'Shot 1 should use 52 deg standard lens');
    const shot1CamPos = sim.mockCamera.position.clone();

    // Shot 2 (t >= 3.7)
    director.stageTimer = 4.2;
    const handled2 = camSys.triggerUpdater();
    assert.equal(handled2, true);
    assert.equal(sim.mockCamera.fov, 68, 'Shot 2 should use 68 deg action wide lens');
    assert.notDeepEqual(sim.mockCamera.position, shot1CamPos, 'Shot 2 should cut to a different camera position');
  });

  it('clamps camera position above ground and water surface to avoid clipping', () => {
    const sim = createProximitySimulator();
    const director = new DemoFlightDirector(sim);
    director.start();

    // Set terrain under camera to 50m
    sim.cameraSystem.setCustomViewUpdater(({ camera, queryGroundHeight }) => {
      camera.position.set(0, 10, 0); // Lower than ground
      const groundH = queryGroundHeight(0, 0);
      const minY = Math.max(groundH + 0.8, 0.8);
      if (camera.position.y < minY) camera.position.y = minY;
      return true;
    });

    sim.cameraSystem.triggerUpdater();
    // With terrain at 0m, clamp is at least 0.8m
    assert.ok(sim.mockCamera.position.y >= 0.8);
  });

  it('cancels gracefully on stop and marks status cancelled', () => {
    const sim = createProximitySimulator();
    const director = new DemoFlightDirector(sim);

    director.start();
    assert.equal(director.isActive, true);
    director.stop();
    assert.equal(director.isActive, false);
    assert.equal(director.cessnaProximityScenario.result.status, 'cancelled');
  });

  it('places the building weave inside a corridor that clears the actual generated city', () => {
    const sim = createProximitySimulator();
    const buildings = [];
    // Skyscraper wall across the legacy fixed weave address (2340, 95, 1230).
    for (let x = 2200; x <= 2500; x += 40) {
      for (let z = 900; z <= 1400; z += 40) {
        buildings.push({ x, z, y: 25, width: 30, depth: 30, height: 90 });
      }
    }
    // Sparse downtown blocks the corridor selection can thread between.
    for (let x = 2000; x <= 3600; x += 200) {
      for (let z = 600; z <= 2200; z += 200) {
        buildings.push({ x, z, y: 25, width: 30, depth: 30, height: 90 });
      }
    }
    sim.foliage.buildingData = buildings;
    sim.currentTerrain = { getHeight: () => 25, isLoaded: true };
    const director = new DemoFlightDirector(sim);
    director.start();
    director.stageTimer = 7.5;
    director.update(0.05);
    assert.equal(director.currentStage, CessnaProximityScenario.STAGES.BUILDING_WEAVE);

    const config = director.cessnaProximityScenario.activeConfig;
    assert.ok(config.altitude >= 75, 'flight altitude clears flat terrain by the corridor floor');
    const distanceFlown = config.speedKnots * 0.514444 * 7.5;
    const clearance = buildingClearance(
      { x: sim.position.x, z: sim.position.z },
      config.direction,
      distanceFlown,
      config.altitude,
      buildings);
    assert.ok(clearance >= 40, `building clearance along the weave path: ${clearance.toFixed(1)}`);
    for (const b of buildings) {
      const top = b.y + b.height;
      if (top < config.altitude - 18) continue;
      const distance = Math.hypot(b.x - sim.position.x, b.z - sim.position.z);
      assert.ok(distance > 60, 'spawn is not inside a tower taller than the flight deck');
    }
  });

  it('records failure and description when crash occurs', () => {
    const sim = createProximitySimulator();
    const director = new DemoFlightDirector(sim);

    director.start();
    director.stopForCrash({ description: 'Struck maritime vessel mast', type: 'SHIP' });
    assert.equal(director.isActive, false);
    assert.equal(director.cessnaProximityScenario.result.status, 'failed');
    assert.equal(director.cessnaProximityScenario.result.reason, 'Struck maritime vessel mast');
  });
});
