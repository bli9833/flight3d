import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Vite must be running. Use chrome-session --project flight3d for browser admission.
const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || 9225}`;
const url = process.env.APP_URL || 'http://127.0.0.1:5173/';
const dir = process.env.ARTIFACT_DIR || '.cache/render-diagnostics';
fs.mkdirSync(dir, { recursive: true });
const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map(), errors = [];
let heldBake;
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Fetch.requestPaused') heldBake = message.params.requestId;
  if (message.id) pending.get(message.id)?.(message);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
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
const capture = async name => {
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
};
const change = (key, value) => evaluate(`(() => {
  const select = document.querySelector('[data-render-trial="${key}"]');
  select.value = '${value}'; select.dispatchEvent(new Event('change', { bubbles:true }));
})()`);
const metrics = async () => {
  for (let i = 0; i < 60; i++) {
    const sample = await evaluate('window.simulator.renderDiagnostics.snapshot()');
    if (!sample.warming && sample.samples >= 5 && (!sample.gpuSupported || sample.gpuMs !== null)
        && await evaluate('!document.querySelector("#render-trials [data-baseline]").disabled')) return sample;
    await sleep(250);
  }
  throw Error('No settled render samples');
};
const report = { cases: [] };
const save = () => fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report, null, 2));
try {
  await call('Runtime.enable'); await call('Page.enable'); await call('Page.bringToFront');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // Hold the real async bake at the point where meshes exist but shader hooks
  // have not been installed. A warm cache must not hide this loading race.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('flight3d.renderQuality','performance')` });
  await call('Fetch.enable', { patterns: [{ urlPattern: '*lighting/cockpit-medium.json', requestStage: 'Request' }] });
  await call('Page.navigate', { url });
  for (let i=0;i<180&&!heldBake;i++) await sleep(500);
  assert.ok(heldBake, 'The bake request must be held before readiness');
  report.loading = await evaluate(`(()=>{
    const s=window.simulator,d=s.renderDiagnostics,c=s.aircraft.cockpit;
    document.getElementById('dev-enabled').click();s.renderDiagnosticsPanel.open();
    const result={ready:c.gltfCockpitLoaded,dedicated:d.hasDedicatedCockpit,
      unlit:d.set('material','unlit'),front:d.set('side','front'),projection:d.set('depth','projection')};
    return result;
  })()`);
  assert.deepEqual(report.loading,{ready:false,dedicated:true,unlit:false,front:false,projection:true});
  await call('Fetch.continueRequest', { requestId: heldBake }); heldBake=null;
  await call('Fetch.disable');
  for (let i = 0; i < 180; i++) {
    if (await evaluate('!!window.simulator?.aircraft?.cockpit?.gltfCockpitLoaded')) break;
    await sleep(500);
  }
  report.asyncRestore = await evaluate(`(()=>{
    const s=window.simulator,d=s.renderDiagnostics,c=s.aircraft.cockpit;
    d.refreshScene();s.renderDiagnosticsPanel.close();
    const materials=new Set();c.gltfCockpitGroup.traverse(n=>{if(n.isMesh)
      (Array.isArray(n.material)?n.material:[n.material]).filter(m=>m.isMeshStandardMaterial).forEach(m=>materials.add(m))});
    return {ready:c.lightingBakeStatus,count:materials.size,hooks:[...materials].every(m=>{
      const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <lights_fragment_end>'};
      m.onBeforeCompile(shader,s.renderer);return shader.fragmentShader.includes('deckFrontIrradiance')&&m.userData.cockpitLighting===c.lightTransfer;
    })};
  })()`);
  assert.equal(report.asyncRestore.ready,'ready');assert.ok(report.asyncRestore.count>0);assert.equal(report.asyncRestore.hooks,true);
  report.firstAo = await evaluate(`(()=>{
    const s=window.simulator,d=s.renderDiagnostics;
    s.demoDirector.stop();s.gameFlow.enterFlight();s.setPreset('runway');s.integratePhysics=()=>{};
    s.cameraSystem.setMode(0,true);s.cameraSystem.photoCockpit=false;
    const fresh=!s.cockpitOcclusion.pass;s.renderDiagnosticsPanel.open();
    d.set('material','unlit');d.set('ao','on');d.render();
    let deck=0,displays=0,invalid=0;
    for(const [mesh,original] of d.meshes){const mats=Array.isArray(original.material)?original.material:[original.material];
      if(!s.aircraft.cockpit.gltfCockpitGroup.getObjectById(mesh.id)||mats.some(m=>m.transparent))continue;
      const display=mats.every(m=>m.isMeshBasicMaterial);if(display)displays++;else deck++;
      if(!mesh.layers.isEnabled(display?2:1)||mesh.layers.isEnabled(display?1:2))invalid++;
    }
    s.renderDiagnosticsPanel.close();
    // A consumed empty cache must be marked dirty on restore as well as on entry.
    s.renderDiagnosticsPanel.open();d.set('scene','world');d.render();
    const lights=[];s.scene.traverse(n=>{if(n.castShadow&&n.shadow){n.shadow.needsUpdate=false;lights.push(n)}});
    s.renderDiagnosticsPanel.close();const shadowRestore=lights.length>0&&lights.every(n=>n.shadow.needsUpdate);
    document.getElementById('dev-enabled').click();return {fresh,deck,displays,invalid,shadowRestore};
  })()`);
  assert.equal(report.firstAo.fresh,true);assert.ok(report.firstAo.deck>0);assert.ok(report.firstAo.displays>0);
  assert.equal(report.firstAo.invalid,0);assert.equal(report.firstAo.shadowRestore,true);
  report.defaultGate = await evaluate(`(() => {
    const s=window.simulator;
    return { enabled:s.developerMode.enabled, active:s.renderDiagnostics.active,
      hidden:document.getElementById('render-trials').hidden, open:s.renderDiagnosticsPanel.open() };
  })()`);
  assert.deepEqual(report.defaultGate, { enabled:false, active:false, hidden:true, open:false });
  await evaluate(`(() => {
    const s=window.simulator; s.demoDirector.stop(); s.gameFlow.enterFlight(); s.setPreset('runway');
    s.integratePhysics=()=>{}; s.cameraSystem.setMode(0,true); s.cameraSystem.photoCockpit=false;
    s.cameraSystem.enableCursorTrack=false; s.cameraSystem.enableEdgePan=false;
    s.setRenderQuality('balanced');
    window.__savedQuality=localStorage.getItem('flight3d.renderQuality');
    document.getElementById('dev-enabled').click(); document.getElementById('dev-render-trials').click();
  })()`);
  await evaluate('document.activeElement.blur()');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA'});
  assert.equal(await evaluate('window.simulator.controls.keys.KeyA'),true);
  await evaluate('document.querySelector("#render-trials select").focus()');
  assert.equal(await evaluate('!!window.simulator.controls.keys.KeyA'),false,'Focusing a trial must release held flight inputs');
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA'});
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'c',code:'KeyC'});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'c',code:'KeyC'});
  assert.equal(await evaluate('window.simulator.cameraSystem.mode'),0,'Typing in the panel must not change the flight camera');
  report.baseline = await metrics(); assert.ok(report.baseline.calls > 0 && report.baseline.triangles > 0);
  await evaluate(`document.querySelector('#render-trials [data-baseline]').click()`);
  await capture('desktop-default'); save();
  for (const [key, value] of [['resolution','0.75'],['ao','off'],['shadows','off'],['lights','noExterior'],
    ['lights','noLocal'],['material','unlit'],['side','front'],['depth','projection'],['scene','world'],['scene','cockpit'],['culling','off']]) {
    await change(key,value);
    const sample = await metrics(); report.cases.push({key,value,...sample}); save();
    assert.equal(await evaluate(`window.simulator.renderDiagnostics.options['${key}']`),value);
    assert.ok(sample.calls > 0 && sample.triangles > 0);
    assert.equal(await evaluate('window.simulator.renderer.getContext().getError()'),0);
    if (key === 'resolution') assert.deepEqual([sample.width,sample.height],[1080,675]);
    if (key === 'shadows') {
      report.shadowDefines = await evaluate(`(()=>{
        const s=window.simulator,checked=[],restore=[];
        s.scene.traverse(node=>{if(!node.isMesh)return;const after=node.onAfterRender;restore.push([node,after]);
          node.onAfterRender=function(...args){after.apply(this,args);const material=args[4];
            if(material.isMeshStandardMaterial&&checked.length<8){const p=s.renderer.properties.get(material).currentProgram;
              checked.push(/^\\s*#define USE_SHADOWMAP\\b/m.test(s.renderer.getContext().getShaderSource(p.fragmentShader)));}};});
        try{s.renderScene();return checked}finally{for(const [node,after] of restore)node.onAfterRender=after}
      })()`);
      assert.ok(report.shadowDefines.length>0);
      assert.ok(report.shadowDefines.every(value=>!value),'Shadows off must also disable shader shadow sampling');
    }
    await change(key,'default');
  }
  const world = report.cases.find(row=>row.key==='scene'&&row.value==='world');
  assert.ok(world.triangles < report.baseline.triangles, 'Hiding the aircraft must remove submitted geometry');
  await metrics();
  report.export = await evaluate(`(async()=>{
    const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob,name;
    URL.createObjectURL=value=>{blob=value;return create(value)};
    HTMLAnchorElement.prototype.click=function(){name=this.download};
    try{document.querySelector('#render-trials [data-save]').click();return {name,data:JSON.parse(await blob.text())}}
    finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}
  })()`);
  assert.ok(report.export.data.baseline.metrics.samples > 0);
  assert.equal(report.export.name,'flight3d-render-comparison.json');
  // Revisit cached shader variants, checking that repeated toggles stop adding programs.
  report.programCycles=[];
  for(let cycle=0;cycle<3;cycle++) {
    for(const [key,value] of [['material','unlit'],['depth','projection'],['side','front']]) {
      await change(key,value); await sleep(500); await change(key,'default'); await sleep(300);
    }
    report.programCycles.push(await evaluate('window.simulator.renderer.info.programs.length'));
  }
  assert.ok(report.programCycles[2] <= report.programCycles[1] + 2,'Shader programs must stabilize on repeated options');
  await evaluate(`(async()=>{const {setLanguage}=await import('/src/i18n/index.js');setLanguage('en')})()`);
  await capture('desktop-english');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`(async()=>{const {setLanguage}=await import('/src/i18n/index.js');setLanguage('ko')})()`);
  await capture('mobile-korean');
  report.mobile = await evaluate(`(()=>{const panel=document.getElementById('render-trials'),r=panel.getBoundingClientRect();
    return {fits:r.left>=0&&r.right<=innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,selects:panel.querySelectorAll('select').length}})()`);
  assert.equal(report.mobile.fits,true);assert.equal(report.mobile.overflow,false);assert.equal(report.mobile.selects,9);
  await change('resolution','0.5'); await change('material','unlit'); await change('depth','projection');
  await evaluate(`window.simulator.setAircraft('B738')`);
  assert.equal(await evaluate('window.simulator.renderDiagnostics.active'),false,'Changing aircraft must restore the rendering baseline');
  await evaluate(`document.getElementById('dev-render-trials').click()`);
  await change('material','unlit');
  await evaluate(`window.simulator.setRenderQuality('balanced')`);
  assert.equal(await evaluate('window.simulator.renderDiagnostics.active'),false,'A normal quality change must close diagnostic overrides');
  await evaluate(`document.getElementById('dev-render-trials').click()`);
  await change('resolution','0.5'); await change('material','unlit'); await change('depth','projection');
  await evaluate(`document.getElementById('dev-enabled').click()`);
  report.restored=await evaluate(`(()=>{const s=window.simulator;return {active:s.renderDiagnostics.active,hidden:document.getElementById('render-trials').hidden,
    ratio:s.renderer.getPixelRatio(),autoReset:s.renderer.info.autoReset,materials:s.renderDiagnostics.materials.size,
    preference:localStorage.getItem('flight3d.renderQuality')===window.__savedQuality}})()`);
  assert.deepEqual(report.restored,{active:false,hidden:true,ratio:1,autoReset:true,materials:0,preference:true});
  await evaluate(`window.simulator.setAircraft('C172')`);
  for(let i=0;i<180;i++){
    if(await evaluate('!!window.simulator.aircraft.gltfModel && window.simulator.aircraft.cockpit.gltfCockpitGroup === window.simulator.aircraft.gltfModel'))break;
    await sleep(500);
  }
  report.unifiedCockpit=await evaluate(`(()=>{
    const s=window.simulator,d=s.renderDiagnostics;
    document.getElementById('dev-enabled').click();s.renderDiagnosticsPanel.open();s.renderDiagnosticsPanel.refresh();
    const before=new Map();s.aircraft.group.traverse(n=>{if(n.isMesh)before.set(n,n.material)});
    const unlit=d.set('material','unlit'),front=d.set('side','front');
    return {ready:!!s.aircraft.gltfModel&&s.aircraft.cockpit.gltfCockpitGroup===s.aircraft.gltfModel,dedicated:d.hasDedicatedCockpit,unlit,front,
      disabled:['material','side'].every(k=>document.querySelector('[data-render-trial="'+k+'"]').disabled),
      preserved:[...before].every(([mesh,material])=>mesh.material===material)};
  })()`);
  assert.deepEqual(report.unifiedCockpit,{ready:true,dedicated:false,unlit:false,front:false,disabled:true,preserved:true});
  await capture('c172-unsupported');
  await evaluate('window.simulator.renderDiagnosticsPanel.close()');
  assert.deepEqual(errors,[]); report.status='PASS';
} catch(error) {report.failure=error.stack;process.exitCode=1;console.error(error)}
finally{if(heldBake)await call('Fetch.continueRequest',{requestId:heldBake}).catch(()=>{});report.errors=errors;save();await fetch(`${endpoint}/json/close/${target.id}`).catch(()=>{});ws.close()}
