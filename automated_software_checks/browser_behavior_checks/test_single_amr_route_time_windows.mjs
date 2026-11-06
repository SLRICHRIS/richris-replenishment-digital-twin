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
let schedules = 0;
for (const slow of [false, true])
  for (const objective of ['distance', 'time'])
    for (const blockedEdges of [[], ['lane00~lane10'], ['lane10~lane11']])
      for (let bin = 0; bin < 4; bin++) {
        const robot = {
          id: 0,
          ...homeFor({ id: 0 }),
          battery: 95,
          state: 'Queued',
          task: 1,
          route: [],
        };
        const c = {
          robots: [robot],
          bins: structuredClone(BIN_DESTINATIONS),
          tasks: [{ id: 1, robot: 0, bin, status: 'Queued', approvedOrder: 1 }],
          slow,
          routing: { objective, blockedEdges },
          stopped: false,
          demand: 1,
          trafficClock: 0,
        };
        c.tasks[0].journey = tripFor(robot, c.bins[bin], slow, c.routing);
        const timeline = queueTimeline(c),
          entry = timeline.entries[0];
        assert(
          Number.isFinite(entry.start) &&
            entry.arrival > entry.start &&
            entry.release > entry.arrival,
        );
        assert.equal(timeline.entries.length, 1);
        assert.equal(conflictingWindows(timeline.windows), null);
        const tripRobot = {
          ...robot,
          route: [...entry.trip.outbound.points, ...entry.trip.inbound.points],
        };
        const end = advanceMotion(tripRobot, entry.release - entry.start, slow);
        assert(
          Math.hypot(end.x - robot.x, end.y - robot.y) < 1e-7,
          'AMR-01 returns to its own bay',
        );
        assert(robot.battery - end.usedSeconds * MODEL.drain >= MODEL.reserve);
        schedules++;
      }
console.log(
  `PASS: ${schedules} single-AMR route schedules, reserved outbound/return time windows and return-reserve checks.`,
);
