// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Reference-map exploration only. Uses the dispatch solver; never assigns a mission.
import {
  referenceFacility,
  graphRouteTrace,
  managerRestrictedEdgeKeys,
  routeEdgeKey,
  travelledMetres,
} from './warehouse_graph_validation_and_dijkstra_routing.js';
import {
  STORAGE_RACKS,
  WAREHOUSE_LAYOUT,
} from '../warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
import { MODEL } from '../robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';

export function routeNodeLabel(node) {
  if (node.role === 'bay') return 'Bay ' + node.assetId.slice(-2);
  if (node.role === 'bin') return 'Bin ' + node.binId;
  if (node.id === 'entry') return 'Depot entry';
  if (node.id.startsWith('stage')) return 'Bay staging ' + node.id.slice(-2);
  if (node.id.startsWith('lane'))
    return ['North', 'Central', 'South'][+node.id[4]] + ' aisle · lane ' + (+node.id[5] + 1);
  return node.id;
}
export function routePosition(route, seconds) {
  const elapsed = Math.max(0, Math.min(route.seconds, seconds)),
    metres = travelledMetres(route.segments, elapsed);
  let remaining = metres,
    heading = 0,
    position = route.nodes[0],
    prefix = [position];
  for (let i = 1; i < route.nodes.length; i++) {
    const a = route.nodes[i - 1],
      b = route.nodes[i],
      length = Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m);
    heading = Math.atan2(b.y_m - a.y_m, b.x_m - a.x_m);
    if (remaining < length - 1e-9) {
      position = {
        x_m: a.x_m + ((b.x_m - a.x_m) * remaining) / length,
        y_m: a.y_m + ((b.y_m - a.y_m) * remaining) / length,
      };
      prefix.push(position);
      break;
    }
    remaining -= length;
    position = b;
    prefix.push(b);
  }
  return {
    ...position,
    heading,
    metres,
    seconds: elapsed,
    remainingM: Math.max(0, route.metres - metres),
    remainingS: Math.max(0, route.seconds - elapsed),
    prefix,
  };
}
function routeTimeAtDistance(route, metres) {
  let remaining = metres,
    time = 0;
  for (const s of route.segments) {
    const used = Math.min(s.metres, Math.max(0, remaining));
    time += (used / s.metres) * s.seconds;
    remaining -= used;
    if (remaining <= 1e-9) break;
  }
  return time;
}
export function routeDirections(route) {
  const groups = [];
  let metres = 0;
  for (let i = 1; i < route.nodes.length; i++) {
    const a = route.nodes[i - 1],
      b = route.nodes[i],
      dx = b.x_m - a.x_m,
      dy = b.y_m - a.y_m,
      length = Math.hypot(dx, dy),
      heading = Math.atan2(dy, dx),
      last = groups.at(-1);
    if (
      last &&
      Math.abs(Math.atan2(Math.sin(heading - last.heading), Math.cos(heading - last.heading))) <
        1e-8
    ) {
      last.to = b;
      last.toM = metres + length;
      last.metres += length;
    } else
      groups.push({ from: a, to: b, fromM: metres, toM: metres + length, metres: length, heading });
    metres += length;
  }
  return groups.map((g, i) => {
    const delta = i
      ? Math.atan2(
          Math.sin(g.heading - groups[i - 1].heading),
          Math.cos(g.heading - groups[i - 1].heading),
        )
      : 0;
    const turn = i === 0 ? 'start' : Math.abs(delta) > 2.6 ? 'uturn' : delta > 0 ? 'right' : 'left';
    const cardinal = ['east', 'south', 'west', 'north'][
      (Math.round(g.heading / (Math.PI / 2)) + 4) % 4
    ];
    return {
      ...g,
      turn,
      label:
        (i === 0
          ? 'Head ' + cardinal
          : turn === 'uturn'
            ? 'Make a U-turn'
            : turn === 'right'
              ? 'Turn right'
              : 'Turn left') +
        ' toward ' +
        routeNodeLabel(g.to),
      seconds: routeTimeAtDistance(route, g.toM) - routeTimeAtDistance(route, g.fromM),
    };
  });
}
export function routeMapPoint(view, rect, clientX, clientY) {
  const scale = Math.min(rect.width / view.w, rect.height / view.h);
  return {
    x: view.x + (clientX - rect.left - (rect.width - view.w * scale) / 2) / scale,
    y: view.y + (clientY - rect.top - (rect.height - view.h * scale) / 2) / scale,
    scale,
  };
}
export function zoomRouteView(
  view,
  factor,
  anchor = { x: view.x + view.w / 2, y: view.y + view.h / 2 },
) {
  const width = Math.max(220, Math.min(1600, view.w * factor)),
    ratio = width / view.w;
  return {
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
    w: width,
    h: view.h * ratio,
  };
}
export function createRouteMap({ getSimulation, isReducedMotion = () => false }) {
  const $ = (id) => document.getElementById(id),
    map = referenceFacility(),
    lookup = new Map(map.nodes.map((n) => [n.id, n])),
    svg = $('route-map-svg');
  const state = {
    from: 'bay01',
    to: 'binD',
    objective: 'distance',
    slow: false,
    blockedEdges: [],
    leg: 'outbound',
    mode: 'navigation',
    tool: 'destination',
    inspected: null,
    step: 0,
    seconds: 0,
    playing: false,
    visible: false,
    speed: 4,
  };
  let plans = {},
    comparison = {},
    view = { x: 0, y: -20, w: 900, h: 540 },
    lastTick = null,
    searchClock = 0,
    dragged = false;
  const pointers = new Map(),
    nodeElements = new Map(),
    edgeElements = new Map();
  const duration = (s) =>
    s < 60 ? s.toFixed(1) + ' s' : Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s';
  const path = (nodes) =>
    nodes
      .map(
        (n, i) =>
          (i ? 'L' : 'M') +
          (n.x_m * MODEL.scale).toFixed(3) +
          ' ' +
          (n.y_m * MODEL.scale).toFixed(3),
      )
      .join(' ');
  const selected = () => plans[state.leg];
  const endpoints = () =>
    state.leg === 'outbound'
      ? { from: state.from, to: state.to }
      : { from: state.to, to: state.from };
  const endpointKey = (tool) =>
    state.leg === 'outbound'
      ? tool === 'start'
        ? 'from'
        : 'to'
      : tool === 'start'
        ? 'to'
        : 'from';
  const snapshot = () => JSON.parse(JSON.stringify({ state, view, plans, comparison }));
  const tell = (message) => ($('route-map-status').textContent = message);
  const set = (id, value) => {
    const e = $(id);
    if (e.textContent !== value) e.textContent = value;
  };
  const options = () => ({ objective: state.objective, blockedEdges: state.blockedEdges });
  function buildMap() {
    const rackMarkup = STORAGE_RACKS.map(
      (r) => /* HTML */ `
        <g class="map-rack ${r.binId ? 'active' : 'reserve'}" data-map-rack="${r.id}">
          <rect
            x="${r.x - WAREHOUSE_LAYOUT.rackFootprintWidth / 2}"
            y="${r.y - WAREHOUSE_LAYOUT.rackFootprintDepth / 2}"
            width="${WAREHOUSE_LAYOUT.rackFootprintWidth}"
            height="${WAREHOUSE_LAYOUT.rackFootprintDepth}"
            rx="4"
          />
          ${[-18, 18]
            .map(
              (d) => /* HTML */ `
                <path d="M${r.x + d} ${r.y - 23}v46" />
              `,
            )
            .join('')}
          <text x="${r.x}" y="${r.y + 5}" text-anchor="middle">${r.id}</text>
          <title>
            ${r.id} · ${r.address} ·
            ${r.binId ? 'line supply for Bin ' + r.binId : 'reserve storage; no route stop'}
          </title>
        </g>
      `,
    ).join('');
    const bays = map.nodes
      .filter((n) => n.role === 'bay')
      .map(
        (n) => /* HTML */ `
          <g class="map-bay">
            <rect x="50" y="${n.y_m * 75 - 28}" width="112" height="56" rx="6" />
            <text x="75" y="${n.y_m * 75 + 5}">${n.assetId.slice(-2)}</text>
          </g>
        `,
      )
      .join('');
    const roads = map.edges
      .map((e) => {
        const a = lookup.get(e.from),
          b = lookup.get(e.to),
          key = routeEdgeKey(e),
          d = path([a, b]);
        return /* HTML */ `
          <g class="map-edge" data-map-edge="${key}" role="button">
            <path class="map-road-border" d="${d}" />
            <path class="map-road" d="${d}" />
            <path class="map-edge-mark" d="${d}" />
            <path class="map-edge-hit" d="${d}" />
          </g>
        `;
      })
      .join('');
    const nodes = map.nodes
      .map(
        (n) => /* HTML */ `
          <g
            class="map-node ${n.role}"
            data-map-node="${n.id}"
            role="button"
            tabindex="0"
            transform="translate(${n.x_m * 75},${n.y_m * 75})"
          >
            <circle r="${n.role === 'junction' ? 6 : 12}" />
            <text class="map-pin-letter" text-anchor="middle" y="5"></text>
            ${n.role === 'bin'
              ? /* HTML */ `
                  <text class="map-stop-label" y="-21" text-anchor="middle">Bin ${n.binId}</text>
                `
              : ''}
            <title>${routeNodeLabel(n)}</title>
          </g>
        `,
      )
      .join('');
    const managers = map.restrictedZones
      .map(
        (zone) => /* HTML */ `
          <g
            class="map-manager-zone"
            data-manager-zone="${zone.id}"
            role="img"
            aria-label="${zone.label}, restricted standing area. No AMR entry. Configured reference location."
            transform="translate(${zone.x_m * MODEL.scale},${zone.y_m * MODEL.scale})"
          >
            <title>
              ${zone.label}: no AMR entry. Route clearance includes the robot footprint. Configured
              location, no live personnel tracking.
            </title>
            <circle class="map-manager-boundary" r="${zone.radius_m * MODEL.scale}" />
            <g class="map-manager-person" aria-hidden="true" transform="translate(0,-8)">
              <path class="map-manager-trousers" d="M-8 5H8L10 24H2L0 12-2 24H-10Z" />
              <path class="map-manager-vest" d="M-8-9H8L15 5 10 8 6-1 7 8H-7L-6-1-10 8-15 5Z" />
              <path class="map-manager-reflective" d="M-7-3H7M-7 3H7M-3-8V7M3-8V7" />
              <circle class="map-manager-head" cy="-17" r="7" />
              <path class="map-manager-helmet" d="M-9-17Q-9-28 0-28T9-17Z M-11-17H11" />
            </g>
            <g class="map-manager-no-entry" transform="translate(27,-22)" aria-hidden="true">
              <circle r="7" />
              <path d="M-4 0H4" />
            </g>
            <text class="map-manager-label" y="29" text-anchor="middle">
              ${zone.label.toUpperCase()}
            </text>
            <text class="map-manager-restriction-label" y="39" text-anchor="middle">
              NO AMR ENTRY
            </text>
          </g>
        `,
      )
      .join('');
    $('route-map-content').innerHTML = /* HTML */ `
      <defs>
        <pattern id="map-grid-pattern" width="75" height="75" patternUnits="userSpaceOnUse">
          <path d="M75 0H0V75" class="map-grid-line" />
        </pattern>
        <pattern id="map-manager-hatch" width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" class="map-manager-hatch-base" />
          <path d="M-2 2 2-2M0 10 10 0M8 12 12 8" class="map-manager-hatch-line" />
        </pattern>
      </defs>
      <rect class="map-floor" x="8" y="8" width="884" height="484" rx="12" />
      <rect x="8" y="8" width="884" height="484" fill="url(#map-grid-pattern)" />
      ${roads}${rackMarkup}${bays}${managers}
      <g class="map-place-labels">
        <text x="42" y="124">CHARGING BAYS</text>
        <text x="492" y="118">NORTH CROSS AISLE</text>
        <text x="492" y="248">CENTRAL CROSS AISLE</text>
        <text x="492" y="378">SOUTH CROSS AISLE</text>
      </g>
      <path id="map-alternate-line" class="map-alternate-line" />
      <path id="map-other-leg" class="map-other-leg" />
      <path id="map-route-halo" class="map-route-halo" />
      <path id="map-route-line" class="map-route-line" />
      <path id="map-search-tree" class="map-search-tree" />
      <path id="map-search-improved" class="map-search-improved" />
      <path id="map-travelled" class="map-travelled" />
      ${nodes}
      <g id="map-preview-robot" class="map-preview-robot" aria-hidden="true">
        <circle r="15" />
        <path d="M-5 -6 8 0-5 6Z" />
      </g>
    `;
    for (const element of svg.querySelectorAll('[data-map-node]'))
      nodeElements.set(element.dataset.mapNode, element);
    for (const element of svg.querySelectorAll('[data-map-edge]'))
      edgeElements.set(element.dataset.mapEdge, element);
  }
  function populateStops() {
    const groups = [
      ['Loading bays', 'bay'],
      ['Line supply', 'bin'],
      ['Aisle junctions', 'junction'],
    ];
    for (const id of ['map-origin', 'map-destination']) {
      $(id).innerHTML = groups
        .map(
          ([label, role]) => /* HTML */ `
            <optgroup label="${label}">
              ${map.nodes
                .filter((n) => n.role === role)
                .map(
                  (n) => /* HTML */ `
                    <option value="${n.id}">${routeNodeLabel(n)}</option>
                  `,
                )
                .join('')}
            </optgroup>
          `,
        )
        .join('');
    }
    $('map-origin').value = state.from;
    $('map-destination').value = state.to;
  }
  function compute() {
    state.playing = false;
    state.step = 0;
    state.seconds = 0;
    lastTick = null;
    searchClock = 0;
    $('map-origin').value = endpoints().from;
    $('map-destination').value = endpoints().to;
    const speed = MODEL.speed / MODEL.scale,
      factor = state.slow ? MODEL.congestedSpeed / MODEL.speed : 1;
    plans = {
      outbound: graphRouteTrace(map, state.from, state.to, speed, factor, options()),
      return: graphRouteTrace(map, state.to, state.from, speed, factor, options()),
    };
    comparison = {
      distance: graphRouteTrace(
        map,
        state.leg === 'outbound' ? state.from : state.to,
        state.leg === 'outbound' ? state.to : state.from,
        speed,
        factor,
        { ...options(), objective: 'distance' },
      ),
      time: graphRouteTrace(
        map,
        state.leg === 'outbound' ? state.from : state.to,
        state.leg === 'outbound' ? state.to : state.from,
        speed,
        factor,
        { ...options(), objective: 'time' },
      ),
    };
    render(true);
  }
  function renderDirections() {
    const route = selected().route;
    $('map-directions').innerHTML = route
      ? routeDirections(route)
          .map(
            (d, i) => /* HTML */ `
              <li data-direction="${i}">
                <span class="map-direction-icon" aria-hidden="true">
                  ${{ start: '↑', left: '↰', right: '↱', uturn: '↶' }[d.turn]}
                </span>
                <div>
                  <b>${d.label}</b>
                  <small>${d.metres.toFixed(2)} m · ${duration(d.seconds)}</small>
                </div>
              </li>
            `,
          )
          .join('') +
        /* HTML */ `
          <li class="map-arrival">
            <span class="map-direction-icon" aria-hidden="true">◎</span>
            <div>
              <b>Arrive at ${routeNodeLabel(route.nodes.at(-1))}</b>
              <small>Preview destination</small>
            </div>
          </li>
        `
      : '<li class="map-no-directions">No directions available. Reopen a connecting lane or choose another stop.</li>';
  }
  function render(full = false) {
    const plan = selected(),
      route = plan.route,
      trace = plan.events[Math.min(state.step, plan.events.length - 1)],
      algorithm = state.mode === 'algorithm',
      complete = trace?.kind === 'complete';
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    $('map-navigation-controls').hidden = algorithm;
    $('map-algorithm-controls').hidden = !algorithm;
    $('map-search-panel').hidden = !algorithm;
    $('map-directions-panel').hidden = algorithm;
    $('map-mode-navigation').setAttribute('aria-pressed', String(!algorithm));
    $('map-mode-algorithm').setAttribute('aria-pressed', String(algorithm));
    for (const [id, tool] of [
      ['map-tool-start', 'start'],
      ['map-tool-destination', 'destination'],
      ['map-tool-lanes', 'lanes'],
      ['map-tool-inspect', 'inspect'],
    ])
      $(id).setAttribute('aria-pressed', String(state.tool === tool));
    set(
      'map-mode-note',
      algorithm
        ? 'Dijkstra search · ' +
            (state.objective === 'distance'
              ? 'distance first, time breaks ties'
              : 'time first, distance breaks ties')
        : 'Navigation preview · travel time excludes mission queue and charging',
    );
    set('map-distance', route ? route.metres.toFixed(2) + ' m' : 'No route');
    set('map-time', route ? duration(route.seconds) : '—');
    const both = plans.outbound.route && plans.return.route;
    set(
      'map-roundtrip',
      both
        ? 'Out + return: ' +
            (plans.outbound.route.metres + plans.return.route.metres).toFixed(2) +
            ' m · ' +
            duration(plans.outbound.route.seconds + plans.return.route.seconds)
        : 'Complete outbound and return journey unavailable',
    );
    set('map-leg-name', state.leg === 'outbound' ? 'Outbound' : 'Return');
    set('map-closures', state.blockedEdges.length + ' / ' + map.edges.length + ' links closed');
    set(
      'map-tap-hint',
      state.tool === 'inspect'
        ? 'Tap a node to inspect its position and search cost.'
        : state.tool === 'lanes'
          ? 'Tap an aisle to close or reopen it. Drag to pan.'
          : state.tool === 'start'
            ? 'Tap a stop or junction to set the start. Drag to pan.'
            : 'Tap a stop or junction to set the destination. Drag to pan.',
    );
    const shown = !algorithm || complete;
    const other = plans[state.leg === 'outbound' ? 'return' : 'outbound'].route;
    $('map-route-halo').setAttribute('d', shown && route ? path(route.nodes) : '');
    $('map-route-line').setAttribute('d', shown && route ? path(route.nodes) : '');
    $('map-other-leg').setAttribute(
      'd',
      !algorithm && $('map-show-return').checked && other ? path(other.nodes) : '',
    );
    const alternate = comparison[state.objective === 'distance' ? 'time' : 'distance'].route,
      identical =
        route &&
        alternate &&
        route.nodes.map((n) => n.id).join('/') === alternate.nodes.map((n) => n.id).join('/');
    $('map-alternate-line').setAttribute(
      'd',
      !algorithm && $('map-show-alternate').checked && alternate && !identical
        ? path(alternate.nodes)
        : '',
    );
    $('map-search-tree').setAttribute(
      'd',
      algorithm
        ? (trace?.tree || []).map((e) => path([lookup.get(e.from), lookup.get(e.to)])).join(' ')
        : '',
    );
    $('map-search-improved').setAttribute(
      'd',
      algorithm
        ? (trace?.improved || []).map((e) => path([lookup.get(e.from), lookup.get(e.to)])).join(' ')
        : '',
    );
    const managerBlocked = managerRestrictedEdgeKeys(map);
    for (const edge of map.edges) {
      const e = edgeElements.get(routeEdgeKey(edge)),
        managerRestricted = managerBlocked.includes(routeEdgeKey(edge)),
        closed = managerRestricted || state.blockedEdges.includes(routeEdgeKey(edge));
      e.classList.toggle('closed', closed);
      e.classList.toggle(
        'restricted',
        state.slow && (lookup.get(edge.from).x_m > 4 || lookup.get(edge.to).x_m > 4),
      );
      e.setAttribute('tabindex', state.tool === 'lanes' ? '0' : '-1');
      e.setAttribute('aria-pressed', String(closed));
      e.setAttribute(
        'aria-label',
        `${routeNodeLabel(lookup.get(edge.from))} to ${routeNodeLabel(lookup.get(edge.to))}, ${managerRestricted ? 'restricted by a manager standing area' : closed ? 'closed' : 'open'}. ${managerRestricted ? 'Cannot reopen a restricted lane.' : state.tool === 'lanes' ? 'Press to toggle lane.' : 'Select Close lane to edit.'}`,
      );
    }
    const settled = new Set(algorithm ? trace?.settled : []),
      frontier = new Set(algorithm ? trace?.frontier.map((n) => n.id) : []);
    for (const node of map.nodes) {
      const e = nodeElements.get(node.id),
        start = node.id === endpoints().from,
        end = node.id === endpoints().to;
      for (const [name, on] of [
        ['settled', settled.has(node.id)],
        ['frontier', frontier.has(node.id)],
        ['current', algorithm && trace?.current === node.id],
        ['start', start],
        ['end', end],
        ['inspected', node.id === state.inspected],
      ])
        e.classList.toggle(name, on);
      e.querySelector('.map-pin-letter').textContent =
        start && end ? 'S/D' : start ? 'S' : end ? 'D' : node.role === 'bin' ? node.binId : '';
      e.setAttribute(
        'aria-label',
        routeNodeLabel(node) +
          (start ? ', start' : '') +
          (end ? ', destination' : '') +
          (algorithm && settled.has(node.id) ? ', settled' : ''),
      );
    }
    $('map-node-info').hidden = !state.inspected;
    if (state.inspected) {
      const node = lookup.get(state.inspected),
        event = algorithm ? trace : plan.events.at(-1),
        cost = event.costs.find((c) => c.id === node.id);
      set('map-node-info-title', routeNodeLabel(node));
      set('map-node-info-position', `X ${node.x_m.toFixed(2)} / Y ${node.y_m.toFixed(2)} m`);
      set(
        'map-node-info-cost',
        cost
          ? `${event.settled.includes(node.id) ? 'Settled cost' : 'Best known'}: ${cost.metres.toFixed(2)} m · ${duration(cost.seconds)}`
          : 'Not reached in this search step.',
      );
    }
    const max = plan.events.length - 1;
    $('map-search-progress').max = String(max);
    $('map-search-progress').value = String(state.step);
    $('map-search-progress').setAttribute('aria-valuetext', `Search step ${state.step} of ${max}`);
    $('map-search-back').disabled = state.step <= 0;
    $('map-search-next').disabled = state.step >= max;
    $('map-search-play').disabled = isReducedMotion() || max <= 0;
    $('map-search-play').textContent =
      state.playing && algorithm
        ? 'Pause search'
        : state.step >= max
          ? 'Replay search'
          : 'Play search';
    $('map-nav-play').disabled = !route || route.seconds === 0 || isReducedMotion();
    $('map-nav-play').textContent =
      state.playing && !algorithm
        ? 'Pause preview'
        : route && state.seconds >= route.seconds
          ? 'Replay route'
          : 'Play route';
    $('map-nav-progress').disabled = !route || route.seconds === 0;
    $('map-nav-progress').value = String(
      route && route.seconds ? Math.round((state.seconds / route.seconds) * 1000) : 0,
    );
    $('map-nav-progress').setAttribute(
      'aria-valuetext',
      route
        ? duration(state.seconds) + ' of ' + duration(route.seconds) + ' model travel time'
        : 'No route',
    );
    const motion = route ? routePosition(route, state.seconds) : null,
      marker = $('map-preview-robot');
    marker.style.display = route && !algorithm ? '' : 'none';
    if (motion)
      marker.setAttribute(
        'transform',
        `translate(${motion.x_m * 75},${motion.y_m * 75}) rotate(${(motion.heading * 180) / Math.PI})`,
      );
    $('map-travelled').setAttribute('d', motion && !algorithm ? path(motion.prefix) : '');
    set(
      'map-navigation-readout',
      motion
        ? duration(motion.seconds) + ' elapsed · ' + motion.remainingM.toFixed(2) + ' m remaining'
        : 'Route unavailable',
    );
    set(
      'map-search-readout',
      'Step ' + state.step + ' / ' + max + ' · ' + (trace?.settled.length || 0) + ' nodes settled',
    );
    if (algorithm) {
      const description =
        trace.kind === 'start'
          ? 'Seed the start at zero cost. The next candidate is the cheapest unsettled node.'
          : trace.kind === 'unreachable'
            ? 'No unsettled candidates remain. The destination cannot be reached through the open lanes.'
            : trace.kind === 'complete'
              ? 'Destination settled. The predecessor links produce the optimal route for the selected objective.'
              : `Settle ${routeNodeLabel(lookup.get(trace.current))}. ${trace.improved.length} neighbor cost${trace.improved.length === 1 ? '' : 's'} improved. Next candidate: ${trace.frontier[0] ? routeNodeLabel(lookup.get(trace.frontier[0].id)) : 'none'}.`;
      set('map-search-description', description);
      $('map-frontier').innerHTML =
        trace.frontier
          .slice(0, 7)
          .map(
            (n, i) => /* HTML */ `
              <tr>
                <td>${i === 0 ? '→ ' : ''}${routeNodeLabel(lookup.get(n.id))}</td>
                <td>${n.metres.toFixed(2)} m</td>
                <td>${duration(n.seconds)}</td>
              </tr>
            `,
          )
          .join('') || '<tr><td colspan="3">No unsettled candidates.</td></tr>';
    }
    if (full) {
      renderDirections();
      for (const objective of ['distance', 'time']) {
        const r = comparison[objective].route;
        set(
          'map-compare-' + objective,
          r ? r.metres.toFixed(2) + ' m · ' + duration(r.seconds) : 'No permitted route',
        );
        $('map-choose-' + objective).setAttribute(
          'aria-pressed',
          String(state.objective === objective),
        );
      }
      set(
        'map-alternative-note',
        identical
          ? 'Both objectives select the same route in these conditions.'
          : 'The alternative uses the same open links and speed assumptions.',
      );
      tell(
        !route
          ? 'No permitted route for this leg. Reopen an aisle to restore connectivity.'
          : !both
            ? 'This leg is reachable, but a complete return journey is unavailable.'
            : state.blockedEdges.length
              ? 'Route recalculated around ' +
                state.blockedEdges.length +
                ' closed link' +
                (state.blockedEdges.length === 1 ? '' : 's') +
                '.'
              : 'Route ready. Choose Navigation or Algorithm to explore it.',
      );
    }
    if (route && !algorithm) {
      const directions = routeDirections(route);
      for (const element of $('map-directions').querySelectorAll('[data-direction]')) {
        const d = directions[+element.dataset.direction];
        element.classList.toggle(
          'current',
          motion.metres >= d.fromM - 1e-8 && motion.metres < d.toM - 1e-8,
        );
      }
    }
    const bounds = svg.getBoundingClientRect();
    if (bounds.width > 0) {
      const scale = Math.min(bounds.width / view.w, bounds.height / view.h);
      set('map-scale-value', '1 m');
      $('map-scale-rule').style.width = (75 * scale).toFixed(1) + 'px';
    }
  }
  function chooseNode(id) {
    if (!lookup.has(id) || state.tool === 'lanes') return;
    if (state.tool === 'inspect') {
      state.inspected = id;
      render();
      return;
    }
    state[endpointKey(state.tool)] = id;
    compute();
  }
  function toggleEdge(key) {
    if (!edgeElements.has(key)) return;
    if (managerRestrictedEdgeKeys(map).includes(key)) {
      tell('This lane intersects a manager standing area and cannot be reopened.');
      return;
    }
    state.blockedEdges = state.blockedEdges.includes(key)
      ? state.blockedEdges.filter((k) => k !== key)
      : [...state.blockedEdges, key].sort();
    compute();
  }
  function stop() {
    state.playing = false;
    lastTick = null;
    searchClock = 0;
    render();
  }
  function stepSearch(delta) {
    state.playing = false;
    state.step = Math.max(0, Math.min(selected().events.length - 1, state.step + delta));
    render();
  }
  function fitRoute() {
    const route = selected().route;
    if (!route) {
      view = { x: 0, y: -20, w: 900, h: 540 };
      render();
      return;
    }
    const xs = route.nodes.map((n) => n.x_m * 75),
      ys = route.nodes.map((n) => n.y_m * 75);
    const w = Math.max(360, Math.max(...xs) - Math.min(...xs) + 150),
      h = Math.max(260, Math.max(...ys) - Math.min(...ys) + 130);
    view = {
      x: (Math.max(...xs) + Math.min(...xs) - w) / 2,
      y: (Math.max(...ys) + Math.min(...ys) - h) / 2,
      w,
      h,
    };
    render();
  }
  function zoom(factor, anchor) {
    view = zoomRouteView(view, factor, anchor);
    render();
  }
  function clampPan() {
    view.x = Math.max(-80 - view.w / 2, Math.min(980 - view.w / 2, view.x));
    view.y = Math.max(-80 - view.h / 2, Math.min(580 - view.h / 2, view.y));
  }
  for (const [id, tool] of [
    ['map-origin', 'start'],
    ['map-destination', 'destination'],
  ])
    $(id).onchange = () => {
      state[endpointKey(tool)] = $(id).value;
      compute();
    };
  $('map-objective').onchange = () => {
    state.objective = $('map-objective').value;
    compute();
  };
  $('map-speed-zone').onchange = () => {
    state.slow = $('map-speed-zone').value === 'slow';
    compute();
  };
  $('map-leg').onchange = () => {
    state.leg = $('map-leg').value;
    compute();
  };
  for (const mode of ['navigation', 'algorithm'])
    $('map-mode-' + mode).onclick = () => {
      state.mode = mode;
      if (mode === 'algorithm') state.tool = 'inspect';
      stop();
    };
  for (const [id, tool] of [
    ['map-tool-start', 'start'],
    ['map-tool-destination', 'destination'],
    ['map-tool-lanes', 'lanes'],
    ['map-tool-inspect', 'inspect'],
  ])
    $(id).onclick = () => {
      state.tool = tool;
      render();
    };
  $('map-node-info-close').onclick = () => {
    state.inspected = null;
    render();
  };
  for (const objective of ['distance', 'time'])
    $('map-choose-' + objective).onclick = () => {
      state.objective = objective;
      $('map-objective').value = objective;
      compute();
    };
  $('map-show-return').onchange = () => render();
  $('map-show-alternate').onchange = () => render();
  $('map-copy-dispatch').onclick = () => {
    const c = getSimulation();
    state.objective = c.routing?.objective || 'distance';
    state.blockedEdges = [...(c.routing?.blockedEdges || [])];
    state.slow = !!c.slow;
    $('map-objective').value = state.objective;
    $('map-speed-zone').value = state.slow ? 'slow' : 'normal';
    compute();
    tell('Dispatch conditions copied into this preview. Approved missions are unaffected.');
  };
  $('map-open-lanes').onclick = () => {
    state.blockedEdges = [];
    compute();
  };
  $('map-search-back').onclick = () => stepSearch(-1);
  $('map-search-next').onclick = () => stepSearch(1);
  $('map-search-reset').onclick = () => {
    state.step = 0;
    stop();
  };
  $('map-search-progress').oninput = () => {
    state.step = +$('map-search-progress').value;
    stop();
  };
  $('map-nav-progress').oninput = () => {
    state.seconds = (selected().route.seconds * +$('map-nav-progress').value) / 1000;
    stop();
  };
  $('map-nav-speed').onchange = () => {
    state.speed = +$('map-nav-speed').value;
  };
  for (const id of ['map-search-play', 'map-nav-play'])
    $(id).onclick = () => {
      if (isReducedMotion()) return;
      if (state.playing) {
        stop();
        return;
      }
      if (state.mode === 'algorithm' && state.step >= selected().events.length - 1) state.step = 0;
      if (
        state.mode === 'navigation' &&
        selected().route &&
        state.seconds >= selected().route.seconds
      )
        state.seconds = 0;
      state.playing = true;
      lastTick = null;
      searchClock = 0;
      render();
    };
  $('map-nav-reset').onclick = () => {
    state.seconds = 0;
    stop();
  };
  $('map-zoom-in').onclick = () => zoom(0.8);
  $('map-zoom-out').onclick = () => zoom(1.25);
  $('map-fit-route').onclick = fitRoute;
  $('map-reset-view').onclick = () => {
    view = { x: 0, y: -20, w: 900, h: 540 };
    render();
  };
  function action(target) {
    const node = target.closest('[data-map-node]'),
      edge = target.closest('[data-map-edge]'),
      rack = target.closest('[data-map-rack]');
    if (node) chooseNode(node.dataset.mapNode);
    else if (edge && state.tool === 'lanes') toggleEdge(edge.dataset.mapEdge);
    else if (rack) {
      const r = STORAGE_RACKS.find((r) => r.id === rack.dataset.mapRack);
      if (r.binId) chooseNode('bin' + r.binId);
      else tell(r.id + ' is reserve storage. No route stop is registered for this rack.');
    }
  }
  svg.addEventListener('click', (e) => {
    if (dragged) {
      dragged = false;
      if (e.detail > 0) return;
    }
    action(e.target);
  });
  svg.addEventListener('keydown', (e) => {
    if (['Enter', ' '].includes(e.key) && e.target !== svg) {
      e.preventDefault();
      action(e.target);
      return;
    }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoom(0.8);
    } else if (e.key === '-') {
      e.preventDefault();
      zoom(1.25);
    } else if (e.key === '0') {
      $('map-reset-view').click();
    } else if (e.key === 'Escape') stop();
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const n = view.w * 0.05;
      view.x += e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0;
      view.y += e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
      clampPan();
      render();
    }
  });
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = routeMapPoint(view, svg.getBoundingClientRect(), e.clientX, e.clientY);
      zoom(e.deltaY < 0 ? 0.88 : 1.14, p);
    },
    { passive: false },
  );
  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (pointers.size === 0) dragged = false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    if (pointers.size === 2) {
      dragged = true;
      for (const id of pointers.keys()) svg.setPointerCapture?.(id);
    }
  });
  svg.addEventListener('pointermove', (e) => {
    const old = pointers.get(e.pointerId);
    if (!old) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const before = [...pointers.values()];
    pointers.set(e.pointerId, { ...old, x: e.clientX, y: e.clientY });
    const after = [...pointers.values()];
    if (Math.hypot(e.clientX - old.startX, e.clientY - old.startY) > 5) {
      dragged = true;
      svg.setPointerCapture?.(e.pointerId);
    }
    if (!dragged) return;
    if (after.length === 2) {
      const a = before[0],
        b = before[1],
        c = after[0],
        d = after[1],
        distBefore = Math.hypot(a.x - b.x, a.y - b.y),
        distAfter = Math.hypot(c.x - d.x, c.y - d.y);
      if (distBefore > 2 && distAfter > 2) {
        const anchor = routeMapPoint(view, rect, (a.x + b.x) / 2, (a.y + b.y) / 2);
        view = zoomRouteView(view, distBefore / distAfter, anchor);
        const next = routeMapPoint(view, rect, (c.x + d.x) / 2, (c.y + d.y) / 2);
        view.x += anchor.x - next.x;
        view.y += anchor.y - next.y;
        dragged = true;
      }
    } else {
      const scale = routeMapPoint(view, rect, e.clientX, e.clientY).scale;
      view.x -= (e.clientX - old.x) / scale;
      view.y -= (e.clientY - old.y) / scale;
    }
    clampPan();
    render();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', (e) => {
    release(e);
    dragged = true;
  });
  svg.addEventListener('lostpointercapture', release);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
  function tick(now) {
    if (!state.visible || document.hidden) {
      lastTick = null;
      return;
    }
    if (isReducedMotion()) {
      if (state.playing) stop();
      else render();
      return;
    }
    if (!state.playing) {
      lastTick = null;
      return;
    }
    const dt = lastTick === null ? 0 : Math.max(0, Math.min(0.25, (now - lastTick) / 1000));
    lastTick = now;
    if (state.mode === 'algorithm') {
      searchClock += dt;
      if (searchClock >= 0.65) {
        searchClock %= 0.65;
        state.step = Math.min(selected().events.length - 1, state.step + 1);
        if (state.step === selected().events.length - 1) state.playing = false;
        render();
      }
    } else {
      state.seconds = Math.min(selected().route.seconds, state.seconds + dt * state.speed);
      if (state.seconds >= selected().route.seconds) state.playing = false;
      render();
    }
  }
  buildMap();
  populateStops();
  $('map-objective').value = 'distance';
  $('map-speed-zone').value = 'normal';
  $('map-leg').value = 'outbound';
  $('map-nav-speed').value = '4';
  compute();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => render()).observe(svg);
  return {
    tick,
    setVisible(visible) {
      state.visible = visible;
      if (!visible) stop();
      else {
        lastTick = null;
        render();
      }
    },
    getSnapshot: snapshot,
    chooseNode,
    toggleEdge,
    stepSearch,
    render,
  };
}
