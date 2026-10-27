import fs from 'node:fs';
import path from 'node:path';

// Repeated A/B measurement of the session-only render comparison options.
// Requires a running dev server and browser admission: chrome-session --project flight3d node scripts/benchmark-render-options.mjs
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5173/';
const dir = process.env.ARTIFACT_DIR || 'review-artifacts/render-option-benchmark';
const reps = Number(process.env.REPS || 2);
const frames = Number(process.env.FRAMES || 14);
const shots = process.env.SHOTS === '1';
const only = value => value ? value.split(',') : null;
const VIEWS = (only(process.env.VIEWS) || ['forward', 'right', 'rear', 'overhead']).map(key => ({
  forward: { key, yaw: 0, pitch: -0.25 },
  right: { key, yaw: 1.3, pitch: -0.1 },
  rear: { key, yaw: 2.7, pitch: -0.15 },
  overhead: { key, yaw: 0, pitch: 0.6 },
}[key]));
const CASES = (only(process.env.CASES) || [
  'culling/off', 'side/front', 'depth/projection',
  'lights/noExterior', 'lights/noLocal', 'shadows/off',
  'ao/off', 'material/unlit', 'scene/cockpit', 'scene/world',
  'resolution/1', 'resolution/0.75',
]).map(item => item.split('/'));

fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) pending.get(message.id)?.(message);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout ${method}`)); }, 120000);
  pending.set(id, result => { clearTimeout(timer); pending.delete(id); result.error ? reject(Error(JSON.stringify(result.error))) : resolve(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const shot = async name => {
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
};
const change = (key, value) => evaluate(`(() => {
  const select = document.querySelector('[data-render-trial="${key}"]');
  select.value = '${value}'; select.dispatchEvent(new Event('change', { bubbles:true }));
})()`);
// A variant needs a shader compile before it measures steady cost, so require a
// stable program count on top of the panel's own warm-up window.
const measure = async (key, value) => {
  await change(key, value);
  let previous = -1;
  for (let i = 0; i < 400; i++) {
    await sleep(400);
    const sample = await evaluate('window.simulator.renderDiagnostics.snapshot()');
    if (!sample.warming && sample.samples >= frames && sample.programs === previous) {
      return { ...sample, key, value };
    }
    previous = sample.programs;
  }
  throw Error(`No settled samples for ${key}=${value}`);
};
const round = async (key, value) => {
  const list = [];
  for (let rep = 0; rep < reps; rep++) {
    await evaluate('window.simulator.renderDiagnostics.restartSamples()');
    list.push(await measure(key, value));
  }
  const median = field => {
    const values = list.map(sample => sample[field]).filter(value => Number.isFinite(value)).sort((a, b) => a - b);
    if (!values.length) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };
  return { key, value, reps: list, gpuMs: median('gpuMs'), gpuP95: median('gpuP95'), frameMs: median('frameMs'),
    frameP95: median('frameP95'), fps: median('fps'), cpuMs: median('cpuMs'),
    calls: median('calls'), triangles: median('triangles'), programs: median('programs') };
};
const report = { url, reps, frames, cases: [], views: [], errors: [] };
const save = () => fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report, null, 2));

try {
  await call('Runtime.enable'); await call('Page.enable'); await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 240; i++) {
    if (await evaluate('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded')) break;
    await sleep(500);
  }
  report.adapter = await evaluate(`(() => {
    const gl = window.simulator.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION), gpuTimer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
  })()`);
  await evaluate(`(() => {
    const s = window.simulator;
    s.demoDirector.stop(); s.gameFlow.enterFlight(); s.setPreset('runway');
    s.integratePhysics = () => {};
    s.cameraSystem.setMode(0, true); s.cameraSystem.photoCockpit = false;
    s.cameraSystem.enableCursorTrack = false; s.cameraSystem.enableEdgePan = false;
    s.setRenderQuality('balanced');
    document.getElementById('dev-enabled').click();
    document.getElementById('dev-render-trials').click();
  })()`);
  await evaluate('document.activeElement.blur()');
  report.quality = await evaluate(`(() => {
    const s = window.simulator;
    return { renderQuality: s.renderQuality, pixelRatio: s.renderer.getPixelRatio(),
      shadows: s.renderer.shadowMap.enabled, cockpit: !!s.aircraft.cockpit, airport: s.airport?.id ?? null };
  })()`);

  for (const view of VIEWS) {
    await evaluate(`(() => { const c = window.simulator.cameraSystem;
      c.lookYaw = ${view.yaw}; c.lookPitch = ${view.pitch}; })()`);
    await sleep(4000);
    const entry = { view: view.key, yaw: view.yaw, pitch: view.pitch, baseline: [], variants: [] };
    report.views.push(entry); save();
    for (let i = 0; i < reps; i++) {
      await evaluate('window.simulator.renderDiagnostics.restartSamples()');
      entry.baseline.push(await measure('resolution', 'default'));
    }
    const medianOf = (list, field) => {
      const values = list.map(item => item[field]).filter(Number.isFinite).sort((a, b) => a - b);
      return values.length ? values[Math.floor(values.length / 2)] : null;
    };
    const base = { gpuMs: medianOf(entry.baseline, 'gpuMs'), frameMs: medianOf(entry.baseline, 'frameMs'),
      calls: medianOf(entry.baseline, 'calls'), triangles: medianOf(entry.baseline, 'triangles') };
    entry.base = base; save();
    await shot(`${view.key}-baseline`);
    for (const [key, value] of CASES) {
      const variant = await round(key, value);
      if (shots) await shot(`${view.key}-${key}-${value}`);
      entry.variants.push(variant);
      variant.deltaGpuPct = base.gpuMs ? +(100 * (variant.gpuMs / base.gpuMs - 1)).toFixed(1) : null;
      variant.deltaFramePct = base.frameMs ? +(100 * (variant.frameMs / base.frameMs - 1)).toFixed(1) : null;
      variant.deltaTriPct = base.triangles ? +(100 * (variant.triangles / base.triangles - 1)).toFixed(1) : null;
      variant.deltaCallsPct = base.calls ? +(100 * (variant.calls / base.calls - 1)).toFixed(1) : null;
      await change(key, 'default');
      report.progress = `${view.key}/${key}=${value}`; save();
    }
    entry.drift = await round('resolution', 'default');
    entry.driftGpuPct = base.gpuMs ? +(100 * (entry.drift.gpuMs / base.gpuMs - 1)).toFixed(1) : null;
    save();
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, `view-${view.key}.png`), Buffer.from(data, 'base64'));
  }

  const visualLoss = new Set(['side/front', 'depth/projection', 'material/unlit', 'scene/cockpit', 'scene/world', 'resolution/1', 'resolution/0.75']);
  report.ranking = CASES.map(([key, value]) => {
    const perView = report.views.map(view => {
      const found = view.variants.find(item => item.key === key && item.value === value);
      return { view: view.key, gpuMs: found?.gpuMs, deltaGpuPct: found?.deltaGpuPct, deltaTriPct: found?.deltaTriPct };
    });
    const deltas = perView.map(item => item.deltaGpuPct).filter(Number.isFinite);
    return { case: `${key}/${value}`, visualLoss: visualLoss.has(`${key}/${value}`),
      medianDeltaGpuPct: deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)] ?? null,
      worstDeltaGpuPct: deltas.length ? Math.min(...deltas) : null, perView };
  }).sort((a, b) => (b.worstDeltaGpuPct ?? 0) - (a.worstDeltaGpuPct ?? 0));
  report.errors = errors;
  save();
} catch (error) {
  report.failed = String(error); save();
  throw error;
} finally {
  await call('Target.closeTarget', { targetId: target.id }).catch(() => {});
}
console.log(JSON.stringify(report.ranking?.map(row => ({ case: row.case, median: row.medianDeltaGpuPct, worst: row.worstDeltaGpuPct, visualLoss: row.visualLoss })), null, 1));
