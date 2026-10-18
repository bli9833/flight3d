import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 5173;
const CDP_PORT = 9460;
const SIM_URL = `http://localhost:${PORT}/`;

async function diagnose() {
  console.log('🔍 Starting Demo Flight Diagnostics...');
  const profileDir = `/tmp/chrome-demo-diag-${Date.now()}`;
  const args = [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    SIM_URL
  ];

  const chrome = spawn('/usr/bin/google-chrome', args, { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 2000));

  const versionRes = await fetch(`http://localhost:${CDP_PORT}/json/list`);
  const targets = await versionRes.json();
  const pageTarget = targets.find(t => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
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
  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result.value;
  }

  await send('Page.enable');
  await send('Runtime.enable');

  // Wait for simulator
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate('typeof window.simulator !== "undefined" && window.simulator.aircraft !== undefined');
    if (ready) break;
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('✈️ Simulator ready, tracking demo flight frame by frame...');

  // Track demo flight for 45 seconds of simulation time
  let prevHdg = null;
  let prevPos = null;
  let prevCameraPos = null;
  const history = [];

  for (let sec = 0; sec < 50; sec++) {
    // Run 1 second in simulation
    const state = await evaluate(`
      (() => {
        const sim = window.simulator;
        const d = sim.demoDirector;
        const tel = sim.telemetry;
        const cam = sim.cameraSystem;
        return {
          stage: d.currentStage,
          stageTimer: d.stageTimer.toFixed(1),
          active: d.isActive,
          camMode: cam.getModeName(),
          camPos: { x: sim.camera.position.x.toFixed(2), y: sim.camera.position.y.toFixed(2), z: sim.camera.position.z.toFixed(2) },
          pos: { x: sim.position.x.toFixed(1), y: sim.position.y.toFixed(1), z: sim.position.z.toFixed(1) },
          vel: { x: sim.linearVelocity.x.toFixed(1), y: sim.linearVelocity.y.toFixed(1), z: sim.linearVelocity.z.toFixed(1) },
          angVel: { x: sim.angularVelocity.x.toFixed(3), y: sim.angularVelocity.y.toFixed(3), z: sim.angularVelocity.z.toFixed(3) },
          ias: Math.round(tel.iasKnots),
          alt: Math.round(tel.altitudeFt),
          radioAlt: Math.round(tel.radioAltFt),
          pitch: tel.pitchDeg.toFixed(1),
          roll: tel.rollDeg.toFixed(1),
          hdg: Math.round(tel.headingDeg),
          gForce: tel.gForce.toFixed(2),
          isStalled: tel.isStalled,
          onGround: tel.onGround,
          touchdown: tel.touchdown
        };
      })()
    `);

    // Check for sudden 180° heading jump or huge angular velocity
    let hdgJump = 0;
    if (prevHdg !== null) {
      hdgJump = Math.abs(((state.hdg - prevHdg + 540) % 360) - 180);
    }

    console.log(`[T=${sec}s][Stage ${state.stage}|${state.camMode}] Hdg:${state.hdg}°(Δ${hdgJump}°) Pitch:${state.pitch}° Roll:${state.roll}° Alt:${state.alt}ft IAS:${state.ias}kt G:${state.gForce}G pos:(${state.pos.x}, ${state.pos.y}, ${state.pos.z})`);

    if (hdgJump > 40 && prevHdg !== null) {
      console.warn(`🚨 ABNORMAL HEADING JUMP DETECTED at T=${sec}s! Previous: ${prevHdg}°, Now: ${state.hdg}°`);
      const snap = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`diag_jump_${sec}.png`, Buffer.from(snap.data, 'base64'));
    }

    prevHdg = state.hdg;
    await new Promise(r => setTimeout(r, 1000));
  }

  ws.close();
  chrome.kill('SIGKILL');
  console.log('✅ Diagnostic run finished.');
}

diagnose().catch(console.error);
