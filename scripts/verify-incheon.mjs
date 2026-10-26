import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run inside chrome-session --project flight3d. Reuse the project daemon;
// create/close only this script's own tab, never the shared browser.
if (process.env.CHROME_PROJECT !== 'flight3d') throw new Error('Run with chrome-session --project flight3d');
const port = process.env.CHROME_DEBUG_PORT ?? '9225';
const url = process.env.APP_URL ?? 'http://127.0.0.1:5186/incheon.html';
const artifacts = process.env.ARTIFACT_DIR ?? path.join(process.cwd(), 'review-artifacts/incheon-stage2');
const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map();
const errors = [];
let id = 0;
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(`${message.params.entry.text} ${message.params.entry.url ?? ''}`.trim());
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(requestId, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
async function click(selector) {
  const point = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await settle();
}
async function capture(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'));
}
try {
  await mkdir(artifacts, { recursive: true });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await evaluate('Boolean(window.incheonPreview?.ready)');
    if (ready) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!ready) {
    await capture('load-failure');
    throw new Error(`Scene did not load: ${await evaluate('document.querySelector("#status")?.textContent')} / ${errors.join('; ')}`);
  }
  await settle();
  const initial = await evaluate('window.incheonPreview');
  assert.equal(initial.counts.building, 43);
  assert.equal(initial.counts.road, 553);
  assert.ok(initial.render.calls > 0 && initial.render.calls < 40, 'bounded batching draw calls');
  assert.ok(initial.render.triangles > 1000);
  assert.equal(initial.terrain.worldSize, 12000);
  assert.ok(initial.terrain.maxM > 200, 'regional DSM includes surrounding hills');
  assert.ok(initial.terrain.outsideUnmodified, 'outside the local patch retains source height');
  assert.ok(initial.terrain.changedSamples > 0);
  assert.ok(initial.terrain.coastlineChecks.every(p => p.observed === p.land), 'land/sea classification matches independent checkpoints');
  const gpu = await evaluate(`(() => { const gl=document.querySelector('canvas').getContext('webgl2'); const ext=gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable'; })()`);
  await capture('regional');
  await click('#oblique');
  await capture('oblique');
  await click('[data-layer="buildings"]');
  const hidden = await evaluate('window.incheonPreview.render');
  assert.ok(hidden.triangles < initial.render.triangles, 'real checkbox removes building draw work');
  await click('[data-layer="buildings"]');
  assert.equal(await evaluate('window.incheonPreview.render.triangles'), initial.render.triangles);
  await click('#top');
  await capture('top');
  for (let i = 0; i < 3; i++) {
    await click('#natural-dsm');
    assert.equal(await evaluate('window.incheonPreview.terrain.naturalMode'), true);
    assert.ok(await evaluate('document.querySelector("[data-layer=buildings]").disabled'));
    if (i === 0) await capture('natural-dsm');
    await click('#natural-dsm');
    assert.equal(await evaluate('window.incheonPreview.terrain.naturalMode'), false);
  }
  assert.equal(await evaluate('window.incheonPreview.terrain.geometryCount'), initial.terrain.geometryCount, 'comparison cycles reuse terrain geometry');
  // Drive actual canvas pointer gestures; rendered on demand after controls change.
  const canvas = await evaluate(`(() => { const r=document.querySelector('canvas').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...canvas, deltaX: 0, deltaY: -150 });
  await settle();
  await click('#oblique');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await settle();
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile page has no horizontal overflow');
  assert.ok(await evaluate('document.querySelector("canvas").clientHeight > 300'));
  assert.ok(await evaluate(`(() => {
    const orientation = document.querySelector('.orientation').getBoundingClientRect();
    const attribution = document.querySelector('.map-attribution').getBoundingClientRect();
    const caption = document.querySelector('.caption').getBoundingClientRect();
    return orientation.bottom <= attribution.top && attribution.bottom <= caption.top;
  })()`), 'mobile attribution and captions must not overlap');
  await capture('mobile');
  assert.deepEqual(errors, [], 'no runtime or resource errors');
  const result = { url, gpu, initial, buildingsHidden: hidden, errors,
    checks: ['loaded real snapshot and DSM', 'land/sea checkpoints', 'unmodified regional source', 'batched geometry',
      'layer checkbox hide/restore', 'view buttons', 'DSM comparison cycles without geometry growth', 'wheel input', '390px layout'],
    limitation: 'Standalone DSM/coast preview with approximate local grading; no flight-loop FPS, surveyed pavement, bridge clearances or collision integration.' };
  await writeFile(path.join(artifacts, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
}
