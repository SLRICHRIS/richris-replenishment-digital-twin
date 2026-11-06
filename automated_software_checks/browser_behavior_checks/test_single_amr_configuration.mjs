import assert from 'node:assert/strict';
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
const bays = referenceFacility().nodes.filter((n) => n.role === 'bay');
assert.deepEqual(
  bays.map((n) => n.assetId),
  ['amr-01'],
);
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
