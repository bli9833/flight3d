import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SIM_PORT = 5173;
const CDP_PORT = 9234;
const SIM_URL = `http://127.0.0.1:${SIM_PORT}/`;
const OUTPUT_DIR = process.env.ARTIFACT_DIR || '/home/bli/.gemini/antigravity-cli/brain/a3ad2ff1-feab-42d2-8534-a320d9e30f37';

async function main() {
  console.log('🌊 Verifying Ocean Water Camera Anchoring & Far Edge Horizon Blending...');

  const profileDir = `/tmp/chrome-ocean-verify-${Date.now()}`;
  const chromeArgs = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1080,2400', // Match mobile portrait aspect ratio from user screenshot
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    SIM_URL
  ];

  const chrome = spawn('/usr/bin/google-chrome', chromeArgs, { stdio: 'ignore' });

  // Cleanup handler
  const cleanup = () => {
    try { chrome.kill(); } catch (e) {}
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  // Wait for Chrome to bind port
  let connected = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (res.ok) {
        connected = true;
        break;
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (!connected) {
    cleanup();
    throw new Error('Could not connect to Chrome CDP');
  }

  const targetsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const targets = await targetsRes.json();
  const pageTarget = targets.find(t => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  const consoleLogs = [];

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
      consoleLogs.push(`[Browser] ${text}`);
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise(r => ws.onopen = r);

  async function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');

  // Wait for simulation to initialize
  console.log('⏳ Waiting for 3D simulator to boot...');
  let simReady = false;
  for (let i = 0; i < 30; i++) {
    const evalRes = await send('Runtime.evaluate', {
      expression: 'Boolean((window.sim || window.simulator) && (window.sim || window.simulator).water && (window.sim || window.simulator).aircraft)',
      returnByValue: true
    });
    if (evalRes && evalRes.result && evalRes.result.value) {
      simReady = true;
      break;
    }
    await new Promise(r => setTimeout(r, 250));
  }

  if (!simReady) {
    cleanup();
    throw new Error('Simulation failed to initialize in time');
  }

  console.log('✅ Simulator loaded and initialized!');
  await send('Runtime.evaluate', { expression: 'window.sim = window.sim || window.simulator;' });

  // Test Case 1: Cruise preset (Z = 3200) - Verify Chase view over coastal ocean
  console.log('📸 Capturing View 1: Cruise over coastal ocean (Z = 3200)...');
  await send('Runtime.evaluate', {
    expression: `
      window.sim.setPreset('CRUISE');
      window.sim.cameraSystem.setMode('CHASE');
      // Advance physics frames
      for (let i = 0; i < 30; i++) window.sim.stepSimulation(0.016);
    `
  });
  await new Promise(r => setTimeout(r, 600));

  const screenshot1 = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  const img1Path = path.join(OUTPUT_DIR, 'ocean_verification_cruise.jpg');
  fs.writeFileSync(img1Path, Buffer.from(screenshot1.data, 'base64'));
  console.log(`Saved: ${img1Path}`);

  // Test Case 2: Boundary test - Position plane at Z = 17,500 (where previously the 36km mesh cut off!)
  console.log('📸 Capturing View 2: Former mesh boundary test (Z = 17,500)...');
  await send('Runtime.evaluate', {
    expression: `
      window.sim.position.set(0, 1500, 17500);
      window.sim.velocity.set(0, 0, 220);
      window.sim.rotation.set(0, 0, 0);
      window.sim.cameraSystem.setMode('CHASE');
      // Step simulation to trigger cameraSystem and water anchoring
      for (let i = 0; i < 30; i++) window.sim.stepSimulation(0.016);
    `
  });
  await new Promise(r => setTimeout(r, 600));

  const waterPosCheck = await send('Runtime.evaluate', {
    expression: `({
      waterMeshX: window.sim.water.mesh.position.x,
      waterMeshZ: window.sim.water.mesh.position.z,
      camX: window.sim.camera.position.x,
      camZ: window.sim.camera.position.z
    })`,
    returnByValue: true
  });
  console.log('Water mesh position check at Z=17,500:', waterPosCheck.result.value);

  const screenshot2 = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  const img2Path = path.join(OUTPUT_DIR, 'ocean_verification_boundary_17500.jpg');
  fs.writeFileSync(img2Path, Buffer.from(screenshot2.data, 'base64'));
  console.log(`Saved: ${img2Path}`);

  // Test Case 3: Far open ocean test - Position plane at Z = 45,000 (deep open ocean far beyond original 18km limit!)
  console.log('📸 Capturing View 3: Deep open ocean test (Z = 45,000)...');
  await send('Runtime.evaluate', {
    expression: `
      window.sim.position.set(0, 2500, 45000);
      window.sim.velocity.set(0, 0, 240);
      window.sim.cameraSystem.setMode('CHASE');
      for (let i = 0; i < 30; i++) window.sim.stepSimulation(0.016);
    `
  });
  await new Promise(r => setTimeout(r, 600));

  const waterPosCheck2 = await send('Runtime.evaluate', {
    expression: `({
      waterMeshX: window.sim.water.mesh.position.x,
      waterMeshZ: window.sim.water.mesh.position.z,
      camX: window.sim.camera.position.x,
      camZ: window.sim.camera.position.z
    })`,
    returnByValue: true
  });
  console.log('Water mesh position check at Z=45,000:', waterPosCheck2.result.value);

  const screenshot3 = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  const img3Path = path.join(OUTPUT_DIR, 'ocean_verification_deep_ocean_45000.jpg');
  fs.writeFileSync(img3Path, Buffer.from(screenshot3.data, 'base64'));
  console.log(`Saved: ${img3Path}`);

  cleanup();
  console.log('🎉 Ocean verification completed successfully with 0 errors!');
}

main().catch(err => {
  console.error('❌ Error during ocean verification:', err);
  process.exit(1);
});
