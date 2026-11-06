import assert from 'node:assert/strict';
import {
  referenceFacility,
  checkedFacility,
  checkedRouting,
  graphRouteFromPose,
  graphRoute,
  graphRouteTrace,
  routeEdgeKey,
} from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';
import { segmentIntersectsManagerZone } from '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/warehouse_manager_standing_zones_and_route_clearance.js';
import {
  routePosition,
  routeDirections,
  routeMapPoint,
  zoomRouteView,
} from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/interactive_route_map_and_algorithm_playback.js';
import {
  MODEL,
  ROUTE_CONDITIONS,
} from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';
const map = referenceFacility(),
  speed = MODEL.speed / MODEL.scale;
let checked = 0;
for (const objective of ['distance', 'time'])
  for (const factor of [1, MODEL.congestedSpeed / MODEL.speed])
    for (const blockedEdges of [
      [],
      ROUTE_CONDITIONS.north,
      ROUTE_CONDITIONS.central,
      ROUTE_CONDITIONS.entry,
    ])
      for (const bay of ['bay01'])
        for (const bin of ['binA', 'binB', 'binC', 'binD'])
          for (const [from, to] of [
            [bay, bin],
            [bin, bay],
          ]) {
            const traced = graphRouteTrace(map, from, to, speed, factor, {
              objective,
              blockedEdges,
            });
            assert.equal(traced.events[0].kind, 'start');
            if (!traced.route) {
              assert.equal(traced.events.at(-1).kind, 'unreachable');
              assert.throws(
                () => graphRoute(map, from, to, speed, factor, { objective, blockedEdges }),
                /No permitted route/,
              );
              continue;
            }
            const route = traced.route;
            assert.deepEqual(
              route,
              graphRoute(map, from, to, speed, factor, { objective, blockedEdges }),
            );
            assert.equal(traced.events.at(-1).kind, 'complete');
            assert.equal(traced.events.at(-1).current, to);
            let previousCost = -Infinity,
              previousSettled = new Set();
            for (const event of traced.events) {
              assert(previousSettled.size <= event.settled.length);
              for (const id of previousSettled) assert(event.settled.includes(id));
              previousSettled = new Set(event.settled);
              for (const candidate of event.frontier) assert(!previousSettled.has(candidate.id));
              if (event.current) {
                const cost = event.costs.find((n) => n.id === event.current),
                  value = objective === 'distance' ? cost.metres : cost.seconds;
                assert(value >= previousCost - 1e-9);
                previousCost = value;
              }
              for (const edge of event.tree) assert(!blockedEdges.includes(edge.edge));
            }
            const directions = routeDirections(route);
            assert(Math.abs(directions.reduce((s, d) => s + d.metres, 0) - route.metres) < 1e-8);
            assert(Math.abs(directions.reduce((s, d) => s + d.seconds, 0) - route.seconds) < 1e-8);
            const start = routePosition(route, 0),
              end = routePosition(route, route.seconds + 500);
            assert(
              Math.hypot(start.x_m - route.nodes[0].x_m, start.y_m - route.nodes[0].y_m) < 1e-9,
            );
            assert(
              Math.hypot(end.x_m - route.nodes.at(-1).x_m, end.y_m - route.nodes.at(-1).y_m) < 1e-9,
            );
            let priorM = -1;
            for (let i = 0; i <= 20; i++) {
              const p = routePosition(route, (route.seconds * i) / 20);
              assert(p.metres >= priorM);
              priorM = p.metres;
              assert(
                Number.isFinite(p.x_m) && Number.isFinite(p.y_m) && Number.isFinite(p.heading),
              );
              assert(
                route.nodes.slice(1).some((b, j) => {
                  const a = route.nodes[j],
                    dx = b.x_m - a.x_m,
                    dy = b.y_m - a.y_m,
                    t = ((p.x_m - a.x_m) * dx + (p.y_m - a.y_m) * dy) / (dx * dx + dy * dy);
                  return (
                    t >= -1e-8 &&
                    t <= 1 + 1e-8 &&
                    Math.hypot(a.x_m + t * dx - p.x_m, a.y_m + t * dy - p.y_m) < 1e-8
                  );
                }),
                'Playback must stay on a permitted segment',
              );
            }
            checked++;
          }
const same = graphRouteTrace(map, 'bay01', 'bay01', speed);
assert.equal(same.route.seconds, 0);
assert.deepEqual(routeDirections(same.route), []);
assert.equal(routePosition(same.route, 4).remainingM, 0);
const directed = {
  slowBoundaryXM: 4,
  nodes: [
    { id: 'a', x_m: 1, y_m: 1 },
    { id: 'b', x_m: 2, y_m: 1 },
  ],
  edges: [{ from: 'a', to: 'b', bidirectional: false }],
};
assert(graphRouteTrace(directed, 'a', 'b', 1).route);
assert.equal(graphRouteTrace(directed, 'b', 'a', 1).route, null);
const view = { x: 0, y: -20, w: 900, h: 540 },
  rect = { left: 0, top: 0, width: 360, height: 500 };
const at = routeMapPoint(view, rect, 100, 222);
assert(Math.abs(at.x - 250) < 1e-9 && Math.abs(at.y - 180) < 1e-9);
const zoomed = zoomRouteView(view, 0.5, at),
  after = routeMapPoint(zoomed, rect, 100, 222);
assert(
  Math.abs(at.x - after.x) < 1e-9 && Math.abs(at.y - after.y) < 1e-9,
  'Zoom must preserve its screen anchor',
);
assert.equal(zoomRouteView(view, 0.000001).w, 220);
assert.equal(zoomRouteView(view, 1000).w, 1600);

// A manager between two clear endpoints must close the whole intersecting link.
const managerMap = checkedFacility({
  ...structuredClone(map),
  restrictedZones: [
    ...map.restrictedZones,
    {
      id: 'manager-test',
      label: 'Manager test',
      x_m: 545 / 75,
      y_m: 250 / 75,
      radius_m: 0.2,
    },
  ],
});
assert.deepEqual(
  checkedFacility(JSON.parse(JSON.stringify(managerMap))).restrictedZones,
  managerMap.restrictedZones,
);
assert(
  checkedRouting(managerMap, { blockedEdges: [] }).blockedEdges.includes('lane11~lane12'),
  'Opening manual closures must not open a manager restriction',
);
for (const objective of ['distance', 'time'])
  for (const [from, to] of [
    ['lane11', 'lane12'],
    ['lane12', 'lane11'],
  ]) {
    const detour = graphRouteTrace(managerMap, from, to, 1, 1, { objective });
    assert(
      Math.abs(detour.route.metres - 470 / 75) < 1e-8,
      'Expected shortest clear cross-aisle detour',
    );
    assert(!detour.route.edgeKeys.includes('lane11~lane12'));
    assert(
      detour.events.every((event) => event.tree.every((edge) => edge.edge !== 'lane11~lane12')),
    );
  }
const crossingZone = { x_m: 2, y_m: 0, radius_m: 0.2 },
  first = { x_m: 0, y_m: 0 },
  last = { x_m: 4, y_m: 0 };
assert(segmentIntersectsManagerZone(first, last, crossingZone, 0.48));
assert(segmentIntersectsManagerZone(last, first, crossingZone, 0.48));
assert(
  segmentIntersectsManagerZone(first, last, { ...crossingZone, y_m: 0.68 }, 0.48),
  'Tangency to the robot clearance boundary is restricted',
);
assert(!segmentIntersectsManagerZone(first, last, { ...crossingZone, y_m: 0.6801 }, 0.48));
assert(segmentIntersectsManagerZone(first, first, { ...crossingZone, x_m: 0.6 }, 0.48));
const restrictedDirected = {
  ...directed,
  restrictedZones: [{ id: 'manager-directed', label: 'Manager', x_m: 1.5, y_m: 1, radius_m: 0.1 }],
};
assert.equal(graphRouteTrace(restrictedDirected, 'a', 'b', 1).route, null);
assert.equal(graphRouteTrace(restrictedDirected, 'b', 'a', 1).route, null);
const endpointMap = {
  ...map,
  restrictedZones: [
    { id: 'manager-bay', label: 'Manager', x_m: 120 / 75, y_m: 250 / 75, radius_m: 0.1 },
  ],
};
const endpointTrace = graphRouteTrace(endpointMap, 'bay01', 'bay01', 1);
assert.equal(endpointTrace.route, null, 'A zero-length route cannot occupy a manager area');
assert.equal(endpointTrace.events.at(-1).kind, 'unreachable');
assert.throws(() => checkedFacility(endpointMap), /manager restriction/);
assert.throws(
  () => graphRouteFromPose(managerMap, { x_m: 545 / 75, y_m: 250 / 75 }, 'binD', 1),
  /manager restriction/,
);
for (const invalid of [
  null,
  [managerMap.restrictedZones[0], managerMap.restrictedZones[0]],
  [{ ...managerMap.restrictedZones[0], x_m: NaN }],
  [{ ...managerMap.restrictedZones[0], radius_m: -1 }],
  [{ ...managerMap.restrictedZones[0], x_m: 0 }],
  [{ ...managerMap.restrictedZones[0], label: '<script>' }],
])
  assert.throws(
    () => checkedFacility({ ...map, restrictedZones: invalid }),
    /Manager zones|manager standing zones/,
  );
const legacyMap = structuredClone(map);
delete legacyMap.restrictedZones;
assert.deepEqual(
  checkedFacility(legacyMap).restrictedZones,
  [],
  'Older facility imports remain supported',
);
for (const bay of ['bay01'])
  for (const bin of ['binA', 'binB', 'binC', 'binD'])
    for (const [from, to] of [
      [bay, bin],
      [bin, bay],
    ])
      assert.deepEqual(
        graphRoute(map, from, to, speed),
        graphRoute(legacyMap, from, to, speed),
        'Reference manager locations preserve all published journey distances',
      );
console.log(
  'PASS: manager-zone crossing, footprint tangency, clear detours, directed/zero-length/pose restrictions, metadata validation, legacy imports and unchanged reference journeys.',
);
console.log(
  `PASS: ${checked} route/trace/direction/playback combinations; monotonic settled costs; closed/directed/unreachable cases; zero-distance route; anchored mobile pan/zoom geometry.`,
);
