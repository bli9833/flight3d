import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5173;
const CDP_PORT = 9448;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/ad33c4b1-3b1c-4752-ad5e-b09f9794851b';

async function main() {
  console.log('🚀 Spawning Chrome to capture updated cockpit viewpoints...');
  const profileDir = `/tmp/chrome-cockpit-capture-${Date.now()}`;
  const args = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    SIM_URL
  ];

  const chrome = spawn('google-chrome-stable', args, { stdio: 'ignore' });

  try {
    let pageTarget = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find(t => t.url.includes(String(PORT)) && t.type === 'page');
        if (pageTarget) break;
      } catch (e) {}
    }

    if (!pageTarget) throw new Error('CDP target not found');
    console.log(`🔌 Connected to CDP target: ${pageTarget.webSocketDebuggerUrl}`);

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    let msgId = 1;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evalJs = async (expr) => {
      const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res.result?.value;
    };

    const takeScreenshot = async (filename) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(path.resolve(process.cwd(), filename), buf);
      if (fs.existsSync(ARTIFACT_DIR)) {
        fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
      }
      console.log(`📸 Saved: ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('⏳ Waiting for 3D simulator scene to render...');
    await new Promise(r => setTimeout(r, 3000));

    // 1. Capture Captain Forward View (Default Cockpit framing: MCP, PFD, ND, ISFD, EICAS, Windshield)
    await evalJs(`
      window.simulator.cameraSystem.setMode(0); // COCKPIT
      window.simulator.cameraSystem.lookYaw = 0.0;
      window.simulator.cameraSystem.lookPitch = -0.18;
      window.simulator.camera.fov = 60;
      window.simulator.camera.updateProjectionMatrix();
    `);
    await new Promise(r => setTimeout(r, 1200));
    await takeScreenshot('cockpit_view.png');

    // 2. Capture Flight Instruments Center View (Pitch down -0.32 to showcase full PFD, ND, ISFD, EICAS)
    await evalJs(`
      window.simulator.cameraSystem.lookYaw = 0.05;
      window.simulator.cameraSystem.lookPitch = -0.32;
      window.simulator.camera.fov = 58;
      window.simulator.camera.updateProjectionMatrix();
    `);
    await new Promise(r => setTimeout(r, 800));
    await takeScreenshot('cockpit_instruments_view.png');

    // 3. Capture Pedestal & FMC / CDU View (Looking down-right at FMC, throttles, and trim wheels)
    await evalJs(`
      window.simulator.cameraSystem.lookYaw = -0.42;
      window.simulator.cameraSystem.lookPitch = -0.48;
      window.simulator.camera.fov = 60;
      window.simulator.camera.updateProjectionMatrix();
    `);
    await new Promise(r => setTimeout(r, 800));
    await takeScreenshot('cockpit_pedestal_view.png');

    // 4. Reset to forward view
    await evalJs(`
      window.simulator.cameraSystem.lookYaw = 0.0;
      window.simulator.cameraSystem.lookPitch = -0.18;
      window.simulator.camera.fov = 60;
      window.simulator.camera.updateProjectionMatrix();
    `);

    console.log('✅ Cockpit capture sequence completed successfully!');
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
