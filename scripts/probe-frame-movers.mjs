import fs from 'node:fs';
import path from 'node:path';

// What actually moves inside a parked cockpit frame? Snapshots every mesh the sun shadow
// pass could draw, once per rendered frame, and reports the objects whose transform, batch
// or material inputs change — the inputs a staleness test is allowed to compare against.
// Run under chrome-session --project flight3d with Vite already serving APP_URL.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5173/';
const dir = process.env.ARTIFACT_DIR || '.cache/frame-movers';
const frames = Number(process.env.FRAMES || 40);
const hour = Number(process.env.HOUR || 12);
const yaw = Number(process.env.YAW || 1.3);
const pitch = Number(process.env.PITCH || -0.1);
fs.mkdirSync(dir, { recursive: true });

const target = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) pending.get(message.id)?.(message);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout ${method}`)); }, 180000);
  pending.set(id, result => { clearTimeout(timer); pending.delete(id); result.error ? reject(Error(JSON.stringify(result.error))) : resolve(result.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  await call('Runtime.enable'); await call('Page.enable'); await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 240; i++) {
    if (await evaluate('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded')) break;
    await sleep(500);
  }
  const report = await evaluate(`(async () => {
    const s = window.simulator;
    s.animate = () => {};
    s.demoDirector.stop(); s.gameFlow.enterFlight(); s.setPreset('runway');
    s.integratePhysics = () => {};
    s.cameraSystem.photoCockpit = false; s.cameraSystem.setMode(0, true);
    s.cameraSystem.enableCursorTrack = false; s.cameraSystem.enableEdgePan = false;
    s.setRenderQuality('balanced');
    s.sky.setTimeOfDay(${hour});
    s.cameraSystem.lookYaw = ${yaw}; s.cameraSystem.lookPitch = ${pitch};
    s.aircraft.cockpit.syncLighting(s.sky, s.quaternion, 10);
    s.stepSimulation(0); s.renderScene();

    const chain = object => {
      const names = [];
      for (let node = object; node && node !== s.scene; node = node.parent) {
        names.unshift(node.name || node.constructor?.name || '(anon)');
      }
      return names.join('/');
    };
    const inputs = object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      return {
        matrix: Array.from(object.matrixWorld.elements),
        geometry: object.geometry?.id ?? 0,
        visible: (() => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; })(),
        mask: object.layers.mask,
        count: object.isInstancedMesh ? object.count : -1,
        version: object.isInstancedMesh ? object.instanceMatrix.version : -1,
        skins: !!object.isSkinnedMesh,
        morphs: object.morphTargetInfluences ? object.morphTargetInfluences.join(',') : '',
        materials: materials.map(m => [m.side, m.shadowSide === null ? 'auto' : m.shadowSide, m.visible ? 1 : 0,
          m.alphaTest, m.map?.version ?? -1, m.alphaMap?.version ?? -1, m.name].join('|')).join(' '),
      };
    };
    // Keyed by uuid, never by name: most of these nodes are unnamed and share a path, and
    // a colliding key compares one mesh against a different mesh.
    let seen = new Map();
    const movers = new Map();
    let all = 0, shadowCasters = 0;
    for (let frame = 0; frame < ${frames}; frame++) {
      s.stepSimulation(1 / 60);
      s.renderScene();
      const next = new Map();
      s.scene.updateMatrixWorld();
      s.scene.traverse(object => {
        if (!object.isMesh) return;
        all++;
        const key = object.uuid, sample = inputs(object), previous = seen.get(key);
        next.set(key, sample);
        if (object.castShadow && sample.visible) shadowCasters++;
        if (!previous) return;
        let worst = 0;
        for (let i = 0; i < sample.matrix.length; i++) worst = Math.max(worst, Math.abs(sample.matrix[i] - previous.matrix[i]));
        const fields = [];
        if (worst > 0) fields.push('matrix Δ' + worst.toExponential(1));
        if (sample.geometry !== previous.geometry) fields.push('geometry ' + previous.geometry + '→' + sample.geometry);
        if (sample.visible !== previous.visible) fields.push('visible ' + previous.visible + '→' + sample.visible);
        if (sample.mask !== previous.mask) fields.push('layers');
        if (sample.count !== previous.count || sample.version !== previous.version) fields.push('instances ' + previous.count + '/' + previous.version + '→' + sample.count + '/' + sample.version);
        if (sample.materials !== previous.materials) fields.push('material ' + previous.materials + '→' + sample.materials);
        if (sample.morphs !== previous.morphs) fields.push('morphs');
        if (!fields.length) return;
        const entry = movers.get(key) || { path: chain(object), castShadow: object.castShadow,
          sampled: object.castShadow && sample.visible, frames: 0, fields: new Set(), maxMatrixDelta: 0 };
        entry.frames++;
        entry.maxMatrixDelta = Math.max(entry.maxMatrixDelta, worst);
        for (const field of fields) entry.fields.add(field.slice(0, 120));
        movers.set(key, entry);
      });
      seen = next;
    }
    const list = [...movers.values()].sort((a, b) => b.frames - a.frames);
    return { meshes: all / ${frames}, shadowCasters: shadowCasters / ${frames}, frames: ${frames},
      movers: list.map(item => ({ path: item.path, frames: item.frames, castShadow: item.castShadow,
        sampled: item.sampled, maxMatrixDelta: +item.maxMatrixDelta.toFixed(9), fields: [...item.fields].slice(0, 4) })),
      sunPasses: null };
  })()`);
  report.sunPasses = await evaluate(`(() => {
    const s = window.simulator;
    let passes = 0;
    const refresh = s.sky.sunShadowRefresh, original = refresh.beforeRender.bind(refresh);
    refresh.beforeRender = scene => { if (original(scene)) passes++; return true; };
    for (let frame = 0; frame < 30; frame++) { s.stepSimulation(1 / 60); s.renderScene(); }
    refresh.beforeRender = original.bind(refresh);
    return { passes, frames: 30 };
  })()`);
  fs.writeFileSync(path.join(dir, 'movers.json'), JSON.stringify(report, null, 2));
  console.log(`mean ${report.meshes.toFixed(0)} meshes, ${report.shadowCasters.toFixed(0)} sun casters per frame, `
    + `${report.movers.length} of them changed at all`);
  console.log(`the sun map rebuilt ${report.sunPasses.passes}/${report.sunPasses.frames} parked frames`);
  for (const item of report.movers.slice(0, 30)) {
    console.log(`${(100 * item.frames / report.frames).toFixed(0)}% of frames `
      + `${item.sampled ? 'SAMPLED CASTER' : item.castShadow ? 'caster, hidden' : 'not a caster'} ${item.path}`
      + ` maxΔ${item.maxMatrixDelta.toExponential(1)} — ${item.fields.join(', ')}`);
  }
  if (!report.movers.length) console.log('nothing moved at all');
  const sampled = report.movers.filter(item => item.sampled).length;
  console.log(`${sampled} sampled casters changed`);
} finally {
  await call('Target.closeTarget', { targetId: target.id }).catch(() => {});
}
