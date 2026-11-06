import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MANAGER_STANDING_ZONES,
  segmentIntersectsManagerZone,
} from '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/warehouse_manager_standing_zones_and_route_clearance.js';
import {
  WAREHOUSE_LAYOUT as layout,
  STORAGE_RACKS,
  BIN_DESTINATIONS,
  LANE_SEGMENTS,
} from '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
import {
  referenceFacility,
  checkedFacility,
  graphRoute,
} from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';
import {
  routeTo,
  homeFor,
  ROUTE_CONDITIONS,
} from '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';
const radius = layout.robotRadius + layout.clearance,
  map = checkedFacility(referenceFacility());
assert.deepEqual(
  checkedFacility(
    JSON.parse(
      readFileSync(
        new URL(
          '../../backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/example_warehouse_route_graph_for_calibration.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  ),
  map,
  'The downloadable default facility matches the reference floor and manager areas',
);
const rectangles = STORAGE_RACKS.map((r) => ({
  left: r.x - layout.rackFootprintWidth / 2,
  right: r.x + layout.rackFootprintWidth / 2,
  top: r.y - layout.rackFootprintDepth / 2,
  bottom: r.y + layout.rackFootprintDepth / 2,
}));
function clearRoute(from, points) {
  let previous = from;
  for (const next of points) {
    assert(
      Math.abs(previous.x - next.x) < 1e-7 || Math.abs(previous.y - next.y) < 1e-7,
      'No diagonal shortcut through a rack block',
    );
    const left = Math.min(previous.x, next.x),
      right = Math.max(previous.x, next.x),
      top = Math.min(previous.y, next.y),
      bottom = Math.max(previous.y, next.y);
    assert(
      left >= radius - 1e-7 &&
        right <= layout.width - radius + 1e-7 &&
        top >= radius - 1e-7 &&
        bottom <= layout.height - radius + 1e-7,
      'Robot envelope remains within the reference floor',
    );
    for (const rack of rectangles) {
      const dx = Math.max(0, rack.left - right, left - rack.right),
        dy = Math.max(0, rack.top - bottom, top - rack.bottom);
      assert(Math.hypot(dx, dy) >= radius - 1e-7, 'Robot envelope intersects a storage rack');
    }
    previous = next;
  }
}
assert.equal(STORAGE_RACKS.length, 12);
assert.equal(STORAGE_RACKS.filter((r) => r.binId).length, 4);
for (const rack of rectangles)
  assert(rack.left >= 0 && rack.right <= 900 && rack.top >= 0 && rack.bottom <= 500);
for (const lane of LANE_SEGMENTS)
  clearRoute({ x: lane.x1, y: lane.y1 }, [{ x: lane.x2, y: lane.y2 }]);
for (const lane of LANE_SEGMENTS)
  for (const zone of map.restrictedZones)
    assert(
      !segmentIntersectsManagerZone(
        { x_m: lane.x1 / layout.scale, y_m: lane.y1 / layout.scale },
        { x_m: lane.x2 / layout.scale, y_m: lane.y2 / layout.scale },
        zone,
        radius / layout.scale,
      ),
      'Every reference lane clears manager areas with the full robot footprint',
    );
for (let id = 0; id < 1; id++)
  for (const bin of BIN_DESTINATIONS)
    for (const slow of [false, true]) {
      const home = homeFor({ id }),
        outbound = routeTo(home, bin, slow),
        inbound = routeTo(bin, home, slow);
      clearRoute(home, outbound);
      clearRoute(bin, inbound);
      const metric = graphRoute(map, 'bay0' + (id + 1), 'bin' + bin.id, 38 / 75, slow ? 8 / 38 : 1);
      const distance = outbound.reduce((acc, p, index) => {
        const prev = index ? outbound[index - 1] : home;
        return acc + Math.hypot(p.x - prev.x, p.y - prev.y);
      }, 0);
      assert(
        Math.abs(distance / 75 - metric.metres) < 1e-8,
        'Simulation and experiment use the same graph',
      );
      let previous = home;
      for (const next of outbound) {
        for (const fraction of [0.1, 0.5, 0.9]) {
          const current = {
            id,
            x: previous.x + (next.x - previous.x) * fraction,
            y: previous.y + (next.y - previous.y) * fraction,
          };
          const back = routeTo(current, home, slow);
          clearRoute(current, back);
          assert(
            Math.hypot(back.at(-1).x - home.x, back.at(-1).y - home.y) < 1e-7,
            'Cancellation returns to the correct bay',
          );
        }
        previous = next;
      }
    }
const alternate = structuredClone(map);
alternate.edges = alternate.edges.filter((e) => !(e.from === 'lane00' && e.to === 'binA'));
checkedFacility(alternate);
const detour = graphRoute(alternate, 'bay01', 'binA', 0.5),
  normal = graphRoute(map, 'bay01', 'binA', 0.5);
assert(detour.seconds > normal.seconds, 'A blocked link has a connected, longer alternative');
clearRoute(
  { x: detour.nodes[0].x_m * 75, y: detour.nodes[0].y_m * 75 },
  detour.nodes.slice(1).map((n) => ({ x: n.x_m * 75, y: n.y_m * 75 })),
);
assert.throws(
  () => routeTo({ x: 335, y: 185 }, BIN_DESTINATIONS[0]),
  'An off-network pose must not create a shortcut through a rack',
);
for (const objective of ['distance', 'time'])
  for (const blockedEdges of [ROUTE_CONDITIONS.north, ROUTE_CONDITIONS.central])
    for (const slow of [false, true])
      for (let id = 0; id < 1; id++)
        for (const bin of BIN_DESTINATIONS) {
          const home = homeFor({ id });
          clearRoute(home, routeTo(home, bin, slow, { objective, blockedEdges }));
          clearRoute(bin, routeTo(bin, home, slow, { objective, blockedEdges }));
        }
console.log(
  'PASS: 12-rack geometry, aisle and floor clearance, all 24 outbound/return combinations, mid-segment cancellation, alternate-link routing and off-network rejection.',
);

// Construct the real Three.js model without a browser or GPU to check asset geometry.
const gradient = { addColorStop() {} };
const context = new Proxy(
  {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
  },
  { get: (target, key) => (key in target ? target[key] : () => {}) },
);
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const { createWarehouse } = await import(
    '../../frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/build_warehouse_racks_cartons_and_robot_models.js'
  ),
  T = await import(
    '../../frontend_warehouse_dashboard/external_browser_libraries/threejs_3d_rendering/threejs_3d_rendering_module.min.js'
  );
const model = createWarehouse();
assert.equal(model.allRackCenters.length, 12);
assert.equal(model.rackCenters.length, 4);
assert.equal(model.cartons.count, 108);
assert.equal(model.managers.length, MANAGER_STANDING_ZONES.length);
for (const { definition, figure } of model.managers) {
  assert.equal(
    figure.parent,
    model.root,
    'Manager figures remain when facility equipment is hidden',
  );
  assert.equal(figure.position.x, (definition.x - 450) / layout.scale);
  assert.equal(figure.position.z, (definition.y - 250) / layout.scale);
  const bounds = new T.Box3().setFromObject(figure);
  assert(
    bounds.max.y >= 1.65 && bounds.max.y <= 2.1,
    'Standing human model has reference human height',
  );
  for (const x of [bounds.min.x, bounds.max.x])
    for (const z of [bounds.min.z, bounds.max.z])
      assert(
        Math.hypot(x * layout.scale + 450 - definition.x, z * layout.scale + 250 - definition.y) <
          definition.radius,
        'Manager geometry and sign fit inside their marked area',
      );
}
// New real scene fixtures must stay clear of every AMR graph segment.
for (const fixture of model.industrial.fixtures) {
  const box = new T.Box3().setFromObject(fixture.group);
  const left = box.min.x * 75 + 450,
    right = box.max.x * 75 + 450,
    top = box.min.z * 75 + 250,
    bottom = box.max.z * 75 + 250;
  assert(
    left >= -105 && right <= 1005 && top >= -100 && bottom <= 600,
    'Industrial equipment remains within the illustrative hall',
  );
  for (const lane of LANE_SEGMENTS) {
    const a = Math.min(lane.x1, lane.x2),
      b = Math.max(lane.x1, lane.x2),
      c = Math.min(lane.y1, lane.y2),
      d = Math.max(lane.y1, lane.y2);
    const dx = Math.max(0, left - b, a - right),
      dy = Math.max(0, top - d, c - bottom);
    assert(Math.hypot(dx, dy) >= radius, fixture.definition.id + ' obstructs an AMR lane');
  }
}
const { cameraFrame, animateWarehouse } = await import(
  '../../frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/warehouse_3d_renderer_and_camera.js'
);
animateWarehouse(
  model,
  { robots: [], bins: BIN_DESTINATIONS, routing: { blockedEdges: ROUTE_CONDITIONS.north } },
  0,
  0,
  { grid: false, routes: true },
);
const closedIndex = model.network.userData.edgeKeys.indexOf(ROUTE_CONDITIONS.north[0]),
  expectedColor = new T.Color('#f08075').toArray();
assert(closedIndex >= 0);
for (let i = 0; i < 3; i++)
  assert(
    Math.abs(
      model.network.geometry.getAttribute('color').array[closedIndex * 6 + i] - expectedColor[i],
    ) < 1e-6,
  );
animateWarehouse(
  model,
  { robots: [], bins: BIN_DESTINATIONS, routing: { blockedEdges: [] } },
  0,
  0,
  { grid: false, routes: true },
);
assert(
  Math.abs(model.network.geometry.getAttribute('color').array[closedIndex * 6] - expectedColor[0]) >
    0.1,
  'Reopening restores normal route color',
);
const { CanvasTwinScene } = await import(
    '../../frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/warehouse_2d_canvas_fallback_renderer.js'
  ),
  lines = [];
const fallbackAreas = [],
  fallbackLabels = [],
  fallbackFigures = [];
CanvasTwinScene.prototype.floor.call(
  {
    layers: { grid: false },
    scale: 1,
    box() {},
    flush() {},
    paintPolygon() {},
    line() {},
    shadow() {},
    circle: (...args) => fallbackAreas.push(args),
    text: (...args) => fallbackLabels.push(args),
  },
  { slow: false, robots: [] },
);
assert.equal(fallbackAreas.length, MANAGER_STANDING_ZONES.length);
for (const [index, zone] of MANAGER_STANDING_ZONES.entries()) {
  assert.deepEqual(fallbackAreas[index].slice(0, 4), [zone.x, zone.y, 0.25, zone.radius]);
  assert(
    fallbackLabels.some(
      ([text, x, y]) => text === zone.label.toUpperCase() && x === zone.x && y === zone.y + 26,
    ),
  );
}
CanvasTwinScene.prototype.managerStandingFigures.call({
  box: (...args) => fallbackFigures.push(args),
  cylinder() {},
});
for (const zone of MANAGER_STANDING_ZONES)
  assert(
    fallbackFigures.some(([x, y, z]) => x === zone.x && y === zone.y && z === 74),
    'Canvas fallback includes a standing figure at each shared zone location',
  );
CanvasTwinScene.prototype.overlays.call(
  { layers: { routes: true }, line: (...args) => lines.push(args) },
  { robots: [], routing: { blockedEdges: ROUTE_CONDITIONS.north } },
  0,
);
assert.equal(
  lines.filter((line) => line[1] === '#f08075').length,
  1,
  'Compatibility view shows the same closed graph link',
);
for (const [width, height, yaw, elevation, zoom] of [
  [1000, 650, -0.56, 0.7, 1.06],
  [375, 500, -1.04, 0.84, 1.06],
  [1200, 560, -0.74, 0.35, 1.05],
]) {
  const frame = cameraFrame({ x: 450, y: 250, zoom, yaw, elevation }, width, height),
    camera = new T.PerspectiveCamera(frame.fov, frame.aspect, 0.07, 140);
  camera.position.copy(frame.position);
  camera.lookAt(frame.target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  for (const x of [-7.4, 7.4])
    for (const z of [-4.67, 4.67])
      for (const y of [0, 3.65]) {
        const projected = new T.Vector3(x, y, z).project(camera);
        assert(
          Math.abs(projected.x) < 0.99 && Math.abs(projected.y) < 0.99,
          'Default camera must frame the expanded industrial hall',
        );
      }
}
console.log(
  'PASS: industrial fixture geometry clears every AMR lane; landscape, mobile and ground cameras frame the enlarged hall.',
);
for (const robot of model.robots) {
  const box = new T.Box3().setFromObject(robot.assembly),
    x = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
    z = Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
  assert(
    Math.hypot(x, z) * 75 <= layout.robotRadius,
    'Rendered robot fits the conservative route envelope',
  );
}
model.syncStock(BIN_DESTINATIONS);
const matrix = new T.Matrix4(),
  position = new T.Vector3(),
  rotation = new T.Quaternion(),
  scale = new T.Vector3();
for (let i = 0; i < STORAGE_RACKS.length; i++)
  for (let j = 0; j < 9; j++) {
    model.cartons.getMatrixAt(i * 9 + j, matrix);
    matrix.decompose(position, rotation, scale);
    if (scale.x < 0.01) continue;
    assert(
      Math.abs(position.x * 75 + 450 - STORAGE_RACKS[i].x) + 15 <= layout.rackFootprintWidth / 2,
    );
    assert(
      Math.abs(position.z * 75 + 250 - STORAGE_RACKS[i].y) + 18 <= layout.rackFootprintDepth / 2,
    );
  }
model.syncStock(BIN_DESTINATIONS.map((b) => ({ ...b, stock: 0 })));
for (let i = 0; i < STORAGE_RACKS.length; i++) {
  model.cartons.getMatrixAt(i * 9, matrix);
  matrix.decompose(position, rotation, scale);
  assert(
    STORAGE_RACKS[i].binId ? scale.x < 0.01 : scale.x > 0.9,
    'Only replenishment rack cartons follow bin stock',
  );
}
console.log(
  'PASS: real scene constructs 12 racks and 108 carton instances; robot and carton geometry fit the route envelopes; reserve decoration is isolated from measured stock.',
);
const relocated = map.restrictedZones.map((zone, i) =>
  i ? zone : { ...zone, x_m: 545 / 75, y_m: 250 / 75 },
);
animateWarehouse(
  model,
  {
    robots: [],
    bins: BIN_DESTINATIONS,
    routing: { objective: 'distance', blockedEdges: [], restrictedZones: relocated },
  },
  0,
  0,
  { grid: false, routes: true },
);
assert(Math.abs(model.managers[0].figure.position.x - (545 - 450) / 75) < 1e-8);
assert.equal(model.managers[0].figure.position.z, 0);
assert.equal(model.managers[0].area.position.x, model.managers[0].figure.position.x);
assert.equal(model.managers[0].area.position.z, model.managers[0].figure.position.z);
const restrictedIndex = model.network.userData.edgeKeys.indexOf('lane11~lane12');
assert(
  Math.abs(
    model.network.geometry.getAttribute('color').array[restrictedIndex * 6] - expectedColor[0],
  ) < 1e-6,
  '3D network includes manager restrictions',
);
fallbackAreas.length = 0;
CanvasTwinScene.prototype.floor.call(
  {
    layers: { grid: false },
    scale: 1,
    box() {},
    flush() {},
    paintPolygon() {},
    line() {},
    shadow() {},
    circle: (...args) => fallbackAreas.push(args),
    text() {},
  },
  { robots: [], routing: { restrictedZones: relocated } },
);
assert.deepEqual(fallbackAreas[0].slice(0, 4), [545, 250, 0.25, 40]);
const { projectedRobot } = await import(
  '../../frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/warehouse_3d_renderer_and_camera.js'
);
const waitingRobot = {
  id: 0,
  x: 440,
  y: 250,
  route: [{ x: 650, y: 250 }],
  state: 'Delivering',
  battery: 96,
  traffic: { start: 20 },
};
assert.equal(
  projectedRobot(waitingRobot, { running: true, trafficClock: 12 }),
  null,
  'Forecast ghost respects a replanned departure wait',
);
assert.equal(
  projectedRobot(waitingRobot, { running: true, trafficClock: 25, managerHoldReason: 'Blocked' }),
  null,
);
console.log(
  'PASS: moved manager figures, floor boundaries, 3D/Canvas positions, restricted-network colors and held/waiting motion projections agree.',
);
delete globalThis.document;
