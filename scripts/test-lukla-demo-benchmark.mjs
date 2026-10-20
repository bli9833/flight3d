/** Run the real browser physics circuit; incomplete flights must fail this gate. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = Number(process.env.PORT || 5173);
const CDP_PORT = Number(process.env.CDP_PORT || 9488);
const SIM_URL = `http://127.0.0.1:${PORT}/`;
const ARTIFACT_DIR = path.resolve(process.env.ARTIFACT_DIR || '.tmp/lukla-physics');
const screenshots = process.argv.includes('--screenshots');
const repetitions = Number(process.env.LUKLA_RUNS || 3);
assert.ok(Number.isInteger(repetitions) && repetitions > 0 && repetitions <= 10);

async function main() {
  assert.ok((await fetch(SIM_URL)).ok, `Start Vite on port ${PORT}`);
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const profile = fs.mkdtempSync('/tmp/chrome-lukla-physics-');
  const chrome = spawn('google-chrome-stable', [
    '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,720', '--use-gl=angle', '--use-angle=vulkan',
    '--disable-dev-shm-usage', '--no-first-run', SIM_URL
  ], { stdio: 'ignore' });
  let ws;
  try {
    let page;
    for (let i = 0; i < 60 && !page; i++) {
      await new Promise(r => setTimeout(r, 100));
      try {
        page = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json())
          .find(t => t.type === 'page' && t.url.includes(String(PORT)));
      } catch { /* Chrome may still be starting. */ }
    }
    assert.ok(page, 'Chrome CDP page must be available');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      const request = pending.get(msg.id);
      if (!request) return;
      pending.delete(msg.id);
      clearTimeout(request.timer);
      if (msg.error) request.reject(new Error(msg.error.message));
      else request.resolve(msg.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      ready = await evaluate('!!window.simulator?.luklaTerrain?.isLoaded');
      if (!ready) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(ready, 'Measured DEM must load; an unloaded fallback cannot pass');
    const renderer = await evaluate(`(() => {
      const gl = window.simulator.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    })()`);
    const reports = [];
    for (let run = 0; run < repetitions; run++) {
      await evaluate(`(() => {
        const sim = window.simulator;
        // Freeze wall-clock advance only. stepSimulation still uses the actual
        // director, controls, terrain, forces, collision and 120 Hz integration.
        sim.clock.getDelta = () => 0;
        sim.physicsAccumulator = 0;
        sim.setAirport('lukla');
        sim.demoDirector.start('lukla');
        const original = sim.integratePhysics.bind(sim);
        window.luklaMetrics = { stallFrames: 0, maxAlpha: 0, stages: [], touchdowns: [], finite: true };
        sim.integratePhysics = function(dt) {
          original(dt);
          const m = window.luklaMetrics;
          m.stallFrames += this.aero.isStalled ? 1 : 0;
          m.maxAlpha = Math.max(m.maxAlpha, this.aero.alpha * 180 / Math.PI);
          m.finite &&= [...this.position, ...this.linearVelocity, ...this.angularVelocity].every(Number.isFinite);
          const stage = this.demoDirector.currentStage;
          if (m.stages.at(-1) !== stage) m.stages.push(stage);
          if (this.demoDirector.luklaScenario.result.airborne && this.gear.touchdownEvent) {
            m.touchdowns.push({ speedKt: this.telemetry.iasKnots,
              contacts: this.gear.contacts.filter(c => c.touchdownThisFrame).map(c => c.id) });
          }
        };
        window.restoreLuklaIntegration = () => { sim.integratePhysics = original; };
      })()`);
      const captured = new Set();
      let final;
      for (let slice = 0; slice < 960; slice++) {
        const state = await evaluate(`(() => {
          const sim = window.simulator;
          sim.stepSimulation(0.25);
          return { active: sim.demoDirector.isActive, crashed: sim.isCrashed,
            stage: sim.demoDirector.currentStage, outcome: sim.demoDirector.luklaScenario.result.status };
        })()`);
        if (screenshots && run === 0 && [1, 2, 4].includes(state.stage) && !captured.has(state.stage)) {
          captured.add(state.stage);
          await evaluate('window.simulator.renderer.render(window.simulator.scene, window.simulator.camera)');
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(ARTIFACT_DIR, `stage-${state.stage}.png`), Buffer.from(shot.data, 'base64'));
        }
        if (state.crashed || !state.active) { final = state; break; }
      }
      const report = await evaluate(`(() => {
        const sim = window.simulator;
        const result = structuredClone(sim.demoDirector.luklaScenario.result);
        const stop = sim.position.clone();
        sim.stepSimulation(10);
        const s = sim.position.x * 0.848048 - sim.position.z * 0.529919;
        return { ...window.luklaMetrics, result, maxImpact: sim.gear.maxImpactSpeed,
          remainingRunwayM: 263.5 - s, holdDriftM: sim.position.distanceTo(stop),
          speedMs: sim.linearVelocity.length(), gearFailure: sim.gear.failure,
          crashed: sim.isCrashed, parkingBrake: sim.controls.parkingBrake };
      })()`);
      await evaluate('window.restoreLuklaIntegration()');
      reports.push(report);
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'report.json'), JSON.stringify({ renderer, reports }, null, 2));
      assert.ok(final, 'Circuit timed out; screenshots or stage changes cannot count as success');
      assert.equal(report.result.status, 'completed', JSON.stringify(report));
      assert.equal(report.crashed, false);
      assert.equal(report.gearFailure, null);
      assert.equal(report.finite, true);
      assert.equal(report.stallFrames, 0);
      assert.ok([0, 1, 2, 3, 4].every(s => report.stages.includes(s)));
      assert.ok(report.touchdowns.length > 0, 'A real touchdown event must be observed');
      assert.ok(report.remainingRunwayM > 50, 'Stop with runway margin');
      assert.ok(report.speedMs < 0.1);
      assert.ok(report.holdDriftM < 0.1, 'Parking brake must hold on the slope for 10s');
      console.log(`Run ${run + 1}: ${report.result.elapsedSeconds.toFixed(1)}s; max impact ${report.maxImpact.toFixed(2)}m/s; runway remaining ${report.remainingRunwayM.toFixed(1)}m; hold drift ${report.holdDriftM.toFixed(3)}m`);
    }
    const rejectedImpacts = await evaluate(`(() => {
      const sim = window.simulator;
      const cases = [];
      for (const uphill of [false, true]) {
        sim.setAirport(uphill ? 'lukla' : 'coastal');
        sim.setPreset('runway');
        sim.controls.setParkingBrake(false);
        const heading = uphill ? 58 * Math.PI / 180 : 0;
        const x = uphill ? -150 * Math.sin(heading) - 5 * Math.cos(heading) : -1000;
        const z = uphill ? 150 * Math.cos(heading) - 5 * Math.sin(heading) : 0;
        const y = sim.currentTerrain.getHeight(x, z) + 3.75;
        sim.position.set(x, y, z);
        sim.quaternion.setFromEuler(new THREE.Euler(uphill ? Math.atan(0.1176) : 0, -heading, 0, 'YXZ'));
        sim.angularVelocity.set(0, 0, 0);
        sim.linearVelocity.set(65 * Math.sin(heading), uphill ? 0 : -20, -65 * Math.cos(heading));
        sim.aircraft.group.position.copy(sim.position);
        sim.aircraft.group.quaternion.copy(sim.quaternion);
        sim.aircraft.group.updateMatrixWorld(true);
        sim.integratePhysics(1 / 120);
        cases.push({ uphill, crashed: sim.isCrashed, failure: sim.gear.failure,
          yChanged: sim.position.y !== y, massKg: sim.aero.mass });
      }
      return cases;
    })()`);
    for (const impact of rejectedImpacts) {
      assert.equal(impact.crashed, true, JSON.stringify(impact));
      assert.equal(impact.failure?.reason, 'impact');
      assert.ok(impact.failure.sinkRate > (impact.uphill ? 7 : 19));
      assert.equal(impact.yChanged, false, 'Impact must be detected before correcting position');
      assert.equal(impact.massKg, 66000, 'Manual presets must restore default aircraft loading');
    }
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'report.json'), JSON.stringify({ renderer, reports, rejectedImpacts }, null, 2));
    console.log(`PASS: ${reports.length} complete circuits. ${path.join(ARTIFACT_DIR, 'report.json')}`);
  } finally {
    ws?.close();
    chrome.kill('SIGTERM');
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
