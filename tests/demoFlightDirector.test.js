import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { DemoFlightDirector } from '../src/director/DemoFlightDirector.js';
import { CameraSystem } from '../src/cameras/CameraSystem.js';

function createMockSimulator(activeAirport = 'lukla') {
  const virtualInputs = {};
  return {
    activeAirport,
    position: new THREE.Vector3(0, 2800, 0),
    angularVelocity: new THREE.Vector3(0, 0, 0),
    telemetry: {
      altitudeFt: 9300,
      radioAltFt: 0,
      iasKnots: 0,
      pitchDeg: -6.71,
      rollDeg: 0,
      headingDeg: 238,
      onGround: true,
      gearState: 1.0,
      isTransit: false
    },
    controls: {
      brakes: 0.0,
      parkingBrake: false,
      setParkingBrake: function(v) {
        this.parkingBrake = Boolean(v);
        if (this.parkingBrake) this.brakes = 1.0;
      },
      setVirtualInput: (k, v) => { virtualInputs[k] = v; },
      clearVirtualInputs: () => {
        for (const k of Object.keys(virtualInputs)) delete virtualInputs[k];
      },
      getVirtualInput: (k) => virtualInputs[k]
    },
    engines: {
      setThrottle: () => {},
      setReverser: () => {}
    },
    gear: {
      brakes: 0.0,
      setBrakes: function(v) { this.brakes = v; },
      setGearTarget: () => {}
    },
    aero: {
      spoilers: 0,
      setFlapPosition: () => {}
    },
    sky: {
      setTimeOfDay: () => {},
      getSunDirection: () => new THREE.Vector3(0, 1, 0)
    },
    water: {
      setSunDirection: () => {}
    },
    cameraSystem: {
      mode: CameraSystem.MODES.COCKPIT,
      onCycleMode: null,
      setMode: function(m) { this.mode = m; },
      cycleMode: function() {
        this.mode = (this.mode + 1) % 7;
        if (this.onCycleMode) this.onCycleMode(this.mode);
        return 'MODE_' + this.mode;
      },
      resetDroneOrbit: () => {},
      lookPitch: 0,
      lookYaw: 0
    },
    setAirport: function(id) { this.activeAirport = id; },
    setPreset: () => {},
    showToast: () => {}
  };
}

describe('DemoFlightDirector (Nepal Lukla & Coastal Autonomous Demos)', () => {
  it('should initialize with Idle stage and Lukla as default demo airport', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    assert.strictEqual(director.isActive, false);
    assert.strictEqual(director.currentStage, -1);
    assert.strictEqual(director.activeDemoAirport, 'lukla');
  });

  it('should start Lukla demo flight at CLIFF_TAKEOFF when Lukla is active', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start();
    assert.strictEqual(director.isActive, true);
    assert.strictEqual(director.activeDemoAirport, 'lukla');
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);
    assert.strictEqual(sim.controls.getVirtualInput('throttle'), 1.0);
    assert.strictEqual(sim.controls.getVirtualInput('brakes'), 0.0);
  });

  it('should transition through Lukla demo stages in sequence', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);

    // 1. Advance to Canyon Climb when reaching cliff / timer
    director.stageTimer = 9.0;
    sim.telemetry.iasKnots = 130;
    sim.telemetry.radioAltFt = 100;
    director.update(0.1);
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CANYON_CLIMB);

    // 2. Advance to Himalayan Cruise
    director.stageTimer = 10.0;
    director.update(0.1);
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.HIMALAYAN_CRUISE);

    // 3. Advance to Canyon Approach
    director.stageTimer = 9.5;
    director.update(0.1);
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CANYON_APPROACH);

    // 4. Advance to Uphill Touchdown
    // Position aircraft over Threshold 06: s >= -263.5m, onGround = true
    sim.position.set(-200 * 0.848048, 2810, 200 * 0.529919); // s ≈ -200m
    sim.telemetry.onGround = true;
    director.update(0.1);
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.UPHILL_TOUCHDOWN);
    assert.strictEqual(sim.aero.spoilers, 1.0);
    assert.strictEqual(sim.controls.getVirtualInput('brakes'), 1.0);

    // 5. Complete rollout when stopped
    sim.telemetry.iasKnots = 2;
    director.stageTimer = 8.5;
    director.update(0.1);
    assert.strictEqual(director.isActive, false);
  });

  it('should support Coastal demo flight when coastal airport is explicitly targeted', () => {
    const sim = createMockSimulator('coastal');
    const director = new DemoFlightDirector(sim);

    director.start('coastal');
    assert.strictEqual(director.isActive, true);
    assert.strictEqual(director.activeDemoAirport, 'coastal');
    assert.strictEqual(director.currentStage, DemoFlightDirector.COASTAL_STAGES.PREFLIGHT_ORBIT);
  });

  it('should cleanly stop demo and clear virtual control inputs', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    assert.strictEqual(sim.controls.getVirtualInput('throttle'), 1.0);

    director.stop('Test Stop');
    assert.strictEqual(director.isActive, false);
    assert.strictEqual(sim.controls.getVirtualInput('throttle'), undefined);
    assert.strictEqual(sim.controls.brakes, 0.0);
    assert.strictEqual(sim.gear.brakes, 0.0);
  });

  it('should engage and retain parking brake when stop is called with keepParkingBrake=true', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    director.stop('Runway rollout complete', true);

    assert.strictEqual(director.isActive, false);
    assert.strictEqual(sim.controls.parkingBrake, true);
    assert.strictEqual(sim.controls.brakes, 1.0);
    assert.strictEqual(sim.gear.brakes, 1.0);
  });

  it('should bind #btn-demo click and toggle active class', () => {
    const listeners = {};
    const classList = new Set();
    const mockBtn = {
      classList: {
        add: (cls) => classList.add(cls),
        remove: (cls) => classList.delete(cls),
        contains: (cls) => classList.has(cls)
      },
      addEventListener: (type, fn) => { listeners[type] = fn; }
    };

    globalThis.document = {
      getElementById: (id) => (id === 'btn-demo' ? mockBtn : null)
    };

    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);
    director.initUI();

    assert.strictEqual(director.demoBtn, mockBtn);
    assert.strictEqual(typeof listeners['click'], 'function');

    // Clicking btn-demo should start demo flight
    listeners['click']();
    assert.strictEqual(director.isActive, true);
    assert.strictEqual(classList.has('active'), true);

    // Stopping demo flight should remove active class
    director.stop('Stopped');
    assert.strictEqual(director.isActive, false);
    assert.strictEqual(classList.has('active'), false);

    delete globalThis.document;
  });

  it('should trigger demo flight with P keyboard shortcut', () => {
    const windowListeners = {};
    globalThis.window = {
      addEventListener: (type, fn) => { windowListeners[type] = fn; }
    };
    globalThis.document = {
      getElementById: () => null
    };

    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);
    director.initUI();

    assert.strictEqual(typeof windowListeners['keydown'], 'function');

    // Pressing 'p' starts demo
    windowListeners['keydown']({
      key: 'p',
      target: { matches: () => false }
    });
    assert.strictEqual(director.isActive, true);

    // Pressing Escape stops demo
    windowListeners['keydown']({
      key: 'Escape',
      target: { matches: () => false }
    });
    assert.strictEqual(director.isActive, false);

    // Pressing 'P' starts demo
    windowListeners['keydown']({
      key: 'P',
      target: { matches: () => false }
    });
    assert.strictEqual(director.isActive, true);

    delete globalThis.window;
    delete globalThis.document;
  });

  it('should allow user to cycle camera during ROTATION_CLIMB without mid-stage cut reverting user choice', () => {
    const sim = createMockSimulator('coastal');
    const director = new DemoFlightDirector(sim);

    director.start('coastal');
    director.setStage(DemoFlightDirector.COASTAL_STAGES.ROTATION_CLIMB);
    sim.cameraSystem.mode = CameraSystem.MODES.COCKPIT;

    // Simulate flight progressing past 6.0s (the mid-stage cut time)
    director.stageTimer = 7.0;

    // User cycles camera to WING (2)
    sim.cameraSystem.cycleMode();
    sim.cameraSystem.cycleMode();
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.WING);
    assert.strictEqual(director.userCameraOverridden, true);

    // Multi-frame update should NOT revert camera mode to CHASE
    for (let i = 0; i < 10; i++) {
      director.update(0.016);
    }
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.WING, 'Camera mode must remain WING and not be forced to CHASE');
  });

  it('should perform scheduled mid-stage camera cut once when user has not changed camera', () => {
    const sim = createMockSimulator('coastal');
    const director = new DemoFlightDirector(sim);

    director.start('coastal');
    sim.telemetry.altitudeFt = 150;
    director.setStage(DemoFlightDirector.COASTAL_STAGES.ROTATION_CLIMB);
    sim.cameraSystem.mode = CameraSystem.MODES.COCKPIT;

    // Before 6.0s, mode remains COCKPIT
    director.stageTimer = 5.0;
    director.update(0.1);
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.COCKPIT);

    // Reaching 6.0s triggers scheduled one-shot cut to CHASE
    director.stageTimer = 6.1;
    director.update(0.1);
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.CHASE);

    // Subsequent updates do not re-run cut
    director.stageTimer = 8.0;
    director.update(0.1);
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.CHASE);

    // User can now change camera at 8.0s and it sticks
    sim.cameraSystem.cycleMode(); // to WING
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.WING);
    director.update(0.1);
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.WING);
  });

  it('should allow user to cycle camera in Lukla demo flight without being overridden in cliff takeoff or climb', () => {
    const sim = createMockSimulator('lukla');
    const director = new DemoFlightDirector(sim);

    director.start('lukla');
    assert.strictEqual(director.currentStage, DemoFlightDirector.LUKLA_STAGES.CLIFF_TAKEOFF);

    // Advance past 4.5s
    director.stageTimer = 5.0;

    // User cycles camera to FLYBY (4)
    sim.cameraSystem.mode = CameraSystem.MODES.FLYBY;
    director.onUserCameraChange();

    for (let i = 0; i < 5; i++) {
      director.update(0.016);
    }
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.FLYBY, 'Camera mode must stay FLYBY during cliff takeoff');
  });

  it('should reset userCameraOverridden on stage transition so each stage begins with intended showcase view', () => {
    const sim = createMockSimulator('coastal');
    const director = new DemoFlightDirector(sim);

    director.start('coastal');
    director.setStage(DemoFlightDirector.COASTAL_STAGES.ROTATION_CLIMB);

    // User overrides camera in rotation climb
    sim.cameraSystem.cycleMode();
    assert.strictEqual(director.userCameraOverridden, true);

    // Transition to next stage (COASTAL_BANK)
    director.setStage(DemoFlightDirector.COASTAL_STAGES.COASTAL_BANK);
    assert.strictEqual(director.userCameraOverridden, false, 'userCameraOverridden should be reset on entering new stage');
    assert.strictEqual(sim.cameraSystem.mode, CameraSystem.MODES.WING, 'Should initialize with COASTAL_BANK showcase view (WING)');
  });
});


for (const airport of ['coastal', 'lukla']) {
  it(`preserves user time through camera changes, stages and demo restart (${airport})`, () => {
    const sim = createMockSimulator(airport);
    sim.sky.setTimeOfDay = function(hours) { this.timeOfDay = hours; };
    const director = new DemoFlightDirector(sim);
    director.start();
    assert.strictEqual(sim.sky.timeOfDay, airport === 'coastal' ? 6.5 : 8.5);
    director.onUserTimeOfDayChange();
    sim.sky.setTimeOfDay(22.5);
    sim.cameraSystem.cycleMode();
    const stages = airport === 'coastal'
      ? [DemoFlightDirector.COASTAL_STAGES.TAKEOFF_ROLL,
         DemoFlightDirector.COASTAL_STAGES.COASTAL_BANK,
         DemoFlightDirector.COASTAL_STAGES.FINAL_APPROACH]
      : [DemoFlightDirector.LUKLA_STAGES.HIMALAYAN_CRUISE,
         DemoFlightDirector.LUKLA_STAGES.CANYON_APPROACH];
    for (const stage of stages) {
      director.setStage(stage);
      director.update(0.1);
      assert.strictEqual(sim.sky.timeOfDay, 22.5);
    }
    director.stop();
    director.start();
    assert.strictEqual(sim.sky.timeOfDay, 22.5);
  });
}
