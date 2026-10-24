import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=`http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const appUrl=process.env.APP_URL || 'http://127.0.0.1:5182/';
const tab=await(await fetch(base+'/json/new?'+encodeURIComponent(appUrl),{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map();ws.addEventListener('message',({data})=>{const m=JSON.parse(data);pending.get(m.id)?.(m);pending.delete(m.id)});
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}))});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
const dir=process.env.ARTIFACT_DIR || 'review-artifacts/issue182';fs.mkdirSync(dir,{recursive:true});
try{
await call('Page.enable');
await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.requestAnimationFrame=()=>0;'});
await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
await call('Page.reload');
for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,500));if(await ev('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded'))break;if(i===119)throw Error('load timeout')}
const setup=await ev(`(async()=>{const s=window.simulator;await s.aircraft.cockpit.shaderWarmup;s.demoDirector.stop();s.gameFlow.enterFlight();s.setPreset('runway');s.cameraSystem.setMode(0);s.stepSimulation(0);s.animate();s.setRenderQuality('balanced');return {mode:s.cameraSystem.mode,renderer:s.renderer.getContext().getParameter(s.renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)}})()`);
const rows=[];
for(const value of ['detailed','performance','detailed','performance']){
rows.push(await ev(`(()=>{const s=window.simulator;const el=document.getElementById('cockpit-quality');el.value='${value}';el.dispatchEvent(new Event('change'));s.renderer.info.autoReset=false;s.renderer.info.reset();const start=performance.now();for(let i=0;i<12;i++)s.renderScene();s.renderer.getContext().finish();const ms=(performance.now()-start)/12;const result={value:el.value,enabled:s.cockpitOcclusion.enabled,stored:localStorage.getItem('flight3d.cockpitQuality'),drawCalls:s.renderer.info.render.calls/12,ms,quality:s.renderQuality,dpr:s.renderer.getPixelRatio(),terrain:s.terrain.getQuality(),glError:s.renderer.getContext().getError()};s.renderer.info.autoReset=true;return result})()`));
const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${dir}/${value}.png`,Buffer.from(shot.data,'base64'));
}
assert.equal(setup.mode,0);assert.ok(rows[0].drawCalls>rows[1].drawCalls);assert.ok(rows.every(r=>r.quality==='balanced'&&r.glError===0));assert.deepEqual(rows.map(r=>r.enabled),[true,false,true,false]);
await call('Page.reload');await new Promise(r=>setTimeout(r,3000));assert.equal(await ev('document.getElementById("cockpit-quality").value'),'performance');
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const mobile=await ev(`(()=>{const s=window.simulator;if(s.gameFlow.state!=='lobby')document.getElementById('menu-toggle').click();document.getElementById('lobby-tab-settings').click();const el=document.getElementById('cockpit-quality');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {visible:el.checkVisibility(),fits:r.left>=0&&r.right<=innerWidth,reachable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el}})()`);assert.ok(mobile.visible&&mobile.fits&&mobile.reachable);
const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${dir}/mobile.png`,Buffer.from(shot.data,'base64'));
fs.writeFileSync(`${dir}/results.json`,JSON.stringify({setup,rows,mobile},null,2));console.log(JSON.stringify({setup,rows,mobile}));
}finally{await fetch(base+'/json/close/'+tab.id);ws.close()}
