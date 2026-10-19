import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5173;
const CDP_PORT = 9477;
const SIM_URL = `http://localhost:${PORT}/`;
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/home/stlim/.gemini/antigravity-cli/brain/bcd826f8-e1a6-4976-85f2-0b2ca46b22fc';

const SCENARIOS = [
  { timeName: 'sunrise', hour: 6.0, label: '일출 (Sunrise 06:00)' },
  { timeName: 'noon', hour: 12.0, label: '정오 (Noon 12:00)' },
  { timeName: 'sunset', hour: 18.0, label: '황혼 (Sunset 18:00)' },
  { timeName: 'night', hour: 23.0, label: '야간 (Night 23:00)' }
];

const ALTITUDES = [
  {
    altName: 'low_100ft',
    y: 30.5, // 100ft
    pitch: 2.0,
    heading: 90,
    label: '저고도 (100ft / 30m)',
    camMode: 1 // Chase
  },
  {
    altName: 'high_6000ft',
    y: 1828.8, // 6,000ft
    pitch: -2.5,
    heading: 135,
    label: '고고도 (6,000ft / 1,828m)',
    camMode: 1 // Chase
  }
];

async function main() {
  console.log('🚀 Launching Headless Chrome to verify Aerial Perspective Fog & Lighting Matrix...');
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  const profileDir = `/tmp/chrome-fog-matrix-${Date.now()}`;
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
    SIM_URL
  ];

  const chrome = spawn('google-chrome-stable', args, { stdio: 'ignore' });

  try {
    let pageTarget = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const resp = await fetch(`http://localhost:${CDP_PORT}/json`);
        const targets = await resp.json();
        pageTarget = targets.find(t => t.url && t.url.includes(String(PORT)) && t.type === 'page');
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
      fs.writeFileSync(path.join(ARTIFACT_DIR, filename), buf);
      console.log(`📸 Saved screenshot: ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('⏳ Waiting for simulator initialization...');
    for (let i = 0; i < 40; i++) {
      const ready = await evalJs('Boolean(typeof window.simulator !== "undefined" && window.simulator.aircraft && window.simulator.sky)');
      if (ready) break;
      await new Promise(r => setTimeout(r, 300));
    }

    // Stop demo flight director to take full programmatic control of aircraft & camera
    await evalJs(`
      if (window.simulator.demoDirector) window.simulator.demoDirector.stop();
      window.simulator.cameraSystem.setMode(1); // Chase view
    `);

    console.log('\n=================== 4대 시간대 × 고도 2단계 검증 시작 ===================');
    const matrixResults = [];

    for (const time of SCENARIOS) {
      for (const alt of ALTITUDES) {
        console.log(`\n▶ [${time.label}] × [${alt.label}] 셋업 중...`);

        // Set time and altitude state
        const state = await evalJs(`
          (() => {
            const sim = window.simulator;
            sim.sky.setTimeOfDay(${time.hour});
            
            // Reposition aircraft for cinematic view
            if (${alt.y} < 100) {
              // Runway threshold climb-out orientation
              sim.position.set(-1000, ${alt.y}, 0);
              sim.linearVelocity.set(70, 2.5, 0);
            } else {
              // Scenic high-altitude over island looking across bay & mountains
              sim.position.set(-1500, ${alt.y}, 1200);
              sim.linearVelocity.set(110, 0, -60);
            }
            
            sim.aircraft.group.position.copy(sim.position);
            sim.cameraSystem.snapToTarget(sim.aircraft.group);
            sim.sky.updateSun(sim.position, sim.camera.position);

            // Measure GPU frame time over 10 rendered frames
            const frameTimes = [];
            for (let f = 0; f < 10; f++) {
              const t0 = performance.now();
              sim.renderer.render(sim.scene, sim.camera);
              frameTimes.push(performance.now() - t0);
            }
            const avgMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;

            const fogCol = sim.scene.fog ? sim.scene.fog.color : null;
            const fogDens = sim.scene.fog ? sim.scene.fog.density : 0;
            const exposure = sim.renderer.toneMappingExposure;

            return {
              fogR: fogCol ? fogCol.r.toFixed(3) : 0,
              fogG: fogCol ? fogCol.g.toFixed(3) : 0,
              fogB: fogCol ? fogCol.b.toFixed(3) : 0,
              density: fogDens.toExponential(3),
              exposure: exposure.toFixed(2),
              avgRenderMs: avgMs.toFixed(2),
              sunLightIntensity: sim.sky.sunLight.intensity.toFixed(2),
              ambientLightIntensity: sim.sky.ambientLight.intensity.toFixed(2)
            };
          })()
        `);

        // Settle rendering for 500ms
        await new Promise(r => setTimeout(r, 500));

        const filename = `fog_${time.timeName}_${alt.altName}.png`;
        await takeScreenshot(filename);

        matrixResults.push({
          timeLabel: time.label,
          altLabel: alt.label,
          density: state.density,
          fogColor: `rgb(${Math.round(state.fogR * 255)}, ${Math.round(state.fogG * 255)}, ${Math.round(state.fogB * 255)})`,
          exposure: state.exposure,
          renderMs: state.avgRenderMs,
          sunInt: state.sunLightIntensity,
          ambInt: state.ambientLightIntensity,
          filename
        });
      }
    }

    console.log('\n=================== 📊 매트릭스 측정 결과 요약 ===================\n');
    console.table(matrixResults.map(r => ({
      '시간대': r.timeLabel,
      '고도': r.altLabel,
      '안개 밀도 (Density)': r.density,
      '안개 색상 (RGB)': r.fogColor,
      '노출 (Exposure)': r.exposure,
      '렌더 타임 (ms)': `${r.renderMs} ms`
    })));

    // Save JSON results for PR report
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, 'fog_matrix_benchmark.json'),
      JSON.stringify(matrixResults, null, 2)
    );

    console.log('\n✅ 모든 8개 매트릭스 캡처 및 벤치마크 완료!');
    ws.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
