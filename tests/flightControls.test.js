import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FlightControls } from '../src/controls/FlightControls.js';

describe('FlightControls (Keyboard & Touch Inputs)', () => {
  it('should initialize with neutral controls and zero touch inputs', () => {
    // Mock minimal DOM element for Node test environment
    const mockDom = { addEventListener: () => {} };
    // Temporarily mock window if not present
    const prevWindow = globalThis.window;
    if (!globalThis.window) {
      globalThis.window = { addEventListener: () => {}, innerWidth: 1920, innerHeight: 1080 };
    }

    const controls = new FlightControls(mockDom);
    assert.strictEqual(controls.elevator, 0.0);
    assert.strictEqual(controls.aileron, 0.0);
    assert.strictEqual(controls.rudder, 0.0);
    assert.strictEqual(controls.throttle, 0.0);
    assert.strictEqual(controls.brakes, 0.0);
    assert.strictEqual(controls.touchElevator, 0.0);
    assert.strictEqual(controls.touchAileron, 0.0);
    assert.strictEqual(controls.touchRudder, 0.0);
    assert.strictEqual(controls.touchBrakes, 0.0);

    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  });

  it('should integrate touch stick inputs (Pitch & Roll) smoothly with slew rates', () => {
    const mockDom = { addEventListener: () => {} };
    const prevWindow = globalThis.window;
    if (!globalThis.window) {
      globalThis.window = { addEventListener: () => {}, innerWidth: 1920, innerHeight: 1080 };
    }

    const controls = new FlightControls(mockDom);

    // Simulate pilot pulling touch stick back for pitch up (0.8) and right roll (0.5)
    controls.setTouchStick(0.8, 0.5);
    assert.strictEqual(controls.touchElevator, 0.8);
    assert.strictEqual(controls.touchAileron, 0.5);

    // Run physics update for 1 second at 140 knots
    controls.update(1.0, 140);
    assert.ok(controls.elevator > 0.4, `Elevator should slew positive towards 0.8, got ${controls.elevator}`);
    assert.ok(controls.aileron > 0.4, `Aileron should slew positive towards 0.5, got ${controls.aileron}`);

    // Pilot releases touch stick (spring to center)
    controls.setTouchStick(0.0, 0.0);
    // Run physics update for 2 seconds
    controls.update(2.0, 140);
    assert.ok(Math.abs(controls.elevator) < 0.05, `Elevator should return to neutral, got ${controls.elevator}`);
    assert.ok(Math.abs(controls.aileron) < 0.05, `Aileron should return to neutral, got ${controls.aileron}`);

    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  });

  it('should integrate touch throttle and rudder inputs accurately', () => {
    const mockDom = { addEventListener: () => {} };
    const prevWindow = globalThis.window;
    if (!globalThis.window) {
      globalThis.window = { addEventListener: () => {}, innerWidth: 1920, innerHeight: 1080 };
    }

    const controls = new FlightControls(mockDom);

    // Touch throttle set to TOGA (1.0)
    controls.setTouchThrottle(1.0);
    assert.strictEqual(controls.throttle, 1.0);

    // Touch throttle set to CLB (0.85)
    controls.setTouchThrottle(0.85);
    assert.strictEqual(controls.throttle, 0.85);

    // Touch rudder set to right pedal (0.7)
    controls.setTouchRudder(0.7);
    assert.strictEqual(controls.touchRudder, 0.7);
    controls.update(1.0, 140);
    assert.ok(controls.rudder > 0.35, `Rudder should slew towards 0.7, got ${controls.rudder}`);

    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  });

  it('should engage and release touch brakes properly', () => {
    const mockDom = { addEventListener: () => {} };
    const prevWindow = globalThis.window;
    if (!globalThis.window) {
      globalThis.window = { addEventListener: () => {}, innerWidth: 1920, innerHeight: 1080 };
    }

    const controls = new FlightControls(mockDom);

    // Hold brake button
    controls.setTouchBrakes(1.0);
    controls.update(0.1, 80);
    assert.strictEqual(controls.brakes, 1.0);

    // Release brake button
    controls.setTouchBrakes(0.0);
    controls.update(0.1, 80);
    assert.strictEqual(controls.brakes, 0.0);

    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  });
});
