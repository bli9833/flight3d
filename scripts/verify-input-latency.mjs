import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Browser evidence for input-latency telemetry: boot the worktree app in headless Chrome,
// dispatch real clicks during the post-load settle window, then pull window.sim.inputLatency
// and assert the report contains boot marks, samples and long-task attribution.
const REPO = process.env.REPO || process.cwd();
const CDP_PORT = Number(process.env.CDP_PORT || 9451);
const SERVER_PORT = Number(process.env.SERVER_PORT || 5251);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flight3d-latency-'));
const url = `http://127.0.0.1:${SERVER_PORT}/index.html`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let chrome, server, ws, msgId = 0;
const pending = new Map();
const send = (method, params = {}) => { const id = ++msgId; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
async function evalJS(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function pollOK(u, tries = 160) { for (let i = 0; i < tries; i++) { try { const r = await fetch(u); if (r.ok) return r; } catch {} await sleep(500); } throw new Error('timeout ' + u); }

const failures = [];
// Spawn into their own process groups so teardown kills the whole tree (npx wrapper + node child).
const killGroup = proc => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill(); } catch {} } };
try {
  server = spawn('npx', ['vite', '--port', String(SERVER_PORT), '--strictPort'], { cwd: REPO, stdio: 'ignore', detached: true });
  await pollOK(`http://127.0.0.1:${SERVER_PORT}/`);
  chrome = spawn('google-chrome', ['--headless=new', `--user-data-dir=${profileDir}`, `--remote-debugging-port=${CDP_PORT}`,
    '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', url], { stdio: 'ignore', detached: true });
  let page;
  for (let i = 0; i < 160; i++) {
    const list = await pollOK(`http://127.0.0.1:${CDP_PORT}/json/list`, 1).then(r => r.json()).catch(() => []);
    page = list.find(t => t.type === 'page' && t.url.includes('index.html'));
    if (page) break; await sleep(500);
  }
  await new Promise((res, rej) => {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = res; ws.onerror = rej;
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  });
  await send('Runtime.enable');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '`', code: 'Backquote', text: '`', windowsVirtualKeyCode: 192 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '`', code: 'Backquote', text: '', windowsVirtualKeyCode: 192 });

  // Real clicks while boot asset work is still running.
  const clickAt = async (delayMs, x, y) => {
    await sleep(delayMs);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    }
  };
  await clickAt(1200, 400, 300);
  await clickAt(1800, 640, 400);
  await sleep(6000);
  await clickAt(0, 500, 250);
  await sleep(4000);

  const report = await evalJS('window.sim?.inputLatency ? JSON.stringify(window.sim.inputLatency.report()) : null');
  if (!report) { console.log('FATAL: window.sim.inputLatency missing'); process.exitCode = 1; failures.push('telemetry-missing'); }
  else {
    const r = JSON.parse(report);
    console.log('capability:', JSON.stringify(r.capability));
    console.log('boot marks:', JSON.stringify(r.boot.marks));
    console.log('timeline:', JSON.stringify(r.boot.timeline));
    console.log('firstSeconds:', JSON.stringify(r.firstSeconds));
    console.log('last5s:', JSON.stringify(r.windows.last5s), 'longTasks lifetime:', JSON.stringify(r.longTasks.lifetime));
    console.log(`samples (${r.events.samples.length}, dropped ${r.events.dropped}):`);
    for (const s of r.events.samples.slice(-8)) console.log(`  ${s.type} @${s.startMs}ms total=${s.totalMs}ms processing=${s.processingMs} src=${s.source}`);
    fs.writeFileSync('/tmp/latency-report.json', JSON.stringify(r, null, 1));

    if (!r.boot.marks['module-start']) failures.push('no module-start mark');
    if (!('first-frame' in r.boot.marks)) failures.push('no first-frame mark');
    if (!('fly' in r.boot.marks)) failures.push('no fly mark');
    if (r.capability.eventTiming && r.events.samples.length < 1) failures.push('event-timing claimed but no samples');
    if (r.capability.longTask && r.longTasks.lifetime.count < 1) failures.push('longtask claimed but none recorded (boot is heavy — expected at least one)');
    if (r.generatedAtMs < r.boot.marks['module-start']) failures.push('clock order broken');
  }
  const snap = await evalJS('window.sim?.inputLatency ? JSON.stringify(window.sim.inputLatency.snapshot()) : null');
  if (snap) console.log('snapshot:', snap);
  const panel = await evalJS(`(() => { const el = document.getElementById('m-input-last'); return el ? el.textContent : null; })()`);
  console.log(`panel row m-input-last: ${JSON.stringify(panel)}`);
  if (panel === null) failures.push('panel row missing');
} catch (e) { console.log('FATAL', e.message); failures.push('fatal'); } finally {
  console.log(`FAILURES: ${failures.length ? failures.join(', ') : 'none'}`);
  process.exitCode = failures.length ? 1 : (process.exitCode || 0);
  setTimeout(() => { killGroup(chrome); killGroup(server); try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {} }, 2000);
}
