import assert from 'node:assert/strict';
import {
  ARENA,
  normalizeSettings,
  normalizePoint,
  normalizeObstacles,
  clearanceRadius,
  expandedObstacles,
  segmentAllowed,
  planRoute,
} from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/a0_route_preview.js';

const settings = { robotLengthMm: 180, robotWidthMm: 140, clearanceMm: 20 };
const radius = clearanceRadius(settings);
assert.deepEqual(ARENA, { widthMm: 841, heightMm: 1189, gridMm: 10 });
assert.equal(normalizeSettings().robotWidthMm, null, 'Never infer full width from wheel spacing');
assert.throws(() => normalizeSettings(null));
assert.throws(
  () => planRoute({ settings: {}, start: { x: 200, y: 200 }, goal: { x: 600, y: 200 } }),
  /full robot length and width/,
);
assert.throws(() => normalizeSettings({ robotWidthMm: '140' }));
assert.throws(() => normalizeSettings({ clearanceMm: -1 }));
assert.throws(() => normalizeSettings({ robotLengthMm: 2001 }));
assert.throws(() => normalizeSettings({ markerId: 50 }));
assert.throws(() => normalizeObstacles(Array(26).fill({ x: 10, y: 10, width: 10, height: 10 })));
assert.throws(() => normalizeObstacles([{ x: 830, y: 0, width: 20, height: 20 }]));
assert.throws(() => normalizePoint({ x: Infinity, y: 10 }));
assert.deepEqual(normalizePoint({ x: 841, y: 1189 }), { x: 840, y: 1180 });
assert.equal(normalizeSettings({ executionEnabled: true }).executionEnabled, undefined);
assert(Math.abs(radius - (Math.hypot(90, 70) + 20)) < 1e-9);

const start = { x: 200, y: 200 },
  goal = { x: 600, y: 200 };
const direct = planRoute({ settings, start, goal });
assert.equal(direct.lengthMm, 400);
assert.equal(direct.executionEnabled, false);
assert.equal(direct.source, 'manual-rehearsal');
assert.equal(planRoute({ settings, start, goal: start }).lengthMm, 0);
assert.throws(() => planRoute({ settings, start: { x: 100, y: 200 }, goal }), /start is too close/);
assert.throws(
  () => planRoute({ settings, start, goal: { x: 700, y: 1100 } }),
  /destination is too close/,
);
assert.throws(() => planRoute({ settings, start, goal: null }), /Set the robot start/);

const end = { x: 600, y: 900 },
  obstacles = [{ x: 350, y: 400, width: 120, height: 200 }];
const detour = planRoute({ settings, start, goal: end, obstacles });
assert(detour.points.length > 2);
assert(detour.lengthMm > Math.hypot(end.x - start.x, end.y - start.y));
assert.deepEqual(detour.points[0], start);
assert.deepEqual(detour.points.at(-1), end);
const inflated = expandedObstacles(obstacles, radius);
for (let i = 1; i < detour.points.length; i++)
  assert(segmentAllowed(detour.points[i - 1], detour.points[i], inflated, radius));
const blocked = planRoute({
  settings,
  start,
  goal: end,
  obstacles: [{ x: 0, y: 500, width: 841, height: 10 }],
});
assert.deepEqual(blocked.points, []);
assert.equal(blocked.lengthMm, null);
assert.throws(
  () =>
    planRoute({ settings, start, goal, obstacles: [{ x: 590, y: 190, width: 20, height: 20 }] }),
  /destination is too close/,
);
// Even a thin obstacle between grid nodes blocks an edge; touching corners is blocked.
assert.equal(
  segmentAllowed(
    { x: 200, y: 200 },
    { x: 210, y: 210 },
    [{ x: 204, y: 204, width: 1, height: 1 }],
    0,
  ),
  false,
);
assert.equal(
  segmentAllowed(
    { x: 200, y: 200 },
    { x: 210, y: 210 },
    [{ x: 205, y: 204, width: 1, height: 1 }],
    0,
  ),
  false,
);
assert.equal(segmentAllowed(start, goal, [], -1), false);
assert.equal(segmentAllowed({ x: 0, y: 200 }, goal, [], radius), false);
console.log(
  'PASS: A0 footprint clearance, continuous edge collisions, blocked scenes and command-free grid planning.',
);
