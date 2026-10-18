/**
 * Procedural Web Audio API Sound Engine for Boeing Airliner
 * Synthesizes twin turbofan engines (combustion roar + turbine whine), aerodynamic airflow slipstream,
 * runway rumble, touchdown tire screech, stall horn, and Boeing GPWS voice callouts.
 */
export class FlightAudio {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isInitialized = false;

    // Callout tracking
    this.lastRadioAlt = 9999;
    this.calledAltitudes = new Set();
    this.stallBeepTime = 0;
  }

  init() {
    if (this.isInitialized) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();

      // Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Cockpit Interior Filter (muffles exterior roar inside cockpit)
      this.cockpitFilter = this.ctx.createBiquadFilter();
      this.cockpitFilter.type = 'lowpass';
      this.cockpitFilter.frequency.setValueAtTime(2500, this.ctx.currentTime);
      this.cockpitFilter.connect(this.masterGain);

      // 1. Turbofan Jet Engine Synthesizer
      this.initEngineSynth();

      // 2. Airflow / Wind Slipstream Synthesizer
      this.initWindSynth();

      // 3. Ground Roll Rumble & Touchdown Screech
      this.initGroundSynth();

      // 4. Cockpit Warning Tone Oscillator
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
    // Generate pink noise buffer for turbofan combustion roar
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
      output[i] *= 0.11;
      b6 = white * 0.115926;
    }

    // Engine Roar Source
    this.engineNoise = this.ctx.createBufferSource();
    this.engineNoise.buffer = noiseBuffer;
    this.engineNoise.loop = true;

    // Combustion low-pass filter
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(320, this.ctx.currentTime);
    this.engineFilter.Q.setValueAtTime(2.5, this.ctx.currentTime);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.05, this.ctx.currentTime);

    this.engineNoise.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.cockpitFilter);
    this.engineNoise.start();

    // High-Pitch Turbine Compressor Whine (Oscillator)
    this.turbineWhine = this.ctx.createOscillator();
    this.turbineWhine.type = 'sine';
    this.turbineWhine.frequency.setValueAtTime(450, this.ctx.currentTime);

    this.turbineGain = this.ctx.createGain();
    this.turbineGain.gain.setValueAtTime(0.01, this.ctx.currentTime);

    this.turbineWhine.connect(this.turbineGain);
    this.turbineGain.connect(this.cockpitFilter);
    this.turbineWhine.start();
  }

  initWindSynth() {
    // Airflow noise buffer
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.windNoise = this.ctx.createBufferSource();
    this.windNoise.buffer = noiseBuffer;
    this.windNoise.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.setValueAtTime(800, this.ctx.currentTime);
    this.windFilter.Q.setValueAtTime(1.2, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.cockpitFilter);
    this.windNoise.start();
  }

  initGroundSynth() {
    // Runway rolling rumble
    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
    this.rumbleGain.connect(this.cockpitFilter);

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

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.5);
    } catch (e) {}
  }

  playGpwsCallout(text) {
    if (this.isMuted) return;
    if ('speechSynthesis' in window) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.15;
        u.pitch = 0.95;
        u.volume = 0.9;
        window.speechSynthesis.speak(u);
      } catch (e) {}
    }
  }

  setMuted(muted) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0.0 : 0.7, this.ctx.currentTime);
    }
  }

  update(dt, state, isCockpitCam) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;

    const now = this.ctx.currentTime;

    // Interior vs Exterior camera acoustic filter
    const targetCutoff = isCockpitCam ? 2400 : 8000;
    this.cockpitFilter.frequency.setTargetAtTime(targetCutoff, now, 0.1);

    // 1. Turbofan Engines Pitch and Roar based on N1%
    const n1 = Math.max(20, (state.engine1 ? state.engine1.n1 : 22));
    const n1Ratio = (n1 - 20) / 80.0; // 0.0 to 1.0

    const engineFreq = 180 + n1Ratio * 420;
    const engineVol = 0.08 + Math.pow(n1Ratio, 1.8) * 0.45;
    this.engineFilter.frequency.setTargetAtTime(engineFreq, now, 0.08);
    this.engineGain.gain.setTargetAtTime(engineVol, now, 0.08);

    // Turbine compressor whine: 400Hz to 1800Hz
    const turbineFreq = 400 + Math.pow(n1Ratio, 1.2) * 1400;
    const turbineVol = 0.008 + n1Ratio * 0.08;
    this.turbineWhine.frequency.setTargetAtTime(turbineFreq, now, 0.08);
    this.turbineGain.gain.setTargetAtTime(turbineVol, now, 0.08);

    // 2. Wind Slipstream Noise proportional to IAS
    const ias = state.iasKnots || 0;
    const windVol = Math.min(0.45, Math.pow(ias / 320.0, 2.0) * 0.4);
    const windCutoff = 350 + Math.min(3200, ias * 9.0);
    this.windGain.gain.setTargetAtTime(windVol, now, 0.1);
    this.windFilter.frequency.setTargetAtTime(windCutoff, now, 0.1);

    // 3. Touchdown Screech trigger
    if (state.touchdown) {
      this.playTouchdownScreech();
    }

    // 4. Stall Warning Horn
    if (state.isStalled) {
      this.stallBeepTime += dt;
      // Pulsing tone: 4 beeps per second
      const beepActive = (this.stallBeepTime % 0.25) < 0.14;
      this.warningGain.gain.setValueAtTime(beepActive ? 0.35 : 0.0, now);
    } else {
      this.stallBeepTime = 0;
      this.warningGain.gain.setValueAtTime(0.0, now);
    }

    // 5. Boeing GPWS Altitude Voice Callouts
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

    // Cut ongoing engine, turbine & wind sounds
    if (this.engineGain) this.engineGain.gain.setValueAtTime(0, now);
    if (this.turbineGain) this.turbineGain.gain.setValueAtTime(0, now);
    if (this.windGain) this.windGain.gain.setValueAtTime(0, now);
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
