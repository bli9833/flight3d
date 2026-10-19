import { spawn } from 'node:child_process';

const PORT = 5176;
const CDP_PORT = 9467;
const SIM_URL = `http://localhost:${PORT}/`;

async function testLuklaDemo() {
  console.log('🚀 Starting Vite preview server on port ' + PORT);
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore'
  });

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const resp = await fetch(SIM_URL);
      if (resp.ok) break;
    } catch (e) {}
  }

  const profileDir = `/tmp/chrome-lukla-demo-${Date.now()}`;
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

  const chrome = spawn('google-chrome-stable', args, { stdio: 'ignore' });

  try {
    let pageTarget = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find(t => t.url.includes(String(PORT)) && t.type === 'page');
        if (pageTarget) break;
      } catch (e) {}
    }

    if (!pageTarget) throw new Error('CDP target not found');
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
      if (res?.exceptionDetails) throw new Error(res.exceptionDetails.text);
      return res?.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('⏳ Waiting 4s for simulator to initialize WebGL...');
    await new Promise(r => setTimeout(r, 4000));

    // Verify initial airport is Lukla and demo flight is active
    const state = await evalJs(`
      (() => {
        const sim = window.simulator;
        return {
          activeAirport: sim.activeAirport,
          demoActive: sim.demoDirector.isActive,
          demoAirport: sim.demoDirector.activeDemoAirport,
          stage: sim.demoDirector.currentStage
        };
      })()
    `);

    console.log('📊 Simulator Initial State:', JSON.stringify(state, null, 2));

    if (state.activeAirport !== 'lukla') {
      throw new Error(`Expected activeAirport to be 'lukla', got '${state.activeAirport}'`);
    }
    if (!state.demoActive) {
      throw new Error('Expected demoDirector.isActive to be true');
    }
    if (state.demoAirport !== 'lukla') {
      throw new Error(`Expected demoDirector.activeDemoAirport to be 'lukla', got '${state.demoAirport}'`);
    }

    // Step simulation 25 times (approx 5 seconds of flight time)
    for (let step = 0; step < 25; step++) {
      const stepData = await evalJs(`
        (() => {
          const sim = window.simulator;
          sim.stepSimulation(0.2);
          const d = sim.demoDirector;
          const tel = sim.telemetry;
          return {
            stage: d.currentStage,
            stageTimer: d.stageTimer.toFixed(1),
            ias: Math.round(tel.iasKnots),
            alt: Math.round(tel.altitudeFt),
            pitch: tel.pitchDeg.toFixed(1),
            isCrashed: sim.isCrashed
          };
        })()
      `);
      if (step % 5 === 0) {
        console.log(`⏱️ Step ${step * 0.2}s: Stage ${stepData.stage}, IAS: ${stepData.ias}kt, Alt: ${stepData.alt}ft, Pitch: ${stepData.pitch}°, Crashed: ${stepData.isCrashed}`);
      }
      if (stepData.isCrashed) {
        throw new Error('Plane crashed during takeoff roll!');
      }
    }

    console.log('✅ Lukla Demo Flight verification successfully passed!');
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    vite.kill('SIGKILL');
  }
}

testLuklaDemo().catch(err => {
  console.error('❌ Error during demo verification:', err);
  process.exit(1);
});
