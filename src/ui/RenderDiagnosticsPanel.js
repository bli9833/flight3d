import { bindText, t } from '../i18n/index.js';
import { RENDER_TRIALS } from '../dev/RenderDiagnostics.js';

export class RenderDiagnosticsPanel {
  constructor(sim) {
    this.sim = sim;
    this.trial = sim.renderDiagnostics;
    this.root = document.createElement('aside');
    this.root.id = 'render-trials';
    this.root.hidden = true;
    this.root.innerHTML = `<header><strong data-title></strong><button class="btn" data-close></button></header>
      <output data-metrics></output><p data-status></p><p data-comparison></p>
      <div class="render-trial-actions"><button class="btn" data-baseline></button>
      <button class="btn" data-reset></button><button class="btn" data-save></button></div>
      <details open><summary></summary><p data-help></p><div data-options></div><p data-warning></p></details>`;
    document.body.append(this.root);
    const text = (selector, key) => bindText(this.root.querySelector(selector), () => t(key));
    text('[data-title]', 'render.title'); text('summary', 'render.options');
    text('[data-close]', 'render.close'); text('[data-help]', 'render.help');
    text('[data-warning]', 'render.warning'); text('[data-baseline]', 'render.baseline');
    text('[data-reset]', 'render.reset'); text('[data-save]', 'render.save');
    this.selects = new Map();
    for (const [key, values] of Object.entries(RENDER_TRIALS)) {
      const label = document.createElement('label'), caption = document.createElement('span');
      bindText(caption, () => t(`render.${key}`));
      const select = document.createElement('select');
      select.className = 'btn'; select.dataset.renderTrial = key;
      for (const value of values) {
        const option = document.createElement('option'); option.value = value;
        bindText(option, () => key === 'resolution' && value !== 'default' ? value : t(`render.value.${value}`));
        select.append(option);
      }
      label.append(caption, select); this.root.querySelector('[data-options]').append(label);
      this.selects.set(key, select);
      select.addEventListener('change', () => { this.trial.set(key, select.value); this.refresh(); });
    }
    this.root.querySelector('[data-close]').addEventListener('click', () => this.close());
    this.root.querySelector('[data-reset]').addEventListener('click', () => { this.trial.reset(); this.refresh(); });
    this.root.querySelector('[data-baseline]').addEventListener('click', () => {
      const metrics = this.trial.snapshot();
      if (!this.ready(metrics)) return;
      this.baseline = { options: { ...this.trial.options }, metrics }; this.refresh();
    });
    this.root.querySelector('[data-save]').addEventListener('click', () => {
      if (!this.ready(this.trial.snapshot())) return;
      const snapshot = { options: this.trial.options, metrics: this.trial.snapshot(), baseline: this.baseline ?? null,
        aircraft: sim.currentAircraftId, airport: sim.activeAirport, quality: sim.renderQuality,
        camera: { mode: sim.cameraSystem.mode, yaw: sim.cameraSystem.lookYaw, pitch: sim.cameraSystem.lookPitch } };
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'flight3d-render-comparison.json';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    // Release held controls when a form takes focus; key-up must still reach
    // the normal controls so leaving the panel cannot leave a key latched.
    this.root.addEventListener('focusin', () => sim.controls.releaseAllKeys());
    for (const event of ['keydown', 'pointerdown', 'wheel']) this.root.addEventListener(event, e => e.stopPropagation());
    this.trial.onSample = () => this.refresh();
  }

  open() {
    if (!this.trial.open()) return false;
    this.root.hidden = false; this.refresh();
    this.root.querySelector('select').focus();
    return true;
  }

  close() {
    this.trial.close(); this.root.hidden = true; this.baseline = null;
  }

  ready(metrics) {
    return !metrics.warming && metrics.samples >= 5 && metrics.frameMs !== null
      && (!metrics.gpuSupported || metrics.gpuMs !== null);
  }

  refresh() {
    if (this.root.hidden) return;
    if (!this.sim.developerMode.enabled || !this.trial.active) { this.close(); return; }
    for (const [key, select] of this.selects) select.value = this.trial.options[key];
    const m = this.trial.snapshot(), f = value => value === null ? '—' : value.toFixed(1);
    this.root.querySelector('[data-metrics]').textContent = t('render.metrics', {
      fps: f(m.fps), frame: f(m.frameMs), frameP95: f(m.frameP95), gpu: f(m.gpuMs), gpuP95: f(m.gpuP95), cpu: f(m.cpuMs),
      calls: m.calls === null ? '—' : Math.round(m.calls).toLocaleString(),
      triangles: m.triangles === null ? '—' : Math.round(m.triangles).toLocaleString(),
      width: m.width, height: m.height, programs: m.programs, samples: m.samples,
    });
    this.root.querySelector('[data-status]').textContent = t(m.warming ? 'render.warming' : m.gpuSupported ? 'render.measuring' : 'render.noGpu');
    this.root.querySelector('[data-warning]').hidden = !['depth', 'side', 'scene', 'lights', 'material'].some(key => this.trial.options[key] !== 'default');
    const delta = key => {
      const before = this.baseline?.metrics[key], after = m[key];
      return !m.warming && before > 0 && after !== null ? `${((after / before - 1) * 100).toFixed(1)}%` : '—';
    };
    this.root.querySelector('[data-comparison]').textContent = this.baseline
      ? t('render.delta', { gpu: delta('gpuMs'), frame: delta('frameMs') }) : '';
    this.root.querySelector('[data-baseline]').disabled = !this.ready(m);
    this.root.querySelector('[data-save]').disabled = !this.ready(m);
  }
}
