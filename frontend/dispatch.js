// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Deterministic educational dispatch model. Never sends commands to hardware.
export const MODEL = Object.freeze({ scale: 75, depotX: 120, stagingX: 220, aisleY: 250,
  speed: 38, congestedSpeed: 8, drain: .06, reserve: 15, load: 30, capacity: 100 });
export const OPEN_MISSIONS = ['Pending approval', 'Queued', 'Active'];
export const homeFor = robot => ({ id: robot.id, x: MODEL.depotX, y: 170 + robot.id * 80 });

export function routeTo(from, to) {
  const points = [];
  if (from.x <= 150) points.push({ x: MODEL.stagingX, y: from.y });
  points.push({ x: from.x <= 150 ? MODEL.stagingX : from.x, y: MODEL.aisleY });
  if (to.x <= 150) points.push({ x: MODEL.stagingX, y: MODEL.aisleY }, { x: MODEL.stagingX, y: to.y });
  else points.push({ x: to.x, y: MODEL.aisleY });
  points.push({ x: to.x, y: to.y });
  let previous = from;
  return points.filter(point => { const different = Math.hypot(point.x - previous.x, point.y - previous.y) > .001; previous = point; return different; });
}

export function routeStats(from, route, slow = false) {
  let previous = from, distance = 0, seconds = 0;
  for (const point of route) {
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    let slowFraction = 0;
    if (slow) {
      if (previous.x > 300 && point.x > 300) slowFraction = 1;
      else if ((previous.x > 300) !== (point.x > 300)) slowFraction = (Math.max(previous.x, point.x) - 300) / Math.abs(point.x - previous.x);
    }
    seconds += length * ((1 - slowFraction) / MODEL.speed + slowFraction / MODEL.congestedSpeed);
    distance += length; previous = point;
  }
  return { distance, metres: distance / MODEL.scale, seconds };
}

export function tripFor(robot, bin, slow = false) {
  const outbound = routeStats(robot, routeTo(robot, bin), slow);
  const inbound = routeStats(bin, routeTo(bin, homeFor(robot)), slow);
  return { outbound, inbound, seconds: outbound.seconds + inbound.seconds, metres: outbound.metres + inbound.metres };
}

export function projectMotion(robot, seconds, slow = false) {
  let x = robot.x, y = robot.y, heading = robot.heading || 0;
  let remaining = Math.min(seconds, Number.isFinite(robot.battery) ? Math.max(0, robot.battery) / MODEL.drain : seconds);
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
      x += dx / length * travel; y += dy / length * travel; remaining -= travel / speed;
      if (remaining <= .00001) return { x, y, heading };
    }
  }
  return { x, y, heading };
}

export const aisleOwner = robots => robots.find(robot => robot.route.length > 0) || null;

export function aisleWait(task, context) {
  const owner = aisleOwner(context.robots);
  let seconds = 0;
  if (owner) {
    if (['Paused', 'Stopped'].includes(owner.state)) return Infinity;
    seconds = routeStats(owner, owner.route, context.slow).seconds;
    const active = context.tasks.find(t => t.id === owner.task && t.status === 'Active');
    if (active) seconds += routeStats(context.bins[active.bin], routeTo(context.bins[active.bin], homeFor(owner)), context.slow).seconds;
  }
  const queued = context.tasks.filter(t => t.status === 'Queued').sort((a, b) => a.approvedOrder - b.approvedOrder || a.id - b.id);
  for (const queuedTask of queued) {
    if (queuedTask.id === task.id) break;
    const robot = context.robots[queuedTask.robot];
    const trip = tripFor(homeFor(robot), context.bins[queuedTask.bin], context.slow);
    // A paused/undercharged reservation makes later ETAs indeterminate.
    if (['Paused', 'Stopped'].includes(robot.state) || robot.battery - trip.seconds * MODEL.drain < MODEL.reserve) return Infinity;
    seconds += trip.seconds;
  }
  return seconds;
}

export function assessMission(task, context) {
  const robot = context.robots[task.robot], bin = context.bins[task.bin], reasons = [];
  if (!robot || !bin) return { feasible: false, reasons: ['Choose a valid unit and destination.'], eta: null, returnBattery: null };
  const trip = tripFor(robot, bin, context.slow), wait = aisleWait(task, context);
  const eta = Number.isFinite(wait) ? wait + trip.outbound.seconds : null;
  const returnBattery = robot.battery - trip.seconds * MODEL.drain;
  if (context.stopped) reasons.push('Fleet stop is latched.');
  if (robot.task !== null && robot.task !== task.id) reasons.push('This unit is reserved by another mission.');
  if (robot.route.length || robot.x > 150) reasons.push('This unit must return to its loading bay first.');
  if (['Stopped', 'Paused'].includes(robot.state)) reasons.push('This unit is stopped or paused.');
  if (context.tasks.some(t => t.id !== task.id && t.bin === task.bin && OPEN_MISSIONS.includes(t.status))) reasons.push('Another open mission already supplies this bin.');
  if (returnBattery < MODEL.reserve) reasons.push(`Return battery would fall below the ${MODEL.reserve}% reserve.`);
  const stockAtArrival = eta === null ? null : Math.max(0, bin.stock - bin.rate * context.demand * eta);
  const stockout = bin.rate * context.demand > 0 ? bin.stock / (bin.rate * context.demand) : Infinity;
  return { feasible: reasons.length === 0, reasons, trip, wait, eta, returnBattery, stockAtArrival,
    stockout, late: eta !== null && stockout < eta, delivered: stockAtArrival === null ? null : Math.min(MODEL.load, MODEL.capacity - stockAtArrival) };
}

export function rankUnits(bin, context, taskId = null) {
  return context.robots.map(robot => ({ robot: robot.id, ...assessMission({ id: taskId, bin, robot: robot.id }, context) }))
    .sort((a, b) => Number(b.feasible) - Number(a.feasible) || (a.eta ?? Infinity) - (b.eta ?? Infinity) || b.returnBattery - a.returnBattery || a.robot - b.robot);
}

export function reviewDispatch(context, ids) {
  const copy = { ...context, robots: context.robots.map(r => ({ ...r })), tasks: context.tasks.map(t => ({ ...t })) };
  const selected = copy.tasks.filter(t => t.status === 'Pending approval' && ids.includes(t.id));
  selected.sort((a, b) => copy.bins[a.bin].stock / copy.bins[a.bin].rate - copy.bins[b.bin].stock / copy.bins[b.bin].rate || a.id - b.id);
  let order = Math.max(0, ...copy.tasks.map(t => t.approvedOrder || 0));
  return selected.map(task => {
    const assessment = assessMission(task, copy);
    if (assessment.feasible) { task.status = 'Queued'; task.approvedOrder = ++order; copy.robots[task.robot].task = task.id; copy.robots[task.robot].state = 'Queued'; }
    return { id: task.id, robot: task.robot, bin: task.bin, ...assessment };
  });
}

export function inventoryProjection(context, horizon) {
  const arrivals = context.tasks.filter(t => ['Active', 'Queued'].includes(t.status)).map(task => {
    const robot = context.robots[task.robot];
    let eta = task.status === 'Active' ? routeStats(robot, robot.route, context.slow).seconds : assessMission(task, context).eta;
    if (context.stopped || ['Paused', 'Stopped'].includes(robot.state)) eta = null;
    if (task.status === 'Active' && robot.battery < routeStats(robot, robot.route, context.slow).seconds * MODEL.drain) eta = null;
    if (task.status === 'Queued' && !assessMission(task, context).feasible) eta = null;
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
