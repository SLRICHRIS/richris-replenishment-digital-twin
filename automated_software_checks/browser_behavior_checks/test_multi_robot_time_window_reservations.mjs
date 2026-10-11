import assert from 'node:assert/strict';
import {
  reserveEarliest,
  journeyWindows,
  conflictingWindows,
  TRAFFIC_CLEARANCE,
} from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/node_and_segment_time_window_reservations.js';
import {
  queueTimeline,
  tripFor,
  homeFor,
  MODEL,
  advanceMotion,
  routeStats,
} from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';
import { BIN_DESTINATIONS } from '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';

const template = {
  windows: [{ resource: 'segment:left~right', start: 0, end: 10 }],
  arrival: 5,
  release: 10,
};
assert.equal(reserveEarliest(template, [], 0).start, 0);
assert(
  reserveEarliest(template, [{ resource: 'segment:left~right', start: 0, end: 10 }], 0).start >= 10,
);
assert.equal(
  reserveEarliest(template, [{ resource: 'segment:other', start: 0, end: 100 }], 0).start,
  0,
);
assert.equal(reserveEarliest(template, [], Infinity), null);
let schedules = 0,
  minimum = Infinity,
  overlapping = 0;
for (const slow of [false, true])
  for (const objective of ['distance', 'time'])
    for (const condition of [[], ['lane00~lane10'], ['lane10~lane11']])
      for (const bins of [
        [3, 1, 0],
        [0, 1, 2],
        [1, 3, 2],
        [2, 0, 3],
      ]) {
        const c = {
          robots: [0, 1, 2].map((id) => ({
            id,
            ...homeFor({ id }),
            battery: 95,
            state: 'Queued',
            task: id + 1,
            route: [],
          })),
          bins: structuredClone(BIN_DESTINATIONS),
          tasks: bins.map((bin, robot) => ({
            id: robot + 1,
            robot,
            bin,
            status: 'Queued',
            approvedOrder: robot + 1,
          })),
          slow,
          routing: { objective, blockedEdges: condition },
          stopped: false,
          demand: 1,
          trafficClock: 0,
        };
        for (const t of c.tasks)
          t.journey = tripFor(c.robots[t.robot], c.bins[t.bin], slow, c.routing);
        const timeline = queueTimeline(c);
        assert(
          timeline.entries.every(
            (e) =>
              Number.isFinite(e.start) && Number.isFinite(e.arrival) && Number.isFinite(e.release),
          ),
        );
        assert.equal(conflictingWindows(timeline.windows), null);
        const plans = timeline.entries.map((e, i) => ({
          ...e,
          robot: { ...c.robots[i], route: [...e.trip.outbound.points, ...e.trip.inbound.points] },
        }));
        const end = Math.max(...plans.map((e) => e.release));
        for (let t = 0; t <= end; t += 0.05) {
          const poses = plans.map((p) => advanceMotion(p.robot, Math.max(0, t - p.start), slow));
          for (let a = 0; a < 3; a++)
            for (let b = a + 1; b < 3; b++) {
              const distance = Math.hypot(poses[a].x - poses[b].x, poses[a].y - poses[b].y);
              minimum = Math.min(minimum, distance);
              assert(
                distance >= TRAFFIC_CLEARANCE - 1e-6,
                `Collision: scenario ${schedules}, t=${t}, ${a}/${b} at ${distance}`,
              );
            }
        }
        if (plans[1].start < plans[0].release) overlapping++;
        // An already departed unit's remaining windows must protect new approvals.
        c.robots[0].traffic = { ...plans[0].plan, slow };
        c.robots[0].route = plans[0].trip.outbound.points;
        c.tasks[0].status = 'Active';
        c.robots[0].state = 'Delivering';
        const later = queueTimeline(c);
        assert.equal(conflictingWindows(later.windows), null);
        c.robots[0].state = 'Paused';
        assert(later.entries.every((e) => e.start !== null));
        assert(queueTimeline(c).entries.every((e) => e.start === null));
        schedules++;
      }
assert(overlapping > 0, 'The planner must actually permit concurrent journeys');
// Distance is Lipschitz with at most the sum of both maximum speeds.
// The 50 ms sample interval therefore bounds any unsampled dip by 1.9 units.
assert(
  minimum - MODEL.speed * 0.05 >= TRAFFIC_CLEARANCE,
  'Continuous separation bound must cover intervals between samples',
);
console.log(
  `PASS: ${schedules} fleet schedules, head-on/disjoint windows, continued reservations, paused traffic hold; ${overlapping} overlapping journeys; minimum sampled separation ${minimum.toFixed(3)} units (required ${TRAFFIC_CLEARANCE}).`,
);

// Verify the paired study uses the same spatial conflicts and actually overlaps units.
const { comparePolicies } = await import(
  '../../frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/compare_dispatch_policies_with_shared_inputs.js'
);
const { defaultProfile } = await import(
  '../../frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js'
);
const snapshot = {
  provenance: 'simulation',
  units: [0, 1, 2].map((id) => ({
    id: 'amr-0' + (id + 1),
    x_m: homeFor({ id }).x / MODEL.scale,
    y_m: homeFor({ id }).y / MODEL.scale,
    battery_pct: 90,
    state: 'idle',
    profile: defaultProfile('amr-0' + (id + 1)),
  })),
  bins: BIN_DESTINATIONS.map((b) => ({
    id: b.id,
    count: b.stock,
    rate: b.rate,
    x_m: b.x / MODEL.scale,
    y_m: b.y / MODEL.scale,
  })),
};
const study = comparePolicies(snapshot, {
  policy: 'urgency',
  horizonS: 120,
  demandMultiplier: 5,
  speedFactor: 1,
});
for (const branch of [study.baseline, study.proposal]) {
  const trips = branch.schedule.filter((s) => !s.blocked);
  assert.equal(
    conflictingWindows(trips.flatMap((s) => s.windows.map((w) => ({ ...w, robot: s.unit })))),
    null,
  );
  assert(
    trips.some((a, i) =>
      trips
        .slice(i + 1)
        .some((b) => a.unit !== b.unit && a.start < b.release && b.start < a.release),
    ),
    'The paired study must permit different robots to overlap',
  );
}
console.log(
  'PASS: paired policy branches share spatial windows, retain per-unit exclusivity and execute concurrent fleet journeys.',
);
