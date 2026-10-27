import fs from 'node:fs';
import path from 'node:path';

// Attribute the per-frame sun shadow pass: which scene groups feed casters into the
// directional shadow map the cockpit view pays for, how many triangles each submits,
// and how much of that is doubled by DoubleSide depth rendering.
// chrome-session --project flight3d node scripts/probe-shadow-pass.mjs
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5173/';
const dir = process.env.ARTIFACT_DIR || '.cache/shadow-pass';
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

try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 240; i++) {
    if (await evaluate('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded')) break;
    await sleep(500);
  }
  await evaluate(`(() => {
    const s = window.simulator;
    s.demoDirector.stop(); s.gameFlow.enterFlight(); s.setPreset('runway');
    s.integratePhysics = () => {};
    s.cameraSystem.setMode(0, true); s.cameraSystem.photoCockpit = false;
    s.cameraSystem.enableCursorTrack = false; s.cameraSystem.enableEdgePan = false;
    s.setRenderQuality('balanced'); s.sky.setTimeOfDay(12);
    s.cameraSystem.lookYaw = 0; s.cameraSystem.lookPitch = -0.25;
  })()`);
  await sleep(4000);

  const report = await evaluate(`(() => {
    const s = window.simulator;
    const sun = s.sky.sunLight, shadow = sun.shadow;
    const info = s.renderer.info;
    s.renderScene();
    const frame = { calls: info.render.calls, triangles: info.render.triangles };
    // The renderer just rebuilt this frustum for the cascade it culled last.
    const frustum = shadow.getFrustum();
    const tri = mesh => {
      const index = mesh.geometry?.index;
      const count = index ? index.count : (mesh.geometry?.attributes?.position?.count ?? 0);
      return count / 3 * (Array.isArray(mesh.material) ? mesh.material.length : 1);
    };
    const cockpitNodes = new Set();
    if (s.aircraft.cockpit?.group) {
      s.aircraft.cockpit.group.traverse(node => cockpitNodes.add(node));
    }
    const chain = object => {
      const names = [];
      for (let node = object; node && node !== s.scene; node = node.parent) {
        names.unshift(node.name || node.constructor?.name || '(anon)');
      }
      return names;
    };
    const owner = mesh => {
      if (cockpitNodes.has(mesh)) return 'cockpit';
      for (let node = mesh; node && node !== s.scene; node = node.parent) {
        if (node === s.aircraft.group) return 'aircraft';
      }
      return chain(mesh).slice(0, 2).join('/');
    };
    const groups = new Map();
    let inFrustum = 0, total = 0, doubled = 0;
    s.scene.updateMatrixWorld(true);
    s.scene.traverse(mesh => {
      if (!mesh.isMesh || !mesh.castShadow) return;
      const key = owner(mesh);
      let visible = true;
      for (let node = mesh; node; node = node.parent) if (!node.visible) { visible = false; break; }
      const triangles = tri(mesh);
      total += triangles;
      const entry = groups.get(key) || { group: key, meshes: 0, triangles: 0, hiddenMeshes: 0,
        hiddenTriangles: 0, casters: 0, casterTriangles: 0, doubledTriangles: 0, materials: new Set() };
      entry.meshes++; entry.triangles += triangles;
      entry.materials.add(mesh.material?.name || 'material');
      if (!visible) { entry.hiddenMeshes++; entry.hiddenTriangles += triangles; return; }
      if (!frustum.intersectsObject(mesh)) return;
      inFrustum += triangles;
      entry.casters++; entry.casterTriangles += triangles;
      const side = mesh.material?.side, shadowSide = mesh.material?.shadowSide;
      // Three renders BackSide for shadowSide null on FrontSide materials and both
      // faces for DoubleSide, so DoubleSide depth passes submit every triangle twice.
      const effective = shadowSide ?? (side === 2 ? 2 : side === 0 ? 1 : 0);
      if (effective === 2) { entry.doubledTriangles += triangles; doubled += triangles; }
      groups.set(key, entry);
    });
    for (const entry of groups.values()) entry.materials = [...entry.materials].slice(0, 4);
    return {
      gpu: (() => { const gl = s.renderer.getContext(), d = gl.getExtension('WEBGL_debug_renderer_info');
        return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; })(),
      shadowMapSize: [shadow.mapSize.x, shadow.mapSize.y],
      shadowAutoUpdate: shadow.autoUpdate, rendererShadowAutoUpdate: s.renderer.shadowMap.autoUpdate,
      shadowMapEnabled: s.renderer.shadowMap.enabled, type: s.renderer.shadowMap.type,
      orthoHalf: shadow.camera.right, near: shadow.camera.near, far: shadow.camera.far,
      mapExists: !!shadow.map,
      cockpitMode: s.aircraft.isCockpit,
      shadowCastersInFrustumTriangles: inFrustum, shadowCasterTrianglesTotal: total,
      doubledBySideTriangles: doubled,
      frameSubmitted: frame,
      groups: [...groups.values()].sort((a, b) => b.casterTriangles - a.casterTriangles),
    };
  })()`);
  fs.writeFileSync(path.join(dir, 'shadow-pass.json'), JSON.stringify(report, null, 1));
  console.log(`shadow map ${report.shadowMapSize} auto=${report.shadowAutoUpdate}/renderer ${report.rendererShadowAutoUpdate}`);
  console.log(`ortho ±${report.orthoHalf} near ${report.near} far ${report.far} casters in frustum ${report.shadowCastersInFrustumTriangles.toLocaleString()} of ${report.shadowCasterTrianglesTotal.toLocaleString()} triangles, ${report.doubledBySideTriangles.toLocaleString()} DoubleSide`);
  console.log(`frame submitted ${report.frameSubmitted.calls} calls / ${report.frameSubmitted.triangles.toLocaleString()} triangles`);
  for (const g of report.groups) {
    if (!g.casterTriangles && !g.hiddenTriangles) continue;
    console.log(`${g.group.padEnd(34)} in-frustum ${String(g.casters).padStart(4)} meshes ${g.casterTriangles.toLocaleString().padStart(12)} tris  doubled ${g.doubledTriangles.toLocaleString().padStart(12)}  hidden ${g.hiddenMeshes}/${g.hiddenTriangles.toLocaleString()}`);
  }
} finally {
  await call('Target.closeTarget', { targetId: target.id }).catch(() => {});
}
