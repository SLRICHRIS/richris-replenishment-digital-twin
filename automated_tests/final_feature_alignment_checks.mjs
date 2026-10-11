// Cross-feature contracts found during the final audit. No hardware or browser claims.
import assert from 'node:assert/strict';
import { MODEL, homeFor, tripFor, assessMission, ROUTE_CONDITIONS } from '../digital_twin_application/mission_scheduling_and_routes.js';
import { BIN_DESTINATIONS } from '../digital_twin_application/warehouse_racks_and_aisle_layout.js';
import { TwinEngine, defaultProfile, referenceRecording, fitCalibration, parseRecording, replayRecording,decodeInventory } from '../digital_twin_application/robot_state_estimation_and_calibration.js';
import { observedDemand } from '../digital_twin_application/twin_model_validation_workspace.js';
import { comparePolicies } from '../digital_twin_application/paired_dispatch_policy_experiments.js';

let reassignments=0;
for(const slow of [false,true])for(const objective of ['distance','time'])for(const blockedEdges of [ROUTE_CONDITIONS.open,ROUTE_CONDITIONS.north,ROUTE_CONDITIONS.central])for(let from=0;from<3;from++)for(let to=0;to<3;to++)if(from!==to)for(let bin=0;bin<4;bin++){
  const robots=[0,1,2].map(id=>({id,...homeFor({id}),battery:95,state:'Idle',task:null,route:[]}));
  const task={id:1,robot:from,bin,status:'Queued',approvedOrder:1};
  const c={robots,bins:structuredClone(BIN_DESTINATIONS),tasks:[task],demand:1,slow,stopped:false,routing:{objective,blockedEdges:[...blockedEdges]}};
  task.journey=tripFor(robots[from],c.bins[bin],slow,c.routing);robots[from].task=1;robots[from].state='Queued';
  const own=tripFor(robots[to],c.bins[bin],slow,c.routing),before=JSON.stringify(task.journey);
  robots[to].battery=MODEL.reserve+own.seconds*MODEL.drain+1e-7;
  const a=assessMission({...task,robot:to},c);
  assert(a.feasible,a.reasons.join(' '));assert.equal(a.trip.inbound.nodes.at(-1).id,'bay0'+(to+1));
  assert.deepEqual(a.trip.outbound.nodes,own.outbound.nodes);assert.deepEqual(a.trip.inbound.nodes,own.inbound.nodes);
  assert(Math.abs(a.trip.metres-own.metres)<1e-9);assert(Math.abs(a.trip.seconds-own.seconds)<1e-9);
  assert.equal(JSON.stringify(task.journey),before,'Candidate checks must preserve the old approval');reassignments++;
}

const now=1760000000000;
const inv=(seq,count,frame='warehouse-01',source='camera')=>({v:1,source_id:source,frame_id:frame,boot_id:'abcdef0012345678',seq,sent_at_ms:now+seq*1000,bins:[{id:'A',count}]});
const e=new TwinEngine();
e.ingestInventory(inv(0,80,'other-map'),now+20,1000);
assert(!e.inventorySnapshot(now+20,true,1000)[0].fresh,'A wrong-frame count cannot supply the floor or evidence gates');
assert(!e.inventorySnapshot(now+20,true,1000)[0].frameMatch);
e.ingestInventory(inv(1,79),now+1020,2000);
assert(e.inventorySnapshot(now+1020,true,2000)[0].fresh);
assert(!e.inventorySnapshot(now+7020,true,8000)[0].fresh);
assert(!e.inventorySnapshot(now+2000,true,9000)[0].fresh,'Wall-clock reversal cannot revive stale stock');
e.setProfile(0,{poseSigmaM:.04});
assert(!e.inventorySnapshot(now+2000,true,9000)[0].fresh,'Rebuilding an observer retains inventory monotonic timing');
e.ingestInventory(inv(0,3,'warehouse-01','delayed-camera'),now+2000,10000);
assert.equal(e.inventory.get('A').count,79,'An older source cannot overwrite the latest bin observation');
e.ingestInventory(inv(2,0),now+2020,10020);
assert.equal(e.inventorySnapshot(now+2020,true,10020)[0].count,0,'Measured zero remains valid');
assert(!e.inventorySnapshot(now+2020,false,10020)[0].fresh);
const restored=replayRecording(parseRecording(JSON.stringify(e.evidence())));
assert.equal(restored.inventory.get('A').count,0);assert(restored.inventorySnapshot(now+2020)[0].fresh);
assert.throws(()=>decodeInventory(JSON.stringify({...inv(2,0),boot_id:12345678}),now+2020),/schema/);
const simultaneous=new TwinEngine();simultaneous.ingestInventory(inv(0,80),now+20,1000);
assert(simultaneous.ingestInventory({...inv(0,80),seq:1,bins:[{id:'B',count:42}]},now+20,1000),'Distinct partial bins may share one acquisition timestamp');
assert.equal(simultaneous.inventorySnapshot(now+20,true,1000)[1].count,42);
assert(simultaneous.ingestInventory({...inv(0,79),seq:2},now+20,7000));
assert(!simultaneous.inventorySnapshot(now+20,true,7000)[0].fresh,'A repeated capture timestamp cannot renew its monotonic age');

const demandEngine=new TwinEngine();
for(let i=0;i<=30;i++)demandEngine.ingestInventory(inv(i,90-i),now+i*1000,1000+i*1000);
assert.equal(observedDemand(demandEngine)[0].rate,1);
demandEngine.ingestInventory(inv(31,50,'other-map'),now+31000,32000);
assert(!demandEngine.inventorySnapshot(now+31000,true,32000)[0].fresh);
assert.equal(observedDemand(demandEngine)[0].duration,30,'Wrong-frame observations cannot enter demand fitting');
demandEngine.ingestInventory(inv(32,49,'warehouse-01','replacement-camera'),now+32000,33000);
assert.equal(observedDemand(demandEngine)[0].rate,null,'A new inventory source needs its own consumption evidence');

const narrow={...defaultProfile('amr-01'),cruiseMps:.24,maxSpeedMps:.25},before=JSON.stringify(narrow);
const blockedFit=fitCalibration(referenceRecording().events,'amr-01',narrow);
assert(!blockedFit.ready);assert.match(blockedFit.reason,/maximum physical speed/i);assert.equal(JSON.stringify(narrow),before);
const allowedFit=fitCalibration(referenceRecording().events,'amr-01',defaultProfile('amr-01'));assert(allowedFit.ready&&allowedFit.passes);
const docked={provenance:'simulation',units:[0,1,2].map(id=>({id:'amr-0'+(id+1),x_m:homeFor({id}).x/MODEL.scale,y_m:homeFor({id}).y/MODEL.scale,battery_pct:90,state:'idle',profile:defaultProfile('amr-0'+(id+1))})),bins:BIN_DESTINATIONS.map(b=>({id:b.id,count:b.stock,rate:b.rate,x_m:b.x/MODEL.scale,y_m:b.y/MODEL.scale}))};
const options={policy:'urgency',horizonS:120,demandMultiplier:3,speedFactor:1},nearby=structuredClone(docked);nearby.units.forEach(u=>u.x_m+=.1);
assert.deepEqual(comparePolicies(nearby,options).baseline,comparePolicies(docked,options).baseline,'Dock noise must not invent cross-graph travel or bias unit ranking');
const uncertain=structuredClone(docked);uncertain.units[0].profile.poseSigmaM=1;uncertain.units[0].x_m=5;
assert.throws(()=>comparePolicies(uncertain,options),/0.25 m/,'Large configured noise cannot admit an off-bay asset');
console.log(`PASS: ${reassignments} reassignment configurations use the new unit's own outbound/return geometry and reserve; frame/monotonic/source-consistent stock and demand; deterministic inventory replay; unapplyable speed fits withheld; bounded graph-only docked experiments.`);
