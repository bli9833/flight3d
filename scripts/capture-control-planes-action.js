import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIM_PORT = 5175;
const CDP_PORT = 9449;
const SIM_URL = `http://localhost:${SIM_PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || path.resolve(process.cwd());

async function main() {
  console.log('✈️ Starting Headless Chrome for Control Planes & Landing Gear Action views...');

  const viteProc = spawn('npx', ['vite', '--port', String(SIM_PORT), '--strictPort'], {
    stdio: 'ignore',
    env: { ...process.env, PATH: `/home/stlim/.local/bin:${process.env.PATH}` }
  });

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch(SIM_URL);
      if (res.ok) break;
    } catch (e) {}
  }

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

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
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

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 300));
    const ready = await evalCode(`Boolean(window.simulator && window.simulator.aircraft && window.simulator.aircraft.modelLoaded)`);
    if (ready) break;
  }

  const captureView = async (filename, setupCode) => {
    await evalCode(setupCode);
    await new Promise(r => setTimeout(r, 600));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
    console.log(`📸 Captured: ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
  };

  // 1. Wing view with Flaps 40 and Spoilers fully deployed
  await captureView('b737_flaps_spoilers_deployed.png', `
    window.simulator.cameraSystem.setMode(2); // Wing view
    window.simulator.aircraft.update(0.016, { flapDegree: 40, spoilers: 1.0, aileron: 0 });
  `);

  // 2. Wing view with Roll Aileron deflection
  await captureView('b737_aileron_deflected.png', `
    window.simulator.cameraSystem.setMode(2); // Wing view
    window.simulator.aircraft.update(0.016, { flapDegree: 15, spoilers: 0.0, aileron: 1.0 });
  `);

  // 3. Gear camera view under fuselage
  await captureView('b737_gear_view_details.png', `
    window.simulator.cameraSystem.setMode(5); // Gear view
  `);

  ws.close();
  chromeProc.kill();
  viteProc.kill();
  console.log('🎉 Action views complete!');
}

main().catch(err => {
  console.error('Capture script error:', err);
  process.exit(1);
});
