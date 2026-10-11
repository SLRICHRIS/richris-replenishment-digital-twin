// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Deterministic paired discrete-event experiment; never changes the running fleet.
import { checkedProfile } from './robot_state_estimation_and_calibration.js';
import { referenceFacility, checkedFacility, checkedRouting, graphRoute, travelledMetres } from '../routing/warehouse_graph_and_pathfinding.js';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function trip(unit, bin, facility, speedFactor, routing) {
  const speed=unit.profile.cruiseMps*unit.profile.speedGain,bay=facility.nodes.find(n=>n.assetId===unit.id),destination=facility.nodes.find(n=>n.binId===bin.id);
  const route=graphRoute(facility,bay.id,destination.id,speed,speedFactor,routing),inbound=graphRoute(facility,destination.id,bay.id,speed,speedFactor,routing);
  // Validated dock proximity is a location tolerance, not an off-network travel segment.
  return{outbound:route,inbound,bay,segments:[...route.segments,...inbound.segments],seconds:route.seconds+inbound.seconds,metres:route.metres+inbound.metres};
}

function validate(input, options) {
  if (!input || input.units?.length !== 3 || input.bins?.length !== 4) throw new Error('Experiment requires exactly three assets and four bins.');
  if (!Number.isFinite(options.horizonS) || options.horizonS < 30 || options.horizonS > 300 || !Number.isFinite(options.demandMultiplier) || options.demandMultiplier < .5 || options.demandMultiplier > 5 ||
      !Number.isFinite(options.speedFactor) || options.speedFactor < .2 || options.speedFactor > 1) throw new Error('Experiment parameters are outside the supported range.');
  input.units.forEach((u, i) => {
    if (u.id !== 'amr-0' + (i + 1) || !Number.isFinite(u.x_m) || !Number.isFinite(u.y_m) || u.x_m < 0 || u.x_m > 12 || u.y_m < 0 || u.y_m > 6.6667 || !Number.isFinite(u.battery_pct) || u.battery_pct < 0 || u.battery_pct > 100) throw new Error('Every asset requires a finite, mapped pose and battery reading.');
    if (!['idle', 'charging', 'queued'].includes(u.state)) throw new Error('A remaining hardware mission route is unknown. Run this experiment with units idle at their bays.');
    checkedProfile(u.profile, u.id);
    const bay=input.facility.nodes.find(n=>n.assetId===u.id);
    if(Math.hypot(u.x_m-bay.x_m,u.y_m-bay.y_m)>.25)throw Error('An idle asset is not within 0.25 m of its mapped loading bay. Remaining routes are unknown.');
  });
  input.bins.forEach((b, i) => { if (b.id !== ['A','B','C','D'][i] || !Number.isFinite(b.count) || b.count < 0 || b.count > 100 || !Number.isFinite(b.rate) || b.rate < 0 || b.rate > 10 || !Number.isFinite(b.x_m) || !Number.isFinite(b.y_m)) throw new Error('Every bin requires a stock count, demand rate and mapped location.'); });
}

export function runBranch(input, options, policy) {
  const units = input.units.map((u, i) => ({ ...u, index: i, battery: u.battery_pct }));
  const bins = input.bins.map(b => ({ ...b, stock: b.count, rate: b.rate * options.demandMultiplier, stockoutS: 0, unmetUnits: 0 }));
  let time = 0, integrated = 0, energy = 0, distance = 0, completions = 0;
  const schedule = [], remaining = bins.map(b => b.id), samples = [{ t: 0, stock: bins.map(b => b.stock) }];
  function advance(to, active, activeEnd) {
    const end = Math.min(to, options.horizonS), dt = Math.max(0, end - integrated);
    for (const b of bins) {
      const untilEmpty = b.rate > 0 ? b.stock / b.rate : Infinity;
      b.stockoutS += Math.max(0, dt - untilEmpty); b.unmetUnits += Math.max(0, b.rate * dt - b.stock);
      b.stock = Math.max(0, b.stock - b.rate * dt);
    }
    for (const u of units) {
      const moving = active?.id === u.id ? Math.max(0, Math.min(end, activeEnd) - integrated) : 0;
      const drain = moving * u.profile.batteryMovePctS + (dt - moving) * u.profile.batteryIdlePctS;
      const used=Math.min(u.battery,drain);u.battery=clamp(u.battery-used,0,100);energy+=used;
    }
    integrated = end; samples.push({ t: end, stock: bins.map(b => b.stock) });
  }
  while (remaining.length && time < options.horizonS) {
    const candidates = remaining.map(id => bins.find(b => b.id === id));
    if (policy === 'urgency') candidates.sort((a, b) => (a.rate ? a.stock / a.rate : Infinity) - (b.rate ? b.stock / b.rate : Infinity) || a.id.localeCompare(b.id));
    const bin = candidates[0]; remaining.splice(remaining.indexOf(bin.id), 1);
    const ranked = units.filter(u => policy !== 'maintenance' || u.id !== 'amr-02').map(u => {
      try{const route=trip(u,bin,input.facility,options.speedFactor,input.routing),returnBattery=u.battery-route.seconds*u.profile.batteryMovePctS;
        return{unit:u,route,returnBattery,feasible:returnBattery>=u.profile.reservePct};
      }catch{return{unit:u,route:null,returnBattery:null,feasible:false};}
    }).sort((a,b)=>Number(b.feasible)-Number(a.feasible)||((input.routing?.objective??'distance')==='distance'?(a.route?.metres??Infinity)-(b.route?.metres??Infinity):0)||(a.route?.outbound.seconds??Infinity)-(b.route?.outbound.seconds??Infinity)||(b.returnBattery??-Infinity)-(a.returnBattery??-Infinity)||a.unit.index-b.unit.index);
    const choice = ranked.find(x => x.feasible);
    if (!choice) { schedule.push({ bin: bin.id, blocked: true, reason: ranked.every(r=>!r.route)?'No permitted outbound and return route.':'No unit can complete the round trip within its battery reserve.' }); continue; }
    const { unit, route } = choice, arrival = time + route.outbound.seconds, release = time + route.seconds;
    const record = { bin: bin.id, unit: unit.id, start: time, arrival, release, returnBattery: choice.returnBattery, metres: route.metres,
      outboundM:route.outbound.metres,returnM:route.inbound.metres,outboundNodes:route.outbound.nodes.map(n=>n.id),returnNodes:route.inbound.nodes.map(n=>n.id) };
    schedule.push(record);
    advance(arrival, unit, release);
    if (arrival <= options.horizonS) { const delivered = Math.min(30, 100 - bin.stock); bin.stock += delivered; record.delivered = delivered; completions++; samples.push({ t: arrival, stock: bins.map(b => b.stock) }); }
    // The same resource is held for outbound AND return: journeys cannot overlap.
    advance(release, unit, release);
    distance += travelledMetres(route.segments,options.horizonS-time);
    unit.x_m=route.bay.x_m;unit.y_m=route.bay.y_m;time = release;
  }
  advance(options.horizonS, null, 0);
  return { policy, completions, unmetUnits: bins.reduce((s, b) => s + b.unmetUnits, 0), stockoutSeconds: bins.reduce((s, b) => s + b.stockoutS, 0),
    energyPctPoints: energy, distanceM: distance, blocked: schedule.filter(s => s.blocked).length,
    projectedBatteries: units.map(u => u.battery), finalStock: bins.map(b => b.stock), schedule, samples };
}

export function comparePolicies(input, options) {
  input={...input,facility:checkedFacility(input.facility||referenceFacility())};
  options={...options,routeObjective:options.routeObjective??input.routing?.objective??'distance'};
  input.routing=checkedRouting(input.facility,{objective:options.routeObjective,blockedEdges:input.routing?.blockedEdges??[]});
  validate(input, options);
  if(!['simulation','synthetic','physical-recording','live-telemetry'].includes(input.provenance))throw Error('Experiment provenance is required.');
  if(['physical-recording','live-telemetry'].includes(input.provenance)&&(!input.facility.verified||input.units.some(u=>!u.profile.frameConfirmed||u.profile.frameId!==input.facility.frameId)))throw Error('Physical experiments require a confirmed route graph and aligned asset frames.');
  if(['physical-recording','live-telemetry'].includes(input.provenance)&&input.units.some(u=>u.profile.energyProvenance!=='measured'||!u.profile.validation?.passes||u.profile.validation.provenance==='synthetic'))throw Error('Physical experiments require measured discharge models and accepted motion holdouts.');
  if (!['urgency','maintenance'].includes(options.policy)) throw new Error('Unknown comparison policy.');
  const frozen = JSON.parse(JSON.stringify(input)), baseline = runBranch(frozen, options, 'fifo'), proposal = runBranch(frozen, options, options.policy);
  return { schema: 'replenish-paired-experiment/v1', snapshot: frozen, options: { ...options }, baseline, proposal,
    assumptions: ['One new 30-unit request for each A–D bin; existing approved missions are not continued.', 'Each idle unit must be within 0.25 m of its own bay and is modeled as docked there; no off-network connector is invented.', 'One shared aisle, reserved until return to bay.', 'Constant configured demand, deterministic speed and battery model; no charger model.',
      'Both policies use the exact same frozen state, route objective, lane closures and disturbances. Results are predictions, not measured improvements.'],
    delta: { unmetUnits: proposal.unmetUnits - baseline.unmetUnits, completions: proposal.completions - baseline.completions, energyPctPoints: proposal.energyPctPoints - baseline.energyPctPoints } };
}
