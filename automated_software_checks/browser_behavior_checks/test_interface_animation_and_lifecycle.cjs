// DOM behavior checks; run with jsdom available through NODE_PATH.
// Animation timing is controlled here. This is not a visual/browser test.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const base = require('node:path').resolve(__dirname, '../../frontend_warehouse_dashboard');
const html = fs.readFileSync(base + '/index.html', 'utf8');

function workspace({ savedMotion = null, osReduced = false, animationsSupported = true } = {}) {
  const dom = new JSDOM(html, {
    url: 'https://test.invalid/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window,
    doc = w.document,
    frames = [],
    effects = [],
    listeners = new Map(),
    intervals = new Map(),
    workers = [];
  const media = {
    matches: osReduced,
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
  };
  w.matchMedia = () => media;
  if (savedMotion) w.localStorage.setItem('replenish.motion', savedMotion);
  w.HTMLElement.prototype.getClientRects = w.SVGElement.prototype.getClientRects = function () {
    return this.isConnected ? [{ width: 500, height: 80 }] : [];
  };
  if (animationsSupported)
    w.Element.prototype.animate = function (keyframes, options) {
      let resolve, reject;
      const effect = {
        target: this,
        keyframes,
        options,
        ended: false,
        finished: new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
        finish() {
          if (!this.ended) {
            this.ended = true;
            resolve();
          }
        },
        cancel() {
          if (!this.ended) {
            this.ended = true;
            reject(new Error('cancelled'));
          }
        },
      };
      effects.push(effect);
      return effect;
    };
  const returnFocus = new WeakMap();
  w.HTMLDialogElement.prototype.showModal = function () {
    returnFocus.set(this, doc.activeElement);
    this.open = true;
    this.querySelector('button')?.focus();
  };
  w.HTMLDialogElement.prototype.close = function (value = '') {
    this.returnValue = value;
    this.open = false;
    this.dispatchEvent(new w.Event('close'));
    returnFocus.get(this)?.focus();
  };
  w.ResizeObserver = class {
    constructor(fn) {
      this.fn = fn;
    }
    observe() {
      this.fn();
    }
  };
  w.requestAnimationFrame = (fn) => {
    frames.push(fn);
    return frames.length;
  };
  let intervalId = 0;
  w.setInterval = (fn) => {
    intervals.set(++intervalId, fn);
    return intervalId;
  };
  w.clearInterval = (id) => intervals.delete(id);
  w.setTimeout = () => 1;
  w.clearTimeout = () => {};
  w.scrollTo = () => {};
  w.TextDecoder = TextDecoder;
  w.TextEncoder = TextEncoder;
  w.Worker = class {
    constructor(url) {
      this.url = url;
      workers.push(this);
    }
    postMessage(data) {
      this.data = data;
    }
    terminate() {
      this.terminated = true;
    }
  };
  w.TwinScene = class {
    constructor() {
      this.camera = { yaw: 0, elevation: 0.7, zoom: 1 };
      this.layers = { routes: true, grid: true };
      this.width = 1000;
      this.rendererKind = 'DOM fixture';
    }
    setView() {}
    setTheme() {}
    resize() {}
    draw() {}
    focus() {}
    zoomBy() {}
    cameraChanged() {}
  };
  const context = dom.getInternalVMContext();
  const run = (source) => vm.runInContext(source, context);
  run(
    'Object.assign(window,(()=>{' +
      fs
        .readFileSync(
          base +
            '/browser_modules/warehouse_reference_geometry/warehouse_manager_standing_zones_and_route_clearance.js',
          'utf8',
        )
        .replace(/export /g, '') +
      ';return{MANAGER_STANDING_ZONES,managerStandingZonesInMetres,checkedManagerStandingZones,segmentIntersectsManagerZone,managerZoneHatchSegments,managerZonesInModelCoordinates};})())',
  );
  run(
    'Object.assign(window,(()=>{' +
      fs
        .readFileSync(
          base +
            '/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js',
          'utf8',
        )
        .replace(/^import[\s\S]*?;\s*$/gm, '')
        .replace(/export /g, '') +
      ';return{AMR_HOME,WAREHOUSE_LAYOUT,BIN_DESTINATIONS,STORAGE_RACKS,AISLE_X,AISLE_Y,LANE_SEGMENTS,referenceRouteGraph,paintLanePlan};})())',
  );
  run(
    'Object.assign(window,(()=>{' +
      fs
        .readFileSync(
          base +
            '/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js',
          'utf8',
        )
        .replace(/^import[\s\S]*?;\s*$/gm, '')
        .replace(/export /g, '') +
      ';return{referenceFacility,checkedFacility,graphRoute,graphRouteTrace,graphRouteFromPose,checkedRouting,managerRestrictedEdgeKeys,routeEdgeKey,edgeSegments,travelledMetres};})())',
  );
  for (const name of [
    'browser_modules/esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness',
    'browser_modules/robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay',
    'browser_modules/robot_mission_simulation/node_and_segment_time_window_reservations',
    'browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion',
    'browser_modules/robot_mission_simulation/manager_relocation_and_fleet_route_replanning',
    'browser_modules/shortest_path_and_route_map/interactive_route_map_and_algorithm_playback',
    'browser_modules/esp32_telemetry_monitoring/esp32_mqtt_connection_and_status_panel',
    'browser_modules/dashboard_navigation_and_appearance/dashboard_animation_and_element_updates',
    'browser_modules/robot_state_models_and_policy_experiments/robot_model_validation_and_experiment_panel',
    'browser_modules/dashboard_navigation_and_appearance/warehouse_simulation_and_dashboard_controller',
  ]) {
    run(
      fs
        .readFileSync(base + '/' + name + '.js', 'utf8')
        .replace(/^import[\s\S]*?;\s*$/gm, '')
        .replace(/export /g, '')
        .replace(/if\s*\(document\.fonts\)\s*await document\.fonts\.ready;/, ''),
    );
  }
  function flush() {
    const batch = frames.splice(0);
    for (const fn of batch) fn(100);
  }
  async function settle() {
    for (const effect of effects) effect.finish();
    await Promise.resolve();
    await Promise.resolve();
  }
  return {
    dom,
    w,
    doc,
    run,
    flush,
    settle,
    effects,
    media,
    workers,
    tickIntervals() {
      for (const fn of [...intervals.values()]) fn();
    },
    changeOS(value) {
      media.matches = value;
      listeners.get('change')?.();
    },
  };
}

(async () => {
  const ui = workspace(),
    { doc, run, effects } = ui,
    $ = (id) => doc.getElementById(id);
  ui.flush();
  await ui.settle();
  const initialRows = [...$('tasks').children],
    bins = [...$('bins').children];
  const log = $('log').firstElementChild;
  run('step(.2);render()');
  ui.flush();
  assert.deepEqual([...$('tasks').children], initialRows, 'refreshes must preserve mission rows');
  assert.deepEqual([...$('bins').children], bins, 'stock updates must preserve meter elements');
  assert.equal($('log').firstElementChild, log);
  run("log('New operator action');render()");
  ui.flush();
  assert.equal($('log').children[1], log, 'prepending a log must keep older rows attached');

  $('demo').focus();
  $('demo').click();
  assert($('dispatch-dialog').open);
  assert.equal($('dispatch-review').children.length, 3);
  const body = doc.querySelector('.dispatch-body'),
    footer = doc.querySelector('.dispatch-actions');
  assert.equal(body.parentElement, $('dispatch-dialog'));
  assert.equal(footer.parentElement, $('dispatch-dialog'));
  assert(!body.contains(footer), 'approval controls must stay outside scrolling cards');
  $('confirm-dispatch').click();
  assert.equal(
    run('tasks.filter(t=>t.status==="Active").length'),
    1,
    'animation must not defer dispatch',
  );
  assert.equal(run('tasks.filter(t=>t.status==="Queued").length'), 0);
  assert($('dispatch-dialog').inert, 'a closing approval dialog cannot be clicked twice');
  ui.flush();
  await ui.settle();
  assert(!$('dispatch-dialog').open);
  const row = doc.querySelector('[data-motion-key="mission-1-1"]'),
    progress = row.querySelector('.task-progress i');
  run('step(2);render()');
  ui.flush();
  assert.equal(doc.querySelector('[data-motion-key="mission-1-1"]'), row);
  assert.equal(row.querySelector('.task-progress i'), progress);
  assert(parseFloat(progress.style.width) > 0);
  run('pauseRobot(0)');
  const paused = run('robots[0].x');
  run('step(3)');
  assert.equal(run('robots[0].x'), paused);

  run('reset();activatePage("missions")');
  ui.flush();
  await ui.settle();
  const select = $('tasks').querySelector('select');
  select.focus();
  const selection = select.value;
  run('step(1);render()');
  ui.flush();
  assert.equal(doc.activeElement, select);
  assert.equal(select.value, selection);
  select.blur();
  run('reassign(tasks[0],1);render()');
  assert.equal(
    doc.querySelector('[data-reassign="1"]').value,
    '0',
    'removed AMRs cannot replace the configured AMR-01',
  );
  run('activatePage("telemetry")');
  ui.flush();
  const lines = [...$('energy-chart').querySelectorAll('polyline')];
  run('step(2);render()');
  ui.flush();
  assert.deepEqual([...$('energy-chart').querySelectorAll('polyline')], lines);
  run('activatePage("environment");selected=0;render()');
  ui.flush();
  assert.equal($('inspect-title').textContent, 'AMR-01');
  await ui.settle();
  const stableEffectCount = effects.length;
  run('render()');
  ui.flush();
  assert.equal(
    effects.length,
    stableEffectCount,
    'unchanged values must not continuously replay motion',
  );

  run(
    "motion.openDialog(document.getElementById('help-dialog'));motion.closeDialog(document.getElementById('help-dialog'));motion.openDialog(document.getElementById('help-dialog'))",
  );
  await ui.settle();
  assert($('help-dialog').open, 'a cancelled exit cannot close a reopened dialog');
  run("motion.closeDialog(document.getElementById('help-dialog'))");
  $('motion-toggle').click();
  assert.equal(doc.documentElement.dataset.motion, 'reduced');
  assert(!$('help-dialog').open, 'reducing motion must complete a pending modal exit');
  assert.equal(ui.w.localStorage.getItem('replenish.motion'), 'reduced');
  assert(run('scene.reducedMotion'));
  assert($('auto-orbit').disabled);
  const reducedCount = effects.length;
  run('activatePage("missions");selected=0;render()');
  ui.flush();
  $('demo').click();
  $('cancel-dispatch').click();
  assert(!$('dispatch-dialog').open);
  assert.equal(effects.length, reducedCount, 'reduced motion must suppress JS animations too');
  $('motion-toggle').click();
  assert.equal(doc.documentElement.dataset.motion, 'full');
  ui.changeOS(true);
  assert.equal(doc.documentElement.dataset.motion, 'reduced');
  assert($('motion-toggle').disabled);
  ui.changeOS(false);
  assert.equal(doc.documentElement.dataset.motion, 'full');
  $('theme-bright').click();
  assert.equal(doc.documentElement.dataset.theme, 'bright');
  $('theme-dark').click();
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  run('activatePage("environment");setFloorSource("hardware")');
  assert($('stop').disabled);
  assert.equal($('unit-battery').textContent, '—');
  assert.equal(doc.querySelectorAll('.navigation-cursor').length, 1);
  const dispatchBeforeMap = run('JSON.stringify({routing,tasks,robots})');
  $('expand').click();
  assert(doc.body.classList.contains('scene-expanded'));
  $('tab-routes').click();
  assert(
    !doc.body.classList.contains('scene-expanded'),
    'leaving Floor must restore document scrolling',
  );
  assert.equal(doc.body.dataset.view, 'routes');
  assert(!$('routes').hidden);
  assert.equal($('tab-routes').getAttribute('aria-selected'), 'true');
  assert.equal($('page-mode').textContent, 'Route preview');
  assert.equal($('source-badge').textContent, 'Reference route preview');
  assert(run('routeMap.getSnapshot().state.visible'));
  $('map-destination').value = 'binA';
  $('map-destination').dispatchEvent(new ui.w.Event('change'));
  $('map-tool-lanes').click();
  doc
    .querySelector('[data-map-edge="lane00~lane10"]')
    .dispatchEvent(new ui.w.MouseEvent('click', { bubbles: true }));
  assert.equal(
    run('JSON.stringify({routing,tasks,robots})'),
    dispatchBeforeMap,
    'map edits must leave dispatch state intact',
  );
  $('map-mode-algorithm').click();
  $('map-search-play').click();
  assert(run('routeMap.getSnapshot().state.playing'));
  run('activatePage("engineering")');
  $('lab-reference').click();
  assert(!run('routeMap.getSnapshot().state.visible'));
  assert(!run('routeMap.getSnapshot().state.playing'), 'page navigation pauses route playback');
  doc.querySelector('[data-lab-tab="calibration"]').click();
  assert(doc.querySelector('[data-lab-panel="state"]').hidden);
  assert(!doc.querySelector('[data-lab-panel="calibration"]').hidden);
  const liveProfiles = run('JSON.stringify(engineering.liveEngine.profiles)');
  $('lab-fit').click();
  assert(!$('lab-apply-fit').disabled);
  $('lab-apply-fit').click();
  assert.equal(run('JSON.stringify(engineering.liveEngine.profiles)'), liveProfiles);
  doc.querySelector('[data-lab-tab="state"]').click();
  assert.equal(doc.querySelectorAll('#lab-assets tr').length, 1);
  assert.equal(doc.querySelectorAll('#lab-map polyline').length, 2);
  $('theme-bright').click();
  assert.equal(doc.documentElement.dataset.theme, 'bright');
  $('lab-source').value = 'live';
  $('lab-source').dispatchEvent(new ui.w.Event('change'));
  assert.equal($('lab-frame-confirmed').checked, false);
  assert($('lab-replay').hidden);
  // Restore the reference source and verify one frame convention across both maps.
  $('lab-reference').click();
  const binY = (id) =>
    +[...$('lab-map').querySelectorAll('text')]
      .find((e) => e.textContent.trim() === id)
      .getAttribute('y');
  assert(
    binY('A') < binY('C'),
    'Twin lab and Route map must both place smaller reference Y above larger Y',
  );
  assert($('lab-map-note').textContent.includes('+Y down'));
  const experimentWorker = ui.workers.find(
    (x) =>
      x.url ===
      './browser_modules/background_calculation_workers/dispatch_policy_experiment_worker.js',
  );
  $('lab-run-experiment').click();
  const oldRequest = experimentWorker.data;
  $('lab-sim-source').click();
  experimentWorker.onmessage({
    data: { requestId: oldRequest.requestId, error: 'obsolete source response' },
  });
  assert(!$('lab-experiment-message').textContent.includes('obsolete source response'));
  assert($('lab-export-experiment').disabled);
  $('lab-source').value = 'recording';
  $('lab-source').dispatchEvent(new ui.w.Event('change'));
  $('lab-play').click();
  ui.tickIntervals();
  const replayCursor = +$('lab-cursor').value;
  assert(replayCursor > 0);
  $('tab-routes').click();
  ui.tickIntervals();
  assert.equal(+$('lab-cursor').value, replayCursor, 'leaving Twin lab pauses replay');
  $('tab-engineering').click();
  assert.equal($('lab-play').getAttribute('aria-pressed'), 'false');
  ui.changeOS(true);
  ui.tickIntervals();
  assert($('lab-play').disabled);
  $('lab-cursor').value = '3';
  $('lab-cursor').dispatchEvent(new ui.w.Event('input'));
  assert.equal(+$('lab-cursor').value, 3);
  ui.changeOS(false);
  ui.tickIntervals();
  assert(!$('lab-play').disabled);
  ui.w.dispatchEvent(new ui.w.Event('pagehide'));
  ui.w.dispatchEvent(new ui.w.Event('pageshow'));
  $('lab-play').click();
  ui.tickIntervals();
  assert(+$('lab-cursor').value > 3, 'replay resumes correctly after page restoration');
  const restoredWorker = ui.workers.at(-1);
  assert.equal(typeof restoredWorker.onerror, 'function');
  assert.equal(typeof restoredWorker.onmessageerror, 'function');
  restoredWorker.onmessageerror();
  assert($('lab-run-experiment').disabled);
  assert($('lab-experiment-message').textContent.includes('service unavailable'));
  // A hosted raw-sensor session must not offer the disconnected v1 observer source.
  $('lab-source').value = 'live';
  $('lab-source').dispatchEvent(new ui.w.Event('change'));
  doc.documentElement.dataset.pythonTwin = 'true';
  doc.dispatchEvent(new ui.w.CustomEvent('python-twin:render'));
  assert.equal($('lab-source').value, 'recording');
  assert($('lab-source').querySelector('option[value="live"]').disabled);
  $('lab-reference').click();
  $('lab-cursor').value = '7';
  $('lab-cursor').dispatchEvent(new ui.w.Event('input'));
  const hostedFloor = run('JSON.stringify({tasks,robots})');
  doc.dispatchEvent(new ui.w.CustomEvent('python-twin:render'));
  assert.equal(+$('lab-cursor').value, 7, 'sensor refresh preserves the reference replay');
  assert.equal(run('JSON.stringify({tasks,robots})'), hostedFloor);
  $('lab-source').value = 'live';
  $('lab-source').dispatchEvent(new ui.w.Event('change'));
  assert.equal($('lab-source').value, 'recording', 'hosted scope rejects a legacy source');
  $('tab-engineering').click();
  assert.equal(doc.body.dataset.view, 'hardware', 'old study deep links resolve to slide models');
  $('tab-hardware').dispatchEvent(
    new ui.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
  );
  assert.equal(doc.body.dataset.view, 'missions');
  $('tab-missions').dispatchEvent(
    new ui.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
  );
  assert.equal(doc.body.dataset.view, 'activity', 'keyboard navigation skips hidden study views');
  await ui.settle();
  ui.dom.window.close();

  const saved = workspace({ savedMotion: 'reduced' });
  saved.flush();
  assert.equal(saved.doc.documentElement.dataset.motion, 'reduced');
  assert.equal(saved.effects.length, 0);
  saved.dom.window.close();
  const os = workspace({ osReduced: true });
  os.flush();
  assert.equal(os.doc.documentElement.dataset.motion, 'reduced');
  assert.equal(os.effects.length, 0);
  os.dom.window.close();
  const fallback = workspace({ animationsSupported: false });
  fallback.doc.getElementById('demo').click();
  fallback.doc.getElementById('confirm-dispatch').click();
  assert.equal(fallback.run('tasks.filter(t=>t.status==="Active").length'), 1);
  fallback.dom.window.close();
  console.log(
    'PASS: persistent DOM rows/bars/charts, focus and select preservation, immediate mission actions, modal close/reopen races, stable animation counts, both themes, saved/device reduced motion, graceful fallback, source isolation, Route map navigation/isolation/pause and Twin lab DOM navigation/calibration/plots.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
