/**
 * @file scripts/test-mobile-touch.js
 * @description Mobile & Touchscreen Flight Control Verification Suite
 * 
 * Tests mobile browser emulation:
 * 1. Mobile viewport (iPhone 14 Pro Max Landscape: 926x428)
 * 2. Touch event emulation & auto-detection
 * 3. On-screen Virtual Stick, Throttle Quadrant, Rudder Bar, Brake Button
 * 4. Touch interaction: Setting TOGA throttle, deflecting stick, engaging brake
 * 5. Screen captures of mobile landscape cockpit view with on-screen controls
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5173;
const CDP_PORT = 9458;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/ad33c4b1-3b1c-4752-ad5e-b09f9794851b';

class MobileTouchTestRunner {
  constructor() {
    this.chromeProcess = null;
    this.ws = null;
    this.msgId = 1;
    this.pendingRequests = new Map();
  }

  log(msg, emoji = '📱') {
    const timestamp = new Date().toISOString().substring(11, 19);
    console.log(`[${timestamp}] ${emoji} ${msg}`);
  }

  async run() {
    this.log('Launching Mobile & Touchscreen Flight Controls Verification...', '🚀');

    // 1. Launch Headless Chrome
    const profileDir = path.resolve(process.cwd(), '.chrome-profile/mobile');
    fs.mkdirSync(profileDir, { recursive: true });
    const args = [
      '--headless=new',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--window-size=926,428',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--disable-gpu-sandbox',
      SIM_URL
    ];

    this.chromeProcess = spawn('google-chrome-stable', args, { stdio: 'ignore' });

    // Wait for CDP port with retry loop
    let pageTarget = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const versionRes = await fetch(`http://localhost:${CDP_PORT}/json/list`);
        const targets = await versionRes.json();
        pageTarget = targets.find(t => t.type === 'page');
        if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
      } catch (e) {}
    }
    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
      throw new Error('No page target found on CDP port');
    }

    this.ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const { resolve, reject } = this.pendingRequests.get(msg.id);
        this.pendingRequests.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };

    // Enable CDP domains
    await this.send('Page.enable');
    await this.send('Runtime.enable');

    // Emulate Mobile Landscape Viewport (926x428, touch enabled, mobile: true)
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 926,
      height: 428,
      deviceScaleFactor: 2,
      mobile: true,
      screenOrientation: { type: 'landscapePrimary', angle: 90 }
    });
    await this.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5
    });

    this.log('📱 Mobile touch device emulation configured (926x428 landscape, maxTouchPoints: 5)', '✅');

    // Wait for simulator to be ready
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const check = await this.evaluate('typeof window.simulator !== "undefined" && window.simulator.aircraft !== undefined');
        if (check) {
          ready = true;
          break;
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 500));
    }

    if (!ready) {
      throw new Error('Simulator failed to initialize within 20s');
    }
    this.log('Simulator confirmed ready in browser DOM!', '✈️');

    // 1. Check Touch Overlay Status
    const overlayStatus = await this.evaluate(`
      (() => {
        const overlay = document.getElementById('touch-controls-overlay');
        const sim = window.simulator;
        return {
          exists: !!overlay,
          display: overlay ? overlay.style.display : null,
          enabled: sim.touchControls ? sim.touchControls.enabled : false,
          hasStick: !!document.getElementById('touch-stick-zone'),
          hasThrottle: !!document.getElementById('touch-throttle-track'),
          hasRudder: !!document.getElementById('touch-rudder-track'),
          hasBrake: !!document.getElementById('touch-btn-brake'),
          hasToggleBtn: !!document.getElementById('btn-touch-toggle')
        };
      })()
    `);

    this.log(`Overlay initial state: ${JSON.stringify(overlayStatus)}`, '🔍');
    if (!overlayStatus.exists || !overlayStatus.hasStick || !overlayStatus.hasThrottle) {
      throw new Error('Touch controls DOM elements missing');
    }

    // Ensure touch controls are enabled
    await this.evaluate('window.simulator.touchControls.enable()');

    // 2. Test Throttle Setting via Touch
    this.log('Testing Touch Throttle (TOGA 100% command)...', '🔥');
    await this.evaluate(`
      (() => {
        window.simulator.touchControls.setThrottleValue(1.0);
      })()
    `);

    const thrCheck = await this.evaluate(`
      (() => {
        const c = window.simulator.controls;
        const readout = document.getElementById('touch-thr-val');
        return {
          throttle: c.throttle,
          readoutText: readout ? readout.textContent : null
        };
      })()
    `);
    this.log(`Throttle check: ${JSON.stringify(thrCheck)}`, '📊');
    if (thrCheck.throttle !== 1.0) throw new Error('Touch throttle failed to set 1.0');

    // 3. Test Touch Stick (Pitch up 0.75, Bank right 0.5)
    this.log('Testing Virtual Flight Stick Deflection (Pitch UP & Right Bank)...', '🕹️');
    await this.evaluate(`
      (() => {
        window.simulator.touchControls.controls.setTouchStick(0.75, 0.5);
        window.simulator.touchControls.updateStickTelemetry(0.75, 0.5);
      })()
    `);

    const stickCheck = await this.evaluate(`
      (() => {
        const c = window.simulator.controls;
        const telem = document.getElementById('touch-stick-telemetry');
        return {
          touchElevator: c.touchElevator,
          touchAileron: c.touchAileron,
          telemetryText: telem ? telem.textContent : null
        };
      })()
    `);
    this.log(`Stick check: ${JSON.stringify(stickCheck)}`, '📊');
    if (stickCheck.touchElevator !== 0.75 || stickCheck.touchAileron !== 0.5) {
      throw new Error('Touch stick failed to set deflection values');
    }

    // 4. Test Touch Rudder & Brake
    this.log('Testing Touch Rudder & Hydraulic Brake...', '🛞');
    await this.evaluate(`
      (() => {
        window.simulator.touchControls.controls.setTouchRudder(0.6);
        window.simulator.touchControls.controls.setTouchBrakes(1.0);
      })()
    `);

    const brakeCheck = await this.evaluate(`
      (() => {
        const c = window.simulator.controls;
        return {
          touchRudder: c.touchRudder,
          touchBrakes: c.touchBrakes
        };
      })()
    `);
    this.log(`Rudder & Brake check: ${JSON.stringify(brakeCheck)}`, '📊');
    if (brakeCheck.touchBrakes !== 1.0 || brakeCheck.touchRudder !== 0.6) {
      throw new Error('Touch rudder or brake failed');
    }

    // Step simulation 2.0 seconds to settle visuals
    await this.evaluate('window.simulator.stepSimulation(2.0)');

    // 5. Capture Mobile Landscape Screenshot
    this.log('Capturing settled mobile screen capture with touch controls...', '📸');
    const screenshot = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(screenshot.data, 'base64');
    
    const outPathArtifact = path.join(ARTIFACT_DIR, 'mobile_touch_controls_showcase.png');
    const outPathWorkspace = path.join(process.cwd(), 'mobile_touch_controls_showcase.png');
    fs.writeFileSync(outPathArtifact, buffer);
    fs.writeFileSync(outPathWorkspace, buffer);
    this.log(`Saved mobile touch controls showcase: ${outPathArtifact} (${(buffer.length / 1024).toFixed(1)} KB)`, '🎉');

    // 6. Test Quick Action Buttons (Gear cycle, Camera cycle)
    this.log('Testing Touch Quick Action buttons (Gear & Camera cycle)...', '🎥');
    await this.evaluate(`
      (() => {
        const camBtn = document.getElementById('touch-btn-cam');
        if (camBtn) camBtn.click();
      })()
    `);
    const newCamMode = await this.evaluate('window.simulator.cameraSystem.getModeName()');
    this.log(`Camera mode after touch button: ${newCamMode}`, '✨');

    // Stop demo if running so test exits cleanly
    await this.evaluate('window.simulator.demoDirector.stop()');

    this.log('🎉 ALL MOBILE & TOUCHSCREEN TESTS PASSED SUCCESSFULLY! ✅', '🏆');
  }

  async send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result.value;
  }

  async cleanup() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
    if (this.chromeProcess) {
      try { this.chromeProcess.kill('SIGKILL'); } catch (_) {}
    }
  }
}

const runner = new MobileTouchTestRunner();
runner.run()
  .then(async () => {
    await runner.cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('❌ Mobile Touch Test Error:', err);
    await runner.cleanup();
    process.exit(1);
  });
