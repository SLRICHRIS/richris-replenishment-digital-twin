// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Deterministic educational dispatch model. Never sends commands to hardware.
import { referenceFacility, graphRouteFromPose, edgeSegments, checkedRouting } from '../shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';
export const MODEL = Object.freeze({ scale: 75, depotX: 120, stagingX: 220, aisleY: 250,
  speed: 38, congestedSpeed: 8, drain: .06, charge: .16, reserve: 15, load: 30, capacity: 100 });
export const OPEN_MISSIONS = ['Pending approval', 'Queued', 'Active'];
export const homeFor = robot => ({ id: robot.id, x: MODEL.depotX, y: 170 + robot.id * 80 });

export const ROUTE_CONDITIONS=Object.freeze({open:[],north:['lane00~lane10'],central:['lane10~lane11'],entry:['entry~lane10']});
const routeFacility=referenceFacility(),graphPaths=new Map();
export const routingSignature=(options={})=>JSON.stringify(checkedRouting(routeFacility,options));
export const atHome=robot=>Number.isFinite(robot?.x)&&Number.isFinite(robot?.y)&&Math.hypot(robot.x-homeFor(robot).x,robot.y-homeFor(robot).y)<.01;
export function routePlan(from,to,slow=false,options={}){
  const target=routeFacility.nodes.find(n=>Math.hypot(n.x_m*MODEL.scale-to.x,n.y_m*MODEL.scale-to.y)<.01);
  if(!target)throw Error('Destination is not on the reference route network.');
  const key=from.x+'/'+from.y+'/'+target.id+'/'+Boolean(slow)+'/'+routingSignature(options);
  if(!graphPaths.has(key)){
    const result=graphRouteFromPose(routeFacility,{x_m:from.x/MODEL.scale,y_m:from.y/MODEL.scale},target.id,MODEL.speed/MODEL.scale,slow?MODEL.congestedSpeed/MODEL.speed:1,options);
    let previous=from;
    const points=result.nodes.map(n=>({x:n.x_m*MODEL.scale,y:n.y_m*MODEL.scale})).filter(p=>{const different=Math.hypot(p.x-previous.x,p.y-previous.y)>.001;previous=p;return different;});
    graphPaths.set(key,{...result,points,distance:result.metres*MODEL.scale});
    if(graphPaths.size>256)graphPaths.delete(graphPaths.keys().next().value);
  }
  const plan=graphPaths.get(key);return{...plan,points:plan.points.map(p=>({...p}))};
}
export const routeTo=(from,to,slow=false,options={})=>routePlan(from,to,slow,options).points;

export function routeStats(from, route, slow = false) {
  let previous = from, distance = 0, seconds = 0;
  for (const point of route) {
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    seconds += edgeSegments({x_m:previous.x/MODEL.scale,y_m:previous.y/MODEL.scale},{x_m:point.x/MODEL.scale,y_m:point.y/MODEL.scale},MODEL.speed/MODEL.scale,routeFacility.slowBoundaryXM,slow?MODEL.congestedSpeed/MODEL.speed:1).reduce((s,p)=>s+p.seconds,0);
    distance += length; previous = point;
  }
  return { distance, metres: distance / MODEL.scale, seconds };
}

export function tripFor(robot,bin,slow=false,options={},journey=null){
  const outboundPlan=journey?.outbound||routePlan(robot,bin,slow,options),inboundPlan=journey?.inbound||routePlan(bin,homeFor(robot),slow,options);
  const outbound={...outboundPlan,...routeStats(robot,outboundPlan.points,slow)},inbound={...inboundPlan,...routeStats(bin,inboundPlan.points,slow)};
  return{objective:journey?.objective||options.objective||'distance',signature:journey?.signature||routingSignature(options),outbound,inbound,seconds:outbound.seconds+inbound.seconds,metres:outbound.metres+inbound.metres};
}

export function advanceMotion(robot, seconds, slow = false) {
  let x = robot.x, y = robot.y, heading = robot.heading || 0;
  const budget=Math.min(Math.max(0,seconds),Number.isFinite(robot.battery)?Math.max(0,robot.battery)/MODEL.drain:Math.max(0,seconds));
  let remaining=budget,distance=0,index=0;
  for (const destination of robot.route) {
    const points = [];
    if (slow && (x < 300 && destination.x > 300 || x > 300 && destination.x < 300)) {
      points.push({ x: 300, y: y + (destination.y - y) * (300 - x) / (destination.x - x) });
    }
    points.push(destination);
    for (const point of points) {
      const dx = point.x - x, dy = point.y - y, length = Math.hypot(dx, dy);
      if (length < .00001) continue;
      const speed = slow && (x + point.x) / 2 > 300 ? MODEL.congestedSpeed : MODEL.speed;
      const travel = Math.min(length, remaining * speed);
      if (travel > 0) heading = Math.atan2(dy, dx);
      x += dx / length * travel; y += dy / length * travel; remaining -= travel / speed;distance+=travel;
      if(travel<length-1e-8)return{x,y,heading,distance,usedSeconds:budget-remaining,route:robot.route.slice(index).map(p=>({...p}))};
    }
    x=destination.x;y=destination.y;index++;
  }
  return{x,y,heading,distance,usedSeconds:budget-remaining,route:[]};
}
export function projectMotion(robot,seconds,slow=false){const{x,y,heading}=advanceMotion(robot,seconds,slow);return{x,y,heading};}

export const aisleOwner = robots => robots.find(robot => robot.route.length > 0) || null;

function missionCheck(task,context){
  const robot=context.robots[task.robot],bin=context.bins[task.bin],reasons=[];
  if(!robot||!bin)return{robot,bin,reasons:['Choose a valid unit and destination.'],trip:null};
  if(!Number.isFinite(robot.battery)||robot.battery<0||robot.battery>100)reasons.push('A valid battery reading is required.');
  if(!atHome(robot)||robot.route.length)reasons.push('This unit must return to its own loading bay first.');
  if(robot.task!==null&&robot.task!==task.id)reasons.push('This unit is reserved by another mission.');
  if(['Stopped','Paused'].includes(robot.state))reasons.push('This unit is stopped or paused.');
  if(context.stopped)reasons.push('Fleet stop is latched.');
  if(!Number.isFinite(bin.stock)||bin.stock<0||bin.stock>MODEL.capacity||!Number.isFinite(bin.rate)||bin.rate<0||!Number.isFinite(context.demand)||context.demand<0)reasons.push('Stock and demand inputs are invalid.');
  if(context.tasks.some(t=>t.id!==task.id&&t.bin===task.bin&&OPEN_MISSIONS.includes(t.status)))reasons.push('Another open mission already supplies this bin.');
  let trip=null;
  try{
    // A reassignment candidate needs its own bay geometry, not the previous owner's approval.
    const journey=context.tasks.some(t=>t.id===task.id&&t.robot!==task.robot)?null:task.journey;
    if(journey&&journey.signature!==routingSignature(context.routing))reasons.push('Route settings changed. Cancel and obtain fresh approval.');
    trip=tripFor(homeFor(robot),bin,context.slow,context.routing,journey);
  }catch{reasons.push('No permitted outbound and return route. Check the lane closures and mapped destination.');}
  return{robot,bin,reasons,trip};
}
// One chronological resource schedule is shared by reviews and forecasts.
// A head mission can recharge at its own bay; an impossible/paused head holds its followers.
export function queueTimeline(context){
  const owner = aisleOwner(context.robots);
  let seconds=context.stopped?Infinity:0;
  if (owner) {
    if (context.stopped||['Paused', 'Stopped'].includes(owner.state)) seconds=Infinity;
    else seconds=routeStats(owner,owner.route,context.slow).seconds;
    const active = context.tasks.find(t => t.id === owner.task && t.status === 'Active');
    if(active)try{seconds+=routeStats(context.bins[active.bin],active.journey?.inbound.points||routeTo(context.bins[active.bin],homeFor(owner),context.slow,context.routing),context.slow).seconds;}catch{seconds=Infinity;}
    if(owner.battery+1e-9<seconds*MODEL.drain)seconds=Infinity;
  }
  const queued = context.tasks.filter(t => t.status === 'Queued').sort((a, b) => a.approvedOrder - b.approvedOrder || a.id - b.id);
  const entries=[],reserved=new Set();
  for (const queuedTask of queued) {
    const {robot,reasons,trip}=missionCheck(queuedTask,context),required=trip?MODEL.reserve+trip.seconds*MODEL.drain:Infinity;
    if(reasons.length||required>100||reserved.has(queuedTask.robot))seconds=Infinity;
    reserved.add(queuedTask.robot);
    const battery=robot&&Number.isFinite(seconds)?Math.min(100,robot.battery+MODEL.charge*seconds):null;
    const chargeWait=battery===null?null:Math.max(0,(required-battery)/MODEL.charge);
    const start=chargeWait===null?null:seconds+chargeWait,arrival=start===null?null:start+trip.outbound.seconds,release=start===null?null:start+trip.seconds;
    entries.push({id:queuedTask.id,start,arrival,release,chargeWait,trip,returnBattery:start===null?null:Math.min(100,robot.battery+MODEL.charge*start)-trip.seconds*MODEL.drain,reasons});
    seconds=release??Infinity;
  }
  return{entries,release:seconds};
}
export function aisleWait(task,context){const schedule=queueTimeline(context),entry=schedule.entries.find(e=>e.id===task.id);return entry?entry.start??Infinity:schedule.release;}

export function assessMission(task, context) {
  const {robot,bin,reasons,trip}=missionCheck(task,context),wait=aisleWait(task,context);
  const eta=trip&&Number.isFinite(wait)&&!reasons.length?wait+trip.outbound.seconds:null;
  const returnBattery=trip&&Number.isFinite(robot?.battery)?robot.battery-trip.seconds*MODEL.drain:null;
  if(returnBattery!==null&&returnBattery+1e-9<MODEL.reserve)reasons.push(`Return battery would fall below the ${MODEL.reserve}% reserve. Recharge at the loading bay.`);
  if(!robot||!bin)return{feasible:false,reasons,trip:null,wait,eta:null,returnBattery:null,stockAtArrival:null};
  const stockAtArrival = eta === null ? null : Math.max(0, bin.stock - bin.rate * context.demand * eta);
  const stockout = bin.rate * context.demand > 0 ? bin.stock / (bin.rate * context.demand) : Infinity;
  return { feasible: reasons.length === 0, reasons, trip, wait, eta, returnBattery, stockAtArrival,
    stockout, late: eta !== null && stockout < eta, delivered: stockAtArrival === null ? null : Math.min(MODEL.load, MODEL.capacity - stockAtArrival) };
}

export function rankUnits(bin, context, taskId = null) {
  return context.robots.map(robot => ({ robot: robot.id, ...assessMission({ id: taskId, bin, robot: robot.id }, context) }))
    .sort((a,b)=>Number(b.feasible)-Number(a.feasible)||((context.routing?.objective??'distance')==='distance'?(a.trip?.metres??Infinity)-(b.trip?.metres??Infinity):0)||(a.eta??Infinity)-(b.eta??Infinity)||(b.returnBattery??-Infinity)-(a.returnBattery??-Infinity)||a.robot-b.robot);
}

export function reviewDispatch(context, ids) {
  const copy = { ...context, robots: context.robots.map(r => ({ ...r })), tasks: context.tasks.map(t => ({ ...t })) };
  const selected = copy.tasks.filter(t => t.status === 'Pending approval' && ids.includes(t.id));
  const stockout=t=>copy.bins[t.bin]?.rate*copy.demand>0?copy.bins[t.bin].stock/(copy.bins[t.bin].rate*copy.demand):Infinity;
  selected.sort((a,b)=>stockout(a)-stockout(b)||a.id-b.id);
  let order = Math.max(0, ...copy.tasks.map(t => t.approvedOrder || 0));
  return selected.map(task => {
    const assessment = assessMission(task, copy);
    if (assessment.feasible) { task.status = 'Queued';task.journey=assessment.trip;task.approvedOrder = ++order; copy.robots[task.robot].task = task.id; copy.robots[task.robot].state = 'Queued'; }
    return { id: task.id, robot: task.robot, bin: task.bin, ...assessment };
  });
}

export function inventoryProjection(context, horizon) {
  const schedule=queueTimeline(context);
  const arrivals = context.tasks.filter(t => ['Active', 'Queued'].includes(t.status)).map(task => {
    const robot = context.robots[task.robot];
    let eta = task.status === 'Active' ? routeStats(robot, robot.route, context.slow).seconds : schedule.entries.find(e=>e.id===task.id)?.arrival??null;
    if (context.stopped || ['Paused', 'Stopped'].includes(robot.state)) eta = null;
    if (task.status === 'Active' && robot.battery < routeStats(robot, robot.route, context.slow).seconds * MODEL.drain) eta = null;
    return { bin: task.bin, eta, id: task.id };
  });
  return context.bins.map((bin, index) => {
    const rate = bin.rate * context.demand, deliveries = arrivals.filter(a => a.bin === index && a.eta !== null && a.eta <= horizon).sort((a, b) => a.eta - b.eta);
    let stock = bin.stock, time = 0, stockoutAt = null;
    for (const delivery of [...deliveries, { eta: horizon, end: true }]) {
      const duration = delivery.eta - time;
      if (rate > 0 && stock / rate < duration && stockoutAt === null) stockoutAt = time + stock / rate;
      stock = Math.max(0, stock - rate * duration);
      if (!delivery.end) stock = Math.min(MODEL.capacity, stock + MODEL.load);
      time = delivery.eta;
    }
    return { id: bin.id, current: bin.stock, projected: stock, stockoutAt, deliveries: deliveries.length,
      noDelivery: Math.max(0, bin.stock - rate * horizon) };
  });
}
