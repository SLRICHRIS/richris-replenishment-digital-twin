// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Surveyed route graph in metres; no actuator/controller dependencies.
import { referenceRouteGraph } from '../warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
const assets = ['amr-01', 'amr-02', 'amr-03'],
  bins = ['A', 'B', 'C', 'D'];
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(id);
export function referenceFacility(verified = false) {
  return {
    schema: 'replenish-facility/v1',
    frameId: 'warehouse-01',
    widthM: 12,
    heightM: 6.6667,
    verified,
    slowBoundaryXM: 4,
    ...referenceRouteGraph(),
  };
}
export function checkedFacility(input) {
  if (
    !input ||
    input.schema !== 'replenish-facility/v1' ||
    !validId(input.frameId) ||
    typeof input.verified !== 'boolean' ||
    !Number.isFinite(input.widthM) ||
    input.widthM < 0.5 ||
    input.widthM > 12 ||
    !Number.isFinite(input.heightM) ||
    input.heightM < 0.5 ||
    input.heightM > 6.6667 ||
    !Number.isFinite(input.slowBoundaryXM) ||
    input.slowBoundaryXM < 0 ||
    input.slowBoundaryXM > input.widthM ||
    !Array.isArray(input.nodes) ||
    input.nodes.length < 7 ||
    input.nodes.length > 80 ||
    !Array.isArray(input.edges) ||
    input.edges.length < 1 ||
    input.edges.length > 200
  )
    throw Error(
      'Facility requires a frame, measured extents, 7–80 nodes and 1–200 edges within the supported 12 × 6.67 m envelope.',
    );
  const ids = new Set(),
    seenAssets = new Set(),
    seenBins = new Set();
  const nodes = input.nodes.map((n) => {
    if (
      !n ||
      !validId(n.id) ||
      ids.has(n.id) ||
      !['bay', 'bin', 'junction'].includes(n.role) ||
      !Number.isFinite(n.x_m) ||
      !Number.isFinite(n.y_m) ||
      n.x_m < 0 ||
      n.x_m > input.widthM ||
      n.y_m < 0 ||
      n.y_m > input.heightM
    )
      throw Error('Each route node needs a unique ID, role and coordinates inside the facility.');
    ids.add(n.id);
    if (n.role === 'bay') {
      if (!assets.includes(n.assetId) || seenAssets.has(n.assetId))
        throw Error('Assign exactly one loading bay to each AMR.');
      seenAssets.add(n.assetId);
    }
    if (n.role === 'bin') {
      if (!bins.includes(n.binId) || seenBins.has(n.binId))
        throw Error('Assign exactly one destination to each A–D bin.');
      seenBins.add(n.binId);
    }
    return {
      id: n.id,
      role: n.role,
      x_m: n.x_m,
      y_m: n.y_m,
      ...(n.role === 'bay' ? { assetId: n.assetId } : {}),
      ...(n.role === 'bin' ? { binId: n.binId } : {}),
    };
  });
  if (seenAssets.size !== 3 || seenBins.size !== 4)
    throw Error('Facility needs three bays and four bin destinations.');
  const edgeIds = new Set();
  const edges = input.edges.map((e) => {
    if (
      !e ||
      !ids.has(e.from) ||
      !ids.has(e.to) ||
      e.from === e.to ||
      typeof e.bidirectional !== 'boolean'
    )
      throw Error(
        'Every edge must connect different known nodes and declare bidirectional true or false.',
      );
    const a = nodes.find((n) => n.id === e.from),
      b = nodes.find((n) => n.id === e.to);
    if (Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m) < 0.001)
      throw Error('Zero-length route edges are not supported.');
    const key = routeEdgeKey(e);
    if (edgeIds.has(key)) throw Error('Duplicate route links are not supported.');
    edgeIds.add(key);
    return { from: e.from, to: e.to, bidirectional: e.bidirectional };
  });
  const result = {
    schema: input.schema,
    frameId: input.frameId,
    widthM: input.widthM,
    heightM: input.heightM,
    verified: input.verified,
    slowBoundaryXM: input.slowBoundaryXM,
    nodes,
    edges,
  };
  for (const bay of nodes.filter((n) => n.role === 'bay'))
    for (const bin of nodes.filter((n) => n.role === 'bin')) {
      graphRoute(result, bay.id, bin.id, 1, 1);
      graphRoute(result, bin.id, bay.id, 1, 1);
    }
  return result;
}
export function edgeSegments(a, b, speed, boundary, speedFactor) {
  const points = [a];
  if ((a.x_m < boundary && b.x_m > boundary) || (a.x_m > boundary && b.x_m < boundary)) {
    const f = (boundary - a.x_m) / (b.x_m - a.x_m);
    points.push({ x_m: boundary, y_m: a.y_m + (b.y_m - a.y_m) * f });
  }
  points.push(b);
  return points.slice(1).map((p, i) => {
    const q = points[i],
      metres = Math.hypot(p.x_m - q.x_m, p.y_m - q.y_m),
      v = speed * ((p.x_m + q.x_m) / 2 > boundary ? speedFactor : 1);
    return { metres, seconds: metres / v };
  });
}
export const routeEdgeKey = (e) =>
  e.bidirectional ? [e.from, e.to].sort().join('~') : e.from + '>' + e.to;
export function checkedRouting(facility, options = {}) {
  const objective = options.objective ?? 'distance',
    blockedEdges = options.blockedEdges ?? [];
  if (
    !['distance', 'time'].includes(objective) ||
    !Array.isArray(blockedEdges) ||
    blockedEdges.some(
      (k) => typeof k !== 'string' || !facility.edges.some((e) => routeEdgeKey(e) === k),
    )
  )
    throw Error('Choose distance or time and known route links.');
  return { objective, blockedEdges: [...new Set(blockedEdges)].sort() };
}
function compareCost(a, b, objective) {
  const keys =
    objective === 'distance' ? ['metres', 'seconds', 'hops'] : ['seconds', 'metres', 'hops'];
  for (const key of keys) {
    const delta = a[key] - b[key];
    if (Math.abs(delta) > 1e-9) return delta;
  }
  return a.key.localeCompare(b.key);
}
function routeResult(facility, nodes, speed, speedFactor, options, edgeKeys) {
  const segments = nodes
    .slice(1)
    .flatMap((n, i) => edgeSegments(nodes[i], n, speed, facility.slowBoundaryXM, speedFactor));
  return {
    objective: options.objective,
    nodes,
    edgeKeys,
    segments,
    seconds: segments.reduce((s, x) => s + x.seconds, 0),
    metres: segments.reduce((s, x) => s + x.metres, 0),
  };
}
export function graphRoute(
  facility,
  from,
  to,
  speed,
  speedFactor = 1,
  options = {},
  observe = null,
) {
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(speedFactor) || speedFactor <= 0)
    throw Error('Route speed must be positive.');
  options = checkedRouting(facility, options);
  const lookup = new Map(facility.nodes.map((n) => [n.id, n])),
    cost = new Map([[from, { metres: 0, seconds: 0, hops: 0, key: from }]]),
    previous = new Map(),
    visited = new Set(),
    blocked = new Set(options.blockedEdges);
  if (!lookup.has(from) || !lookup.has(to)) throw Error('Unknown route endpoint.');
  const emit = (kind, current, improved = []) => {
    if (observe)
      observe({
        kind,
        current,
        settled: [...visited],
        frontier: [...cost]
          .filter(([id]) => !visited.has(id))
          .sort((a, b) => compareCost(a[1], b[1], options.objective))
          .map(([id, value]) => ({ id, ...value })),
        costs: [...cost].map(([id, value]) => ({ id, ...value })),
        tree: [...previous].map(([id, p]) => ({ from: p.id, to: id, edge: p.edge })),
        improved,
      });
  };
  emit('start', null);
  while (true) {
    const current = [...cost.entries()]
      .filter(([id]) => !visited.has(id))
      .sort((a, b) => compareCost(a[1], b[1], options.objective))[0];
    if (!current) break;
    const [id, weight] = current;
    visited.add(id);
    if (id === to) {
      emit('complete', id);
      break;
    }
    const improved = [];
    const neighbors = facility.edges
      .filter((e) => !blocked.has(routeEdgeKey(e)))
      .flatMap((e) =>
        e.from === id
          ? [{ next: e.to, edge: e }]
          : e.bidirectional && e.to === id
            ? [{ next: e.from, edge: e }]
            : [],
      );
    for (const { next, edge } of neighbors) {
      if (visited.has(next)) continue;
      const parts = edgeSegments(
        lookup.get(id),
        lookup.get(next),
        speed,
        facility.slowBoundaryXM,
        speedFactor,
      );
      const sum = {
        metres: weight.metres + parts.reduce((s, e) => s + e.metres, 0),
        seconds: weight.seconds + parts.reduce((s, e) => s + e.seconds, 0),
        hops: weight.hops + 1,
        key: weight.key + '/' + next,
      };
      if (!cost.has(next) || compareCost(sum, cost.get(next), options.objective) < 0) {
        cost.set(next, sum);
        previous.set(next, { id, edge: routeEdgeKey(edge) });
        improved.push({
          from: id,
          to: next,
          edge: routeEdgeKey(edge),
          metres: sum.metres,
          seconds: sum.seconds,
        });
      }
    }
    emit('settle', id, improved);
  }
  if (!cost.has(to)) {
    emit('unreachable', null);
    throw Error(
      'No permitted route from ' + from + ' to ' + to + '. Check closures and directed links.',
    );
  }
  const ids = [to],
    edgeKeys = [];
  while (ids[0] !== from) {
    const p = previous.get(ids[0]);
    if (!p) throw Error('Route graph is disconnected.');
    ids.unshift(p.id);
    edgeKeys.unshift(p.edge);
  }
  return routeResult(
    facility,
    ids.map((id) => lookup.get(id)),
    speed,
    speedFactor,
    options,
    edgeKeys,
  );
}
// Opt-in trace captures the production search; it is never a second route algorithm.
export function graphRouteTrace(facility, from, to, speed, speedFactor = 1, options = {}) {
  const events = [];
  try {
    return {
      route: graphRoute(facility, from, to, speed, speedFactor, options, (event) =>
        events.push(event),
      ),
      events,
      error: null,
    };
  } catch (error) {
    if (!error.message.startsWith('No permitted route')) throw error;
    return { route: null, events, error: error.message };
  }
}
// Anchor a measured/model pose only to an existing node or an open segment.
// A one-way segment permits forward travel only. No cross-rack connector is invented.
export function graphRouteFromPose(facility, pose, to, speed, speedFactor = 1, options = {}) {
  options = checkedRouting(facility, options);
  if (!Number.isFinite(pose?.x_m) || !Number.isFinite(pose?.y_m))
    throw Error('Route position must be finite.');
  const tolerance = 0.00014,
    lookup = new Map(facility.nodes.map((n) => [n.id, n]));
  const atNode = facility.nodes.find(
    (n) => Math.hypot(n.x_m - pose.x_m, n.y_m - pose.y_m) <= tolerance,
  );
  if (atNode) return graphRoute(facility, atNode.id, to, speed, speedFactor, options);
  const candidates = [];
  for (const edge of facility.edges) {
    if (options.blockedEdges.includes(routeEdgeKey(edge))) continue;
    const a = lookup.get(edge.from),
      b = lookup.get(edge.to),
      dx = b.x_m - a.x_m,
      dy = b.y_m - a.y_m;
    const f = ((pose.x_m - a.x_m) * dx + (pose.y_m - a.y_m) * dy) / (dx * dx + dy * dy);
    if (
      f < 0 ||
      f > 1 ||
      Math.hypot(a.x_m + f * dx - pose.x_m, a.y_m + f * dy - pose.y_m) > tolerance
    )
      continue;
    for (const endpoint of edge.bidirectional ? [a, b] : [b]) {
      let tail;
      try {
        tail = graphRoute(facility, endpoint.id, to, speed, speedFactor, options);
      } catch (error) {
        if (!error.message.startsWith('No permitted route')) throw error;
        continue;
      }
      const result = routeResult(
        facility,
        [{ id: 'current', ...pose }, ...tail.nodes],
        speed,
        speedFactor,
        options,
        [routeEdgeKey(edge), ...tail.edgeKeys],
      );
      candidates.push({
        ...result,
        hops: result.edgeKeys.length,
        key: result.nodes.map((n) => n.id).join('/'),
      });
    }
  }
  const best = candidates.sort((a, b) => compareCost(a, b, options.objective))[0];
  if (!best) throw Error('Robot position has no permitted path on the route network.');
  return best;
}
export function travelledMetres(segments, seconds) {
  let time = Math.max(0, seconds),
    distance = 0;
  for (const s of segments) {
    const used = Math.min(time, s.seconds);
    distance += (used / s.seconds) * s.metres;
    time -= used;
    if (time <= 0) break;
  }
  return distance;
}
