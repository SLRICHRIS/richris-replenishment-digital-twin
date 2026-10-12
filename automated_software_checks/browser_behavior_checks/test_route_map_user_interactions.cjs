// Functional DOM/pointer fixtures. This is not browser visual or GPU verification.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { JSDOM } = require('jsdom');
(async () => {
  const dom = new JSDOM(
    fs.readFileSync(
      require('node:path').resolve(__dirname, '../../frontend_warehouse_dashboard/index.html'),
      'utf8',
    ),
    { pretendToBeVisual: true },
  );
  const w = dom.window,
    doc = w.document,
    $ = (id) => doc.getElementById(id),
    svg = $('route-map-svg');
  globalThis.document = doc;
  globalThis.ResizeObserver = class {
    constructor(fn) {
      this.fn = fn;
    }
    observe() {
      this.fn();
    }
  };
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 540 });
  let captures = [];
  svg.setPointerCapture = (id) => captures.push(id);
  const simulation = {
      robots: [{ id: 0, x: 120, y: 170, battery: 96 }],
      bins: [{ id: 'A', stock: 64 }],
      tasks: [],
      routing: { objective: 'distance', blockedEdges: [] },
      slow: false,
    },
    before = JSON.stringify(simulation);
  const { createRouteMap } = await import(
    '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/interactive_route_map_and_algorithm_playback.js'
  );
  let reduced = false;
  const dragFlags = [],
    appliedZones = [];
  const { checkedManagerRelocation } = await import(
    '../../frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/manager_relocation_and_fleet_route_replanning.js'
  );
  const api = createRouteMap({
    getSimulation: () => simulation,
    isReducedMotion: () => reduced,
    onManagerDragChange: (active) => dragFlags.push(active),
    onManagersMoved(zones) {
      try {
        checkedManagerRelocation(zones);
        appliedZones.push(zones);
        return { ok: true, message: 'Position applied.' };
      } catch (error) {
        return { ok: false, message: error.message };
      }
    },
  });
  api.setVisible(true);
  const snapshot = () => api.getSnapshot(),
    click = (selector) =>
      svg
        .querySelector(selector)
        .dispatchEvent(new w.MouseEvent('click', { bubbles: true, detail: 1 }));
  const change = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const input = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const pointer = (type, id, x, y, target = svg) => {
    const event = new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: id });
    target.dispatchEvent(event);
  };
  assert.equal(svg.querySelectorAll('[data-map-node]').length, 22);
  assert.equal(svg.querySelectorAll('[data-map-edge]').length, 27);
  assert.equal(svg.querySelectorAll('[data-map-rack]').length, 12);
  const { MANAGER_STANDING_ZONES } = await import(
    '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/warehouse_manager_standing_zones_and_route_clearance.js'
  );
  assert.equal(svg.querySelectorAll('[data-manager-zone]').length, 2);
  for (const zone of MANAGER_STANDING_ZONES) {
    const marker = svg.querySelector(`[data-manager-zone="${zone.id}"]`);
    const position = marker.getAttribute('transform').match(/translate\(([^,]+),([^\)]+)\)/);
    assert(Math.abs(Number(position[1]) - zone.x) < 1e-8);
    assert(Math.abs(Number(position[2]) - zone.y) < 1e-8);
    assert.equal(
      Number(marker.querySelector('.map-manager-boundary').getAttribute('r')),
      zone.radius,
    );
    assert(marker.getAttribute('aria-label').includes('No AMR entry'));
    assert(marker.textContent.includes(zone.label.toUpperCase()));
    assert(marker.querySelector('.map-manager-person'));
  }
  assert(doc.querySelector('.map-legend .manager'));
  assert(doc.querySelector('.facility-register .manager'));
  assert.equal(snapshot().state.to, 'binD');
  assert(snapshot().plans.outbound.route);
  assert($('map-directions').textContent.includes('Arrive at Bin D'));
  click('[data-map-node="binA"]');
  assert.equal(snapshot().state.to, 'binA');
  assert.equal($('map-destination').value, 'binA');
  $('map-tool-start').click();
  click('[data-map-node="bay03"]');
  assert.equal(snapshot().state.from, 'bay03');
  $('map-tool-lanes').click();
  click('[data-map-edge="entry~lane10"] .map-edge-hit');
  assert.equal(snapshot().plans.outbound.route, null);
  assert($('map-nav-play').disabled);
  assert($('route-map-status').textContent.includes('No permitted route'));
  assert(!svg.outerHTML.includes('NaN'));
  $('map-open-lanes').click();
  assert(snapshot().plans.outbound.route);
  assert.equal(snapshot().state.blockedEdges.length, 0);
  $('map-mode-algorithm').click();
  assert.equal(snapshot().state.tool, 'inspect');
  assert(!$('map-search-panel').hidden);
  assert($('map-navigation-controls').hidden);
  $('map-search-next').click();
  assert.equal(snapshot().state.step, 1);
  assert(snapshot().plans.outbound.events[1].settled.includes('bay03'));
  const endpoints = [snapshot().state.from, snapshot().state.to];
  click('[data-map-node="bay03"]');
  assert.deepEqual([snapshot().state.from, snapshot().state.to], endpoints);
  assert(!$('map-node-info').hidden);
  assert($('map-node-info-cost').textContent.includes('Settled cost'));
  input('map-search-progress', snapshot().plans.outbound.events.length - 1);
  assert(svg.querySelector('[data-map-node="binA"]').classList.contains('settled'));
  assert($('map-route-line').getAttribute('d').length > 0);
  assert($('map-search-next').disabled);
  $('map-search-play').click();
  assert.equal(snapshot().state.step, 0);
  api.tick(0);
  for (let t = 100; t <= 2500; t += 100) api.tick(t);
  assert(snapshot().state.step >= 3);
  api.setVisible(false);
  assert.equal(snapshot().state.playing, false);
  api.setVisible(true);
  $('map-mode-navigation').click();
  input('map-nav-progress', 500);
  assert(Math.abs(snapshot().state.seconds - snapshot().plans.outbound.route.seconds / 2) < 1e-9);
  assert($('map-preview-robot').getAttribute('transform').includes('rotate('));
  assert.equal($('map-directions').querySelectorAll('.current').length, 1);
  $('map-nav-reset').click();
  $('map-nav-play').click();
  api.tick(0);
  api.tick(250);
  assert(Math.abs(snapshot().state.seconds - 1) < 1e-8, '4x playback changes model time correctly');
  reduced = true;
  api.tick(500);
  assert.equal(snapshot().state.playing, false);
  assert($('map-nav-play').disabled);
  input('map-nav-progress', 1000);
  assert.equal(snapshot().state.seconds, snapshot().plans.outbound.route.seconds);
  reduced = false;
  api.render();
  change('map-leg', 'return');
  assert.equal(snapshot().plans.return.route.nodes[0].id, 'binA');
  assert.equal(snapshot().state.seconds, 0);
  assert.equal($('map-origin').value, 'binA');
  assert.equal($('map-destination').value, 'bay03');
  assert(svg.querySelector('[data-map-node="binA"]').classList.contains('start'));
  assert(svg.querySelector('[data-map-node="bay03"]').classList.contains('end'));
  assert.equal(svg.querySelector('[data-map-node="binA"] .map-pin-letter').textContent, 'S');
  assert($('map-directions').textContent.includes('Arrive at Bay 03'));
  $('map-tool-start').click();
  click('[data-map-node="binB"]');
  assert.equal(snapshot().plans.return.route.nodes[0].id, 'binB');
  assert.equal($('map-origin').value, 'binB');
  change('map-destination', 'bay02');
  assert.equal(snapshot().plans.return.route.nodes.at(-1).id, 'bay02');
  assert.equal(snapshot().plans.outbound.route.nodes[0].id, 'bay02');
  change('map-speed-zone', 'slow');
  assert(snapshot().state.slow);
  $('map-choose-time').click();
  assert.equal(snapshot().state.objective, 'time');
  const width = snapshot().view.w;
  $('map-zoom-in').click();
  assert(snapshot().view.w < width);
  $('map-reset-view').click();
  assert.equal(snapshot().view.w, 900);
  captures = [];
  const origin = svg.querySelector('[data-map-node="bay01"]');
  pointer('pointerdown', 1, 120, 170, origin);
  pointer('pointerup', 1, 120, 170, origin);
  assert.equal(captures.length, 0, 'Station clicks must not be stolen by pointer capture');
  const old = snapshot().view;
  pointer('pointerdown', 1, 200, 200);
  pointer('pointermove', 1, 250, 220);
  pointer('pointerup', 1, 250, 220);
  assert(snapshot().view.x < old.x);
  const closures = JSON.stringify(snapshot().state.blockedEdges);
  click('[data-map-edge="entry~lane10"]');
  assert.equal(
    JSON.stringify(snapshot().state.blockedEdges),
    closures,
    'Drag release must not toggle a lane',
  );
  const priorW = snapshot().view.w;
  pointer('pointerdown', 1, 200, 200);
  pointer('pointerdown', 2, 260, 200);
  pointer('pointermove', 2, 330, 200);
  assert(snapshot().view.w < priorW);
  pointer('pointerup', 1, 200, 200);
  pointer('pointerup', 2, 330, 200);
  svg.dispatchEvent(new w.KeyboardEvent('keydown', { key: '0', bubbles: true }));
  assert.equal(snapshot().view.w, 900);
  svg.dispatchEvent(new w.KeyboardEvent('keydown', { key: '+', bubbles: true }));
  assert.equal(snapshot().view.w, 720);
  $('map-tool-start').click();
  origin.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(snapshot().state.to, 'bay01');
  assert.equal(snapshot().plans.return.route.nodes[0].id, 'bay01');
  const reserve = svg.querySelector('[data-map-rack="R02"]');
  reserve.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert($('route-map-status').textContent.includes('reserve storage'));
  assert.equal(
    JSON.stringify(simulation),
    before,
    'Exploration and playback have no dispatch authority',
  );
  simulation.routing = { objective: 'distance', blockedEdges: ['lane00~lane10'] };
  simulation.slow = true;
  const dispatchBefore = JSON.stringify(simulation);
  $('map-copy-dispatch').click();
  assert.deepEqual(snapshot().state.blockedEdges, simulation.routing.blockedEdges);
  assert.equal(JSON.stringify(simulation), dispatchBefore);
  $('map-reset-view').click();
  $('map-mode-navigation').click();
  change('map-origin', 'lane11');
  change('map-destination', 'lane12');
  change('map-leg', 'outbound');
  change('map-speed-zone', 'normal');
  $('map-open-lanes').click();
  const directDistance = snapshot().plans.outbound.route.metres;
  $('map-tool-managers').click();
  assert.equal($('map-tool-managers').getAttribute('aria-pressed'), 'true');
  const manager = svg.querySelector('[data-manager-zone="manager-01"]');
  const panBefore = { ...snapshot().view };
  pointer('pointerdown', 20, 130, 80, manager);
  pointer('pointermove', 20, 545, 270);
  assert.equal(dragFlags.at(-1), true);
  assert(
    snapshot().plans.outbound.route.metres > directDistance,
    'Dragging updates the route before release',
  );
  assert.deepEqual(snapshot().view, panBefore, 'Manager drag must not pan the map');
  pointer('pointerup', 20, 545, 270);
  assert.equal(dragFlags.at(-1), false);
  assert.equal(appliedZones.length, 1);
  assert(Math.abs(snapshot().state.managerZones[0].x_m * 75 - 545) < 1e-8);
  assert(svg.querySelector('[data-map-edge="lane11~lane12"]').classList.contains('closed'));
  api.toggleEdge('lane11~lane12');
  $('map-open-lanes').click();
  assert(!snapshot().plans.outbound.route.edgeKeys.includes('lane11~lane12'));
  pointer('pointerdown', 21, 545, 270, manager);
  pointer('pointermove', 21, 700, 270);
  pointer('pointercancel', 21, 700, 270);
  assert.equal(appliedZones.length, 1, 'Cancelled touch placement does not apply a position');
  assert(Math.abs(snapshot().state.managerZones[0].x_m * 75 - 545) < 1e-8);
  pointer('pointerdown', 22, 545, 270, manager);
  pointer('pointermove', 22, 335, 205);
  pointer('pointerup', 22, 335, 205);
  assert($('map-manager-status').textContent.includes('rack footprints'));
  assert(
    Math.abs(snapshot().state.managerZones[0].x_m * 75 - 545) < 1e-8,
    'Invalid placement restores the old position',
  );
  manager.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
  );
  assert(Math.abs(snapshot().state.managerZones[0].x_m * 75 - 548) < 1e-8);
  $('map-reset-managers').click();
  assert.equal(snapshot().plans.outbound.route.metres, directDistance);
  assert(!svg.querySelector('[data-map-edge="lane11~lane12"]').classList.contains('closed'));
  pointer('pointerdown', 23, 130, 80, manager);
  pointer('pointermove', 23, 440, 270);
  api.setVisible(false);
  assert.equal(dragFlags.at(-1), false, 'Leaving the map clears the placement hold');
  assert(Math.abs(snapshot().state.managerZones[0].x_m * 75 - 130) < 1e-8);
  api.setVisible(true);
  simulation.robots[0].x = 200;
  api.tick(9000);
  assert(svg.querySelector('[data-map-fleet-robot="0"]').getAttribute('transform').includes('200'));
  dom.window.close();
  delete globalThis.document;
  delete globalThis.ResizeObserver;
  console.log(
    'PASS: real DOM map picking, closure rerouting, unreachable states, exact trace scrubbing/playback, node inspection, navigation playback, reduced motion, leg/objective switching, touch pan/pinch, keyboard controls and dispatch isolation.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
