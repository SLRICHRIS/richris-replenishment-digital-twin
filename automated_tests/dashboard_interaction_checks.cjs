const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=require('node:path').resolve(__dirname,'../digital_twin_application');
const html=fs.readFileSync(base+'/index.html','utf8'),nodes=new Map(),all=[],windowEvents={},documentEvents={},frames=[];
let doc;
function classes(value=''){const set=new Set(value.split(/\s+/).filter(Boolean));return{toggle(v,on){on=on??!set.has(v);on?set.add(v):set.delete(v);return on},add(v){set.add(v)},remove(v){set.delete(v)},contains:v=>set.has(v)}}
function parseAttrs(s){const o={};for(const m of s.matchAll(/([\w-]+)(?:="([^"]*)")?/g))o[m[1]]=m[2]??'';return o}
function create(attrs={},owner=null){
 const e={attrs:{...attrs},id:attrs.id,dataset:{},owner,inner:'',hidden:'hidden'in attrs,style:{setProperty(k,v){this[k]=v}},classList:classes(attrs.class),handlers:{},value:'',disabled:false,clientWidth:640,selectedOptions:[{text:'Test scenario'}],textContent:'',open:false};
 for(const k of Object.keys(attrs))if(k.startsWith('data-'))e.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=attrs[k];
 e.setAttribute=(k,v)=>e.attrs[k]=String(v);e.getAttribute=k=>e.attrs[k];e.addEventListener=(k,fn)=>e.handlers[k]=fn;
 e.focus=()=>{doc.activeElement=e};e.blur=()=>{if(doc.activeElement===e)doc.activeElement=null};e.click=()=>{e.onclick?.({target:e});e.handlers.click?.({target:e})};
 e.contains=target=>{while(target){if(target===e)return true;target=target.owner}return false};e.showModal=()=>e.open=true;e.close=()=>e.open=false;
 e.closest=selector=>selector.startsWith('[data-')&&selector.slice(1,-1) in e.attrs?e:null;
 e.querySelector=selector=>{if(selector.startsWith('[data-measurement=')){e.chips??={};return e.chips[selector]??=create({},e);}if(selector==='[data-select]')return all.find(n=>e.contains(n)&&'select'in n.dataset)||null;if(selector==='span')return e.span??=create({},e);return null};
 Object.defineProperty(e,'innerHTML',{get(){return e.inner},set(s){e.inner=s;for(const m of s.matchAll(/<([a-z][a-z0-9-]*)\b([^>]+)>/g)){const a=parseAttrs(m[2]);if(a.id){const n=create(a,e);nodes.set(a.id,n)}}}});
 all.push(e);if(e.id)nodes.set(e.id,e);return e;
}
for(const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]+)>/g)){const a=parseAttrs(m[2]);if(a.id||a.class||a['data-page']||a['data-view']||'data-screen'in a||'data-lab-tab'in a||'data-lab-panel'in a)create(a)}
const get=id=>{const e=nodes.get(id);assert(e,'Unknown DOM id '+id);return e};
doc={getElementById:get,activeElement:null,hidden:false,title:'',body:create(),documentElement:create(),addEventListener:(k,f)=>documentEvents[k]=f,createElement:()=>create(),querySelector(s){return s.startsWith('.')?all.find(n=>n.classList.contains(s.slice(1))):null},querySelectorAll(s){if(s.startsWith('[data-')){const k=s.slice(1,-1);return all.filter(n=>k in n.attrs)}return[]}};
get('speed').value='3';get('horizon').value='120';get('scenario').value='normal';
class Scene{constructor(c,onSelect,onCamera){this.onSelect=onSelect;this.onCamera=onCamera;this.camera={yaw:0,elevation:.7,zoom:1};this.layers={routes:false,sensors:false,ghosts:false,grid:false,facility:true};this.rendererKind='Test renderer';this.width=1000;this.draws=0;this.resizes=0}setView(p){this.preset=p}focus(){this.follow=true}cameraChanged(p){this.onCamera(p,this.camera)}resize(){this.resizes++}draw(){this.draws++}zoomBy(f){this.camera.zoom*=f}}
let worker;const location={hash:''};const win={addEventListener:(k,f)=>windowEvents[k]=f,history:{replaceState(a,b,h){location.hash=h}},scrollTo(){}};
const ctx={document:doc,window:win,location,TwinScene:Scene,Worker:class{constructor(){worker=this}postMessage(d){this.data=d}},performance:{now:()=>100},requestAnimationFrame:f=>frames.push(f),setTimeout(){},clearTimeout(){},Blob,URL,console};vm.createContext(ctx);

Object.assign(ctx,{TextDecoder,TextEncoder,setInterval(){return 1},clearInterval(){},crypto:require('node:crypto').webcrypto});
vm.runInContext(fs.readFileSync(base+'/interface_motion_and_transitions.js','utf8').replace(/export /g,''),ctx);
vm.runInContext(fs.readFileSync(base+'/robot_measurement_validation.js','utf8').replace(/export /g,''),ctx);
Object.assign(ctx,vm.runInContext("(()=>{"+fs.readFileSync(base+'/warehouse_racks_and_aisle_layout.js','utf8').replace(/export /g,'')+";return{WAREHOUSE_LAYOUT,BIN_DESTINATIONS,STORAGE_RACKS,AISLE_X,AISLE_Y,LANE_SEGMENTS,referenceRouteGraph,paintLanePlan};})()",ctx));
Object.assign(ctx,vm.runInContext("(()=>{"+fs.readFileSync(base+'/warehouse_graph_and_pathfinding.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,'')+";return{referenceFacility,checkedFacility,graphRoute,graphRouteTrace,graphRouteFromPose,checkedRouting,routeEdgeKey,edgeSegments,travelledMetres};})()",ctx));
vm.runInContext(fs.readFileSync(base+'/robot_state_estimation_and_calibration.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,''),ctx);
vm.runInContext(fs.readFileSync(base+'/mission_scheduling_and_routes.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,''),ctx);
vm.runInContext(fs.readFileSync(base+'/twin_model_validation_workspace.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,''),ctx);
vm.runInContext(fs.readFileSync(base+'/esp32_connection_controls.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/export /g,''),ctx);

ctx.createRouteMap=()=>({render(){},tick(){},setVisible(){}});
const app=fs.readFileSync(base+'/warehouse_simulation_controller.js','utf8').replace(/^import[^\n]*\n/gm,'').replace('if(document.fonts)await document.fonts.ready;','');vm.runInContext(app,ctx);const run=s=>vm.runInContext(s,ctx);
assert.equal(get('environment').hidden,false);assert.equal(run('tasks.length'),3);
assert.equal(run('scene.layers.facility'),true);get('layer-facility').click();assert.equal(run('scene.layers.facility'),false);assert.equal(get('layer-facility').attrs['aria-pressed'],'false');get('layer-facility').click();assert.equal(run('scene.layers.facility'),true);
get('demo').click();assert(get('dispatch-dialog').open);assert(get('dispatch-review').innerHTML.includes('Battery on return'));assert.equal(run('tasks.filter(t=>t.status==="Active").length'),0);
get('confirm-dispatch').click();assert(!get('dispatch-dialog').open);assert.equal(run('tasks.filter(t=>t.status==="Active").length'),1);assert.equal(run('tasks.filter(t=>t.status==="Queued").length'),2);
assert(get('brief-value-a').textContent.includes('AMR-01'));run('step(5);render()');assert.equal(run('robots[1].x'),120);assert.equal(run('robots[2].x'),120);
run('pauseRobot(0)');let poses=run('JSON.stringify(robots.map(r=>[r.x,r.y]))');run('step(5)');assert.equal(run('JSON.stringify(robots.map(r=>[r.x,r.y]))'),poses);assert.equal(run('assessMission(tasks[1],dispatchContext()).eta'),null);
run('stopFleet();resumeFleet()');assert.equal(run('robots[0].state'),'Paused');assert.equal(run('robots[1].state'),'Queued');run('pauseRobot(0)');
run(`for(let i=0;i<1400;i++){step(.1);if(robots.filter(r=>r.route.length).length>1)throw Error('Aisle overlap');for(let a=0;a<robots.length;a++)for(let b=a+1;b<robots.length;b++)if(Math.hypot(robots[a].x-robots[b].x,robots[a].y-robots[b].y)<70)throw Error('Bay overlap');}render();`);
assert.equal(run('completed'),3);assert(run('robots.every(r=>r.state==="Idle")'));assert(run('robots.every(r=>Number.isFinite(r.battery)&&r.battery>=15)'));
run('reset();running=false');get('demo').click();get('confirm-dispatch').click();assert.equal(run('tasks.filter(t=>t.status==="Active").length'),0);assert.equal(run('tasks.filter(t=>t.status==="Queued").length'),3);
run('cancelTask(tasks[0]);render()');assert.equal(run('robots[0].task'),null);assert.equal(run('robots[0].state'),'Idle');
run('reset();openDispatch();robots[0].battery=16');get('confirm-dispatch').click();assert.equal(run('tasks[0].status'),'Pending approval');assert.equal(run('tasks.filter(t=>t.status==="Active").length'),1);
run('reset();assign(tasks[0]);step(2);reassign(tasks[0],1)');assert.equal(run('tasks[0].status'),'Pending approval');assert.equal(run('robots[0].state'),'Returning');assert.equal(run('robots[1].task'),null);
run('reset();assign(tasks[0]);step(2);cancelTask(tasks[0]);step(100)');assert.equal(run('completed'),0);assert.equal(run('robots[0].state'),'Idle');
run('reset();slow=true');get('demo').click();get('confirm-dispatch').click();run('step(500);render()');assert.equal(run('completed'),3);assert(run('robots.every(r=>r.route.length===0)'));
run('reset()');get('new-task').click();assert.equal(get('destination').value,'2');assert(get('mission-assessment').innerHTML.includes('Recommended'));get('mission-form').onsubmit({preventDefault(){}});assert.equal(run('tasks.length'),4);assert.equal(run('activePage'),'missions');
run('addTask(2,0)');assert.equal(run('tasks.length'),4);assert(!get('tasks').innerHTML.includes('NaN'));
get('theme-bright').click();assert.equal(run('currentTheme'),'bright');get('theme-dark').click();assert.equal(run('currentTheme'),'dark');
run('activatePage("environment");setFloorSource("hardware")');const before=run('JSON.stringify({robots,bins,tasks,elapsed})');run('frame(500)');get('run').click();get('stop').click();get('demo').click();assert.equal(run('JSON.stringify({robots,bins,tasks,elapsed})'),before);assert(get('run').disabled);assert.equal(get('unit-battery').innerHTML,'—');assert.equal(get('brief-title').textContent,'0 of 3 streams live');assert(!get('layer-facility').disabled);get('layer-facility').click();assert.equal(run('scene.layers.facility'),false);get('layer-facility').click();assert.equal(run('JSON.stringify({robots,bins,tasks,elapsed})'),before,'Facility visibility has no operational authority');
run('setFloorSource("simulation")');assert(!get('run').disabled);assert(!get('tasks').innerHTML.includes('undefined'));assert(!get('log').innerHTML.includes('NaN'));
get('tab-missions').handlers.keydown({key:'ArrowDown',preventDefault(){}});assert.equal(run('activePage'),'telemetry');
console.log('PASS: dispatch review, approval revalidation, exclusive aisle and bay separation, queued states, pause/stop retention, complete delivery cycles, cancellation, reassignment, congestion, mission guidance, theme switching and live/simulation isolation.');
run('reset();slow=true;assign(tasks[0]);robots[0].x=290;robots[0].y=250;robots[0].route=[{x:710,y:250},{x:710,y:350}];');
const predicted=run('projectMotion(robots[0],5,true)');run('step(5)');assert(Math.abs(run('robots[0].x')-predicted.x)<1e-7);assert(Math.abs(run('robots[0].y')-predicted.y)<1e-7);
console.log('PASS: rendered motion projection agrees with simulation across the aisle speed boundary.');
// Forecasts and execution must agree across capacity clamping and exact arrival events.
run('reset();bins[3].stock=98;assign(tasks[0]);');
const arrival=run('tasks[0].journey.outbound.seconds'),expectedStock=run('inventoryProjection(dispatchContext(),60)[3].projected');
run('step(60)');assert(Math.abs(run('tasks[0].finishedAt')-arrival)<1e-8);assert(Math.abs(run('bins[3].stock')-expectedStock)<1e-8);
// A battery disturbance after approval causes a timed charging hold, then a valid journey.
run('reset();running=false;assign(tasks[0]);robots[0].battery=12;running=true;');
const expected=run('queueTimeline(dispatchContext()).entries[0]');assert(expected.chargeWait>0);
const projected=run('inventoryProjection(dispatchContext(),150)[3].projected');
run('step(150);render()');assert(Math.abs(run('tasks[0].startedAt')-expected.start)<1e-8);assert(Math.abs(run('tasks[0].finishedAt')-expected.arrival)<1e-8);assert(Math.abs(run('bins[3].stock')-projected)<1e-8);assert(run('robots[0].battery>=15'));
run('reset()');get('route-condition').value='entry';get('route-condition').onchange();get('demo').click();assert(get('confirm-dispatch').disabled);assert(get('dispatch-review').innerHTML.includes('No permitted outbound and return route'));assert(!get('dispatch-review').innerHTML.includes('NaN'));assert(!get('dispatch-review').innerHTML.includes('undefined'));
run('reset()');get('route-condition').value='north';get('route-condition').onchange();const approvedPath=run('JSON.stringify(assessMission(tasks[2],dispatchContext()).trip.outbound.points)');run('assign(tasks[2]);render()');assert(get('route-condition').disabled);assert.equal(run('JSON.stringify(robots[2].route)'),approvedPath);run('cancelTask(tasks[2]);step(50);render()');assert(!get('route-condition').disabled);
run('reset();slow=true;assign(tasks[0]);');const savedReturn=run('JSON.stringify(tasks[0].journey.inbound.points)');run('slow=false;step(tasks[0].journey.outbound.seconds+1)');assert.equal(run('JSON.stringify(tasks[0].journey.inbound.points)'),savedReturn,'Speed changes retain approved geometry');
run('reset();predict()');const forecastGeneration=run('generation');run(`worker.onmessage({data:{generation:${forecastGeneration},sent:100,alerts:[{title:'obsolete response',detail:'superseded snapshot'}]}})`);assert(!get('alerts').innerHTML.includes('obsolete response'));
console.log('PASS: exact arrival/capacity accounting, charging-aware queue forecasts, blocked route review, route setting lock, retained return paths and superseded forecast handling.');
run('activatePage("engineering")');get('lab-reference').click();assert.equal(run('engineering.source'),'recording');assert(get('lab-provenance').textContent.includes('Synthetic'));
const liveBefore=run('JSON.stringify(engineering.liveEngine.profiles)');
get('lab-fit').click();assert(!get('lab-apply-fit').disabled);assert(get('lab-calibration-result').innerHTML.includes('holdout'));
get('lab-apply-fit').click();assert.equal(run('JSON.stringify(engineering.liveEngine.profiles)'),liveBefore,'Synthetic calibration cannot modify live models');
get('lab-run-experiment').click();assert.equal(worker.data.snapshot.provenance,'synthetic');assert.equal(worker.data.options.horizonS,120);
const frozen=worker.data;get('lab-source').value='live';get('lab-source').handlers.change?.();get('lab-source').onchange();
assert.equal(run('engineering.source'),'live');assert.equal(get('lab-frame-confirmed').checked,false);assert(!get('lab-provenance').textContent.includes('Synthetic'));
worker.onmessage({data:{requestId:frozen.requestId,error:'old comparison should be ignored'}});assert(!get('lab-experiment-message').textContent.includes('old comparison'));
get('lab-run-experiment').click();assert(get('lab-experiment-message').textContent.includes('facility route graph'),'Uncommissioned hardware cannot run a physical experiment');
get('lab-reference').click();get('lab-run-experiment').click();
import('../digital_twin_application/paired_dispatch_policy_experiments.js').then(({comparePolicies})=>{
  const d=worker.data,comparison=comparePolicies(d.snapshot,d.options);worker.onmessage({data:{requestId:d.requestId,result:comparison}});
  assert(!get('lab-export-experiment').disabled);assert(get('lab-experiment-result').innerHTML.includes('Unmet demand'));
  assert(get('lab-experiment-message').textContent.includes('synthetic snapshot'));
  console.log('PASS: complete Twin lab UI workflow, reference/import source identity, fitting and application, live/synthetic model isolation, blocked physical studies, stale worker replies and paired-result display.');
}).catch(error=>{console.error(error);process.exitCode=1;});
