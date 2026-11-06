import assert from 'node:assert/strict';
import {
  referenceFacility,
  graphRoute,
  graphRouteFromPose,
  routeEdgeKey,
  checkedFacility,
} from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';
import {
  MODEL,
  ROUTE_CONDITIONS,
  routePlan,
  tripFor,
  assessMission,
  rankUnits,
  queueTimeline,
  inventoryProjection,
} from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';
import { BIN_DESTINATIONS } from '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
import { comparePolicies } from '../../frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/compare_dispatch_policies_with_shared_inputs.js';
import { defaultProfile } from '../../frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js';

// Independent all-pairs oracle: Floyd–Warshall, rather than the production search.
// Time weights use a direct analytic integral through the two speed regions.
function oracle(map, speed, factor, blocked, objective) {
  const n = map.nodes.length,
    d = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)),
    );
  const index = (id) => map.nodes.findIndex((p) => p.id === id);
  for (const edge of map.edges) {
    if (blocked.includes(routeEdgeKey(edge))) continue;
    const i = index(edge.from),
      j = index(edge.to),
      a = map.nodes[i],
      b = map.nodes[j];
    const length = Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m),
      boundary = map.slowBoundaryXM;
    const share =
      Math.min(a.x_m, b.x_m) >= boundary
        ? 1
        : Math.max(a.x_m, b.x_m) <= boundary
          ? 0
          : (Math.max(a.x_m, b.x_m) - boundary) / Math.abs(a.x_m - b.x_m);
    const weight =
      objective === 'distance' ? length : length * ((1 - share) / speed + share / (speed * factor));
    d[i][j] = Math.min(d[i][j], weight);
    if (edge.bidirectional) d[j][i] = Math.min(d[j][i], weight);
  }
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) d[i][j] = Math.min(d[i][j], d[i][k] + d[k][j]);
  return d;
}
let seed = 49315;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
let comparisons = 0;
for (let trial = 0; trial < 30; trial++) {
  const nodes = Array.from({ length: 7 }, (_, i) => ({
      id: 'n' + i,
      x_m: random() * 10,
      y_m: random() * 6,
    })),
    edges = [];
  for (let i = 0; i < 7; i++)
    for (let j = i + 1; j < 7; j++)
      if (random() < 0.38)
        edges.push({ from: 'n' + i, to: 'n' + j, bidirectional: random() < 0.55 });
  const map = { nodes, edges, slowBoundaryXM: 4 },
    blocked = edges.filter(() => random() < 0.16).map(routeEdgeKey);
  for (const objective of ['distance', 'time']) {
    const expected = oracle(map, 0.5, 0.23, blocked, objective);
    for (let i = 0; i < 7; i++)
      for (let j = 0; j < 7; j++) {
        if (!Number.isFinite(expected[i][j]))
          assert.throws(
            () =>
              graphRoute(map, 'n' + i, 'n' + j, 0.5, 0.23, { objective, blockedEdges: blocked }),
            /No permitted route/,
          );
        else {
          const route = graphRoute(map, 'n' + i, 'n' + j, 0.5, 0.23, {
            objective,
            blockedEdges: blocked,
          });
          assert(
            Math.abs((objective === 'distance' ? route.metres : route.seconds) - expected[i][j]) <
              1e-8,
          );
          assert(route.edgeKeys.every((k) => !blocked.includes(k)));
          assert.equal(
            JSON.stringify(route),
            JSON.stringify(
              graphRoute({ ...map, edges: [...edges].reverse() }, 'n' + i, 'n' + j, 0.5, 0.23, {
                objective,
                blockedEdges: blocked,
              }),
            ),
            'Input order must not change tie decisions',
          );
        }
        comparisons++;
      }
  }
}

// Shortest distance and fastest time must make different choices when appropriate.
const tradeoff = {
  slowBoundaryXM: 4,
  nodes: [
    { id: 's', x_m: 3, y_m: 1 },
    { id: 't', x_m: 3, y_m: 5 },
    { id: 'slow', x_m: 4.5, y_m: 3 },
    { id: 'fast', x_m: 0, y_m: 3 },
  ],
  edges: [
    ['s', 'slow'],
    ['slow', 't'],
    ['s', 'fast'],
    ['fast', 't'],
  ].map(([from, to]) => ({ from, to, bidirectional: true })),
};
const shortest = graphRoute(tradeoff, 's', 't', 1, 0.1),
  fastest = graphRoute(tradeoff, 's', 't', 1, 0.1, { objective: 'time' });
assert.equal(shortest.nodes[1].id, 'slow');
assert.equal(fastest.nodes[1].id, 'fast');
assert(shortest.metres < fastest.metres && shortest.seconds > fastest.seconds);

const directed = {
  slowBoundaryXM: 4,
  nodes: [
    { id: 'a', x_m: 0, y_m: 0 },
    { id: 'b', x_m: 2, y_m: 0 },
    { id: 'c', x_m: 1, y_m: 1 },
  ],
  edges: [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'a'],
  ].map(([from, to]) => ({ from, to, bidirectional: false })),
};
const mid = graphRouteFromPose(directed, { x_m: 1, y_m: 0 }, 'a', 1);
assert.deepEqual(
  mid.nodes.map((n) => n.id),
  ['current', 'b', 'c', 'a'],
);
assert(Math.abs(mid.metres - (1 + 2 * Math.SQRT2)) < 1e-9);
assert.throws(
  () => graphRouteFromPose(directed, { x_m: 1, y_m: 0 }, 'a', 1, 1, { blockedEdges: ['c>a'] }),
  /no permitted path/,
);
assert.throws(
  () => graphRouteFromPose(directed, { x_m: 1, y_m: 0.2 }, 'a', 1),
  /no permitted path/,
);
const map = referenceFacility(),
  duplicate = structuredClone(map);
duplicate.edges.push({ ...duplicate.edges[0] });
assert.throws(() => checkedFacility(duplicate), /Duplicate/);

const make = () => ({
  robots: [0].map((id) => ({
    id,
    x: 120,
    y: 250,
    battery: 96 - id * 9,
    state: 'Idle',
    task: null,
    route: [],
  })),
  bins: BIN_DESTINATIONS.map((b) => ({ ...b })),
  tasks: [],
  demand: 1,
  slow: false,
  stopped: false,
  routing: { objective: 'distance', blockedEdges: [] },
});
let c = make(),
  task = { id: 1, robot: 0, bin: 0, status: 'Pending approval' };
c.tasks = [task];
const normal = assessMission(task, c);
c.routing.blockedEdges = ROUTE_CONDITIONS.north;
const detour = assessMission(task, c);
assert(detour.feasible && detour.trip.metres > normal.trip.metres);
assert(detour.trip.outbound.edgeKeys.every((k) => !c.routing.blockedEdges.includes(k)));
c.routing.blockedEdges = ROUTE_CONDITIONS.entry;
assert.equal(assessMission(task, c).trip, null);
assert.equal(assessMission(task, c).feasible, false);
c = make();
c.tasks = [task];
c.robots[0].y = 170;
assert(assessMission(task, c).reasons.some((r) => r.includes('own loading bay')));
c.robots[0].y = 250;
c.robots[0].battery = NaN;
assert.equal(assessMission(task, c).feasible, false);
c = make();
assert.equal(rankUnits(0, c)[0].robot, 0, 'Only AMR-01 can be recommended');

// A retained queued mission can charge after a battery disturbance. No instantaneous dispatch.
c = make();
task = { id: 1, robot: 0, bin: 0, status: 'Queued', approvedOrder: 1 };
c.tasks = [task];
c.robots[0].state = 'Queued';
c.robots[0].task = 1;
task.journey = tripFor(c.robots[0], c.bins[0], false, c.routing);
c.robots[0].battery = 12;
const queue = queueTimeline(c),
  required = MODEL.reserve + task.journey.seconds * MODEL.drain,
  charge = (required - 12) / MODEL.charge;
assert(Math.abs(queue.entries[0].start - charge) < 1e-9);
assert.equal(assessMission(task, c).feasible, false);
assert.equal(inventoryProjection(c, charge + task.journey.outbound.seconds + 1)[0].deliveries, 1);
c.routing = { objective: 'time', blockedEdges: [] };
assert.equal(
  queueTimeline(c).entries[0].arrival,
  null,
  'A stale approved route cannot enter a new configuration',
);

const snapshot = {
  provenance: 'simulation',
  facility: map,
  routing: { objective: 'distance', blockedEdges: ROUTE_CONDITIONS.entry },
  units: make().robots.map((r, i) => ({
    id: 'amr-0' + (i + 1),
    x_m: r.x / 75,
    y_m: r.y / 75,
    battery_pct: r.battery,
    state: 'idle',
    profile: { ...defaultProfile('amr-0' + (i + 1)), frameConfirmed: true },
  })),
  bins: BIN_DESTINATIONS.map((b) => ({
    id: b.id,
    count: b.stock,
    rate: b.rate,
    x_m: b.x / 75,
    y_m: b.y / 75,
  })),
};
const result = comparePolicies(snapshot, {
  policy: 'urgency',
  horizonS: 120,
  demandMultiplier: 1,
  speedFactor: 1,
  routeObjective: 'distance',
});
assert.equal(result.baseline.blocked, 4);
assert.equal(result.proposal.blocked, 4);
assert.equal(result.proposal.distanceM, 0);
assert.equal(result.proposal.completions, 0);
const depleted = structuredClone(snapshot);
depleted.units.forEach((u) => (u.battery_pct = 0));
assert.equal(
  comparePolicies(depleted, {
    policy: 'urgency',
    horizonS: 120,
    demandMultiplier: 1,
    speedFactor: 1,
  }).baseline.energyPctPoints,
  0,
  'A depleted battery cannot discharge additional energy',
);
console.log(
  `PASS: ${comparisons} independent optimality checks, deterministic ties, distance/time tradeoff, directed pose anchoring, closed/disconnected routes, bay/data gates, recommendation, charging waits, stale approval and blocked paired experiments.`,
);
