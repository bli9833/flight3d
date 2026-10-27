import * as THREE from 'three';

export const RENDER_TRIALS = Object.freeze({
  resolution: ['default', '2', '1.5', '1', '0.75', '0.5'],
  ao: ['default', 'on', 'off'],
  shadows: ['default', 'off'],
  lights: ['default', 'noExterior', 'noLocal'],
  material: ['default', 'unlit'],
  side: ['default', 'front'],
  depth: ['default', 'projection'],
  scene: ['default', 'cockpit', 'world'],
  culling: ['default', 'off'],
});
const defaults = () => Object.fromEntries(Object.keys(RENDER_TRIALS).map(key => [key, 'default']));

/** Session-only render experiments. Nothing is saved to normal quality settings. */
export class RenderDiagnostics {
  constructor(sim, now = () => performance.now()) {
    this.sim = sim;
    this.now = now;
    this.active = false;
    this.options = defaults();
    this.meshes = new Map();
    this.materials = new Map();
    this.unlit = new Map();
    this.queries = [];
    this.samples = [];
  }

  open() {
    if (!this.sim.developerMode.enabled) return false;
    if (this.active) return true;
    const renderer = this.sim.renderer;
    this.saved = { ratio: renderer.getPixelRatio(), autoReset: renderer.info.autoReset, shadows: renderer.shadowMap.enabled };
    this.gl = renderer.getContext();
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.active = true;
    renderer.info.autoReset = false;
    this.refreshScene();
    this.restartSamples();
    return true;
  }

  set(key, value) {
    if (!this.active || !this.sim.developerMode.enabled || !Object.hasOwn(RENDER_TRIALS, key)
        || !RENDER_TRIALS[key].includes(value)) return false;
    if (this.options[key] === value) return true;
    this.options[key] = value;
    if (key === 'resolution') this.sim.renderer.setPixelRatio(value === 'default' ? this.saved.ratio : Number(value));
    if (key === 'shadows') {
      this.sim.renderer.shadowMap.enabled = value === 'off' ? false : this.saved.shadows;
      for (const material of this.materials.keys()) material.needsUpdate = true;
    }
    if (['material', 'side', 'depth', 'culling'].includes(key)) this.applyMaterials();
    this.restartSamples();
    return true;
  }

  refreshScene() {
    if (!this.active) return;
    this.restoreMaterials();
    this.sim.scene.traverse(node => {
      if (!node.isMesh) return;
      if (!this.meshes.has(node)) this.meshes.set(node, { material: node.material, culling: node.frustumCulled });
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!this.materials.has(material)) this.materials.set(material, {
          compile: material.onBeforeCompile, key: material.customProgramCacheKey,
          keyValue: material.customProgramCacheKey(), side: material.side,
        });
      }
    });
    this.localLights = [];
    this.sim.scene.traverse(node => { if (node.isPointLight || node.isSpotLight) this.localLights.push(node); });
    this.applyMaterials();
    this.restartSamples();
  }

  applyMaterials() {
    this.restoreMaterials();
    const deck = new Set();
    this.sim.aircraft.cockpit?.gltfCockpitGroup?.traverse(node => { if (node.isMesh) deck.add(node); });
    for (const [mesh, original] of this.meshes) {
      if (this.options.culling === 'off') mesh.frustumCulled = false;
      if (deck.has(mesh) && this.options.material === 'unlit') {
        const unlit = material => {
          if (!material.isMeshStandardMaterial) return material;
          if (!this.unlit.has(material)) {
            const basic = new THREE.MeshBasicMaterial();
            for (const key of ['color', 'map', 'alphaMap', 'alphaTest', 'opacity', 'transparent', 'vertexColors',
              'side', 'depthTest', 'depthWrite', 'colorWrite', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits']) {
              if (key === 'color') basic.color.copy(material.color);
              else basic[key] = material[key];
            }
            this.unlit.set(material, basic);
            this.materials.set(basic, { compile: basic.onBeforeCompile, key: basic.customProgramCacheKey,
              keyValue: basic.customProgramCacheKey(), side: basic.side });
          }
          return this.unlit.get(material);
        };
        mesh.material = Array.isArray(original.material) ? original.material.map(unlit) : unlit(original.material);
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (deck.has(mesh) && this.options.side === 'front' && !material.transparent) {
          material.side = THREE.FrontSide;
          material.needsUpdate = true;
        }
      }
    }
    if (this.options.depth === 'projection') for (const [material, original] of this.materials) {
      material.onBeforeCompile = function(shader, renderer) {
        original.compile.call(this, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <logdepthbuf_fragment>', '');
      };
      material.customProgramCacheKey = () => `${original.keyValue}:render-trial-projection`;
      material.needsUpdate = true;
    }
  }

  restoreMaterials() {
    for (const [mesh, original] of this.meshes) {
      mesh.material = original.material;
      mesh.frustumCulled = original.culling;
    }
    for (const [material, original] of this.materials) {
      if (material.onBeforeCompile !== original.compile || material.customProgramCacheKey !== original.key || material.side !== original.side) {
        material.onBeforeCompile = original.compile;
        material.customProgramCacheKey = original.key;
        material.side = original.side;
        material.needsUpdate = true;
      }
    }
  }

  reset() {
    const shadowsChanged = this.options.shadows !== 'default';
    this.restoreMaterials();
    if (this.active) this.sim.renderer.shadowMap.enabled = this.saved.shadows;
    if (shadowsChanged) for (const material of this.materials.keys()) material.needsUpdate = true;
    this.options = defaults();
    if (this.active) this.sim.renderer.setPixelRatio(this.saved.ratio);
    this.restartSamples();
  }

  close() {
    if (!this.active) return;
    this.reset();
    this.sim.renderer.info.autoReset = this.saved.autoReset;
    this.active = false;
    for (const material of this.unlit.values()) material.dispose();
    this.unlit.clear(); this.materials.clear(); this.meshes.clear();
  }

  restartSamples() {
    for (const { query } of this.queries) this.gl?.deleteQuery(query);
    this.queries = []; this.samples = [];
    this.lastFrame = null;
    this.warmUntil = this.now() + 2000;
  }

  pollQueries() {
    if (!this.timer || !this.queries.length) return;
    if (this.gl.getParameter(this.timer.GPU_DISJOINT_EXT)) { this.restartSamples(); return; }
    for (let i = this.queries.length - 1; i >= 0; i--) {
      const { query, sample } = this.queries[i];
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) continue;
      sample.gpu = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) / 1e6;
      this.gl.deleteQuery(query); this.queries.splice(i, 1);
    }
  }

  render() {
    const s = this.sim, r = s.renderer;
    if (!this.active || !s.developerMode.enabled) { this.close(); s.renderStandardScene(); return; }
    const start = this.now(), o = this.options;
    if (this.gl.isContextLost()) { this.lost = true; this.queries = []; this.samples = []; s.renderStandardScene(); return; }
    if (this.lost) { this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2'); this.lost = false; this.restartSamples(); }
    this.pollQueries();
    const saved = { shadows: r.shadowMap.enabled, ao: s.cockpitOcclusion.enabled };
    const hidden = [];
    const hide = node => { if (node?.visible) { hidden.push(node); node.visible = false; } };
    if (o.scene === 'world') hide(s.aircraft.group);
    if (o.scene === 'cockpit') for (const child of s.scene.children) {
      if (child !== s.aircraft.group && !child.isLight && !child.isCamera) hide(child);
    }
    if (o.lights === 'noExterior') hide(s.aircraft.lightsGroup);
    if (o.lights === 'noLocal') this.localLights.forEach(hide);
    if (o.shadows === 'off') r.shadowMap.enabled = false;
    if (o.ao !== 'default') s.cockpitOcclusion.enabled = o.ao === 'on';
    const sample = { frame: this.lastFrame !== null && this.lastFrame >= this.warmUntil ? start - this.lastFrame : null, gpu: null };
    this.lastFrame = start;
    r.info.reset();
    const query = this.timer && start >= this.warmUntil && this.queries.length < 4 ? this.gl.createQuery() : null;
    if (query) this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query);
    try {
      s.renderStandardScene(o.ao === 'on' && s.renderQuality === 'performance' ? 'balanced' : s.renderQuality);
    } finally {
      if (query) { this.gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.queries.push({ query, sample }); }
      for (const node of hidden) node.visible = true;
      r.shadowMap.enabled = saved.shadows; s.cockpitOcclusion.enabled = saved.ao;
    }
    sample.cpu = this.now() - start;
    sample.calls = r.info.render.calls; sample.triangles = r.info.render.triangles;
    if (start >= this.warmUntil) {
      this.samples.push(sample);
      if (this.samples.length > 120) this.samples.shift();
    }
    if (start - (this.lastNotify ?? 0) >= 500) { this.lastNotify = start; this.onSample?.(); }
  }

  snapshot() {
    const values = key => this.samples.map(sample => sample[key]).filter(value => value !== null && Number.isFinite(value));
    const mean = key => {
      const list = values(key);
      return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
    };
    const p95 = key => { const list = values(key).sort((a, b) => a - b); return list[Math.ceil(list.length * .95) - 1] ?? null; };
    const frame = mean('frame');
    return { warming: this.now() < this.warmUntil, samples: this.samples.length,
      fps: frame ? 1000 / frame : null, frameMs: frame, gpuMs: mean('gpu'), cpuMs: mean('cpu'),
      gpuSupported: !!this.timer, calls: mean('calls'), triangles: mean('triangles'),
      frameP95: p95('frame'), gpuP95: p95('gpu'),
      width: this.sim.renderer.domElement.width, height: this.sim.renderer.domElement.height,
      programs: this.sim.renderer.info.programs?.length ?? 0 };
  }
}
