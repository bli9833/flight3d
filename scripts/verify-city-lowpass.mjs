import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Reuse the project browser: chrome-session --project flight3d node scripts/verify-city-lowpass.mjs
const output = path.resolve(process.env.ARTIFACT_DIR || '.cache/city-lowpass');
const temp = '.tmp/city-lowpass';
const baseline = process.env.BASELINE_REF || 'origin/main';
await fs.mkdir(output, { recursive: true }); await fs.mkdir(temp, { recursive: true });
for (const name of ['CityBuildingAssets', 'FoliageAndCities']) {
  let source = execFileSync('git', ['show', `${baseline}:src/environment/${name}.js`], { encoding: 'utf8' });
  if (name === 'FoliageAndCities') source = source.replace("'./TreeModels.js'", "'/src/environment/TreeModels.js'");
  await fs.writeFile(`${temp}/${name}.js`, source);
}
await fs.writeFile(`${temp}/review.html`, '<!doctype html><html><body style="margin:0"></body></html>');
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = `${process.env.APP_URL || 'http://127.0.0.1:5187'}/${temp}/review.html`;
const page = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map(), errors = [], metrics = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const number = ++id, timer = setTimeout(() => reject(Error(method)), 60000);
  pending.set(number, message => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
  ws.send(JSON.stringify({ id: number, method, params }));
});
const evaluate = async (fn, arg) => {
  const response = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const setup = await evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { FoliageAndCities: Before } = await import('/.tmp/city-lowpass/FoliageAndCities.js');
    const { FoliageAndCities: After } = await import('/src/environment/FoliageAndCities.js');
    const create = Type => { let seed = 12345; return new Type({getHeight: () => 25}, () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296)); };
    const before = create(Before), after = create(After);
    for (const city of [before, after]) for (const child of city.group.children) child.visible = child.name.startsWith('city-');
    const scene = new T.Scene(); scene.background = new T.Color(0xa8bfd1);
    scene.fog = new T.FogExp2(0xa8bfd1, 0.00005);
    const ground = new T.Mesh(new T.PlaneGeometry(12000,12000), new T.MeshStandardMaterial({color:0x77866d}));
    ground.rotation.x = -Math.PI/2; ground.position.y=24.5; scene.add(ground);
    const ambient = new T.HemisphereLight(0xffffff,0x53615a,2); scene.add(ambient);
    const sun = new T.DirectionalLight(0xffffff,3); sun.position.set(-800,1200,-500); scene.add(sun);
    scene.add(before.group, after.group);
    const camera = new T.PerspectiveCamera(52,1.6,0.5,16000);
    const renderer = new T.WebGLRenderer({antialias:true, preserveDrawingBuffer:true}); renderer.setSize(1440,900);
    renderer.toneMapping=T.ACESFilmicToneMapping; document.body.appendChild(renderer.domElement);
    const shaderErrors=[];
    renderer.debug.onShaderError=(gl,program,vertex,fragment)=>shaderErrors.push({program:gl.getProgramInfoLog(program),vertex:gl.getShaderInfoLog(vertex),fragment:gl.getShaderInfoLog(fragment)});
    window.review={T,before,after,scene,camera,renderer,ambient,sun,shaderErrors};
    const gl=renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
    const office=after.buildingData.find(b=>b.archetype===0 && b.height>100 && b.x>2000);
    return {gpu:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      samePlacement:JSON.stringify(before.buildingData)===JSON.stringify(after.buildingData), count:after.buildingData.length,office};
  });
  assert.equal(setup.samePlacement,true); assert.ok(setup.count>400);
  const b=setup.office;
  const cases=[
    ['street-day',[2800,90,1800],[2750,90,1300],12],
    ['roof-day',[b.x+70,b.y+b.height+45,b.z+80],[b.x,b.y+b.height*.7,b.z],12],
    ['street-night',[2800,90,1800],[2750,90,1300],23],
    ['skyline-day',[6500,700,4300],[2800,90,1400],12],
    ['far-lod',[8000,700,6000],[2800,90,1400],12]
  ];
  for(const [view,position,target,hour] of cases) for(const version of ['before','after']) {
    const result=await evaluate(async ({version,position,target,hour})=>{
      const r=window.review, city=r[version]; r.before.group.visible=version==='before';r.after.group.visible=version==='after';
      const night=hour===23; r.scene.background.set(night?0x111827:0xa8bfd1);r.scene.fog.color.copy(r.scene.background);
      r.ambient.intensity=night?.25:2;r.sun.intensity=night?.06:3;city.setTimeOfDay(hour);
      r.camera.position.set(...position);r.camera.lookAt(...target);r.camera.updateMatrixWorld();city.updateCityLod(r.camera.position);
      for(let i=0;i<5;i++)r.renderer.render(r.scene,r.camera);
      const gl=r.renderer.getContext(),times=[];
      for(let i=0;i<20;i++){const start=performance.now();r.renderer.render(r.scene,r.camera);gl.finish();times.push(performance.now()-start);await new Promise(resolve=>setTimeout(resolve,0));}
      times.sort((a,b)=>a-b);
      return {calls:r.renderer.info.render.calls,triangles:r.renderer.info.render.triangles,medianMs:times[10],p95Ms:times[18],
        near:city.cityArchetypes.reduce((n,a)=>n+a.near.count,0),far:city.cityArchetypes.reduce((n,a)=>n+a.far.count,0),shaderErrors:r.shaderErrors};
    },{version,position,target,hour});
    assert.equal(result.shaderErrors.length,0);assert.ok(result.calls<=7, `city draw calls: ${result.calls}`);assert.equal(result.near+result.far,setup.count);
    const screenshot=await send('Page.captureScreenshot',{format:'jpeg',quality:90});
    await fs.writeFile(path.join(output,`${view}-${version}.jpg`),Buffer.from(screenshot.data,'base64'));
    metrics.push({view,version,...result});console.log(view,version,JSON.stringify(result));
  }
  const far=metrics.filter(m=>m.view==='far-lod'); assert.equal(far[0].triangles,far[1].triangles,'distant LOD cost unchanged');
  assert.equal(errors.length,0);
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({baseline,...setup,metrics,errors,note:'Isolated seeded city with flat ground. gl.finish wall times, not full-flight FPS.'},null,2));
  console.log('PASS',setup.count,'buildings; identical placement and collision metadata');
} finally { ws.close();await fetch(`${endpoint}/json/close/${page.id}`); }
