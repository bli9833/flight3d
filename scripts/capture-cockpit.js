import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5190;
const CDP_PORT = 9448;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/d4926e0b-d4bf-44c8-85c5-63c666fb0aa4';

async function main() {
  console.log(`🚀 Spawning Chrome to capture updated cockpit viewpoints from port ${PORT}...`);
  const profileDir = path.resolve(process.cwd(), '.chrome-profile/cockpit-capture');
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-gpu-sandbox',
    SIM_URL
  ];

  const chrome = spawn('google-chrome-stable', args, { stdio: 'ignore' });

  try {
    let pageTarget = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json/list`);
        const targets = await resp.json();
        pageTarget = targets.find(t => t.type === 'page' && t.url.includes(String(PORT)));
        if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
      } catch (e) {}
    }

    if (!pageTarget) throw new Error('CDP target not found');
    console.log(`🔌 Connected to CDP target: ${pageTarget.webSocketDebuggerUrl}`);

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

    const captureView = async (filename, setupCode) => {
      await evalCode(setupCode);
      await new Promise(r => setTimeout(r, 1000)); // wait for render
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(path.resolve(process.cwd(), filename), buf);
      if (fs.existsSync(ARTIFACT_DIR)) {
        fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
      }
      console.log(`📸 Captured: ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('⏳ Waiting for simulator to initialize...');
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 300));
      const ready = await evalCode(`Boolean(window.simulator && window.simulator.aircraft && window.simulator.aircraft.cockpit)`);
      if (ready) break;
    }

    console.log('✅ Simulator initialized. Capturing cockpit viewpoints...');

    // 1. Captain Forward View (Default Cockpit framing: MCP, PFD, ND, ISFD, EICAS, Windshield & Wipers)
    await captureView('cockpit_view.png', `
      window.simulator.cameraSystem.setMode(0); // COCKPIT
      window.simulator.cameraSystem.lookYaw = 0.0;
      window.simulator.cameraSystem.lookPitch = -0.18;
      window.simulator.camera.fov = 60;
      window.simulator.camera.updateProjectionMatrix();
    `);

    // 2. Flight Instruments Center View (Pitch down -0.32 to showcase full PFD, ND, ISFD, EICAS with bezels)
    await captureView('cockpit_instruments_view.png', `
      window.simulator.cameraSystem.lookYaw = 0.05;
      window.simulator.cameraSystem.lookPitch = -0.32;
      window.simulator.camera.fov = 58;
      window.simulator.camera.updateProjectionMatrix();
    `);

    // 3. Pedestal & FMC / CDU View (Looking down-right at FMC, throttles, and trim wheels)
    await captureView('cockpit_pedestal_view.png', `
      window.simulator.cameraSystem.lookYaw = -0.42;
      window.simulator.cameraSystem.lookPitch = -0.48;
      window.simulator.camera.fov = 60;
      window.simulator.camera.updateProjectionMatrix();
    `);

    // 4. Overhead Panel View (Looking up at forward overhead switches and panels)
    await captureView('cockpit_overhead_view.png', `
      window.simulator.cameraSystem.lookYaw = 0.0;
      window.simulator.cameraSystem.lookPitch = 0.65;
      window.simulator.camera.fov = 62;
      window.simulator.camera.updateProjectionMatrix();
    `);

    // 5. Reset camera to forward view
    await evalCode(`
      window.simulator.cameraSystem.lookYaw = 0.0;
      window.simulator.cameraSystem.lookPitch = -0.18;
      window.simulator.camera.fov = 60;
      window.simulator.camera.updateProjectionMatrix();
    `);

    console.log('🎉 All cockpit viewpoints captured successfully!');
    ws.close();
  } finally {
    try {
      chrome.kill('SIGKILL');
    } catch (e) {}
  }
}

main().catch(err => {
  console.error('❌ Error during cockpit capture:', err);
  process.exit(1);
});
