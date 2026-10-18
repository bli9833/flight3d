import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5173;
const CDP_PORT = 9450;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/ad33c4b1-3b1c-4752-ad5e-b09f9794851b';

async function main() {
  console.log('🚀 Spawning Chrome to capture Demo Flight in action...');
  const profileDir = `/tmp/chrome-demo-capture-${Date.now()}`;
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

    console.log('⏳ Waiting for simulator to initialize demo flight...');
    await new Promise(r => setTimeout(r, 3000));

    // Capture Scene 1: Takeoff roll with banner
    await takeScreenshot('demo_takeoff_showcase.png');

    // Advance to Coastal Banking Turn
    await evalJs(`
      window.simulator.demoDirector.setStage(2); // COASTAL_BANK
    `);
    await new Promise(r => setTimeout(r, 1200));
    await takeScreenshot('demo_coastal_banking_showcase.png');

    // Advance to Final Approach with PAPI
    await evalJs(`
      window.simulator.demoDirector.setStage(4); // FINAL_APPROACH
    `);
    await new Promise(r => setTimeout(r, 1200));
    await takeScreenshot('demo_approach_papi_showcase.png');

    console.log('✅ Demo flight screenshots captured successfully!');
    ws.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error('Fatal capture error:', err);
  process.exit(1);
});
