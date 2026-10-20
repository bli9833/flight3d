import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const dir = process.env.ARTIFACT_DIR || path.resolve(".cache/material-review");
fs.mkdirSync(dir, { recursive: true });
// Start Vite on 5173 and headless Chromium with CDP on 9466 first; see ci.md.
const cdp = process.env.CDP_URL || 'http://127.0.0.1:9466';
const site = process.env.SIM_URL || 'http://127.0.0.1:5186/';
const pages = await (await fetch(cdp + '/json')).json();
const ws = new WebSocket(
  pages.find((p) => p.type === "page").webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map(),
  errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
    errors.push(m.params.args.map(a=>a.value || a.description).join(' '));
  if (m.method === "Runtime.exceptionThrown")
    errors.push(m.params.exceptionDetails.text);
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timeout = setTimeout(
      () => reject(new Error(`timeout ${method}`)),
      60000,
    );
    pending.set(id, (m) => {
      clearTimeout(timeout);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
await call("Runtime.enable");
await call("Page.navigate", {url:site});
await new Promise(r=>setTimeout(r,2000));
await call("Emulation.setDeviceMetricsOverride",{width:1200,height:800,deviceScaleFactor:1,mobile:false});
await evaluate(`(async()=>{
 window.requestAnimationFrame=()=>0;
 const THREE=await import('/node_modules/three/build/three.module.js');
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
 renderer.setSize(1200,800);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
 document.body.replaceChildren(renderer.domElement);document.body.style='margin:0';
 const camera=new THREE.PerspectiveCamera(55,1.5,1,50000);
 window.review={THREE,renderer,camera};
})()`);
const results=[];
for(const version of (process.env.BASELINE_PREFIX ? ['before','after'] : ['after'])) {
 for(const sceneName of ['ocean-low','ocean-high','terrain-high','terrain-low','sunset','night']) {
 const result=await evaluate(`(async()=>{
 const {THREE,renderer,camera}=window.review;
 const prefix='${version}'==='before'? ${JSON.stringify(process.env.BASELINE_PREFIX || '/src/environment')}:'/src/environment';
 const {WaterOcean}=await import(prefix+'/WaterOcean.js');
 const {Terrain}=await import(prefix+'/Terrain.js');
 const scene=new THREE.Scene();const night='${sceneName}'==='night';const sunset='${sceneName}'==='sunset';
 const fog=new THREE.Color(night?0x121c30:sunset?0xb99a91:0xc8def4);scene.background=fog;scene.fog=new THREE.FogExp2(fog,0.00008);
 scene.add(new THREE.HemisphereLight(0xd6e8ff,0x62654a,night?0.1:2));
 const sun=new THREE.DirectionalLight(sunset?0xffbc80:0xffffff,night?0:3);sun.position.set(0.2,night?-0.3:sunset?0.08:0.6,-0.8);scene.add(sun);
 const ocean=new WaterOcean();ocean.update(12.5);ocean.setSunDirection(sun.position);ocean.material.uniforms.uFogColor.value.copy(fog);scene.add(ocean.mesh);
 let terrain;
 if('${sceneName}'.startsWith('terrain')){terrain=new Terrain(20000,256,{quality:'${sceneName}'==='terrain-low'?'low':'high'});scene.add(terrain.mesh);camera.position.set(2800,450,1600);camera.lookAt(0,50,-1500);}
 else {camera.position.set(0,'${sceneName}'==='ocean-high'?1000:35,6000);camera.lookAt(0,0,2000);}
 renderer.compile(scene,camera);
 for(let i=0;i<10;i++)renderer.render(scene,camera);
 const result={version:'${version}',scene:'${sceneName}',calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,programs:renderer.info.programs.map(p=>({runnable:p.diagnostics?.runnable??true}))};
 window.review.current={scene,ocean,terrain};return result;
})()`);
 results.push(result);
 const capture=await call('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(path.join(dir,version+'-'+sceneName+'.png'),Buffer.from(capture.data,'base64'));
 await evaluate(`(()=>{const {scene}=window.review.current;scene.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});})()`);
 }
}
fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({results,errors},null,2));
console.log(JSON.stringify({results,errors},null,2));ws.close();
assert.equal(errors.length,0,'Browser errors');
assert.ok(results.every(r=>r.programs.length && r.programs.every(p=>p.runnable)), 'All shaders must compile');
