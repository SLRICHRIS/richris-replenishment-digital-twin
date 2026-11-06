import assert from 'node:assert/strict';
import { paintLanePlan } from '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
import { createWarehouse } from '../../frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/build_warehouse_racks_cartons_and_robot_models.js';
import { referenceFacility } from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';
import {
  SLOT_IDS,
  decodeTelemetry,
} from '../../frontend_warehouse_dashboard/browser_modules/esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness.js';
// CPU geometry construction only: no browser, GPU or hardware claim.
const gradient = { addColorStop() {} };
const context = new Proxy(
  {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (text) => ({ width: String(text).length * 6 }),
  },
  {
    get: (target, key) => (key in target ? target[key] : () => {}),
  },
);
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const model = createWarehouse();
delete globalThis.document;
assert.equal(model.robots.length, 1, 'Only one robot assembly is constructed');
assert.equal(model.dockLights.length, 1, 'Only one charging dock is constructed');
assert.equal(model.dockLights[0].position.z, 0, 'Dock lies at the warehouse middle Y position');
const bays = referenceFacility().nodes.filter((n) => n.role === 'bay');
assert.deepEqual(
  bays.map((n) => n.assetId),
  ['amr-01'],
);
assert.equal(bays[0].y_m * 75, 250, 'AMR-01 bay is centred vertically');
assert.deepEqual(SLOT_IDS, ['amr-01']);
for (const removed of ['amr-02', 'amr-03']) {
  assert.throws(
    () => decodeTelemetry(JSON.stringify({ v: 1, device_id: removed }), removed),
    /identity|version/i,
  );
}
console.log(
  'PASS: actual warehouse geometry constructs one AMR and one dock; map and telemetry registry admit only AMR-01.',
);

// Check the actual floor painter too: robot assemblies alone do not detect ghost bays.
const paintedLabels = [],
  bayRectangles = [],
  chevrons = [];
const floorContext = new Proxy(
  {
    fillText: (value) => paintedLabels.push(value),
    fillRect: (...rectangle) => {
      if (floorContext.fillStyle === '#255f69') bayRectangles.push(rectangle);
    },
    moveTo: (x, y) => {
      if (x === 52) chevrons.push(y);
    },
  },
  { get: (target, key) => (key in target ? target[key] : () => {}) },
);
paintLanePlan(floorContext);
assert.deepEqual(
  paintedLabels.filter((value) => /^\d{2}$/.test(value)),
  ['01'],
);
assert.equal(bayRectangles.length, 1, 'Only one painted parking rectangle');
assert.equal(
  bayRectangles[0][1] + bayRectangles[0][3] / 2,
  250,
  'Painted bay matches the centred dock',
);
assert(
  chevrons.length > 0 && chevrons.every((y) => y >= 213 && y <= 281),
  'Hatching stays within the sole middle bay',
);
console.log(
  'PASS: floor texture paints only bay 01 in the middle position; markings and dock agree.',
);
