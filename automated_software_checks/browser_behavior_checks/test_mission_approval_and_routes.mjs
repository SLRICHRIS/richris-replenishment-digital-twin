import assert from 'node:assert/strict';
import { BIN_DESTINATIONS } from '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
import {
  routeTo,
  routeStats,
  tripFor,
  homeFor,
  assessMission,
  reviewDispatch,
  inventoryProjection,
} from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';
const make = () => ({
  robots: [{ id: 0, ...homeFor({ id: 0 }), battery: 96, state: 'Idle', task: null, route: [] }],
  bins: structuredClone(BIN_DESTINATIONS),
  tasks: [3, 1, 0].map((bin, i) => ({ id: i + 1, robot: 0, bin, status: 'Pending approval' })),
  demand: 1,
  slow: false,
  stopped: false,
  running: true,
});
let c = make(),
  r = c.robots[0],
  b = c.bins[3];
assert.equal(c.robots.length, 1);
assert(Number.isFinite(tripFor(r, b).seconds));
assert(tripFor(r, b, true).seconds > tripFor(r, b, false).seconds);
const original = JSON.stringify(c),
  plan = reviewDispatch(c, [1, 2, 3]);
assert.equal(JSON.stringify(c), original);
assert.equal(plan.filter((a) => a.feasible).length, 1, 'One robot accepts one mission per review');
c.robots[0].battery = 16;
assert(!assessMission(c.tasks[0], c).feasible);
c = make();
c.stopped = true;
assert.equal(reviewDispatch(c, [1, 2, 3]).filter((a) => a.feasible).length, 0);
c = make();
c.robots[0].state = 'Returning';
c.robots[0].route = routeTo(c.bins[3], homeFor(c.robots[0]));
assert(!assessMission(c.tasks[0], c).feasible);
c = make();
c.tasks[0].status = 'Active';
c.robots[0].task = 1;
c.robots[0].state = 'Delivering';
c.robots[0].route = routeTo(c.robots[0], c.bins[3]);
let p = inventoryProjection(c, 30);
assert.equal(p[3].deliveries, 1);
assert.equal(p[1].deliveries, 0);
assert(Math.abs(p[3].projected - (39 + 30 - 0.11 * 30)) < 1e-8);
c.robots[0].state = 'Paused';
assert(inventoryProjection(c, 120).every((p) => p.deliveries === 0));
c = make();
c.bins[0].stock = 2;
c.demand = 3;
p = inventoryProjection(c, 120);
assert(Math.abs(p[0].stockoutAt - 2 / (0.09 * 3)) < 1e-8);
console.log(
  'PASS: single-AMR approval exclusivity, return routes, battery reserve, pause/stop and stock projection.',
);
const { projectMotion } = await import(
  '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js'
);
const boundaryRobot = {
  id: 0,
  x: 290,
  y: 250,
  heading: 0,
  battery: 100,
  route: [{ x: 710, y: 250 }],
};
const ghost = projectMotion(boundaryRobot, 5, true);
assert(Math.abs(ghost.x - (300 + (5 - 10 / 38) * 8)) < 1e-8);
const crossingBack = projectMotion(
  { ...boundaryRobot, x: 310, route: [{ x: 220, y: 250 }] },
  2,
  true,
);
assert(Math.abs(crossingBack.x - (300 - (2 - 10 / 8) * 38)) < 1e-8);
console.log(
  'PASS: five-second projection integrates both directions across the restricted-speed boundary.',
);
let forecast;
globalThis.self = {
  postMessage: (message) => {
    forecast = message;
  },
};
await import(
  '../../frontend_warehouse_dashboard/browser_modules/background_calculation_workers/stock_and_battery_forecast_worker.js'
);
c = make();
c.bins[0].stock = 2;
self.onmessage({ data: { ...c, horizon: 120, generation: 4, sent: 100 } });
assert.equal(forecast.generation, 4);
assert(forecast.alerts.some((a) => a.title.includes('Stockout forecast · Bin A')));
c = make();
c.tasks[0].status = 'Active';
c.robots[0].task = 1;
c.robots[0].state = 'Paused';
c.robots[0].route = routeTo(c.robots[0], c.bins[3]);
self.onmessage({ data: { ...c, horizon: 120, generation: 5, sent: 101 } });
assert(forecast.alerts.some((a) => a.title === 'Aisle reservation held'));
delete globalThis.self;
console.log(
  'PASS: module-worker forecast preserves request identity and reports stockouts and paused aisle reservations.',
);
