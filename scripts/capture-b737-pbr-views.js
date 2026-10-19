import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIM_PORT = 5174;
const CDP_PORT = 9448;
const SIM_URL = `http://localhost:${SIM_PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.resolve(process.cwd());

async function main() {
  console.log('✈️ Starting Headless Chrome to capture Boeing 737 PBR Model & IBL Verification views...');

  // 1. Start Vite preview/dev on dedicated port 5174
  const viteProc = spawn('npx', ['vite', '--port', String(SIM_PORT), '--strictPort'], {
    stdio: 'ignore',
    env: { ...process.env, PATH: `/home/stlim/.local/bin:${process.env.PATH}` }
  });

  // Wait for Vite
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch(SIM_URL);
      if (res.ok) break;
    } catch (e) {}
  }

  // 2. Launch Headless Chrome
  const chromeArgs = [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
    SIM_URL
  ];

  const chromeProc = spawn('google-chrome-stable', chromeArgs, { stdio: 'ignore' });

  let pageTarget = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
      const targets = await resp.json();
      pageTarget = targets.find(t => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    } catch (e) {}
  }

  if (!pageTarget) {
    chromeProc.kill();
    viteProc.kill();
    throw new Error('Could not connect to Chrome CDP target');
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const pending = new Map();
  const consoleErrors = [];

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text;
        consoleErrors.push(desc);
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

  // Wait for simulator to be initialized
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 300));
    const ready = await evalCode(`Boolean(window.simulator && window.simulator.aircraft)`);
    if (ready) break;
  }

  // Wait for GLTF model to load
  console.log('⏳ Waiting for Boeing 737 GLTF PBR model to load...');
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    const modelLoaded = await evalCode(`Boolean(window.simulator.aircraft.modelLoaded)`);
    if (modelLoaded) {
      console.log('✅ Boeing 737 GLTF PBR model loaded and active!');
      break;
    }
  }

  const captureView = async (filename, setupCode) => {
    await evalCode(setupCode);
    await new Promise(r => setTimeout(r, 600)); // wait for render
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
    console.log(`📸 Captured: ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
  };

  // Capture View 1: Chase view (exterior B737 model with PBR & IBL reflection)
  await captureView('b737_pbr_chase_view.png', `
    window.simulator.cameraSystem.setMode(1); // Chase view
    window.simulator.sky.setTimeOfDay(16.5); // Golden hour for beautiful metallic reflections
  `);

  // Capture View 2: Wing view (exterior wing, winglet & engine reflection)
  await captureView('b737_pbr_wing_view.png', `
    window.simulator.cameraSystem.setMode(2); // Wing view
  `);

  // Capture View 3: Cockpit view (contract test: outer fuselage hidden, glass displays visible)
  await captureView('b737_pbr_cockpit_view.png', `
    window.simulator.cameraSystem.setMode(0); // Cockpit view
  `);

  ws.close();
  chromeProc.kill();
  viteProc.kill();
  console.log('🎉 Boeing 737 PBR verification captures complete! Errors:', consoleErrors.length);
}

main().catch(err => {
  console.error('Capture script error:', err);
  process.exit(1);
});
