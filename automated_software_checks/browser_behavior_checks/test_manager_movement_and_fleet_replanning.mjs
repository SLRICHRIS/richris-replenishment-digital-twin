import assert from 'node:assert/strict';
import {
  referenceFacility,
  graphRouteFromPose,
} from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';
import {
  checkedManagerRelocation,
  replanFleetForManagerPositions,
} from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/manager_relocation_and_fleet_route_replanning.js';
import {
  routePlan,
  MODEL,
  homeFor,
  trafficHeld,
  inventoryProjection,
} from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';
import { BIN_DESTINATIONS } from '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
import { routePosition } from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/interactive_route_map_and_algorithm_playback.js';
import { conflictingWindows } from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/node_and_segment_time_window_reservations.js';
const defaults = referenceFacility().restrictedZones;
const zonesAt = (x, y) =>
  defaults.map((z, i) => (i ? { ...z } : { ...z, x_m: x / 75, y_m: y / 75 }));
function context(
  positions = [
    [440, 250],
    [120, 250],
    [120, 330],
  ],
  destinations = [1],
) {
  const robots = positions.map(([x, y], id) => ({
    id,
    x,
    y,
    route: [],
    task: null,
    state: 'Idle',
    battery: 96,
    distance: 0,
  }));
  const tasks = destinations.map((bin, id) => ({ id: id + 1, robot: id, bin, status: 'Active' }));
  for (const task of tasks) {
    const robot = robots[task.robot];
    robot.route = routePlan(robot, BIN_DESTINATIONS[task.bin]).points;
    robot.task = task.id;
    robot.state = 'Delivering';
    robot.phase = 'outbound';
  }
  return {
    robots,
    tasks,
    bins: BIN_DESTINATIONS.map((b) => ({ ...b })),
    routing: { objective: 'distance', blockedEdges: [] },
    slow: false,
    trafficClock: 12,
    demand: 1,
    stopped: false,
  };
}
const snapshot = context();
const before = JSON.stringify(snapshot);
const updated = replanFleetForManagerPositions(snapshot, zonesAt(545, 250));
assert(!updated.held, updated.reason);
assert.equal(JSON.stringify(snapshot), before, 'Planning is atomic and does not mutate live state');
assert(!updated.plans[0].journey.outbound.edgeKeys.includes('lane11~lane12'));
const samePose = { x: 440, y: 250 };
const original = routePlan(samePose, { x: 650, y: 250 });
const detour = routePlan(samePose, { x: 650, y: 250 }, false, updated.routing);
const restored = routePlan(samePose, { x: 650, y: 250 }, false, {
  ...updated.routing,
  restrictedZones: defaults,
});
assert(detour.distance > original.distance);
assert.equal(
  restored.distance,
  original.distance,
  'Moving a manager away reopens its old path and bypasses the old cache',
);
const partial = graphRouteFromPose(
  referenceFacility(),
  { x_m: 500 / 75, y_m: 250 / 75 },
  'binD',
  1,
  1,
  { restrictedZones: zonesAt(600, 250) },
);
assert.equal(
  partial.nodes[1].id,
  'lane11',
  'A robot exits the clear portion of its current segment without crossing the manager',
);
assert.throws(
  () =>
    graphRouteFromPose(referenceFacility(), { x_m: 500 / 75, y_m: 250 / 75 }, 'binD', 1, 1, {
      restrictedZones: zonesAt(600, 250),
      blockedEdges: ['lane11~lane12'],
    }),
  /no permitted path/,
);
assert(
  replanFleetForManagerPositions(snapshot, zonesAt(440, 250)).held,
  'A manager covering the current robot pose holds motion',
);
assert(
  replanFleetForManagerPositions(snapshot, zonesAt(225, 250)).held,
  'An unavailable return route holds the whole fleet',
);
const weak = structuredClone(snapshot);
weak.robots[0].battery = MODEL.reserve;
assert(
  replanFleetForManagerPositions(weak, zonesAt(545, 250)).held,
  'A detour cannot consume the return reserve',
);
assert.throws(() => checkedManagerRelocation(zonesAt(335, 185)), /rack footprints/);
assert.throws(() => checkedManagerRelocation(zonesAt(-50, 250)), /bounded circles/);
const cancelled = structuredClone(snapshot);
cancelled.tasks[0].status = 'Cancelled';
cancelled.robots[0].task = null;
cancelled.robots[0].cancelledDelivery = true;
const returning = replanFleetForManagerPositions(cancelled, zonesAt(545, 250));
assert(!returning.held, returning.reason);
assert(returning.plans[0].journey.returning);
assert.deepEqual(returning.plans[0].route.at(-1), {
  x: homeFor(cancelled.robots[0]).x,
  y: homeFor(cancelled.robots[0]).y,
});
const frozen = structuredClone(snapshot);
frozen.robots[0].traffic = { slow: true };
frozen.slow = false;
const fixedSpeed = replanFleetForManagerPositions(frozen, zonesAt(545, 250));
assert(!fixedSpeed.held, fixedSpeed.reason);
assert.equal(
  fixedSpeed.plans[0].traffic.slow,
  true,
  'Replanning preserves the reserved journey speed',
);
assert(trafficHeld({ ...snapshot, managerPlacementActive: true }));
assert(trafficHeld({ ...snapshot, managerHoldReason: 'No clear route' }));
const delayed = structuredClone(snapshot);
delayed.robots[0].traffic = { start: 42 };
assert.equal(
  inventoryProjection(delayed, 10)[1].deliveries,
  0,
  'Waiting at a replanned departure delays delivery forecasts',
);

// Independently sample the new full journeys, including stationary waiting poses.
let schedules = 0,
  samples = 0;
for (const objective of ['distance', 'time'])
  for (const slow of [false, true]) {
    const fleet = context(
      [
        [440, 250],
        [230, 380],
        [120, 330],
      ],
      [1, 2, 0],
    );
    fleet.routing.objective = objective;
    fleet.slow = slow;
    const result = replanFleetForManagerPositions(fleet, zonesAt(545, 250));
    assert(!result.held, result.reason);
    assert.equal(result.plans.length, 3);
    assert.equal(conflictingWindows(result.plans.flatMap((p) => p.traffic.windows)), null);
    const end = Math.max(...result.plans.map((p) => p.traffic.release));
    for (let time = fleet.trafficClock; time <= end + 0.05; time += 0.05) {
      const poses = result.plans.map((plan) => {
        const robot = fleet.robots.find((r) => r.id === plan.robot);
        if (time <= plan.traffic.start) return { x_m: robot.x / 75, y_m: robot.y / 75 };
        const elapsed = time - plan.traffic.start;
        if (elapsed <= plan.journey.outbound.seconds)
          return routePosition(plan.journey.outbound, elapsed);
        return routePosition(plan.journey.inbound, elapsed - plan.journey.outbound.seconds);
      });
      for (let i = 0; i < poses.length; i++) {
        for (const zone of result.routing.restrictedZones)
          assert(
            Math.hypot(poses[i].x_m - zone.x_m, poses[i].y_m - zone.y_m) >
              zone.radius_m + 0.48 - 1e-8,
            'Moving robot clears manager footprint buffer',
          );
        for (let j = i + 1; j < poses.length; j++)
          assert(
            Math.hypot(poses[i].x_m - poses[j].x_m, poses[i].y_m - poses[j].y_m) * 75 >= 72 - 1e-5,
            'Replanned robots retain fleet clearance while waiting and moving',
          );
      }
      samples++;
    }
    schedules++;
  }
console.log(
  `PASS: manager relocation, fresh route cache, clear partial-segment escape, blocked pose/return/reserve holds, cancellation return, frozen speed, delayed forecasts and ${schedules} concurrent replans over ${samples} fleet samples.`,
);
