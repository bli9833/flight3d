/**
 * @file scripts/test-lukla-demo-benchmark.mjs
 * @description Runs the full autonomous Lukla circuit demo flight with hardware GPU acceleration,
 * captures 3 milestone screenshots (Takeoff, Turnaround, Touchdown), and profiles precise execution times.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const PORT = 5173;
const CDP_PORT = 9488;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/9f9b0ac3-b20b-41ab-8441-938150561733';

async function runLuklaDemoBenchmark() {
  const suiteStart = performance.now();
  console.log('🏔️ ==============================================================');
  console.log('🏔️ AUTONOMOUS LUKLA DEMO FLIGHT BENCHMARK (3 MILESTONE SCREENSHOTS)');
  console.log('🏔️ ==============================================================');

  // Verify Vite dev server is running
  try {
    const res = await fetch(SIM_URL);
    if (!res.ok) throw new Error('Vite not responding ok');
  } catch (e) {
    console.error('❌ Vite dev server is not reachable on port ' + PORT);
    process.exit(1);
  }

  // Launch Chrome with Hardware GPU (Vulkan)
  const profileDir = `/tmp/chrome-lukla-demo-${Date.now()}`;
  const chromeArgs = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720',
    '--use-gl=angle',
    '--use-angle=vulkan',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    SIM_URL
  ];

  console.log('🚀 Spawning Headless Chrome with Hardware GPU acceleration (Vulkan)...');
  const chrome = spawn('google-chrome-stable', chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr?.on('data', (d) => {
    const s = d.toString();
    if (s.includes('FATAL') || s.includes('Crash')) console.error('[Chrome Err]', s.trim());
  });

  try {
    let pageTarget = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find(t => t.url.includes(String(PORT)) && t.type === 'page');
        if (pageTarget) break;
      } catch (e) {}
    }

    if (!pageTarget) throw new Error('CDP target not found on port ' + CDP_PORT);
    console.log(`🔌 Connected to CDP: ${pageTarget.webSocketDebuggerUrl}`);

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
      if (res?.exceptionDetails) {
        const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
        throw new Error(`Browser JS Error: ${desc}`);
      }
      return res?.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('⏳ Waiting for simulator to initialize WebGL context...');
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      const ready = await evalJs(`Boolean(window.simulator && window.simulator.currentTerrain && window.simulator.demoDirector)`);
      if (ready) break;
    }

    // Inspect renderer
    const renderer = await evalJs(`
      (() => {
        const gl = window.simulator?.renderer?.getContext();
        if (!gl) return 'No WebGL';
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      })()
    `);
    console.log(`🎨 WebGL Renderer: ${renderer}`);

    // Set airport to lukla and start demo director
    console.log('🛫 Initializing Lukla Continuous Circuit Demo Flight...');
    await evalJs(`
      (() => {
        const sim = window.simulator;
        sim.setAirport('lukla');
        sim.demoDirector.start('lukla');
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    // Milestone Screenshot helper
    const screenshotTimes = [];
    const takeMilestoneScreenshot = async (name, filename) => {
      console.log(`📸 Capturing Milestone: ${name}...`);
      const t0 = performance.now();
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const elapsedMs = performance.now() - t0;
      screenshotTimes.push({ name, filename, elapsedMs });

      const buf = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(path.resolve(process.cwd(), filename), buf);
      if (fs.existsSync(ARTIFACT_DIR)) {
        fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
      }
      console.log(`✅ Saved: ${filename} (${(buf.length / 1024).toFixed(1)} KB in ${(elapsedMs / 1000).toFixed(2)}s)`);
    };

    let shot1Taken = false;
    let shot2Taken = false;
    let shot3Taken = false;

    let simDurationSec = 0;
    let totalSteppingMs = 0;
    let totalSteps = 0;
    const stagesTraversed = new Set();
    const flightStartTime = performance.now();

    const dt = 0.25; // 250ms per physics subslice (contains 30 internal 120Hz substeps)
    const maxSteps = 600; // max 150s sim flight time

    for (let step = 0; step < maxSteps; step++) {
      const t0 = performance.now();
      const stepData = await evalJs(`
        (() => {
          const sim = window.simulator;
          sim.stepSimulation(${dt});
          const d = sim.demoDirector;
          const tel = sim.telemetry;
          const pos = sim.position;
          const groundH = sim.currentTerrain ? sim.currentTerrain.getHeight(pos.x, pos.z) : 0;
          return {
            stage: d.currentStage,
            stageTimer: d.stageTimer,
            ias: Math.round(tel.iasKnots),
            altFt: Math.round(tel.altitudeFt),
            pitchDeg: tel.pitchDeg.toFixed(1),
            rollDeg: tel.rollDeg.toFixed(1),
            headingDeg: Math.round(tel.headingDeg),
            groundH: Math.round(groundH),
            clearance: Math.round(pos.y - groundH),
            isCrashed: sim.isCrashed,
            crashDesc: sim.crashResult ? sim.crashResult.description : null,
            touchdown: tel.touchdown,
            onGround: tel.onGround,
            speedKt: Math.round(tel.groundSpeedKnots || 0)
          };
        })()
      `);
      const stepLatencyMs = performance.now() - t0;
      totalSteppingMs += stepLatencyMs;
      simDurationSec += dt;
      totalSteps++;

      stagesTraversed.add(stepData.stage);

      if (step % 12 === 0 || stepData.touchdown || stepData.isCrashed) {
        console.log(`⏱️ Sim ${simDurationSec.toFixed(1)}s [Stg ${stepData.stage}]: IAS=${stepData.ias}kt, Alt=${stepData.altFt}ft, Pitch=${stepData.pitchDeg}°, Roll=${stepData.rollDeg}°, Clr=${stepData.clearance}m`);
      }

      if (stepData.isCrashed) {
        throw new Error(`Aircraft crashed during demo flight in Stage ${stepData.stage}: ${stepData.crashDesc}`);
      }

      // MILESTONE 1: Cliff dive takeoff roll / initial canyon climb (Stage 1 or T > 12s)
      if (!shot1Taken && (stepData.stage === 1 || (stepData.stage === 0 && stepData.stageTimer > 10))) {
        shot1Taken = true;
        await takeMilestoneScreenshot('1. Cliff Dive Takeoff & Dudh Kosi Gorge Climb', 'lukla_demo_1_cliff_takeoff.png');
      }

      // MILESTONE 2: Canyon 180° Turnaround among Himalayan peaks (Stage 2 & stageTimer > 15s)
      if (!shot2Taken && stepData.stage === 2 && stepData.stageTimer >= 15) {
        shot2Taken = true;
        await takeMilestoneScreenshot('2. 180° Himalayan Valley Turnaround', 'lukla_demo_2_canyon_turnaround.png');
      }

      // MILESTONE 3: Final Approach & Uphill Touchdown on Runway 06 (Stage 4 touchdown or Stage 5)
      if (!shot3Taken && (stepData.stage === 4 && (stepData.touchdown || stepData.stageTimer > 8) || stepData.stage === 5)) {
        shot3Taken = true;
        await takeMilestoneScreenshot('3. Runway 06 11.7% Uphill Touchdown & Braking', 'lukla_demo_3_uphill_touchdown.png');
      }

      // Completed check
      if (stepData.stage === 5 || (stepData.stage === 4 && stepData.onGround && stepData.speedKt < 2)) {
        console.log(`🎯 Lukla continuous circuit completed successfully at Sim T=${simDurationSec.toFixed(1)}s!`);
        break;
      }
    }

    // Safety fallback: if any of the 3 shots were missed due to fast stage advancement, take them now
    if (!shot1Taken) await takeMilestoneScreenshot('1. Fallback', 'lukla_demo_1_cliff_takeoff.png');
    if (!shot2Taken) await takeMilestoneScreenshot('2. Fallback', 'lukla_demo_2_canyon_turnaround.png');
    if (!shot3Taken) await takeMilestoneScreenshot('3. Fallback', 'lukla_demo_3_uphill_touchdown.png');

    const totalSuiteDurationMs = performance.now() - suiteStart;
    const flightDurationMs = performance.now() - flightStartTime;
    const totalScreenshotMs = screenshotTimes.reduce((acc, s) => acc + s.elapsedMs, 0);
    const speedRatio = simDurationSec / (flightDurationMs / 1000);

    console.log('\n=============================================================');
    console.log('       LUKLA DEMO FLIGHT BENCHMARK REPORT');
    console.log('=============================================================');
    console.log(`Active WebGL Engine:        ${renderer}`);
    console.log(`Total Wall-Clock Time:      ${(totalSuiteDurationMs / 1000).toFixed(2)}s`);
    console.log(`Flight Execution Time:      ${(flightDurationMs / 1000).toFixed(2)}s`);
    console.log(`Simulated Flight Time:      ${simDurationSec.toFixed(1)}s`);
    console.log(`Simulation Speed Ratio:     ${speedRatio.toFixed(2)}x real-time 🚀`);
    console.log(`Total Physics Steps:        ${totalSteps} slices (${(totalSteppingMs / 1000).toFixed(2)}s total, ${(totalSteppingMs / totalSteps).toFixed(2)}ms/step)`);
    console.log(`Screenshot Total Overhead:  ${(totalScreenshotMs / 1000).toFixed(2)}s for 3 PNGs`);
    console.log('Individual Screenshot Latency:');
    for (const s of screenshotTimes) {
      console.log(`  - ${s.name}: ${(s.elapsedMs / 1000).toFixed(2)}s (${s.filename})`);
    }
    console.log(`Stages Traversed:           ${[...stagesTraversed].join(' -> ')}`);
    console.log('=============================================================\n');

    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}

runLuklaDemoBenchmark().catch(err => {
  console.error('❌ Benchmark error:', err);
  process.exit(1);
});
