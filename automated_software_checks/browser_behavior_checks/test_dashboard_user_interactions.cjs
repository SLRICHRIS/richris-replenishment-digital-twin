const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const base = require('node:path').resolve(__dirname, '../../frontend_warehouse_dashboard');
const html = fs.readFileSync(base + '/index.html', 'utf8'),
  nodes = new Map(),
  all = [],
  windowEvents = {},
  documentEvents = {},
  frames = [];
let doc;
function classes(value = '') {
  const set = new Set(value.split(/\s+/).filter(Boolean));
  return {
    toggle(v, on) {
      on = on ?? !set.has(v);
      on ? set.add(v) : set.delete(v);
      return on;
    },
    add(v) {
      set.add(v);
    },
    remove(v) {
      set.delete(v);
    },
    contains: (v) => set.has(v),
  };
}
function parseAttrs(s) {
  const o = {};
  for (const m of s.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) o[m[1]] = m[2] ?? '';
  return o;
}
function create(attrs = {}, owner = null) {
  const e = {
    attrs: { ...attrs },
    id: attrs.id,
    dataset: {},
    owner,
    inner: '',
    hidden: 'hidden' in attrs,
    style: {
      setProperty(k, v) {
        this[k] = v;
      },
    },
    classList: classes(attrs.class),
    handlers: {},
    value: '',
    disabled: false,
    clientWidth: 640,
    selectedOptions: [{ text: 'Test scenario' }],
    textContent: '',
    open: false,
  };
  for (const k of Object.keys(attrs))
    if (k.startsWith('data-'))
      e.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attrs[k];
  e.setAttribute = (k, v) => (e.attrs[k] = String(v));
  e.getAttribute = (k) => e.attrs[k];
  e.addEventListener = (k, fn) => (e.handlers[k] = fn);
  e.focus = () => {
    doc.activeElement = e;
  };
  e.blur = () => {
    if (doc.activeElement === e) doc.activeElement = null;
  };
  e.click = () => {
    e.onclick?.({ target: e });
    e.handlers.click?.({ target: e });
  };
  e.contains = (target) => {
    while (target) {
      if (target === e) return true;
      target = target.owner;
    }
    return false;
  };
  e.showModal = () => (e.open = true);
  e.close = () => (e.open = false);
  e.closest = (selector) =>
    selector.startsWith('[data-') && selector.slice(1, -1) in e.attrs ? e : null;
  e.querySelector = (selector) => {
    if (selector.startsWith('[data-measurement=')) {
      e.chips ??= {};
      return (e.chips[selector] ??= create({}, e));
    }
    if (selector === '[data-select]')
      return all.find((n) => e.contains(n) && 'select' in n.dataset) || null;
    if (selector === 'span') return (e.span ??= create({}, e));
    return null;
  };
  Object.defineProperty(e, 'innerHTML', {
    get() {
      return e.inner;
    },
    set(s) {
      e.inner = s;
      for (const m of s.matchAll(/<([a-z][a-z0-9-]*)\b([^>]+)>/g)) {
        const a = parseAttrs(m[2]);
        if (a.id) {
          const n = create(a, e);
          nodes.set(a.id, n);
        }
      }
    },
  });
  all.push(e);
  if (e.id) nodes.set(e.id, e);
  return e;
}
for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]+)>/g)) {
  const a = parseAttrs(m[2]);
  if (
    a.id ||
    a.class ||
    a['data-page'] ||
    a['data-view'] ||
    'data-screen' in a ||
    'data-lab-tab' in a ||
    'data-lab-panel' in a
  )
    create(a);
}
const get = (id) => {
  const e = nodes.get(id);
  assert(e, 'Unknown DOM id ' + id);
  return e;
};
doc = {
  getElementById: get,
  activeElement: null,
  hidden: false,
  title: '',
  body: create(),
  documentElement: create(),
  addEventListener: (k, f) => (documentEvents[k] = f),
  createElement: () => create(),
  querySelector(s) {
    return s.startsWith('.') ? all.find((n) => n.classList.contains(s.slice(1))) : null;
  },
  querySelectorAll(s) {
    if (s.startsWith('[data-')) {
      const k = s.slice(1, -1);
      return all.filter((n) => k in n.attrs);
    }
    return [];
  },
};
get('speed').value = '3';
get('horizon').value = '120';
get('scenario').value = 'normal';
class Scene {
  constructor(c, onSelect, onCamera) {
    this.onSelect = onSelect;
    this.onCamera = onCamera;
    this.camera = { yaw: 0, elevation: 0.7, zoom: 1 };
    this.layers = { routes: false, sensors: false, ghosts: false, grid: false, facility: true };
    this.rendererKind = 'Test renderer';
    this.width = 1000;
    this.draws = 0;
    this.resizes = 0;
  }
  setView(p) {
    this.preset = p;
  }
  focus() {
    this.follow = true;
  }
  cameraChanged(p) {
    this.onCamera(p, this.camera);
  }
  resize() {
    this.resizes++;
  }
  draw() {
    this.draws++;
  }
  zoomBy(f) {
    this.camera.zoom *= f;
  }
}
let worker;
const location = { hash: '' };
const win = {
  addEventListener: (k, f) => (windowEvents[k] = f),
  history: {
    replaceState(a, b, h) {
      location.hash = h;
    },
  },
  scrollTo() {},
};
const ctx = {
  document: doc,
  window: win,
  location,
  TwinScene: Scene,
  Worker: class {
    constructor() {
      worker = this;
    }
    postMessage(d) {
      this.data = d;
    }
  },
  performance: { now: () => 100 },
  requestAnimationFrame: (f) => frames.push(f),
  setTimeout() {},
  clearTimeout() {},
  Blob,
  URL,
  console,
};
vm.createContext(ctx);

Object.assign(ctx, {
  TextDecoder,
  TextEncoder,
  setInterval() {
    return 1;
  },
  clearInterval() {},
  crypto: require('node:crypto').webcrypto,
});
vm.runInContext(
  fs
    .readFileSync(
      base +
        '/browser_modules/dashboard_navigation_and_appearance/dashboard_animation_and_element_updates.js',
      'utf8',
    )
    .replace(/export /g, ''),
  ctx,
);
vm.runInContext(
  fs
    .readFileSync(
      base +
        '/browser_modules/esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness.js',
      'utf8',
    )
    .replace(/export /g, ''),
  ctx,
);
Object.assign(
  ctx,
  vm.runInContext(
    '(()=>{' +
      fs
        .readFileSync(
          base +
            '/browser_modules/warehouse_reference_geometry/warehouse_manager_standing_zones_and_route_clearance.js',
          'utf8',
        )
        .replace(/export /g, '') +
      ';return{MANAGER_STANDING_ZONES,managerStandingZonesInMetres,checkedManagerStandingZones,segmentIntersectsManagerZone,managerZoneHatchSegments,managerZonesInModelCoordinates};})()',
    ctx,
  ),
);
Object.assign(
  ctx,
  vm.runInContext(
    '(()=>{' +
      fs
        .readFileSync(
          base +
            '/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js',
          'utf8',
        )
        .replace(/^import[\s\S]*?;\s*$/gm, '')
        .replace(/export /g, '') +
      ';return{WAREHOUSE_LAYOUT,BIN_DESTINATIONS,STORAGE_RACKS,AISLE_X,AISLE_Y,LANE_SEGMENTS,referenceRouteGraph,paintLanePlan};})()',
    ctx,
  ),
);
Object.assign(
  ctx,
  vm.runInContext(
    '(()=>{' +
      fs
        .readFileSync(
          base +
            '/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js',
          'utf8',
        )
        .replace(/^import[\s\S]*?;\s*$/gm, '')
        .replace(/export /g, '') +
      ';return{referenceFacility,checkedFacility,graphRoute,graphRouteTrace,graphRouteFromPose,checkedRouting,managerRestrictedEdgeKeys,routeEdgeKey,edgeSegments,travelledMetres};})()',
    ctx,
  ),
);
vm.runInContext(
  fs
    .readFileSync(
      base +
        '/browser_modules/robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js',
      'utf8',
    )
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/export /g, ''),
  ctx,
);
vm.runInContext(
  fs
    .readFileSync(
      base +
        '/browser_modules/robot_mission_simulation/node_and_segment_time_window_reservations.js',
      'utf8',
    )
    .replace(/export /g, ''),
  ctx,
);
vm.runInContext(
  fs
    .readFileSync(
      base +
        '/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js',
      'utf8',
    )
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/export /g, ''),
  ctx,
);
vm.runInContext(
  fs
    .readFileSync(
      base +
        '/browser_modules/robot_state_models_and_policy_experiments/robot_model_validation_and_experiment_panel.js',
      'utf8',
    )
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/export /g, ''),
  ctx,
);
vm.runInContext(
  fs
    .readFileSync(
      base +
        '/browser_modules/esp32_telemetry_monitoring/esp32_mqtt_connection_and_status_panel.js',
      'utf8',
    )
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/export /g, ''),
  ctx,
);

ctx.createRouteMap = () => ({ render() {}, tick() {}, setVisible() {} });
vm.runInContext(
  fs
    .readFileSync(
      base +
        '/browser_modules/robot_mission_simulation/manager_relocation_and_fleet_route_replanning.js',
      'utf8',
    )
    .replace(/^import[\s\S]*?;\s*$/gm, '')
    .replace(/export /g, ''),
  ctx,
);
const app = fs
  .readFileSync(
    base +
      '/browser_modules/dashboard_navigation_and_appearance/warehouse_simulation_and_dashboard_controller.js',
    'utf8',
  )
  .replace(/^import[\s\S]*?;\s*$/gm, '')
  .replace(/if\s*\(document\.fonts\)\s*await document\.fonts\.ready;/, '');
vm.runInContext(app, ctx);
const run = (s) => vm.runInContext(s, ctx);
assert.equal(get('environment').hidden, false);
assert.equal(run('robots.length'), 1);
assert.equal(run('robots[0].id'), 0);
assert.equal(run('tasks.length'), 3);
assert(run('tasks.every(t=>t.robot===0)'));
get('layer-facility').click();
assert.equal(run('scene.layers.facility'), false);
get('layer-facility').click();
assert.equal(run('scene.layers.facility'), true);
for (let mission = 0; mission < 3; mission++) {
  get('demo').click();
  assert(get('dispatch-dialog').open);
  get('confirm-dispatch').click();
  assert.equal(run('tasks.filter(t=>t.status==="Active").length'), 1);
  assert.equal(run('robots.length'), 1);
  run('step(500);render()');
  assert.equal(run('completed'), mission + 1);
  assert.equal(run('robots[0].state'), 'Idle');
  assert(run('robots[0].battery>=15'));
}
run('reset();assign(tasks[0]);step(2);pauseRobot(0)');
const pose = run('JSON.stringify([robots[0].x,robots[0].y])');
run('step(5)');
assert.equal(run('JSON.stringify([robots[0].x,robots[0].y])'), pose);
run('pauseRobot(0);step(500)');
assert.equal(run('completed'), 1);
run('reset();robots[0].battery=12;openDispatch()');
get('confirm-dispatch').click();
assert.equal(run('tasks.filter(t=>t.status==="Active").length'), 0);
run('reset();assign(tasks[0]);step(2);cancelTask(tasks[0]);step(500);render()');
assert.equal(run('completed'), 0);
assert.equal(run('robots[0].state'), 'Idle');
run('reset();running=false;assign(tasks[0]);robots[0].battery=12;running=true');
const queued = run('queueTimeline(dispatchContext()).entries[0]');
assert(queued.chargeWait > 0);
run('step(500)');
assert.equal(run('completed'), 1);
run('reset()');
get('route-condition').value = 'entry';
get('route-condition').onchange();
get('demo').click();
get('confirm-dispatch').click();
assert.equal(run('tasks.filter(t=>t.status==="Active").length'), 0);
run('reset();assign(tasks[0]);step(5);');
const moved = run(
  'managerPositionsChanged(managerStandingZonesInMetres(75).map((z,i)=>i?z:{...z,x_m:545/75,y_m:250/75}))',
);
assert(moved.ok);
assert(!run('managerHoldReason'));
run('step(500)');
assert.equal(run('completed'), 1);
assert.equal(run('robots.length'), 1);
console.log(
  'PASS: original dashboard with one AMR, three sequential deliveries, approval exclusivity, pause/resume, cancellation, recharge, route closure and manager relocation.',
);
