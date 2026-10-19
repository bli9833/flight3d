import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FlightAudio } from '../src/audio/FlightAudio.js';

/**
 * Lightweight mock of Web Audio API for Node.js test environment
 */
function createMockAudioContext() {
  class MockAudioParam {
    constructor(val = 1) {
      this.value = val;
    }
    setValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
  }

  class MockNode {
    constructor() {
      this.connectedTo = [];
    }
    connect(dest) {
      this.connectedTo.push(dest);
      return dest;
    }
    start() {}
    stop() {}
  }

  class MockGainNode extends MockNode {
    constructor() {
      super();
      this.gain = new MockAudioParam(1);
    }
  }

  class MockBiquadFilterNode extends MockNode {
    constructor() {
      super();
      this.type = 'lowpass';
      this.frequency = new MockAudioParam(350);
      this.Q = new MockAudioParam(1);
    }
  }

  class MockOscillatorNode extends MockNode {
    constructor() {
      super();
      this.type = 'sine';
      this.frequency = new MockAudioParam(440);
    }
  }

  class MockCompressorNode extends MockNode {
    constructor() {
      super();
      this.threshold = new MockAudioParam(-14);
      this.knee = new MockAudioParam(12);
      this.ratio = new MockAudioParam(5);
      this.attack = new MockAudioParam(0.003);
      this.release = new MockAudioParam(0.2);
    }
  }

  return class MockAudioContext {
    constructor() {
      this.currentTime = 10.0;
      this.sampleRate = 44100;
      this.state = 'running';
      this.destination = new MockNode();
    }
    createGain() { return new MockGainNode(); }
    createBiquadFilter() { return new MockBiquadFilterNode(); }
    createOscillator() { return new MockOscillatorNode(); }
    createDynamicsCompressor() { return new MockCompressorNode(); }
    createBuffer(channels, size, sampleRate) {
      return {
        getChannelData: () => new Float32Array(size)
      };
    }
    createBufferSource() {
      const src = new MockNode();
      src.buffer = null;
      src.loop = false;
      return src;
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
  };
}

describe('FlightAudio (Web Audio Engine & Mobile Loudness Optimization)', () => {
  it('should construct with default audio state and detect mobile environment', () => {
    // Desktop simulation (no touch)
    const audio = new FlightAudio();
    assert.strictEqual(audio.isMuted, false);
    assert.strictEqual(audio.isInitialized, false);
    assert.strictEqual(audio.volume, 1.0);
    assert.ok(typeof audio.isMobileBoost === 'boolean');
  });

  it('should initialize mastering chain with DynamicsCompressorNode and higher output gain', () => {
    const prevWindow = globalThis.window;
    const MockAudioContext = createMockAudioContext();
    globalThis.window = { AudioContext: MockAudioContext };

    try {
      const audio = new FlightAudio();
      audio.init();

      assert.strictEqual(audio.isInitialized, true);
      assert.ok(audio.ctx, 'AudioContext should be created');
      assert.ok(audio.masterGain, 'Master gain node should be created');
      assert.ok(audio.compressor, 'Master DynamicsCompressorNode should be created for loudness mastering');

      // Check compressor connection to destination
      assert.ok(audio.compressor.connectedTo.includes(audio.ctx.destination), 'Compressor should connect to destination');
      assert.ok(audio.masterGain.connectedTo.includes(audio.compressor), 'Master gain should feed into compressor');

      // Check master gain value: should be >= 1.0 when unmuted
      assert.ok(audio.masterGain.gain.value >= 1.0, `Master gain should be >= 1.0, got ${audio.masterGain.gain.value}`);
    } finally {
      if (prevWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWindow;
      }
    }
  });

  it('should cycle volume states between 100% -> 150% Mobile Boost -> Mute -> 100%', () => {
    const prevWindow = globalThis.window;
    const MockAudioContext = createMockAudioContext();
    globalThis.window = { AudioContext: MockAudioContext };

    try {
      const audio = new FlightAudio();
      audio.isMobileBoost = false;
      audio.init();

      // State 1: Default 100%
      let state = audio.getVolumeState();
      assert.strictEqual(state.muted, false);
      assert.strictEqual(state.boost, false);
      assert.strictEqual(audio.effectiveVolume, 1.0);

      // Cycle to State 2: 150% Mobile Boost
      state = audio.cycleVolume();
      assert.strictEqual(state.muted, false);
      assert.strictEqual(state.boost, true);
      assert.ok(audio.effectiveVolume >= 1.4, `Boosted volume should be >= 1.4, got ${audio.effectiveVolume}`);
      assert.strictEqual(audio.masterGain.gain.value, audio.effectiveVolume);

      // Cycle to State 3: Muted
      state = audio.cycleVolume();
      assert.strictEqual(state.muted, true);
      assert.strictEqual(audio.effectiveVolume, 0.0);
      assert.strictEqual(audio.masterGain.gain.value, 0.0);

      // Cycle to State 4: Unmuted back to 100%
      state = audio.cycleVolume();
      assert.strictEqual(state.muted, false);
      assert.strictEqual(state.boost, false);
      assert.strictEqual(audio.effectiveVolume, 1.0);
      assert.strictEqual(audio.masterGain.gain.value, 1.0);
    } finally {
      if (prevWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWindow;
      }
    }
  });

  it('should output audible frequencies and robust volume across idle to TOGA regimes', () => {
    const prevWindow = globalThis.window;
    const MockAudioContext = createMockAudioContext();
    globalThis.window = { AudioContext: MockAudioContext };

    try {
      const audio = new FlightAudio();
      audio.init();

      // Test Regime 1: Engine Idle on Ground (N1 = 22%)
      const idleState = {
        engine1: { n1: 22 },
        iasKnots: 0,
        groundSpeedKnots: 0,
        onGround: true,
        isStalled: false
      };
      audio.update(0.016, idleState, false);

      // Idle engine frequency must be >= 250 Hz so mobile phone speakers can reproduce it!
      assert.ok(audio.engineFilter.frequency.value >= 250, `Idle cutoff should be >= 250 Hz for mobile speakers, got ${audio.engineFilter.frequency.value}`);
      // Idle engine gain must be audible (>= 0.15)
      assert.ok(audio.engineGain.gain.value >= 0.15, `Idle engine volume should be >= 0.15, got ${audio.engineGain.gain.value}`);
      // Turbine whine must be audible at idle (>= 0.03)
      assert.ok(audio.turbineGain.gain.value >= 0.03, `Turbine whine should be >= 0.03, got ${audio.turbineGain.gain.value}`);

      // Test Regime 2: Full TOGA Takeoff Roll (N1 = 100%, IAS = 140)
      const togaState = {
        engine1: { n1: 100 },
        iasKnots: 140,
        groundSpeedKnots: 140,
        onGround: true,
        isStalled: false
      };
      audio.update(0.016, togaState, false);

      assert.ok(audio.engineFilter.frequency.value >= 700, `TOGA cutoff should be >= 700 Hz, got ${audio.engineFilter.frequency.value}`);
      assert.ok(audio.engineGain.gain.value >= 0.6, `TOGA engine volume should be >= 0.6, got ${audio.engineGain.gain.value}`);
      assert.ok(audio.turbineGain.gain.value >= 0.1, `TOGA turbine whine should be >= 0.1, got ${audio.turbineGain.gain.value}`);

      // Test Regime 3: Ground Roll Rumble during takeoff roll
      assert.ok(audio.rumbleGain.gain.value > 0.1, `Ground roll rumble should be active during ground roll, got ${audio.rumbleGain.gain.value}`);

      // When airborne (onGround: false), ground roll rumble should cut to 0
      const airborneState = {
        engine1: { n1: 85 },
        iasKnots: 250,
        groundSpeedKnots: 250,
        onGround: false,
        isStalled: false
      };
      audio.update(0.016, airborneState, false);
      assert.strictEqual(audio.rumbleGain.gain.value, 0.0, 'Ground rumble should be 0 when airborne');
    } finally {
      if (prevWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWindow;
      }
    }
  });

  it('should play touchdown impact and synthesize punchy transient for mobile speakers', () => {
    const prevWindow = globalThis.window;
    const MockAudioContext = createMockAudioContext();
    globalThis.window = { AudioContext: MockAudioContext };

    try {
      const audio = new FlightAudio();
      audio.init();

      // Trigger touchdown thump without error
      assert.doesNotThrow(() => {
        audio.playTouchdownThump(2.0);
        audio.playTouchdownScreech();
      });
    } finally {
      if (prevWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWindow;
      }
    }
  });
});
