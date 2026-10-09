import assert from 'node:assert/strict';
import { routeTo, routeStats, tripFor, homeFor, assessMission, reviewDispatch, inventoryProjection } from '../digital_twin_application/mission_scheduling_and_routes.js';
const make = () => ({
  robots: [0,1,2].map(id=>({id,x:120,y:170+id*80,battery:96-id*9,state:'Idle',task:null,route:[]})),
  bins: [{id:'A',x:420,y:150,stock:64,rate:.09},{id:'B',x:710,y:150,stock:48,rate:.13},{id:'C',x:420,y:350,stock:77,rate:.07},{id:'D',x:710,y:350,stock:39,rate:.11}],
  tasks: [{id:1,robot:0,bin:3,status:'Pending approval'},{id:2,robot:1,bin:1,status:'Pending approval'},{id:3,robot:2,bin:0,status:'Pending approval'}], demand:1,slow:false,stopped:false,running:true
});
let c=make(),r=c.robots[0],b=c.bins[3];
assert.deepEqual(routeTo(r,b)[0],{x:220,y:170});
assert.deepEqual(routeTo(b,homeFor(r)).at(-2),{x:220,y:170});
assert(Number.isFinite(tripFor(homeFor(r),b).seconds));
assert(tripFor(r,b,true).seconds>tripFor(r,b,false).seconds*2);
const original=JSON.stringify(c),plan=reviewDispatch(c,[1,2,3]);assert.equal(JSON.stringify(c),original);
assert.equal(plan.filter(a=>a.feasible).length,3);assert(plan.every(a=>Number.isFinite(a.eta)&&Number.isFinite(a.returnBattery)));
assert.equal(plan[1].wait,plan[0].trip.seconds);assert.equal(plan[2].wait,plan[0].trip.seconds+plan[1].trip.seconds);
c.robots[0].battery=16;assert.equal(assessMission(c.tasks[0],c).feasible,false);assert(assessMission(c.tasks[0],c).reasons.some(s=>s.includes('reserve')));
c=make();c.tasks[1].robot=0;assert.equal(reviewDispatch(c,[1,2]).filter(a=>a.feasible).length,1);
c=make();assert.equal(assessMission({id:null,robot:0,bin:3},c).feasible,false);
c=make();c.stopped=true;assert.equal(reviewDispatch(c,[1,2,3]).filter(a=>a.feasible).length,0);
c=make();c.robots[0].route=routeTo(c.bins[3],homeFor(c.robots[0]));c.robots[0].state='Returning';assert.equal(assessMission(c.tasks[0],c).feasible,false);
c=make();c.tasks[0].status='Active';c.robots[0].task=1;c.robots[0].state='Delivering';c.robots[0].route=routeTo(c.robots[0],c.bins[3]);
let p=inventoryProjection(c,30);assert.equal(p[3].deliveries,1);assert(Math.abs(p[3].projected-(39+30-.11*30))<1e-8);assert.equal(p[1].deliveries,0);
c.tasks[1].status='Queued';c.tasks[1].approvedOrder=2;c.robots[1].task=2;c.robots[1].state='Queued';
assert(assessMission(c.tasks[1],c).eta>40);
c.robots[0].state='Paused';assert.equal(assessMission(c.tasks[1],c).eta,null);assert(inventoryProjection(c,120).every(p=>p.deliveries===0));
c=make();c.bins[0].stock=2;c.demand=3;p=inventoryProjection(c,120);assert(Math.abs(p[0].stockoutAt-2/(.09*3))<1e-8);
console.log('PASS: staged routes, full-trip energy, shared-aisle timing, duplicate/reservation gates, stopped and paused queues, and approved-delivery inventory projection.');
const {projectMotion}=await import('../digital_twin_application/mission_scheduling_and_routes.js');
const boundaryRobot={id:0,x:290,y:250,heading:0,battery:100,route:[{x:710,y:250}]};
const ghost=projectMotion(boundaryRobot,5,true);
assert(Math.abs(ghost.x-(300+(5-10/38)*8))<1e-8);
const crossingBack=projectMotion({...boundaryRobot,x:310,route:[{x:220,y:250}]},2,true);
assert(Math.abs(crossingBack.x-(300-(2-10/8)*38))<1e-8);
console.log('PASS: five-second projection integrates both directions across the restricted-speed boundary.');
let forecast;
globalThis.self={postMessage:message=>{forecast=message;}};
await import('../digital_twin_application/stock_and_battery_forecast.js');
c=make();c.bins[0].stock=2;self.onmessage({data:{...c,horizon:120,generation:4,sent:100}});assert.equal(forecast.generation,4);assert(forecast.alerts.some(a=>a.title.includes('Stockout forecast · Bin A')));
c=make();c.tasks[0].status='Active';c.robots[0].task=1;c.robots[0].state='Paused';c.robots[0].route=routeTo(c.robots[0],c.bins[3]);self.onmessage({data:{...c,horizon:120,generation:5,sent:101}});assert(forecast.alerts.some(a=>a.title==='Aisle reservation held'));delete globalThis.self;
console.log('PASS: module-worker forecast preserves request identity and reports stockouts and paused aisle reservations.');
