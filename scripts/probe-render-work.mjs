import fs from 'node:fs';
import path from 'node:path';

// Attribute render cost to scene objects: which lights are compiled into shaders
// but out of range, and how much geometry uses double-sided or shadow-casting flags.
// chrome-session --project flight3d node scripts/probe-render-work.mjs
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5173/';
const dir = process.env.ARTIFACT_DIR || '.cache/render-work';
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
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`timeout ${method}`)); }, 60000);
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
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
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
    s.setRenderQuality('balanced');
  })()`);
  await sleep(4000);

  // THREE.DoubleSide is 2; the page has no THREE global, so compare against the constant.
  const probe = await evaluate(`(() => {
    const s = window.simulator, camera = s.camera || s.cameraSystem.camera;
    const Vec3 = camera.position.constructor;
    const eye = camera.getWorldPosition(new Vec3());
    const lights = [];
    s.scene.traverse(object => {
      if (!object.isLight || object.isAmbientLight || object.isHemisphereLight) return;
      let visible = true, node = object;
      while (node) { if (!node.visible) { visible = false; break; } node = node.parent; }
      const position = object.getWorldPosition(new Vec3());
      const range = object.distance;
      const gap = eye.distanceTo(position);
      lights.push({ type: object.isSpotLight ? 'spot' : object.isPointLight ? 'point' : 'other',
        name: object.name || object.parent?.name || '(unnamed)', visible,
        intensity: +object.intensity.toFixed(2),
        range: Number.isFinite(range) ? +range.toFixed(1) : null,
        distance: +gap.toFixed(1),
        inRange: Number.isFinite(range) ? gap <= range : true,
        castShadow: !!object.castShadow });
    });
    const tri = mesh => {
      const index = mesh.geometry?.index;
      const count = index ? index.count : (mesh.geometry?.attributes?.position?.count ?? 0);
      return count / 3 * (Array.isArray(mesh.material) ? mesh.material.length : 1);
    };
    const summarize = root => {
      let meshes = 0, triangles = 0, sided = 0, sidedTriangles = 0, shadowTriangles = 0, transparentTriangles = 0;
      root.traverse(mesh => {
        if (!mesh.isMesh) return;
        const value = tri(mesh);
        meshes++; triangles += value;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (materials.some(material => material.side === 2)) { sided++; sidedTriangles += value; }
        if (materials.some(material => material.transparent)) transparentTriangles += value;
        if (mesh.castShadow) shadowTriangles += value;
      });
      return { meshes, triangles: Math.round(triangles), doubleSidedMeshes: sided,
        doubleSidedTriangles: Math.round(sidedTriangles),
        shadowCastingTriangles: Math.round(shadowTriangles),
        transparentTriangles: Math.round(transparentTriangles) };
    };
    const aircraft = s.aircraft.group;
    const own = new Set();
    aircraft.traverse(node => own.add(node));
    let worldMeshes = 0;
    s.scene.traverse(mesh => { if (mesh.isMesh && !own.has(mesh)) worldMeshes++; });
    const cockpit = s.aircraft.cockpit?.gltfCockpitGroup;
    const byMaterial = new Map();
    cockpit?.traverse(mesh => {
      if (!mesh.isMesh) return;
      for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
        const entry = byMaterial.get(material) ?? { name: material.name || '(unnamed)',
          side: material.side, transparent: material.transparent, emissive: !!material.emissiveIntensity,
          meshes: 0, triangles: 0 };
        entry.meshes++; entry.triangles += tri(mesh);
        byMaterial.set(material, entry);
      }
    });
    return { lights,
      aircraft: summarize(aircraft),
      worldMeshCount: worldMeshes,
      scene: summarize(s.scene),
      cockpitMaterials: [...byMaterial.values()]
        .map(entry => ({ ...entry, triangles: Math.round(entry.triangles) }))
        .sort((a, b) => b.triangles - a.triangles).slice(0, 20),
      programs: s.renderer.info.programs?.length ?? 0 };
  })()`);
  fs.writeFileSync(path.join(dir, 'render-work.json'), JSON.stringify(probe, null, 2));
  const visible = probe.lights.filter(light => light.visible);
  console.log(JSON.stringify({ lights: probe.lights.length, visible: visible.length,
    point: visible.filter(light => light.type === 'point').length,
    spot: visible.filter(light => light.type === 'spot').length,
    visibleOutOfRange: visible.filter(light => !light.inRange).length,
    aircraft: probe.aircraft, scene: probe.scene, programs: probe.programs }, null, 1));
  console.log(probe.lights.map(light => `${light.type} ${light.name} i=${light.intensity} range=${light.range} dist=${light.distance} visible=${light.visible} inRange=${light.inRange} shadow=${light.castShadow}`).join('\n'));
  console.log(probe.cockpitMaterials.map(material => `${material.name} side=${material.side} meshes=${material.meshes} tris=${material.triangles}`).join('\n'));
} finally {
  await call('Target.closeTarget', { targetId: target.id }).catch(() => {});
}
