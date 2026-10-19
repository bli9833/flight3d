/**
 * Procedural Web Audio API Sound Engine for Boeing Airliner
 * Synthesizes twin turbofan engines (combustion roar + N1/N2 turbine whine), aerodynamic airflow slipstream,
 * runway rumble, touchdown tire screech & oleo thump, stall horn, and Boeing GPWS voice callouts.
 * Features mobile speaker loudness optimization and master dynamic range compression.
 */
export class FlightAudio {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isInitialized = false;

    // Volume level: 1.0 = 100%, 1.5 = Mobile Boost 150%
    this.volume = 1.0;
    this.isMobileBoost = false;

    // Auto-detect mobile / small-screen environment for loudness boost
    if (typeof window !== 'undefined') {
      const isMobile = ('ontouchstart' in window) ||
        (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
        (window.innerWidth <= 1024);
      if (isMobile) {
        this.isMobileBoost = true;
      }
    }

    // Callout tracking
    this.lastRadioAlt = 9999;
    this.calledAltitudes = new Set();
    this.stallBeepTime = 0;
  }

  get effectiveVolume() {
    if (this.isMuted) return 0.0;
    return this.volume * (this.isMobileBoost ? 1.4 : 1.0);
  }

  init() {
    if (this.isInitialized) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();

      // 1. Dynamic Range Compressor (Studio Mastering Limiter)
      // Boosts perceived loudness and prevents digital clipping on mobile phone speakers
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(5, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.2, this.ctx.currentTime);

      // 2. Master Gain
      this.masterGain = this.ctx.createGain();
      const initialGain = this.effectiveVolume;
      this.masterGain.gain.setValueAtTime(initialGain, this.ctx.currentTime);

      // Signal chain: sources -> cockpitFilter -> masterGain -> compressor -> destination
      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      // 3. Cockpit Interior Acoustic Filter (muffles exterior roar inside cockpit)
      this.cockpitFilter = this.ctx.createBiquadFilter();
      this.cockpitFilter.type = 'lowpass';
      this.cockpitFilter.frequency.setValueAtTime(2800, this.ctx.currentTime);
      this.cockpitFilter.connect(this.masterGain);

      // 4. Turbofan Jet Engine Synthesizer (Pink Noise Roar + Twin Spool Whine)
      this.initEngineSynth();

      // 5. Airflow / Wind Slipstream Synthesizer
      this.initWindSynth();

      // 6. Ground Roll Rumble & Touchdown Screech
      this.initGroundSynth();

      // 7. Cockpit Warning Tone Oscillator
      this.initWarningSynth();

      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio initialization error:', e);
    }
  }

  ensureContextRunning() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  initEngineSynth() {
    // Generate pink noise buffer for turbofan combustion & bypass exhaust roar
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.28; // Healthy amplitude for mobile reproduction
      b6 = white * 0.115926;
    }

    // Engine Roar Source
    this.engineNoise = this.ctx.createBufferSource();
    this.engineNoise.buffer = noiseBuffer;
    this.engineNoise.loop = true;

    // Combustion low-pass filter
    // Cutoff: 260 Hz (idle) up to 900 Hz (TOGA), allowing mid frequencies to pass through
    // so mobile phone speakers can reproduce the engine roar clearly.
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(320, this.ctx.currentTime);
    this.engineFilter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.18, this.ctx.currentTime);

    this.engineNoise.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.cockpitFilter);
    this.engineNoise.start();

    // Primary N1 Low-Pressure Fan Compressor Whine (Sine Oscillator)
    this.turbineWhine = this.ctx.createOscillator();
    this.turbineWhine.type = 'sine';
    this.turbineWhine.frequency.setValueAtTime(450, this.ctx.currentTime);

    this.turbineGain = this.ctx.createGain();
    this.turbineGain.gain.setValueAtTime(0.04, this.ctx.currentTime);

    this.turbineWhine.connect(this.turbineGain);
    this.turbineGain.connect(this.cockpitFilter);
    this.turbineWhine.start();

    // Secondary N2 High-Pressure Core Compressor Whine & Harmonics (Triangle Oscillator)
    // Adds characteristic twin-spool buzz & harmonic clarity on mobile phone speakers
    this.turbineWhine2 = this.ctx.createOscillator();
    this.turbineWhine2.type = 'triangle';
    this.turbineWhine2.frequency.setValueAtTime(900, this.ctx.currentTime);

    this.turbineGain2 = this.ctx.createGain();
    this.turbineGain2.gain.setValueAtTime(0.02, this.ctx.currentTime);

    this.turbineWhine2.connect(this.turbineGain2);
    this.turbineGain2.connect(this.cockpitFilter);
    this.turbineWhine2.start();
  }

  initWindSynth() {
    // Airflow noise buffer
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.45;
    }

    this.windNoise = this.ctx.createBufferSource();
    this.windNoise.buffer = noiseBuffer;
    this.windNoise.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.setValueAtTime(800, this.ctx.currentTime);
    this.windFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.cockpitFilter);
    this.windNoise.start();
  }

  initGroundSynth() {
    // Runway rolling rumble noise source
    const bufferSize = this.ctx.sampleRate * 2;
    const rumbleBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const rData = rumbleBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      rData[i] = (Math.random() * 2 - 1) * 0.5;
    }

    this.rumbleNoise = this.ctx.createBufferSource();
    this.rumbleNoise.buffer = rumbleBuffer;
    this.rumbleNoise.loop = true;

    this.rumbleFilter = this.ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.setValueAtTime(260, this.ctx.currentTime);
    this.rumbleFilter.Q.setValueAtTime(1.5, this.ctx.currentTime);

    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.rumbleNoise.connect(this.rumbleFilter);
    this.rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.cockpitFilter);
    this.rumbleNoise.start();

    // Tire Screech Synthesizer (short frequency modulated chirp)
    this.screechGain = this.ctx.createGain();
    this.screechGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
    this.screechGain.connect(this.masterGain);
  }

  initWarningSynth() {
    this.warningOsc = this.ctx.createOscillator();
    this.warningOsc.type = 'sawtooth';
    this.warningOsc.frequency.setValueAtTime(680, this.ctx.currentTime);

    this.warningGain = this.ctx.createGain();
    this.warningGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.warningOsc.connect(this.warningGain);
    this.warningGain.connect(this.masterGain);
    this.warningOsc.start();
  }

  playTouchdownScreech() {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2400, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.35);

      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.5);
    } catch (e) {}
  }

  playTouchdownThump(sinkRate = 1.5) {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const severity = Math.min(1.0, Math.max(0.35, sinkRate / 3.0));

      // 1. Deep resonant oleo strut compression thud (for headphones / large speakers)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.28);

      gain.gain.setValueAtTime(0.8 * severity, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.4);

      // 2. Mid-punch mechanical impact transient (clearly audible on mobile phone speakers: 220Hz -> 90Hz)
      const punchOsc = this.ctx.createOscillator();
      const punchGain = this.ctx.createGain();
      punchOsc.type = 'triangle';
      punchOsc.frequency.setValueAtTime(220, now);
      punchOsc.frequency.exponentialRampToValueAtTime(90, now + 0.18);

      punchGain.gain.setValueAtTime(0.45 * severity, now);
      punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

      punchOsc.connect(punchGain);
      punchGain.connect(this.masterGain);
      punchOsc.start(now);
      punchOsc.stop(now + 0.25);
    } catch (e) {}
  }

  playGpwsCallout(text) {
    if (this.isMuted) return;
    if ('speechSynthesis' in window) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.15;
        u.pitch = 0.95;
        u.volume = 1.0;
        window.speechSynthesis.speak(u);
      } catch (e) {}
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0.0, Math.min(2.0, vol));
    if (this.volume > 0.0) {
      this.isMuted = false;
    }
    this.applyMasterGain();
  }

  setMobileBoost(enabled) {
    this.isMobileBoost = !!enabled;
    this.applyMasterGain();
  }

  setMuted(muted) {
    this.isMuted = !!muted;
    this.applyMasterGain();
  }

  applyMasterGain() {
    if (this.masterGain && this.ctx) {
      const targetGain = this.effectiveVolume;
      if (typeof this.masterGain.gain.setTargetAtTime === 'function') {
        this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);
      } else {
        this.masterGain.gain.setValueAtTime(targetGain, this.ctx.currentTime);
      }
    }
  }

  cycleVolume() {
    // Sequence: 100% -> 150% (Mobile Boost) -> Muted -> 100%
    if (this.isMuted) {
      this.isMuted = false;
      this.volume = 1.0;
      this.isMobileBoost = false;
    } else if (!this.isMobileBoost) {
      this.isMobileBoost = true;
      this.volume = 1.0;
    } else {
      this.isMuted = true;
    }
    this.applyMasterGain();
    return this.getVolumeState();
  }

  getVolumeState() {
    if (this.isMuted) {
      return { muted: true, level: 0, boost: false, text: '음소거 (MUTED)', icon: '🔇' };
    }
    if (this.isMobileBoost) {
      return { muted: false, level: 1.5, boost: true, text: '모바일 부스트 (150%)', icon: '🔊⚡' };
    }
    return { muted: false, level: 1.0, boost: false, text: '기본 볼륨 (100%)', icon: '🔊' };
  }

  update(dt, state, isCockpitCam) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;

    const now = this.ctx.currentTime;

    // Interior vs Exterior camera acoustic filter
    const targetCutoff = isCockpitCam ? 2600 : 8500;
    this.cockpitFilter.frequency.setTargetAtTime(targetCutoff, now, 0.1);

    // 1. Turbofan Engines Pitch and Roar based on N1%
    const n1 = Math.max(20, (state.engine1 ? state.engine1.n1 : 22));
    const n1Ratio = Math.max(0.0, Math.min(1.0, (n1 - 20) / 80.0)); // 0.0 to 1.0

    // Cutoff: 260 Hz (idle) to 900 Hz (TOGA) -> directly in mobile speaker sweet spot!
    const engineFreq = 260 + n1Ratio * 640;
    // Volume: 0.18 (idle) to 0.72 (TOGA)
    const engineVol = 0.18 + Math.pow(n1Ratio, 1.4) * 0.54;
    this.engineFilter.frequency.setTargetAtTime(engineFreq, now, 0.08);
    this.engineGain.gain.setTargetAtTime(engineVol, now, 0.08);

    // Primary N1 Fan Compressor Whine: 420 Hz to 1750 Hz
    const turbineFreq = 420 + Math.pow(n1Ratio, 1.2) * 1330;
    const turbineVol = 0.035 + n1Ratio * 0.12;
    this.turbineWhine.frequency.setTargetAtTime(turbineFreq, now, 0.08);
    this.turbineGain.gain.setTargetAtTime(turbineVol, now, 0.08);

    // Secondary N2 Core Whine & Harmonics: 840 Hz to 3100 Hz
    if (this.turbineWhine2 && this.turbineGain2) {
      const turbineFreq2 = 840 + Math.pow(n1Ratio, 1.1) * 2260;
      const turbineVol2 = 0.015 + n1Ratio * 0.065;
      this.turbineWhine2.frequency.setTargetAtTime(turbineFreq2, now, 0.08);
      this.turbineGain2.gain.setTargetAtTime(turbineVol2, now, 0.08);
    }

    // 2. Wind Slipstream Noise proportional to IAS
    const ias = state.iasKnots || 0;
    const windVol = Math.min(0.5, Math.pow(ias / 300.0, 1.7) * 0.45);
    const windCutoff = 450 + Math.min(3200, ias * 9.5);
    this.windGain.gain.setTargetAtTime(windVol, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(windCutoff, now, 0.1);

    // 3. Ground Roll Rumble (Active when wheels on ground and aircraft moving)
    if (this.rumbleGain && this.rumbleFilter) {
      const gndSpeed = state.groundSpeedKnots !== undefined ? state.groundSpeedKnots : (state.onGround ? (state.iasKnots || 0) : 0);
      if (state.onGround && gndSpeed > 3) {
        const rumbleVol = Math.min(0.35, (gndSpeed / 130.0) * 0.32);
        const rumbleCutoff = 180 + Math.min(220, gndSpeed * 1.5);
        this.rumbleGain.gain.setTargetAtTime(rumbleVol, now, 0.08);
        this.rumbleFilter.frequency.setTargetAtTime(rumbleCutoff, now, 0.08);
      } else {
        this.rumbleGain.gain.setTargetAtTime(0.0, now, 0.08);
      }
    }

    // 4. Touchdown Screech and Oleo Thump trigger
    if (state.touchdown) {
      this.playTouchdownScreech();
      const sinkRate = Math.abs(state.vsiFpm || 400) / 196.85; // fpm to m/s
      this.playTouchdownThump(sinkRate);
    }

    // 5. Stall Warning Horn
    if (state.isStalled) {
      this.stallBeepTime += dt;
      // Pulsing tone: 4 beeps per second
      const beepActive = (this.stallBeepTime % 0.25) < 0.14;
      this.warningGain.gain.setValueAtTime(beepActive ? 0.45 : 0.0, now);
    } else {
      this.stallBeepTime = 0;
      this.warningGain.gain.setValueAtTime(0.0, now);
    }

    // 6. Boeing GPWS Altitude Voice Callouts
    const rAlt = state.radioAltFt;
    if (rAlt !== undefined && !state.onGround && state.vsiFpm < -100) {
      const callouts = [500, 100, 50, 40, 30, 20, 10];
      for (const call of callouts) {
        if (this.lastRadioAlt > call && rAlt <= call && !this.calledAltitudes.has(call)) {
          this.calledAltitudes.add(call);
          this.playGpwsCallout(call.toString());
          break;
        }
      }
      // Reset callout set when climbing back above 1000 ft
      if (rAlt > 1000) {
        this.calledAltitudes.clear();
      }
    }
    this.lastRadioAlt = rAlt;
  }

  playExplosion(isWater = false) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    // Cut ongoing engine, turbine, wind & rumble sounds
    if (this.engineGain) this.engineGain.gain.setValueAtTime(0, now);
    if (this.turbineGain) this.turbineGain.gain.setValueAtTime(0, now);
    if (this.turbineGain2) this.turbineGain2.gain.setValueAtTime(0, now);
    if (this.windGain) this.windGain.gain.setValueAtTime(0, now);
    if (this.rumbleGain) this.rumbleGain.gain.setValueAtTime(0, now);
    if (this.warningGain) this.warningGain.gain.setValueAtTime(0, now);

    // 1. Deep Low-Frequency Subwoofer Detonation Thump
    const bufferSize = Math.floor(this.ctx.sampleRate * 3.5);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.7));
    }

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const bassFilter = this.ctx.createBiquadFilter();
    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(isWater ? 180 : 320, now);
    bassFilter.frequency.exponentialRampToValueAtTime(32, now + 2.8);

    const bassGain = this.ctx.createGain();
    bassGain.gain.setValueAtTime(1.4, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 3.2);

    noiseSrc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(this.masterGain);
    noiseSrc.start(now);

    // 2. High-Frequency Metal Crunch / Debris Shatter (or Water Rush)
    const crunchBuffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 1.5), this.ctx.sampleRate);
    const cData = crunchBuffer.getChannelData(0);
    for (let i = 0; i < cData.length; i++) {
      cData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.3));
    }

    const crunchSrc = this.ctx.createBufferSource();
    crunchSrc.buffer = crunchBuffer;

    const crunchFilter = this.ctx.createBiquadFilter();
    crunchFilter.type = isWater ? 'bandpass' : 'highpass';
    crunchFilter.frequency.setValueAtTime(isWater ? 600 : 2200, now);
    crunchFilter.frequency.exponentialRampToValueAtTime(isWater ? 180 : 350, now + 1.2);

    const crunchGain = this.ctx.createGain();
    crunchGain.gain.setValueAtTime(isWater ? 1.0 : 0.85, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

    crunchSrc.connect(crunchFilter);
    crunchFilter.connect(crunchGain);
    crunchGain.connect(this.masterGain);
    crunchSrc.start(now);
  }
}
