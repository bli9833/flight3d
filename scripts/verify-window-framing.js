import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5195;
const CDP_PORT = 9465;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.join(process.cwd(), 'screenshots');
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

async function main() {
  const profileDir = `/tmp/chrome-verify-framing-${Date.now()}`;
  const args = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1440,1000',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-gl=angle',
    '--use-angle=vulkan',
    SIM_URL
  ];

  const chrome = spawn('google-chrome-stable', args, { stdio: 'ignore' });

  try {
    let pageTarget = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find(t => t.type === 'page' && t.url.includes(String(PORT)));
        if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
      } catch (e) {}
    }

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    const pending = new Map();
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || msg.error));
          else resolve(msg.result);
        }
      } catch (e) {}
    };

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evalCode = async (expr) => {
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(`Eval error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
      }
      return res.result?.value;
    };

    const capture = async (name) => {
      await new Promise(r => setTimeout(r, 800));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(path.join(ARTIFACT_DIR, name), buf);
      console.log(`Saved: ${name}`);
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Waiting for cockpit GLB to load naturally...');
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 300));
      const ready = await evalCode(`Boolean(window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded)`);
      if (ready) break;
    }

    // Verify framing elements exist natively in the simulator
    const framingState = await evalCode(`(() => {
      const cp = window.simulator.aircraft.cockpit;
      return {
        loaded: cp.gltfCockpitLoaded,
        framingExists: Boolean(cp.gltfCockpitFraming),
        glassCount: cp.gltfGlassPanels?.length || 0,
        ceilingTrimExists: Boolean(cp.gltfCeilingTrim),
        bracketExists: Boolean(cp.gltfCompassBracket),
        cameraNear: window.simulator.camera.near
      };
    })()`);
    console.log('Native framing state:', framingState);

    // 1. Captain Seated Default View
    await capture('verified_cockpit_window_framing_default.png');

    // 2. Captain Look Left (A-Pillar & #2L window)
    await evalCode(`(() => {
      window.simulator.cameraSystem.lookYaw = 0.42;
      window.simulator.cameraSystem.lookPitch = -0.12;
    })()`);
    await capture('verified_cockpit_window_framing_left.png');

    // 3. Captain Look Right (Center Post & #1R window)
    await evalCode(`(() => {
      window.simulator.cameraSystem.lookYaw = -0.32;
      window.simulator.cameraSystem.lookPitch = -0.12;
    })()`);
    await capture('verified_cockpit_window_framing_right.png');

    // 4. Return to forward view
    await evalCode(`(() => {
      window.simulator.cameraSystem.lookYaw = 0;
      window.simulator.cameraSystem.lookPitch = -0.25;
    })()`);

    ws.close();
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
}

main().catch(console.error);
