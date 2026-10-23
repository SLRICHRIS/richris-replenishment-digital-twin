'use strict';
const $ = id => document.getElementById(id);
const safe = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cached = null, graph = null, websocket = null;
async function api(path, options={}) {const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});let value;try{value=await response.json()}catch(_){throw Error('Server returned a non-JSON response')}if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:JSON.stringify(value.detail||value));return value}
function alertText(message){let el=$('message');el.textContent=message;el.classList.add('visible');setTimeout(()=>{if(el.textContent===message)el.classList.remove('visible')},8500)}
function callButton(id, fun){$(id).addEventListener('click',async()=>{const btn=$(id);btn.disabled=true;try{await fun()}catch(err){alertText(err.message)}finally{btn.disabled=false}})}
const req=(method,body)=>({method,body:JSON.stringify(body)});
function number(v, fallback='—'){return v==null?fallback:String(v)}
async function refresh(){try{let [view,logs,tele]=await Promise.all([api('/api/state'),api('/api/events?limit=300'),api('/api/telemetry?limit=4')]);cached=view;render(view,logs.events,tele.observations);$('connected').textContent='API connected';}catch(err){$('connected').textContent='API unavailable';alertText(err.message)}}
function render(view,events,observations){let s=view.state,m=view.metrics;
  $('clock').textContent=`t = ${Number(s.time).toFixed(1)} s · revision ${view.revision}`;
  const tiles=[['Simulation time',Number(s.time).toFixed(1)+' s'],['Demand fulfilled',`${m.fulfilled} / ${m.requested}`],['Fill rate',m.fill_rate_pct==null?'Not yet':m.fill_rate_pct+'%'],['Units unmet',m.unmet],['Tasks completed',m.tasks_completed]];
  $('metrics').innerHTML=tiles.map(t=>`<div class="metric"><b>${safe(t[1])}</b><span>${safe(t[0])}</span></div>`).join('');
  $('robot').innerHTML=`<strong>SIM-01: ${safe(s.robot.status.toUpperCase())}</strong><span>At node ${safe(s.robot.node)}</span><span>${safe(s.robot.task_id||'No active task')}</span><span>Policy: ${safe(s.policy.toUpperCase())}</span>`;
  $('inventory').innerHTML=Object.entries(s.inventory).map(([sku,row])=>`<tr><td><b>${safe(sku)}</b></td><td class="num">${row.reserve}</td><td class="num">${row.reserved}</td><td class="num">${row.transit}</td><td class="num">${row.pick}</td></tr>`).join('');
  $('measuredTask').innerHTML=Object.values(s.tasks).filter(t=>t.status==='completed').map(t=>`<option value="${safe(t.id)}">${safe(t.id)} · ${safe(t.sku)}</option>`).join('')||'<option value="">No completed task</option>';
  $('tasks').innerHTML=Object.values(s.tasks).map(t=>`<tr><td>${safe(t.id)}<div class="footnote">${safe(t.sku)}</div></td><td>${t.quantity}</td><td>${safe(t.status.replaceAll('_',' '))}</td><td>${safe(t.location)}</td></tr>`).join('');
  $('eventCount').textContent=`${events.length} shown`;
  $('eventRows').innerHTML=events.map(e=>`<tr><td>${e.seq}</td><td>${Number(e.time).toFixed(1)} s</td><td><b>${safe(e.kind.replaceAll('_',' '))}</b></td><td>${safe(e.message)}</td></tr>`).join('')||'<tr><td colspan="4">No events yet</td></tr>';
  $('conservation').innerHTML=view.conservation.map(c=>`<div class="validation-row"><span><strong>${safe(c.sku)}</strong> · expected ${c.expected} units, observed ${c.observed}</span><span class="result-tag">${c.valid?'PASS':'FAIL'}</span></div>`).join('');
  $('telemetry').innerHTML=observations.length?`<table><thead><tr><th>Device</th><th>Sequence</th><th>Status</th></tr></thead><tbody>${observations.map(o=>`<tr><td>${safe(o.device_id)}</td><td>${o.seq}</td><td>${safe(o.disposition)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">No physical telemetry received.</p>';
  if(graph)drawGraph(s)
}
function drawGraph(s){const width=940,height=510, pts={};for(const [node,p] of Object.entries(graph.nodes))pts[node]={x:p[0]*87+24,y:(7-p[1])*69+8};
  let activeEdges=new Set();const activeTask=Object.values(s.tasks).find(x=>['assigned','in_transit'].includes(x.status));if(activeTask){const path=(activeTask.status==='assigned'?activeTask.route_to_reserve:activeTask.route_to_pick);for(let i=0;i<path.length-1;i++)activeEdges.add([path[i],path[i+1]].sort().join(':'));}
  const blocked=new Set(s.blocked);let parts=[];
  for(const [u,v] of graph.edges){let a=pts[u],b=pts[v],key=[u,v].sort().join(':');parts.push(`<line class="map-line ${activeEdges.has(key)?'active':''} ${blocked.has(u)||blocked.has(v)?'blocked':''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`)}
  for(const [node,p] of Object.entries(pts)){const active=node===s.robot.node, b=blocked.has(node);parts.push(`<g class="map-node ${active?'active':''} ${b?'blocked':''}"><circle cx="${p.x}" cy="${p.y}" r="22"/><text x="${p.x}" y="${p.y}">${safe(node)}</text><text class="map-subtitle" x="${p.x}" y="${p.y+37}">${active?'ROBOT':b?'BLOCKED':node==='R'?'RESERVE':node.startsWith('P')?'PICKING':''}</text></g>`)}
  $('map').innerHTML=parts.join('');
}
async function configure(){graph=await api('/api/architecture');$('reset').addEventListener('click',async()=>{const body={policy:$('policy').value,blocked:$('blocked').value?[$('blocked').value]:[],speed_units_per_second:Number($('modelSpeed').value),load_seconds:Number($('modelLoad').value),unload_seconds:Number($('modelUnload').value)};await api('/api/reset',req('POST',body));$('compareResults').innerHTML='<p>Reset completed. Run a new comparison for the current conditions.</p>';await refresh()});
 callButton('step',async()=>{await api('/api/step',{method:'POST'});await refresh()});
 callButton('run',async()=>{const until=Number($('until').value);await api('/api/run',req('POST',{until}));await refresh()});
 callButton('saveMeasurement',async()=>{let task_id=$('measuredTask').value;if(!task_id)throw Error('Finish a task before recording an observation');await api('/api/measurements',req('POST',{task_id,observed_seconds:Number($('observedTime').value),source:$('measurementSource').value}));await measurementReport()});
 callButton('refreshMeasurement',measurementReport);
 callButton('compare',async()=>{const until=Number($('until').value);const comparison=await api('/api/compare',req('POST',{until}));renderComparison(comparison)});
 await refresh();await measurementReport();connectSocket();}
function renderComparison(c){const names=['fifo','urgency'];const p=c.policies;
const rows=[['Requested units','requested'],['Fulfilled units','fulfilled'],['Unmet units','unmet'],['Fill rate (%)','fill_rate_pct'],['Completed tasks','tasks_completed'],['Mean task time (s)','mean_task_duration_seconds'],['Total stockout time (s)','stockout_seconds_total']];
$('compareResults').innerHTML=`<table class="comparison-table"><thead><tr><th>Metric</th><th>FIFO</th><th>Urgency</th></tr></thead><tbody>${rows.map(([name,key])=>`<tr><td>${safe(name)}</td><td>${safe(number(p.fifo.metrics[key]))}</td><td>${safe(number(p.urgency.metrics[key]))}</td></tr>`).join('')}</tbody></table><p class="result-note"><b>Matched external demand:</b> yes. <b>Route restriction:</b> ${safe(c.blocked.join(', ')||'none')}. <b>Horizon:</b> ${c.until} s. Both are independent model runs.</p><p class="disclaimer">${safe(c.warning)}</p>`;
}
function connectSocket(){const scheme=location.protocol==='https:'?'wss':'ws';try{websocket=new WebSocket(`${scheme}://${location.host}/ws/events`);websocket.onmessage=event=>{try{const data=JSON.parse(event.data);if(data.type==='state_changed')refresh()}catch(_){}};websocket.onclose=()=>{$('connected').textContent='Polling API';setInterval(refresh,5000)}}catch(_){setInterval(refresh,5000)}}
window.addEventListener('load',()=>{configure().catch(err=>alertText(err.message))});

async function measurementReport(){const data=await api('/api/measurements');$('measurementReport').innerHTML=data.count?`<p><strong>${data.count} observations</strong> · MAE ${data.mae_seconds} s · RMSE ${data.rmse_seconds} s</p><table><thead><tr><th>Task</th><th>Simulated (s)</th><th>Observed (s)</th><th>Absolute error (s)</th><th>Source</th></tr></thead><tbody>${data.pairs.map(p=>`<tr><td>${safe(p.task_id)}</td><td>${p.simulated_seconds}</td><td>${p.observed_seconds}</td><td>${p.absolute_error_seconds}</td><td>${safe(p.source)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">No external duration observations for this run.</p>'}
