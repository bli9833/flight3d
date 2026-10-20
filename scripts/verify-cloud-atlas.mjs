import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Start Vite and Chrome first; see docs/development/cloud-atlas.md.
const baselinePath = 'src/environment/.cloud-baseline.js';
if (fs.existsSync(baselinePath)) throw new Error('Remove the previous temporary cloud baseline first');
fs.writeFileSync(baselinePath, execFileSync('git', ['show', `${process.env.BASELINE_REF || 'f46c426'}:src/environment/SkyAtmosphere.js`]));
process.on('exit', () => fs.rmSync(baselinePath, { force: true }));
fs.mkdirSync('review-artifacts/cloud-atlas', { recursive: true });
const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9458}/json`)).json();
const target = targets.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, {once:true}));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  } else if (message.method === 'Runtime.exceptionThrown' ||
      (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')) {
    errors.push(message);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  const timeout = setTimeout(() => {
    pending.delete(requestId);
    reject(new Error(`CDP timeout: ${method}`));
  }, 30000);
  pending.set(requestId, message => {
    clearTimeout(timeout);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message);
  });
  ws.send(JSON.stringify({id: requestId, method, params}));
});
await send('Runtime.enable');
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
for (let attempt = 0; !await evaluate('!!window.simulator'); attempt++) {
  if (attempt === 60) throw new Error('Simulator is not ready');
  await new Promise(resolve => setTimeout(resolve, 500));
}
await evaluate(`(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {SkyAtmosphere}=await import('/src/environment/SkyAtmosphere.js');
 const {SkyAtmosphere:Baseline}=await import('/src/environment/.cloud-baseline.js');
 const sim=window.simulator; sim.demoDirector.stop();
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1280,720);renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.domElement.style='position:fixed;inset:0;z-index:99999';document.body.appendChild(renderer.domElement);
 const scene=new THREE.Scene();const sky=new SkyAtmosphere(scene,renderer);
 const originalRandom=Math.random;let seed=12012;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const oldScene=new THREE.Scene();const old=new Baseline(oldScene,renderer);Math.random=originalRandom;
 const camera=new THREE.PerspectiveCamera(60,1280/720,1,60000);
 window.cloudReview={THREE,renderer,scene,sky,oldScene,old,camera};
})()`);
const results=[];
for(const mode of ['baseline','atlas'])for(const [view,hour,pos,look] of [
 ['overview',12,[0,1800,0],[10000,3200,-8000]],
 ['near',12,[8000,3000,-5000],[8000,3200,-10000]],
 ['rolled',12,[0,1800,0],[10000,3200,-8000]],
 ['zenith',12,[0,1800,0],[0,5000,0]],
 ['above',12,[0,6500,0],[8000,3200,-8000]],
 ['sunset',18,[0,1800,0],[10000,3200,-8000]],
 ['night',0,[0,1800,0],[10000,3200,-8000]],
]){
 const metrics=await evaluate(`(()=>{const {renderer,sky,old,scene,oldScene,camera}=cloudReview;const s=${JSON.stringify(mode)}==='atlas'?sky:old;const world=s.scene;
 camera.position.set(...${JSON.stringify(pos)});camera.lookAt(...${JSON.stringify(look)});if (${JSON.stringify(view)}==='rolled') camera.rotateZ(Math.PI/3);camera.updateMatrixWorld(true);s.setTimeOfDay(${hour},null,camera.position);
 for(let i=0;i<5;i++)(s.prepareRender?.(camera),renderer.render(world,camera));renderer.getContext().finish();
 const times=[];for(let i=0;i<30;i++){const t=performance.now();(s.prepareRender?.(camera),renderer.render(world,camera));renderer.getContext().finish();times.push(performance.now()-t);}times.sort((a,b)=>a-b);
 return {medianMs:times[15],p95Ms:times[28],calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,geometries:renderer.info.memory.geometries,programs:renderer.info.programs.map(p=>({name:p.name,runnable:p.diagnostics?.runnable}))};})()`);
 const shot=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync(`review-artifacts/cloud-atlas/${mode}-${view}.png`,Buffer.from(shot.result.data,'base64'));
 results.push({mode,view,...metrics});console.log(results.at(-1));
}
console.log('errors',JSON.stringify(errors));
fs.writeFileSync('review-artifacts/cloud-atlas/metrics.json',JSON.stringify({results,errors},null,2));
await evaluate(`(()=>{const {renderer,sky,old}=cloudReview;renderer.domElement.remove();renderer.dispose();sky.cloudLayer?.dispose();old.cloudsGroup.children.forEach(c=>{c.geometry.dispose();c.material.dispose();});delete window.cloudReview;})()`);
for (const [label, mode] of [['cockpit', 0], ['wing', 2], ['chase', 1]]) {
  await evaluate(`(async()=>{const s=window.simulator;s.setAirport('coastal');s.setPreset('cruise');s.sky.setTimeOfDay(12);s.cameraSystem.setMode(${mode},true);await new Promise(r=>setTimeout(r,500));})()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`review-artifacts/cloud-atlas/app-${label}.png`, Buffer.from(shot.result.data, 'base64'));
}
fs.writeFileSync('review-artifacts/cloud-atlas/metrics.json', JSON.stringify({results,errors},null,2));
ws.close();
if(errors.length) throw new Error('Browser errors occurred; inspect metrics.json');
