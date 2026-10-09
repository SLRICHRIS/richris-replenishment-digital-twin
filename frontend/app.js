import { TwinScene } from './scene.js';
import { createMotionSystem, patchContent } from './motion.js';
import { createHardwareWorkspace } from './hardware.js';
import { MODEL, OPEN_MISSIONS, routeTo, routeStats, homeFor, aisleOwner, assessMission, rankUnits, reviewDispatch, inventoryProjection } from './dispatch.js';
'use strict';
const $=id=>document.getElementById(id),colors=['#82b6ff','#bca2ff','#efbd68'],unitInks=['#82b6ff','#bca2ff','#efbd68'];
let robots,bins,tasks,logs,history,elapsed,running,stopped,completed,seq,demand,slow,selected=0,lastOverride=null,snapshotAge=0,predictionBusy=false,generation=0,lastSample=0,toastTimer;
let motion=null,logSeq=0;
const stableRegions=new Set(['tasks','bins','log','dispatch-review','energy-chart','alerts']);
const setHTML=(id,html)=>{if(stableRegions.has(id)){if(patchContent($(id),html))motion?.content(id)}else if($(id).innerHTML!==html)$(id).innerHTML=html};
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
let approvalOrder=0,reviewIds=[];
let floorSource='simulation',lastForecastHTML='',lastForecastCount='0';
let activePage='environment',currentTheme=document.documentElement.dataset.theme==='bright'?'bright':'dark';
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');motion?.notify();clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3500)}
function log(message,notify=false){logs.unshift({id:++logSeq,time:elapsed.toFixed(1),message});logs=logs.slice(0,500);if(notify)toast(message)}
function cameraChanged(preset,camera){$('camera-label').textContent=({iso:'3D perspective',top:'Plan view',close:'Ground view',focus:'Following selected unit',custom:'Free orbit'})[preset]||'Free orbit';document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===preset);b.setAttribute('aria-pressed',b.dataset.view===preset?'true':'false')});$('auto-orbit').classList.toggle('active',scene.autoOrbit);$('auto-orbit').setAttribute('aria-pressed',scene.autoOrbit?'true':'false');$('compass-needle').style.transform=`rotate(${camera.yaw*180/Math.PI}deg)`}
if(document.fonts)await document.fonts.ready;
const scene=new TwinScene($('scene'),id=>{selected=id;render()},cameraChanged);
motion=createMotionSystem({scene});
scene.setTheme?.(currentTheme);
$('scene-loading').hidden=true;
let worker=null;
try{worker=new Worker('predictor.js',{type:'module'})}catch{forecastUnavailable()}
window.addEventListener('twin-renderer-lost',()=>{running=false;toast('The 3D view was interrupted. Simulation paused.');render()});
document.querySelector('.renderer-badge').textContent=scene.rendererKind;
function reset(){generation++;approvalOrder=0;reviewIds=[];robots=colors.map((color,i)=>({id:i,x:120,y:170+i*80,battery:96-i*9,color,state:'Idle',task:null,route:[],distance:0,heading:0,velocity:0}));bins=[{id:'A',name:'Assembly A',x:420,y:150,stock:64,rate:.09},{id:'B',name:'Assembly B',x:710,y:150,stock:48,rate:.13},{id:'C',name:'Packing C',x:420,y:350,stock:77,rate:.07},{id:'D',name:'Packing D',x:710,y:350,stock:39,rate:.11}];tasks=[];logs=[];history=[];elapsed=0;running=true;stopped=false;completed=0;seq=1;demand=1;slow=false;selected=0;lastOverride=null;lastSample=0;predictionBusy=false;$('scenario').value='normal';$('scenario-description').textContent='Standard demand and aisle speed.';scene.setView('iso');log('Session started. Three virtual robots ready.');addTask(3,0);addTask(1,1);addTask(0,2);sample();render();predict()}
function dispatchContext(){return {robots,bins,tasks,demand,slow,stopped,running};}
const missionName=id=>'M'+String(id).padStart(3,'0');
const etaLabel=seconds=>seconds===null||!Number.isFinite(seconds)?'On hold':seconds<60?'~'+Math.ceil(seconds)+' s':'~'+Math.floor(seconds/60)+'m '+Math.ceil(seconds%60)+'s';
function addTask(bin,robot){
  if(tasks.some(t=>t.bin===bin&&OPEN_MISSIONS.includes(t.status))){toast('This bin already has an open replenishment mission.');return null;}
  const t={id:seq++,bin,robot,status:'Pending approval',progress:0,totalDistance:0,createdAt:elapsed};tasks.push(t);log(missionName(t.id)+' queued for approval.');return t;
}
const path=routeTo;
function routeLength(r){return routeStats(r,r.route,slow).distance;}
function startNextMission(){
  if(stopped||!running||aisleOwner(robots))return;
  const t=tasks.filter(t=>t.status==='Queued').sort((a,b)=>a.approvedOrder-b.approvedOrder)[0];if(!t)return;
  const a=assessMission(t,dispatchContext());
  if(!a.feasible){const reason=a.reasons.join(' ');if(t.holdReason!==reason){t.holdReason=reason;log(missionName(t.id)+' held: '+reason);}return;}
  const r=robots[t.robot];t.holdReason='';t.status='Active';t.startedAt=elapsed;r.state='Delivering';r.route=path(r,bins[t.bin]);t.totalDistance=routeLength(r);t.progress=0;
  log(missionName(t.id)+' started. AMR-0'+(r.id+1)+' holds the aisle until its return.');
}
function assign(t){
  if(!t||t.status!=='Pending approval')return false;
  const a=assessMission(t,dispatchContext());if(!a.feasible){log(missionName(t.id)+' approval blocked: '+a.reasons.join(' '),true);return false;}
  const r=robots[t.robot];t.status='Queued';t.approvedOrder=++approvalOrder;t.approvedAt=elapsed;t.approvedEstimate={eta:a.eta,returnBattery:a.returnBattery};r.task=t.id;r.state='Queued';r.velocity=0;
  log('Approved '+missionName(t.id)+': AMR-0'+(r.id+1)+' to Bin '+bins[t.bin].id+'. Arrival '+etaLabel(a.eta)+', return reserve '+a.returnBattery.toFixed(1)+'%.');
  startNextMission();return true;
}
function pauseRobot(id){const start=performance.now(),r=robots[id];if(r.state==='Stopped'||!r.route.length)return;if(r.state==='Paused'){r.state=r.task===null?'Returning':'Delivering';log('Operator resumed AMR-0'+(id+1)+'.',true)}else{r.state='Paused';r.velocity=0;log('Operator paused AMR-0'+(id+1)+'. Aisle reservation retained.',true)}lastOverride=performance.now()-start;render();predict();}
function stopFleet(){if(stopped)return;const start=performance.now();stopped=true;robots.forEach(r=>{r.wasPausedBeforeStop=r.state==='Paused';r.state='Stopped';r.velocity=0});lastOverride=performance.now()-start;log('Fleet STOP latched. All virtual motion halted; reservations retained.',true);render();predict();}
function resumeFleet(){stopped=false;robots.forEach(r=>{const task=tasks.find(t=>t.id===r.task);r.state=r.battery<=0?'Stopped':r.wasPausedBeforeStop&&r.route.length?'Paused':task?.status==='Queued'?'Queued':task?.status==='Active'?'Delivering':r.route.length?'Returning':'Idle';r.wasPausedBeforeStop=false});log('Operator explicitly released fleet stop.',true);startNextMission();render();predict();}
function releaseUnit(t){const r=robots[t.robot];if(r.task!==t.id)return;r.task=null;if(r.route.length){r.route=path(r,homeFor(r));r.state=stopped?'Stopped':r.state==='Paused'?'Paused':'Returning';}else r.state=stopped?'Stopped':'Idle';}
function cancelTask(t){if(!t||!OPEN_MISSIONS.includes(t.status))return;releaseUnit(t);t.status='Cancelled';t.finishedAt=elapsed;log('Operator cancelled '+missionName(t.id)+'.',true);startNextMission();render();predict();}
function reassign(t,id){
  if(!t||!OPEN_MISSIONS.includes(t.status)||id===t.robot)return;
  const a=assessMission({...t,robot:id},dispatchContext());if(!a.feasible){log('Reassignment blocked: '+a.reasons.join(' '),true);render();return;}
  releaseUnit(t);t.robot=id;t.status='Pending approval';t.progress=0;t.approvedOrder=null;t.approvedEstimate=null;t.holdReason='';log(missionName(t.id)+' reassigned to AMR-0'+(id+1)+'. Fresh approval required.',true);render();predict();
}
function sample(){history.push({t:elapsed,b:robots.map(r=>r.battery)});if(history.length>300)history.shift();}
function step(dt){
  while(dt>1e-8){const slice=Math.min(dt,.05);advanceSimulation(slice);dt-=slice;}
}
function advanceSimulation(dt){
  startNextMission();elapsed+=dt;bins.forEach(b=>b.stock=Math.max(0,b.stock-b.rate*demand*dt));
  robots.forEach(r=>{
    r.velocity=0;if(stopped||['Paused','Stopped'].includes(r.state))return;
    if(!r.route.length){if(r.x<150)r.battery=Math.min(100,r.battery+.16*dt);return;}
    let remaining=dt,moved=0;
    while(remaining>1e-8&&r.route.length){
      if(r.battery<=0){r.state='Stopped';log('AMR-0'+(r.id+1)+' battery depleted. Aisle remains reserved.',true);break;}
      const dest=r.route[0],dx=dest.x-r.x,dy=dest.y-r.y,len=Math.hypot(dx,dy);
      const inSlow=slow&&(r.x>300.00001||(r.x>=299.99999&&dx>0)),speed=inSlow?MODEL.congestedSpeed:MODEL.speed;
      let boundary=len;if(slow&&dx!==0&&((r.x<300&&dest.x>300)||(r.x>300&&dest.x<300)))boundary=Math.abs((300-r.x)/dx)*len;
      const move=Math.min(len,speed*remaining,speed*r.battery/MODEL.drain,boundary),used=move/speed;
      if(len>.001)r.heading=Math.atan2(dy,dx);r.x+=len?dx/len*move:0;r.y+=len?dy/len*move:0;moved+=move;r.distance+=move;r.battery=Math.max(0,r.battery-MODEL.drain*used);remaining-=used;
      const t=tasks.find(t=>t.id===r.task);if(t)t.progress=Math.min(99,100*(1-routeLength(r)/Math.max(1,t.totalDistance)));
      if(len<=move+.001){r.x=dest.x;r.y=dest.y;r.route.shift();if(!r.route.length){
        if(t){const b=bins[t.bin],delivered=Math.min(MODEL.load,MODEL.capacity-b.stock);b.stock+=delivered;t.status='Completed';t.progress=100;t.delivered=delivered;t.finishedAt=elapsed;completed++;log(missionName(t.id)+' complete. '+delivered.toFixed(1)+' units added to Bin '+b.id+'.');r.task=null;r.state='Returning';r.route=path(r,homeFor(r));}
        else{r.state='Idle';log('AMR-0'+(r.id+1)+' docked. Shared aisle released.');}
      }}else if(move<=1e-9)break;
    }
    r.velocity=dt>0?moved/dt/MODEL.scale:0;
  });
  if(elapsed-lastSample>=1){sample();lastSample=elapsed;}
}
function renderEnergy(){
  const chart=$('energy-chart'),w=Math.max(280,chart.clientWidth||640),h=w<500?230:360;
  chart.setAttribute('viewBox',`0 0 ${w} ${h}`);chart.style.height=h+'px';
  const left=38,right=w-14,top=14,bottom=h-31,start=history[0]?.t||0,end=Math.max(start+60,elapsed);
  const X=t=>left+(t-start)/(end-start)*(right-left),Y=b=>bottom-b/100*(bottom-top);
  let s='';
  [0,25,50,75,100].forEach(v=>{s+=`<path d="M${left} ${Y(v)}H${right}" stroke="var(--chart-grid)" stroke-width="1" stroke-dasharray="2 5"/><text x="${left-10}" y="${Y(v)+4}" text-anchor="end" fill="var(--chart-label)" font-size="12" font-family="Hanken Grotesk,Arial,sans-serif" font-weight="500">${v}</text>`});
  unitInks.forEach((color,i)=>{const pts=history.map(s=>`${X(s.t)},${Y(s.b[i])}`).join(' ');s+=`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;if(history.length){const last=history.at(-1);s+=`<circle cx="${X(last.t)}" cy="${Y(last.b[i])}" r="3.5" fill="${color}" stroke="var(--panel)" stroke-width="1.5"/>`}});
  [start,(start+end)/2,end].forEach((v,i)=>{s+=`<text x="${X(v)}" y="${h-7}" text-anchor="${['start','middle','end'][i]}" fill="var(--chart-label)" font-size="12" font-family="Hanken Grotesk,Arial,sans-serif" font-weight="500">${Math.floor(v)}s</text>`});
  setHTML('energy-chart',s);
}
function renderFleet(display=robots){
  if(!$('robots').querySelector('[data-select]'))setHTML('robots',display.map(r=>`<button id="robot-card-${r.id}" class="robot-card" style="--robot:${r.color};--robot-ink:${unitInks[r.id]}" data-select="${r.id}" aria-pressed="false"><span class="robot-card-head"><span class="robot-card-number">0${r.id+1}</span><span class="robot-card-name">AMR-0${r.id+1}<small>AMR / 0${r.id+1}</small></span><i class="robot-card-indicator"></i></span><span class="robot-card-state"><span id="robot-state-${r.id}"></span><b id="robot-charge-${r.id}"></b></span><span class="robot-card-track"><i id="robot-charge-bar-${r.id}"></i></span></button>`).join(''));
  display.forEach(r=>{const card=$('robot-card-'+r.id);card.style.setProperty('--robot-ink',unitInks[r.id]);card.classList.toggle('selected',selected===r.id);card.setAttribute('aria-pressed',selected===r.id?'true':'false');card.setAttribute('aria-label',`Robot 0${r.id+1}, ${r.state}, ${r.battery===null?'unmeasured':r.battery.toFixed(0)+' percent'} battery`);$('robot-state-'+r.id).textContent=r.state;$('robot-charge-'+r.id).textContent=r.battery===null?'—':r.battery.toFixed(0)+'%';$('robot-charge-bar-'+r.id).style.width=(r.battery??0)+'%'});
}
function renderMissions(){
  $('task-count').textContent=tasks.length;
  const context=dispatchContext();
  const rows=tasks.slice().reverse().map(t=>{
    const final=!OPEN_MISSIONS.includes(t.status),a=assessMission(t,context),r=robots[t.robot];
    const status=t.status==='Pending approval'?'Awaiting approval':t.status==='Queued'?'Reserved · queued':t.status;
    const estimate=t.status==='Active'?etaLabel(['Paused','Stopped'].includes(r.state)?null:routeStats(r,r.route,slow).seconds)+' to shelf':t.status==='Queued'?(t.holdReason||etaLabel(a.eta)+' to shelf'):t.status==='Pending approval'?(a.feasible?etaLabel(a.eta)+' arrival · '+a.returnBattery.toFixed(1)+'% return':a.reasons[0]):t.status==='Completed'?t.delivered.toFixed(1)+' units delivered':'Cancelled by operator';
    const unit=final?'AMR-0'+(t.robot+1):`<select aria-label="Reassign mission ${missionName(t.id)}" data-reassign="${t.id}">${robots.map(unit=>`<option value="${unit.id}" ${unit.id===t.robot?'selected':''} ${unit.id!==t.robot&&!assessMission({...t,robot:unit.id},context).feasible?'disabled':''}>AMR-0${unit.id+1}</option>`).join('')}</select>`;
    const actions=(t.status==='Pending approval'?`<button class="approve" data-review="${t.id}" aria-label="Review mission ${missionName(t.id)}">${icon('mission')}Review</button>`:'')+(!final?`<button class="cancel-mission" data-cancel="${t.id}" aria-label="Cancel mission ${missionName(t.id)}">${icon('close')}</button>`:t.status==='Completed'?`<span class="completed-mark">${icon('check')}Delivered</span>`:'');
    return `<tr data-motion-key="mission-${generation}-${t.id}" data-motion-state="${t.status}:${t.robot}"><td data-label="Mission"><span class="mission-id">${missionName(t.id)}</span></td><td data-label="Destination"><span class="destination-name">Bin ${bins[t.bin].id}</span><span class="destination-note">${bins[t.bin].name}</span></td><td data-label="Assigned unit">${unit}</td><td data-label="Readiness & progress"><span class="task-state ${t.status.toLowerCase().replaceAll(' ','-')}">${status}${t.status==='Active'?' · '+Math.floor(t.progress)+'%':''}</span><span class="mission-estimate ${t.status==='Pending approval'&&!a.feasible?'blocked':''}">${estimate}</span>${t.status==='Active'?`<div class="task-progress"><i style="width:${t.progress}%"></i></div>`:''}</td><td data-label="Actions"><div class="task-actions">${actions}</div></td></tr>`;
  }).join('');
  if(!$('tasks').contains(document.activeElement))setHTML('tasks',rows||'<tr><td class="empty-table" colspan="5">No missions yet. Create a mission to replenish a shelf.</td></tr>');
}
function renderBrief(){
  const context=dispatchContext(),owner=aisleOwner(robots),pending=tasks.filter(t=>t.status==='Pending approval'),queued=tasks.filter(t=>t.status==='Queued'),eligible=reviewDispatch(context,pending.map(t=>t.id)).filter(a=>a.feasible).length;
  $('brief-eyebrow').textContent='Dispatch control';$('brief-title').textContent=stopped?'Fleet stop latched':!running?'Simulation paused':owner?owner.state==='Paused'?'Aisle held by paused unit':'Journey in progress':queued.length?'Queue on hold':pending.length?eligible+' ready for review':'Fleet standing by';
  $('brief-note').textContent=pending.length+' awaiting approval · '+queued.length+' in the approved queue';
  $('brief-label-a').textContent='Shared aisle';$('brief-value-a').textContent=owner?'AMR-0'+(owner.id+1):'Available';$('brief-detail-a').textContent=owner?owner.state+' · reserved through return':'One reserved journey at a time';
  const next=tasks.find(t=>t.status==='Active')||queued[0],nextRobot=next?robots[next.robot]:null;
  const eta=next?(next.status==='Active'?(['Paused','Stopped'].includes(nextRobot.state)?null:routeStats(nextRobot,nextRobot.route,slow).seconds):assessMission(next,context).eta):null;
  $('brief-label-b').textContent='Next delivery';$('brief-value-b').textContent=next?etaLabel(eta):'—';$('brief-detail-b').textContent=next?missionName(next.id)+' · Bin '+bins[next.bin].id+' · sim. time':'After approval';
  $('brief-label-c').textContent='Return reserve';$('brief-value-c').textContent=MODEL.reserve+'%';$('brief-detail-c').textContent='Required at the charging bay';
  $('operation-brief').dataset.tone=stopped||owner?.state==='Paused'?'warning':eligible?'ready':'normal';
}
function renderDispatchReview(){
  const plan=reviewDispatch(dispatchContext(),reviewIds),eligible=plan.filter(a=>a.feasible).length;
  setHTML('dispatch-review',plan.map(a=>`<article data-motion-key="review-${generation}-${a.id}" class="review-card ${a.feasible?'':'is-blocked'}"><div class="review-card-heading"><div><span class="eyebrow">${missionName(a.id)} / AMR-0${a.robot+1}</span><h3>Bin ${bins[a.bin].id} <small>${bins[a.bin].name}</small></h3></div><span class="readiness-tag ${a.feasible?'ready':'blocked'}">${a.feasible?'Ready to reserve':'Blocked'}</span></div><div class="review-facts"><div><span>Arrival estimate</span><b>${etaLabel(a.eta)}</b></div><div><span>Battery on return</span><b>${a.returnBattery.toFixed(1)}%</b></div><div><span>Stock on arrival</span><b>${a.stockAtArrival===null?'—':Math.floor(a.stockAtArrival)}<small> units</small></b></div><div><span>Round trip</span><b>${a.trip.metres.toFixed(1)}<small> m</small></b></div></div><p class="review-reason">${!a.feasible?a.reasons.join(' '):a.eta===null?'Approval can reserve this unit, but an earlier aisle reservation is on hold.':a.late?'Stock may run out before arrival. This mission reduces the shortage after delivery.':a.wait>0?'Includes '+etaLabel(a.wait)+' waiting for earlier aisle reservations.':'Unit available; route and return reserve are feasible.'}</p></article>`).join('')||'<p>These missions have already been reviewed.</p>');
  $('confirm-dispatch').disabled=eligible===0;$('confirm-dispatch').textContent='Approve '+eligible+' eligible mission'+(eligible===1?'':'s');
}
function openDispatch(ids=tasks.filter(t=>t.status==='Pending approval').map(t=>t.id)){if(isLiveFloor())return;reviewIds=ids;renderDispatchReview();motion.openDialog($('dispatch-dialog'));}
function renderMissionAssessment(recommend=false){
  const bin=+$('destination').value,ranked=rankUnits(bin,dispatchContext());if(recommend){const best=ranked.find(a=>a.feasible);if(best)$('assignment').value=String(best.robot);}
  const robot=+$('assignment').value,a=assessMission({id:null,bin,robot},dispatchContext()),best=ranked.find(candidate=>candidate.feasible);
  $('create-mission-submit').disabled=tasks.some(t=>t.bin===bin&&OPEN_MISSIONS.includes(t.status));
  setHTML('mission-assessment',`<div class="assessment-title"><span class="readiness-tag ${a.feasible?'ready':'blocked'}">${a.feasible?'Feasible now':'Will need attention'}</span><span>${best?'Recommended: AMR-0'+(best.robot+1):'No unit is currently dispatchable'}</span></div><div class="review-facts"><div><span>Arrival estimate</span><b>${etaLabel(a.eta)}</b></div><div><span>Battery on return</span><b>${a.returnBattery.toFixed(1)}%</b></div></div><p>${a.feasible?'Includes the current queue and the complete return journey.':a.reasons.join(' ')}</p>`);
}
function render(){
  if(!robots)return;
  if(isLiveFloor()){renderHardwareFloor();motion.sync();return;}
  renderBrief();
  const r=robots[selected],activeTask=tasks.find(t=>t.id===r.task),pending=tasks.filter(t=>t.status==='Pending approval').length,active=tasks.filter(t=>t.status==='Active').length,queued=tasks.filter(t=>t.status==='Queued').length;
  setHTML('available',robots.filter(r=>r.state!=='Stopped'&&r.battery>=15).length+' <small>/ 3</small>');
  $('completed').textContent=String(completed).padStart(2,'0');$('fleet-caption').textContent=stopped?'Stop latched':active?active+' on mission':queued?queued+' reserved':'Fleet ready';
  setHTML('health',Math.round(bins.filter(b=>b.stock>=35).length/4*100)+'<small>%</small>');$('clock').textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(Math.floor(elapsed%60)).padStart(2,'0');
  setHTML('run',icon(running?'pause':'play')+(running?'Pause':'Resume'));setHTML('stop',icon(stopped?'play':'stop')+(stopped?'Release stop':'Stop fleet'));$('stop').classList.toggle('latched',stopped);
  $('scene-state').classList.toggle('stopped',stopped);$('scene-state').classList.toggle('paused',!running&&!stopped);
  setHTML('scene-state',`<i style="background:${stopped?'#f0a39c':running?'#cef580':'#e7be7a'}"></i>${stopped?'Fleet stopped':running?'Running':'Paused'}`);
  $('scene-empty').classList.toggle('hidden',!pending||active>0||stopped);
  $('scene-ready-text').textContent=pending+' mission'+(pending===1?'':'s')+' awaiting approval';
  $('demo').disabled=pending===0||stopped;
  $('demo').querySelector('span').textContent=stopped?'Fleet stop is active':pending?'Review '+pending+' mission'+(pending===1?'':'s'):active||queued?'Missions in progress':'All missions reviewed';
  $('demo-caption').textContent=stopped?'Release the stop from the floor controls.':pending?'Check arrival, aisle timing and return reserve.':active?'Select a unit on the floor to inspect its state.':'Create a mission in the Missions view.';
  $('nav-task-count').textContent=String(pending+active+queued).padStart(2,'0');
  $('mission-pending-count').textContent=pending;$('mission-active-count').textContent=active+queued;$('mission-completed-count').textContent=tasks.filter(t=>t.status==='Completed').length;
  $('unit-number').textContent=String(selected+1).padStart(2,'0');document.querySelector('.inspector').dataset.state=r.state;document.querySelector('.inspector').dataset.battery=r.battery<15?'low':'normal';
  renderFleet();document.documentElement.style.setProperty('--unit-color',r.color);document.documentElement.style.setProperty('--unit-ink',unitInks[r.id]);
  $('inspect-title').textContent='AMR-0'+(selected+1);$('inspect-status').textContent=r.state;$('unit-position').textContent=`X ${(r.x/75).toFixed(2)} / Y ${(r.y/75).toFixed(2)} m`;
  setHTML('unit-battery',r.battery.toFixed(0)+'<small>%</small>');$('battery-fill').style.width=r.battery+'%';setHTML('unit-speed',(running?r.velocity:0).toFixed(2)+'<small> m/s</small>');$('unit-distance').textContent=(r.distance/75).toFixed(2)+' m travelled';
  $('unit-mission').textContent=activeTask?missionName(activeTask.id)+' · '+(activeTask.status==='Queued'?'Queued for ':'Delivering to ')+'Bin '+bins[activeTask.bin].id:r.route.length?'Returning to charging bay':'Awaiting assignment';$('unit-progress').textContent=activeTask?Math.floor(activeTask.progress)+'%':'—';
  $('journey-start').textContent=activeTask?.status==='Queued'?'Awaiting aisle':r.task!==null?'Depot':r.route.length?'Current position':'Depot';$('journey-end').textContent=activeTask?'Bin '+bins[activeTask.bin].id:r.route.length?'Charging bay':'Standby';$('journey-progress').style.width=activeTask?activeTask.progress+'%':r.route.length?'100%':'0%';$('journey-progress').classList.toggle('returning',r.task===null&&r.route.length>0);document.querySelector('.inspector').style.setProperty('--journey-position',activeTask?activeTask.progress+'%':r.route.length?'100%':'0%');
  setHTML('unit-pause',icon(r.state==='Paused'?'play':'pause')+(r.state==='Paused'?'Resume unit':'Pause unit'));$('unit-pause').disabled=!r.route.length||r.state==='Stopped';
  const projection=inventoryProjection(dispatchContext(),+$('horizon').value);$('inventory-horizon').textContent=$('horizon').value+' s projection';
  setHTML('bins',bins.map((b,i)=>{const p=projection[i];return `<div data-motion-key="bin-${b.id}" class="bin ${p.stockoutAt!==null||b.stock<35?'low':''}"><div class="bin-head"><span class="bin-letter">${b.id}</span><span class="bin-state">${p.stockoutAt!==null?'Stockout risk':b.stock<35?'Reorder':'Healthy'}</span></div><div class="bin-quantity">${Math.floor(b.stock)}<small>/ 100</small></div><div class="bin-name">${b.name}</div><div class="stock-bar" role="meter" aria-label="Bin ${b.id} stock" aria-valuenow="${Math.floor(b.stock)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${b.stock}%"></i></div><div class="bin-projection"><span>At +${$('horizon').value}s</span><b>${Math.floor(p.projected)} <small>units</small></b></div><small class="bin-arrivals">${p.deliveries?p.deliveries+' approved delivery included':'No approved arrivals in window'}</small></div>`}).join(''));
  renderMissions();setHTML('log',logs.map(l=>`<div data-motion-key="log-${l.id}" class="log-row"><time>${l.time}s</time><span>${l.message}</span></div>`).join(''));
  $('diagnostics').textContent='Browser command handler: '+(lastOverride===null?'not measured':lastOverride.toFixed(3)+' ms')+'. '+(worker?'Forecast round trip: '+snapshotAge.toFixed(1)+' ms.':'Forecast engine unavailable.')+' Physical reliability: not measured.';
  if(activePage==='telemetry')renderEnergy();
  motion.sync();
}
const pages={hardware:{title:'Live hardware',context:'ESP32 fleet connection'},environment:{title:'Warehouse operations',context:'Spatial workspace'},missions:{title:'Mission coordination',context:'Supervised dispatch'},telemetry:{title:'Telemetry & inventory',context:'Operational analysis'},activity:{title:'Operator activity',context:'Session records'}};
function activatePage(name,writeHash=true){
  if(!pages[name])name='environment';activePage=name;document.body.dataset.view=name;
  document.querySelectorAll('[data-screen]').forEach(panel=>panel.hidden=panel.id!==name);
  document.querySelectorAll('[data-page]').forEach(button=>{const on=button.dataset.page===name;button.classList.toggle('active',on);button.setAttribute('aria-selected',on?'true':'false');button.tabIndex=on?0:-1});
  $('page-title').textContent=pages[name].title;$('page-context').textContent=pages[name].context;document.title='Replenish | '+pages[name].title;
  updateSourceUI();render();
  if(writeHash){window.history.replaceState(null,'','#'+name);window.scrollTo(0,0);}
  if(name==='environment')requestAnimationFrame(()=>scene.resize());if(name==='telemetry')requestAnimationFrame(renderEnergy);
  motion.page(name);
}
function forecastUnavailable(){
  predictionBusy=false;worker?.terminate?.();worker=null;
  $('sync').textContent='Forecast engine unavailable';$('alert-count').textContent='—';$('horizon').disabled=true;
  setHTML('alerts','<div class="alert">Forecast unavailable<small>Manual fleet controls remain available. Reload the page to retry the forecast engine.</small></div>');
}
function predict(){if(!worker||predictionBusy)return;predictionBusy=true;try{worker.postMessage({generation,robots,bins,tasks,stopped,horizon:+$('horizon').value,demand,slow,sent:performance.now()})}catch{forecastUnavailable()}}
if(worker){
  worker.onmessage=({data})=>{if(!worker||data.generation!==generation)return;predictionBusy=false;snapshotAge=performance.now()-data.sent;$('sync').textContent='Forecast service · '+snapshotAge.toFixed(0)+' ms browser round trip';lastForecastCount=String(data.alerts.length);lastForecastHTML=data.alerts.length?data.alerts.map(a=>`<div class="alert">${a.title}<small>${a.detail}</small></div>`).join(''):'<div class="alert good">No risks in this horizon<small>Stock and battery stay above limits under current rates.</small></div>';if(!isLiveFloor()){$('alert-count').textContent=lastForecastCount;setHTML('alerts',lastForecastHTML)}};
  worker.onerror=forecastUnavailable;worker.onmessageerror=forecastUnavailable;
}
$('run').onclick=()=>{if(isLiveFloor())return;running=!running;log(running?'Simulation resumed.':'Simulation paused.',true);render()};$('stop').onclick=()=>{if(!isLiveFloor())stopped?resumeFleet():stopFleet()};$('reset').onclick=()=>{if(!isLiveFloor())motion.openDialog($('reset-dialog'))};
$('confirm-reset').onclick=()=>{reset();toast('Session reset. Three missions are ready for approval.')};
const scenarioNotes={normal:'Standard demand and aisle speed. Existing battery levels are retained.',demand:'Shelf consumption increases to three times the standard rate.',battery:'AMR-02 is set to 12% battery. Dispatch requires a 15% reserve after the return journey.',congestion:'Robots slow to 0.11 m/s after entering the aisle.'};
$('scenario').onchange=()=>{$('scenario-description').textContent=scenarioNotes[$('scenario').value]};
$('horizon').oninput=()=>{$('horizon-label').textContent=$('horizon').value+' seconds';$('horizon').setAttribute('aria-valuetext',$('horizon').value+' seconds');$('horizon').style.setProperty('--range-progress',((+$('horizon').value-30)/270*100)+'%');predict()};$('apply').onclick=()=>{const v=$('scenario').value;demand=v==='demand'?3:1;slow=v==='congestion';if(v==='battery')robots[1].battery=12;log('Scenario applied: '+$('scenario').selectedOptions[0].text+'.',true);$('scenario-description').textContent=scenarioNotes[v];render();predict()};
$('robots').onclick=e=>{const s=e.target.closest('[data-select]');if(s){selected=+s.dataset.select;render()}};$('unit-pause').onclick=()=>{if(!isLiveFloor())pauseRobot(selected)};$('unit-focus').onclick=()=>{if(isLiveFloor()&&!hardware.snapshot()[selected].tracked)return;scene.focus();toast('Camera following Robot 0'+(selected+1)+'. Reset view to stop following.');};
$('demo').onclick=()=>openDispatch();
$('close-dispatch').onclick=()=>motion.closeDialog($('dispatch-dialog'));$('cancel-dispatch').onclick=()=>motion.closeDialog($('dispatch-dialog'));
$('confirm-dispatch').onclick=()=>{let count=0;for(const a of reviewDispatch(dispatchContext(),reviewIds)){if(a.feasible&&assign(tasks.find(t=>t.id===a.id)))count++;}if(count){motion.closeDialog($('dispatch-dialog'));toast(count+' mission'+(count===1?'':'s')+' approved. Units reserved in aisle order.');render();predict();}else{renderDispatchReview();toast('Conditions changed. Review the blocked missions.');}};
$('help').onclick=()=>motion.openDialog($('help-dialog'));
$('auto-orbit').onclick=()=>{if(scene.reducedMotion)return;scene.transition=null;scene.autoOrbit=!scene.autoOrbit;scene.follow=false;scene.cameraChanged('custom')};
document.querySelectorAll('[data-page]').forEach(button=>{
  button.addEventListener('click',()=>activatePage(button.dataset.page));
  button.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-page]')],i=tabs.indexOf(button),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)+tabs.length)%tabs.length;tabs[next].focus();activatePage(tabs[next].dataset.page)});
});
function navOrientation(){document.querySelector('.workspace-nav').setAttribute('aria-orientation',window.innerWidth<900?'horizontal':'vertical')}
navOrientation();window.addEventListener('resize',navOrientation);
window.addEventListener('hashchange',()=>activatePage(location.hash.slice(1),false));
$('views').onclick=e=>{const b=e.target.closest('[data-view]');if(b)scene.setView(b.dataset.view)};$('zoom-in').onclick=()=>scene.zoomBy(1.16,true);$('zoom-out').onclick=()=>scene.zoomBy(1/1.16,true);$('home-view').onclick=()=>scene.setView('iso');
for(const layer of ['routes','sensors','ghosts','grid'])$('layer-'+layer).onclick=()=>{if(isLiveFloor()&&layer!=='grid')return;scene.layers[layer]=!scene.layers[layer];$('layer-'+layer).classList.toggle('active',scene.layers[layer]);$('layer-'+layer).setAttribute('aria-pressed',scene.layers[layer]?'true':'false')};
$('expand').onclick=()=>{const panel=document.querySelector('.stage-panel'),expanded=panel.classList.toggle('expanded');document.body.classList.toggle('scene-expanded',expanded);setHTML('expand',icon(expanded?'close':'expand'));$('expand').setAttribute('aria-label',expanded?'Exit expanded view':'Expand warehouse view');scene.resize();motion.expand(panel)};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.stage-panel').classList.contains('expanded'))$('expand').click()});
$('tasks').onclick=e=>{const review=e.target.closest('[data-review]'),cancel=e.target.closest('[data-cancel]');if(review)openDispatch([+review.dataset.review]);if(cancel){cancelTask(tasks.find(t=>t.id===+cancel.dataset.cancel));cancel.blur();}};
$('tasks').onchange=e=>{if(e.target.dataset.reassign){reassign(tasks.find(t=>t.id===+e.target.dataset.reassign),+e.target.value);e.target.blur();render();}};
$('new-task').onclick=()=>{
  $('destination').innerHTML=bins.map((b,i)=>`<option value="${i}">Bin ${b.id} · ${b.name}</option>`).join('');
  const next=bins.map((b,i)=>({i,urgency:b.stock/b.rate})).filter(b=>!tasks.some(t=>t.bin===b.i&&OPEN_MISSIONS.includes(t.status))).sort((a,b)=>a.urgency-b.urgency)[0];
  $('destination').value=String(next?.i??0);$('assignment').innerHTML=robots.map(r=>`<option value="${r.id}">AMR-0${r.id+1}</option>`).join('');$('assignment').value=String(selected);renderMissionAssessment(true);motion.openDialog($('mission-dialog'));
};
$('destination').onchange=()=>renderMissionAssessment(true);$('assignment').onchange=()=>renderMissionAssessment();
$('cancel').onclick=()=>motion.closeDialog($('mission-dialog'));$('close-mission').onclick=()=>motion.closeDialog($('mission-dialog'));
$('mission-form').onsubmit=e=>{e.preventDefault();const t=addTask(+$('destination').value,+$('assignment').value);if(!t){renderMissionAssessment();return;}motion.closeDialog($('mission-dialog'));toast(missionName(t.id)+' created. Review it before dispatch.');activatePage('missions');render();};
function decisionLogCSV(){
  const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
  const rows=[['simulation_seconds','event','project_owner','intended_use','copyright_notice'],...logs.slice().reverse().map(l=>[l.time,l.message,'S L RICHRIS','Purely for educational purposes.','© 2026 S L RICHRIS. All rights reserved.'])];
  return '\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([decisionLogCSV()],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='replenish-educational-decision-log.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Decision log exported with ownership and educational-use notices.')};
function applyTheme(theme,persist=true){
  currentTheme=theme==='bright'?'bright':'dark';
  document.documentElement.dataset.theme=currentTheme;
  $('theme-meta').setAttribute('content',currentTheme==='bright'?'#ffffff':'#0a101b');
  document.querySelectorAll('[data-theme-option]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.themeOption===currentTheme?'true':'false'));
  unitInks.splice(0,3,...(currentTheme==='bright'?['#124fa5','#6541a3','#855306']:colors));
  setHTML('energy-legend',unitInks.map((color,i)=>`<span><i style="background:${color}"></i>AMR-0${i+1}</span>`).join(''));
  scene.setTheme?.(currentTheme);
  if(persist){try{localStorage.setItem('replenish.theme',currentTheme)}catch{}}
  if(robots){render();if(activePage==='environment')scene.draw(sceneState(),performance.now())}
}
document.querySelectorAll('[data-theme-option]').forEach(button=>button.addEventListener('click',()=>applyTheme(button.dataset.themeOption)));
window.addEventListener('storage',event=>{if(event.key==='replenish.theme'&&(event.newValue==='dark'||event.newValue==='bright'))applyTheme(event.newValue,false)});

function isLiveFloor(){return activePage==='environment'&&floorSource==='hardware'}
function liveRobots(){return hardware.snapshot().map((slot,i)=>{const p=slot.data;return{id:i,color:colors[i],x:(p?.pose?.x_m??0)*75,y:(p?.pose?.y_m??0)*75,heading:(p?.pose?.heading_deg??0)*Math.PI/180,battery:p?.battery_pct??null,velocity:p?.speed_mps??0,state:slot.status==='live'?({unknown:'Unmeasured',idle:'Idle',moving:'Moving',paused:'Paused',charging:'Charging',fault:'Fault'})[p.state]:({waiting:'Waiting',stale:'Stale',offline:'Offline'})[slot.status],task:null,route:[],distance:0,tracked:slot.tracked}})}
function sceneState(){return isLiveFloor()?{robots:liveRobots(),bins:bins.map(b=>({...b,stock:0})),selected,running:false,stopped:false,slow:false,live:true}:{robots,bins,selected,running,stopped,slow}}
function updateSourceUI(){
  const live=isLiveFloor();document.body.dataset.source=live?'hardware':'simulation';
  $('source-badge').textContent=activePage==='hardware'||live?'Hardware · read only':'Simulation';
  document.querySelectorAll('[data-floor-source]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.floorSource===floorSource?'true':'false'));
  $('floor-source-note').textContent=live?'Measured poses · illustrative warehouse':'Virtual fleet · supervised simulation';
  for(const id of ['run','stop','reset'])$(id).disabled=live;
  $('horizon').disabled=live||!worker;$('unit-focus').disabled=false;
  for(const layer of ['routes','sensors','ghosts']){const b=$('layer-'+layer);b.disabled=live;b.classList.toggle('active',!live&&scene.layers[layer]);b.setAttribute('aria-pressed',!live&&scene.layers[layer]?'true':'false')}
  $('unit-class').textContent=live?'ESP32 · measured telemetry':'Autonomous mobile robot';
  $('unit-secondary-label').textContent=live?'Last capture':'Distance';
  $('outlook-eyebrow').textContent=live?'Hardware link':'Predictive advisory';
  $('outlook-title').textContent=live?'Connection health':'Predictive outlook';
  $('advisory-note').textContent=live?'Read-only telemetry. Motor control and emergency stops remain onboard.':'Advisory only. Every assignment needs your approval.';
  if(!live){$('alert-count').textContent=worker?lastForecastCount:'—';if(lastForecastHTML)setHTML('alerts',lastForecastHTML);if(!worker)forecastUnavailable()}
}
function setFloorSource(source){floorSource=source==='hardware'?'hardware':'simulation';scene.follow=false;updateSourceUI();render()}
function renderHardwareFloor(){
  const slots=hardware.snapshot(),display=liveRobots(),slot=slots[selected],r=display[selected],p=slot.data,live=slots.filter(s=>s.status==='live').length,tracked=slots.filter(s=>s.tracked).length;
  $('brief-eyebrow').textContent='Measured fleet';$('brief-title').textContent=live+' of 3 streams live';$('brief-note').textContent=tracked+' measured poses available on the floor';
  $('brief-label-a').textContent='Viewer connection';$('brief-value-a').textContent=({connected:'Subscribed',loading:'Preparing',connecting:'Connecting',reconnecting:'Reconnecting',error:'Connection failed',disconnected:'Disconnected'})[hardware.state];$('brief-detail-a').textContent='Read-only broker access';
  $('brief-label-b').textContent='Selected capture';$('brief-value-b').textContent=slot.age===null?'—':(slot.age/1000).toFixed(1)+' s';$('brief-detail-b').textContent='AMR-0'+(selected+1)+' · '+slot.status;
  $('brief-label-c').textContent='Reported measurements';$('brief-value-c').textContent=Object.values(slot.measurements).filter(Boolean).length+' / 4';$('brief-detail-c').textContent='Pose · battery · speed · state';$('operation-brief').dataset.tone=live===3?'ready':'warning';
  renderFleet(display);document.documentElement.style.setProperty('--unit-color',r.color);document.documentElement.style.setProperty('--unit-ink',unitInks[selected]);
  $('unit-number').textContent=String(selected+1).padStart(2,'0');$('inspect-title').textContent='AMR-0'+(selected+1);$('inspect-status').textContent=r.state;
  document.querySelector('.inspector').dataset.state=r.state;document.querySelector('.inspector').dataset.battery=p?.battery_pct!==null&&p?.battery_pct<15?'low':'normal';
  $('unit-position').textContent=p?.pose?`${slot.tracked?'':'Last: '}X ${p.pose.x_m.toFixed(2)} / Y ${p.pose.y_m.toFixed(2)} m`:'Not measured';
  setHTML('unit-battery',r.battery===null?'—':r.battery.toFixed(0)+'<small>%</small>');$('battery-fill').style.width=(r.battery??0)+'%';
  setHTML('unit-speed',p?.speed_mps==null?'—':p.speed_mps.toFixed(2)+'<small> m/s</small>');
  $('unit-distance').textContent=slot.age===null?'No packets':(slot.age/1000).toFixed(1)+' s ago';$('unit-pause').disabled=true;$('unit-focus').disabled=!slot.tracked;
  $('scene-state').classList.remove('stopped');$('scene-state').classList.toggle('paused',live===0);setHTML('scene-state',`<i></i>${live} / 3 live`);
  $('scene-empty').classList.toggle('hidden',tracked>0);$('scene-ready-text').textContent=live?'Devices online. Waiting for measured positions.':'Connect your ESP32 slots in Hardware.';
  $('alert-count').textContent=String(slots.filter(s=>s.status==='stale'||s.status==='offline').length);
  const note=slot.status==='live'?(p.state==='fault'?'Device reports a fault':p.battery_pct!==null&&p.battery_pct<15?'Battery below 15%':slot.tracked?'Receiving measured position':'Waiting for localization'):slot.status==='stale'?'Telemetry is stale':slot.status==='waiting'?'Waiting for device packets':'Device is offline';
  const detail=slot.status==='live'?'Latest device capture '+(slot.age/1000).toFixed(1)+' s ago. '+(slot.tracked?'Position shown in the reference warehouse.':'The ESP32 must report X, Y and heading to appear on the floor.'):'Last reported values may be shown in the inspector. Untracked AMRs are hidden from the floor.';
  setHTML('alerts',`<div class="alert ${slot.status==='live'&&p.state!=='fault'&&!(p.battery_pct!==null&&p.battery_pct<15)?'good':''}">${note}<small>${detail}</small></div>`);
}
const hardware=createHardwareWorkspace({onChange:()=>{if(robots)render()},onView:id=>{selected=id;floorSource='hardware';scene.follow=false;activatePage('environment');render()}});
document.querySelectorAll('[data-floor-source]').forEach(b=>b.addEventListener('click',()=>setFloorSource(b.dataset.floorSource)));

applyTheme(currentTheme,false);
let last=performance.now(),lastUI=0,lastForecast=0,lastScene=0;function frame(now){const dt=Math.min((now-last)/1000,.1);last=now;if(running&&!document.hidden&&!isLiveFloor()&&activePage!=='hardware')step(dt*+$('speed').value);if(!document.hidden&&activePage==='environment'&&now-lastScene>1000/(scene.width<600?30:50)){scene.draw(sceneState(),now);lastScene=now;}if(now-lastUI>180){render();lastUI=now}if(now-lastForecast>1000){predict();lastForecast=now}requestAnimationFrame(frame)}reset();activatePage(location.hash.slice(1),false);requestAnimationFrame(frame);
