import {
  createInputLatencyState, addBootMark, addEventSample, addFallbackSample, discardSample,
  addLongTask, recordSelection, shouldEmitSummary, buildReport, snapshot, THRESHOLDS,
} from '../core/inputLatency.js';

const WATCHED_EVENTS = ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'mousedown', 'mouseup'];

let singleton = null;

/**
 * Installs always-on input-latency telemetry at module scope, before the heavy simulator
 * constructor runs. Uses the Event Timing API where available (Chrome/Edge) and a
 * click-to-next-paint fallback elsewhere; a `longtask` observer attributes blockage to
 * boot asset/shader work. Returns a monitor singleton: { mark, noteSelectionStart,
 * noteSelectionApplied, report, snapshot, state, dispose }.
 */
export function installInputLatencyMonitor(g = globalThis) {
  if (singleton) return singleton;
  if (typeof g.performance === 'undefined') return null;
  const now = () => g.performance.now();
  const state = createInputLatencyState({ clock: now });
  addBootMark(state, 'module-start', now());
  const supported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes;
  const observers = [];
  const cleanups = [];

  const observe = (options, bufferFlag) => {
    try {
      const po = new PerformanceObserver(list => { for (const e of list.getEntries()) options.onEntry(e); });
      po.observe(options.init);
      observers.push(po);
      if (bufferFlag) bufferFlag.value = true;
      return po;
    } catch {
      return null;
    }
  };

  if (supported && supported.includes('event')) {
    const buffered = { value: false };
    const init = { type: 'event', durationThreshold: 0, buffered: true };
    if (observe({ init, onEntry: e => { if (WATCHED_EVENTS.includes(e.name)) addEventSample(state, e); } }, buffered)
      === null && observe({ init: { ...init, buffered: false }, onEntry: e => { if (WATCHED_EVENTS.includes(e.name)) addEventSample(state, e); } })) {
      // Older Chrome rejects buffered event entries; retry without it.
    }
    state.capability.eventTiming = true;
    state.capability.eventTimingBuffered = buffered.value;
  } else if (typeof g.document !== 'undefined' && typeof g.requestAnimationFrame === 'function') {
    // Safari/Firefox: measure interaction → second-paint gap directly. Background tabs
    // stall rAF, so those samples are discarded instead of reporting bogus seconds.
    state.capability.fallback = true;
    const nextPaintThen = (cb) => {
      if (g.document.hidden) { cb(NaN); return; }
      const frame = g.requestAnimationFrame.bind(g);
      frame(() => frame(() => cb(g.document.hidden ? NaN : now())));
    };
    for (const type of ['pointerdown', 'keydown']) {
      const onInput = event => {
        if (event.repeat) return;
        const started = now();
        const pending = addFallbackSample(state, { type: event.type, clickedAtMs: started, paintedAtMs: started });
        nextPaintThen(painted => {
          if (!Number.isFinite(painted)) discardSample(state, pending.startMs);
          else pending.totalMs = Math.max(0, Math.round(painted - started));
        });
      };
      g.document.addEventListener(type, onInput, { capture: true, passive: true });
      cleanups.push(() => g.document.removeEventListener(type, onInput, { capture: true }));
    }
  }

  if (supported && supported.includes('longtask')) {
    const buffered = { value: false };
    observe({ init: { type: 'longtask', buffered: true }, onEntry: e => addLongTask(state, e) }, buffered);
    state.capability.longTask = buffered.value;
  }

  const emitSummary = () => {
    if (!shouldEmitSummary(state, now())) return;
    const t = now();
    console.info('[flight3d:latency]', JSON.stringify({
      atMs: Math.round(t),
      boot: bootCompact(state),
      firstSeconds: buildReport(state, t).firstSeconds,
      last5s: buildReport(state, t).windows.last5s,
      longTasks5s: buildReport(state, t).longTasks.last5s,
    }));
  };
  const tick = setInterval(() => { if (!g.document?.hidden) emitSummary(); }, THRESHOLDS.summaryIntervalMs);
  cleanups.push(() => clearInterval(tick));

  const monitor = {
    state,
    mark: name => addBootMark(state, name, now()),
    noteSelectionStart: () => recordSelection(state, 'start'),
    noteSelectionApplied: () => recordSelection(state, 'applied'),
    report: () => buildReport(state, now()),
    snapshot: () => snapshot(state, now()),
    dispose: () => { observers.forEach(o => o.disconnect()); cleanups.forEach(fn => fn()); if (singleton === monitor) singleton = null; },
  };
  singleton = monitor;
  return monitor;
}

function bootCompact(state) {
  const marks = state.marks;
  return {
    firstFrameMs: marks['first-frame'] ?? null,
    flyMs: marks['fly'] ?? null,
    longTasksDuringBoot: state.longTasks.filter(t => t.startMs <= (marks['fly'] ?? Infinity)).length,
  };
}
