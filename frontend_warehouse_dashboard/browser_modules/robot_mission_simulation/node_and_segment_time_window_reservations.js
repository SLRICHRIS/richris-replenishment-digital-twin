// Time windows protect bidirectional segments and shared junctions.
// This is a conservative reference-graph traffic model, not onboard avoidance.
export const TRAFFIC_CLEARANCE = 72; // Two rendered 34-unit radii + 4-unit gap.
const EPSILON = 1e-6;
const pointKey = (p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;

export function journeyWindows(origin, outbound, inbound, segmentSeconds, slow) {
  const points = [origin, ...outbound, ...inbound];
  const windows = [];
  let time = 0,
    arrival = 0;
  const legs = points.slice(1).map((point, index) => {
    const from = points[index];
    const seconds = segmentSeconds(from, [point], slow);
    const speed = Math.hypot(point.x - from.x, point.y - from.y) / seconds;
    return { from, to: point, seconds, speed };
  });
  for (let index = 0; index < legs.length; index++) {
    const leg = legs[index];
    if (!(leg.seconds > 0)) continue;
    const start = time;
    time += leg.seconds;
    const edge = [pointKey(leg.from), pointKey(leg.to)].sort().join('~');
    windows.push({
      resource: 'segment:' + edge,
      start,
      end: time,
      from: { ...leg.from },
      to: { ...leg.to },
    });
    // Both adjacent approaches reserve the junction before/after passage.
    // Use the slowest speed on either approach, rather than a fixed time gap.
    const previousSpeed = legs[index - 1]?.speed ?? leg.speed;
    const nextSpeed = legs[index + 1]?.speed ?? leg.speed;
    const before = TRAFFIC_CLEARANCE / Math.min(leg.speed, previousSpeed);
    const after = TRAFFIC_CLEARANCE / Math.min(leg.speed, nextSpeed);
    windows.push({
      resource: 'node:' + pointKey(leg.from),
      start: start - before,
      end: start + before,
    });
    windows.push({ resource: 'node:' + pointKey(leg.to), start: time - after, end: time + after });
    if (index + 1 === outbound.length) arrival = time;
  }
  return { windows, arrival, release: time };
}

const corridorDistances = new Map();
function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function windowsShareSpace(a, b) {
  if (a.resource === b.resource) return true;
  if (!a.from || !b.from) return false;
  const key = [a.resource, b.resource].sort().join('|');
  if (!corridorDistances.has(key)) {
    const dx = a.to.x - a.from.x,
      dy = a.to.y - a.from.y;
    const ex = b.to.x - b.from.x,
      ey = b.to.y - b.from.y;
    const cross = dx * ey - dy * ex;
    let distance;
    if (Math.abs(cross) > 1e-9) {
      const px = b.from.x - a.from.x,
        py = b.from.y - a.from.y;
      const t = (px * ey - py * ex) / cross,
        u = (px * dy - py * dx) / cross;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) distance = 0;
    }
    distance ??= Math.min(
      pointSegmentDistance(a.from, b.from, b.to),
      pointSegmentDistance(a.to, b.from, b.to),
      pointSegmentDistance(b.from, a.from, a.to),
      pointSegmentDistance(b.to, a.from, a.to),
    );
    if (corridorDistances.size > 4096) corridorDistances.clear();
    corridorDistances.set(key, distance);
  }
  return corridorDistances.get(key) < TRAFFIC_CLEARANCE - 1e-6;
}

export function reserveEarliest(template, existing, earliest = 0) {
  if (!Number.isFinite(earliest)) return null;
  let start = earliest;
  for (let iteration = 0; iteration < 4096; iteration++) {
    let next = start;
    for (const candidate of template.windows)
      for (const occupied of existing) {
        if (!windowsShareSpace(candidate, occupied)) continue;
        if (
          start + candidate.start < occupied.end - EPSILON &&
          start + candidate.end > occupied.start + EPSILON
        ) {
          next = Math.max(next, occupied.end - candidate.start + EPSILON);
        }
      }
    if (next === start)
      return {
        start,
        arrival: start + template.arrival,
        release: start + template.release,
        windows: template.windows.map((window) => ({
          ...window,
          start: window.start + start,
          end: window.end + start,
        })),
      };
    start = next;
  }
  return null; // Bounded planning failure withholds dispatch, never drops a constraint.
}

export function activeReservations(robots, clock = 0) {
  return robots.flatMap(
    (robot) =>
      robot.traffic?.windows
        ?.filter((window) => window.end > clock)
        .map((window) => ({ ...window, robot: robot.id })) ?? [],
  );
}

export function conflictingWindows(windows) {
  for (let i = 0; i < windows.length; i++)
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i],
        b = windows[j];
      if (
        a.robot !== b.robot &&
        windowsShareSpace(a, b) &&
        a.start < b.end - EPSILON &&
        b.start < a.end - EPSILON
      )
        return [a, b];
    }
  return null;
}
