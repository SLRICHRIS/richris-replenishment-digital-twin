// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
import { MODEL, inventoryProjection, routeStats, routeTo, homeFor, aisleOwner, queueTimeline, assessMission } from '../robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';
self.onmessage = ({ data: d }) => {
  const alerts = [];
  const context = { ...d, tasks: d.tasks || [] };
  const projection = inventoryProjection(context, d.horizon);
  projection.forEach((p, i) => {
    if (p.stockoutAt !== null) alerts.push({ title: 'Stockout forecast · Bin ' + p.id, detail: 'In approximately ' + Math.round(p.stockoutAt) + ' simulation seconds. ' + p.deliveries + ' feasible approved arrivals included in this window.' });
    else if (p.projected < 35) alerts.push({ title: 'Reorder outlook · Bin ' + p.id, detail: Math.floor(d.bins[i].stock) + ' units now; approximately ' + Math.floor(p.projected) + ' at +' + d.horizon + 's with the approved queue.' });
  });
  const schedule=queueTimeline(context);
  d.robots.forEach(r => {
    const queued=context.tasks.find(t=>t.id===r.task&&t.status==='Queued'),entry=schedule.entries.find(e=>e.id===queued?.id);
    if(queued){if(entry?.chargeWait>0)alerts.push({title:'Charging wait · AMR-0'+(r.id+1),detail:'Approximately '+Math.ceil(entry.chargeWait)+' s of additional bay charging before dispatch. The approved route and '+MODEL.reserve+'% return reserve are retained.'});return;}
    const task = context.tasks.find(t => t.id === r.task && t.status === 'Active');
    let motion = routeStats(r, r.route, d.slow).seconds;
    if(task)try{motion+=routeStats(d.bins[task.bin],task.journey?.inbound.points||routeTo(d.bins[task.bin],homeFor(r),d.slow,d.routing),d.slow).seconds;}catch{alerts.push({title:'Return route unavailable',detail:'The complete approved journey cannot be estimated.'});return;}
    const reserve = r.battery - motion * MODEL.drain;
    if (reserve < MODEL.reserve) alerts.push({ title: 'Return reserve · AMR-0' + (r.id + 1), detail: reserve.toFixed(1) + '% projected on return; ' + MODEL.reserve + '% required for new dispatch. No idle battery drain is assumed.' });
  });
  const owner = aisleOwner(d.robots), queued = context.tasks.filter(t => t.status === 'Queued').sort((a,b)=>a.approvedOrder-b.approvedOrder||a.id-b.id);
  if (owner && ['Paused', 'Stopped'].includes(owner.state)) alerts.push({ title: 'Aisle reservation held', detail: 'AMR-0' + (owner.id + 1) + ' is ' + owner.state.toLowerCase() + '. ' + queued.length + ' approved missions cannot enter the shared aisle.' });
  else if (queued[0]) { const a = assessMission(queued[0], context); if (!a.feasible) alerts.push({ title: 'Approved queue on hold', detail: a.reasons.join(' ') }); }
  if (d.slow) alerts.push({ title: 'Reduced aisle speed', detail: 'Arrival and battery estimates include the 0.11 m/s restricted area. Queue order is retained.' });
  self.postMessage({ generation: d.generation, sent: d.sent, alerts });
};
