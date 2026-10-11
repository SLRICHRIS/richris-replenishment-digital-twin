// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Deterministic paired discrete-event experiment; never changes the running fleet.
import { checkedProfile } from './robot_state_estimation_calibration_and_replay.js';
import {
  referenceFacility,
  checkedFacility,
  checkedRouting,
  graphRoute,
  edgeSegments,
  travelledMetres,
} from '../shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';
import {
  journeyWindows,
  reserveEarliest,
} from '../robot_mission_simulation/node_and_segment_time_window_reservations.js';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function trip(unit, bin, facility, speedFactor, routing) {
  const speed = unit.profile.cruiseMps * unit.profile.speedGain,
    bay = facility.nodes.find((n) => n.assetId === unit.id),
    destination = facility.nodes.find((n) => n.binId === bin.id);
  const route = graphRoute(facility, bay.id, destination.id, speed, speedFactor, routing),
    inbound = graphRoute(facility, destination.id, bay.id, speed, speedFactor, routing);
  // Validated dock proximity is a location tolerance, not an off-network travel segment.
  return {
    outbound: route,
    inbound,
    bay,
    segments: [...route.segments, ...inbound.segments],
    seconds: route.seconds + inbound.seconds,
    metres: route.metres + inbound.metres,
  };
}

function validate(input, options) {
  if (!input || input.units?.length !== 3 || input.bins?.length !== 4)
    throw new Error('Experiment requires exactly three assets and four bins.');
  if (
    !Number.isFinite(options.horizonS) ||
    options.horizonS < 30 ||
    options.horizonS > 300 ||
    !Number.isFinite(options.demandMultiplier) ||
    options.demandMultiplier < 0.5 ||
    options.demandMultiplier > 5 ||
    !Number.isFinite(options.speedFactor) ||
    options.speedFactor < 0.2 ||
    options.speedFactor > 1
  )
    throw new Error('Experiment parameters are outside the supported range.');
  input.units.forEach((u, i) => {
    if (
      u.id !== 'amr-0' + (i + 1) ||
      !Number.isFinite(u.x_m) ||
      !Number.isFinite(u.y_m) ||
      u.x_m < 0 ||
      u.x_m > 12 ||
      u.y_m < 0 ||
      u.y_m > 6.6667 ||
      !Number.isFinite(u.battery_pct) ||
      u.battery_pct < 0 ||
      u.battery_pct > 100
    )
      throw new Error('Every asset requires a finite, mapped pose and battery reading.');
    if (!['idle', 'charging', 'queued'].includes(u.state))
      throw new Error(
        'A remaining hardware mission route is unknown. Run this experiment with units idle at their bays.',
      );
    checkedProfile(u.profile, u.id);
    const bay = input.facility.nodes.find((n) => n.assetId === u.id);
    if (Math.hypot(u.x_m - bay.x_m, u.y_m - bay.y_m) > 0.25)
      throw Error(
        'An idle asset is not within 0.25 m of its mapped loading bay. Remaining routes are unknown.',
      );
  });
  input.bins.forEach((b, i) => {
    if (
      b.id !== ['A', 'B', 'C', 'D'][i] ||
      !Number.isFinite(b.count) ||
      b.count < 0 ||
      b.count > 100 ||
      !Number.isFinite(b.rate) ||
      b.rate < 0 ||
      b.rate > 10 ||
      !Number.isFinite(b.x_m) ||
      !Number.isFinite(b.y_m)
    )
      throw new Error('Every bin requires a stock count, demand rate and mapped location.');
  });
}

export function runBranch(input, options, policy) {
  const units = input.units.map((u, index) => ({
    ...u,
    index,
    available: 0,
    plannedBattery: u.battery_pct,
    battery: u.battery_pct,
  }));
  const bins = input.bins.map((b) => ({
    ...b,
    stock: b.count,
    rate: b.rate * options.demandMultiplier,
    stockoutS: 0,
    unmetUnits: 0,
  }));
  const requests = [...bins],
    schedule = [],
    reservations = [];
  if (policy === 'urgency')
    requests.sort(
      (a, b) =>
        (a.rate ? a.stock / a.rate : Infinity) - (b.rate ? b.stock / b.rate : Infinity) ||
        a.id.localeCompare(b.id),
    );
  for (const bin of requests) {
    const ranked = units
      .filter((u) => policy !== 'maintenance' || u.id !== 'amr-02')
      .map((unit) => {
        try {
          const route = trip(unit, bin, input.facility, options.speedFactor, input.routing);
          const point = (n) => ({ x: n.x_m * 75, y: n.y_m * 75 });
          const seconds = (from, path) =>
            edgeSegments(
              { x_m: from.x / 75, y_m: from.y / 75 },
              { x_m: path[0].x / 75, y_m: path[0].y / 75 },
              unit.profile.cruiseMps * unit.profile.speedGain,
              input.facility.slowBoundaryXM,
              options.speedFactor,
            ).reduce((sum, p) => sum + p.seconds, 0);
          const template = journeyWindows(
            point(route.bay),
            route.outbound.nodes.slice(1).map(point),
            route.inbound.nodes.slice(1).map(point),
            seconds,
            false,
          );
          const plan = reserveEarliest(
            template,
            reservations.filter((w) => w.robot !== unit.index),
            unit.available,
          );
          const returnBattery = plan
            ? unit.plannedBattery -
              (plan.start - unit.available) * unit.profile.batteryIdlePctS -
              route.seconds * unit.profile.batteryMovePctS
            : null;
          return {
            unit,
            route,
            plan,
            returnBattery,
            feasible: plan && returnBattery >= unit.profile.reservePct,
          };
        } catch {
          return { unit, route: null, plan: null, returnBattery: null, feasible: false };
        }
      })
      .sort(
        (a, b) =>
          Number(b.feasible) - Number(a.feasible) ||
          (a.plan?.arrival ?? Infinity) - (b.plan?.arrival ?? Infinity) ||
          (a.route?.metres ?? Infinity) - (b.route?.metres ?? Infinity) ||
          (b.returnBattery ?? -Infinity) - (a.returnBattery ?? -Infinity) ||
          a.unit.index - b.unit.index,
      );
    const choice = ranked.find((r) => r.feasible);
    if (!choice) {
      schedule.push({
        bin: bin.id,
        blocked: true,
        reason: ranked.every((r) => !r.route)
          ? 'No permitted outbound and return route.'
          : 'No reserved trip fits the unit battery reserve.',
      });
      continue;
    }
    const { unit, route, plan, returnBattery } = choice;
    reservations.push(...plan.windows.map((w) => ({ ...w, robot: unit.index })));
    unit.available = plan.release;
    unit.plannedBattery = returnBattery;
    schedule.push({
      bin: bin.id,
      unit: unit.id,
      start: plan.start,
      arrival: plan.arrival,
      release: plan.release,
      returnBattery,
      metres: route.metres,
      outboundM: route.outbound.metres,
      returnM: route.inbound.metres,
      outboundNodes: route.outbound.nodes.map((n) => n.id),
      returnNodes: route.inbound.nodes.map((n) => n.id),
      windows: plan.windows,
      segments: route.segments,
    });
  }
  let integrated = 0,
    energy = 0,
    completions = 0;
  const samples = [{ t: 0, stock: bins.map((b) => b.stock) }];
  function advance(end) {
    const dt = Math.max(0, end - integrated);
    for (const bin of bins) {
      const untilEmpty = bin.rate > 0 ? bin.stock / bin.rate : Infinity;
      bin.stockoutS += Math.max(0, dt - untilEmpty);
      bin.unmetUnits += Math.max(0, bin.rate * dt - bin.stock);
      bin.stock = Math.max(0, bin.stock - bin.rate * dt);
    }
    for (const unit of units) {
      const moving = schedule
        .filter((s) => s.unit === unit.id && !s.blocked)
        .reduce(
          (sum, s) => sum + Math.max(0, Math.min(end, s.release) - Math.max(integrated, s.start)),
          0,
        );
      const used = Math.min(
        unit.battery,
        moving * unit.profile.batteryMovePctS + (dt - moving) * unit.profile.batteryIdlePctS,
      );
      unit.battery = clamp(unit.battery - used, 0, 100);
      energy += used;
    }
    integrated = end;
    samples.push({ t: end, stock: bins.map((b) => b.stock) });
  }
  for (const record of schedule
    .filter((s) => !s.blocked && s.arrival <= options.horizonS)
    .sort((a, b) => a.arrival - b.arrival || a.bin.localeCompare(b.bin))) {
    advance(record.arrival);
    const bin = bins.find((b) => b.id === record.bin);
    record.delivered = Math.min(30, 100 - bin.stock);
    bin.stock += record.delivered;
    completions++;
    samples.push({ t: record.arrival, stock: bins.map((b) => b.stock) });
  }
  advance(options.horizonS);
  const distance = schedule
    .filter((s) => !s.blocked)
    .reduce((sum, s) => sum + travelledMetres(s.segments, options.horizonS - s.start), 0);
  return {
    policy,
    completions,
    unmetUnits: bins.reduce((sum, b) => sum + b.unmetUnits, 0),
    stockoutSeconds: bins.reduce((sum, b) => sum + b.stockoutS, 0),
    energyPctPoints: energy,
    distanceM: distance,
    blocked: schedule.filter((s) => s.blocked).length,
    projectedBatteries: units.map((u) => u.battery),
    finalStock: bins.map((b) => b.stock),
    schedule,
    samples,
  };
}

export function comparePolicies(input, options) {
  input = { ...input, facility: checkedFacility(input.facility || referenceFacility()) };
  options = {
    ...options,
    routeObjective: options.routeObjective ?? input.routing?.objective ?? 'distance',
  };
  input.routing = checkedRouting(input.facility, {
    objective: options.routeObjective,
    blockedEdges: input.routing?.blockedEdges ?? [],
  });
  validate(input, options);
  if (
    !['simulation', 'synthetic', 'physical-recording', 'live-telemetry'].includes(input.provenance)
  )
    throw Error('Experiment provenance is required.');
  if (
    ['physical-recording', 'live-telemetry'].includes(input.provenance) &&
    (!input.facility.verified ||
      input.units.some(
        (u) => !u.profile.frameConfirmed || u.profile.frameId !== input.facility.frameId,
      ))
  )
    throw Error('Physical experiments require a confirmed route graph and aligned asset frames.');
  if (
    ['physical-recording', 'live-telemetry'].includes(input.provenance) &&
    input.units.some(
      (u) =>
        u.profile.energyProvenance !== 'measured' ||
        !u.profile.validation?.passes ||
        u.profile.validation.provenance === 'synthetic',
    )
  )
    throw Error(
      'Physical experiments require measured discharge models and accepted motion holdouts.',
    );
  if (!['urgency', 'maintenance'].includes(options.policy))
    throw new Error('Unknown comparison policy.');
  const frozen = JSON.parse(JSON.stringify(input)),
    baseline = runBranch(frozen, options, 'fifo'),
    proposal = runBranch(frozen, options, options.policy);
  return {
    schema: 'replenish-paired-experiment/v1',
    snapshot: frozen,
    options: { ...options },
    baseline,
    proposal,
    assumptions: [
      'One new 30-unit request for each A–D bin; existing approved missions are not continued.',
      'Each idle unit must be within 0.25 m of its own bay and is modeled as docked there; no off-network connector is invented.',
      'Concurrent journeys reserve nodes, bidirectional segments and nearby corridors through return, with the same 0.96 m reference clearance as virtual dispatch.',
      'Constant configured demand, deterministic speed and battery model; no charger model.',
      'Both policies use the exact same frozen state, route objective, lane closures and disturbances. Results are predictions, not measured improvements.',
    ],
    delta: {
      unmetUnits: proposal.unmetUnits - baseline.unmetUnits,
      completions: proposal.completions - baseline.completions,
      energyPctPoints: proposal.energyPctPoints - baseline.energyPctPoints,
    },
  };
}
