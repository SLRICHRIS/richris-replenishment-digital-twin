/* Manual measured-floor planning rehearsal. No camera inference or robot commands. */
export const ARENA = Object.freeze({ widthMm: 760, heightMm: 560, gridMm: 10 });
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
export function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Enter a valid camera and robot setup.');
  const result = {};
  for (const [key, max] of [
    ['robotLengthMm', 2000],
    ['robotWidthMm', 2000],
    ['robotHeightMm', 2000],
    ['markerHeightMm', 2000],
    ['cameraHeightCm', 1000],
    ['markerSizeMm', 500],
  ]) {
    const value = input[key];
    if (value === null || value === undefined || value === '') result[key] = null;
    else if (!finite(value) || value <= 0 || value > max)
      throw Error('Use positive, measured dimensions within the supported range.');
    else result[key] = value;
  }
  result.clearanceMm = input.clearanceMm ?? 20;
  if (!finite(result.clearanceMm) || result.clearanceMm < 0 || result.clearanceMm > 200)
    throw Error('Planning clearance must be between 0 and 200 mm.');
  result.markerId = input.markerId ?? 0;
  if (!Number.isInteger(result.markerId) || result.markerId < 0 || result.markerId > 49)
    throw Error('The planned ArUco 4×4/50 marker ID must be 0–49.');
  return result;
}
export function normalizePoint(input) {
  if (input === null || input === undefined) return null;
  if (
    !finite(input.x) ||
    !finite(input.y) ||
    input.x < 0 ||
    input.x > ARENA.widthMm ||
    input.y < 0 ||
    input.y > ARENA.heightMm
  )
    throw Error('Keep start and destination inside the measured floor.');
  return {
    x: Math.min(
      Math.floor(ARENA.widthMm / ARENA.gridMm) * ARENA.gridMm,
      Math.round(input.x / ARENA.gridMm) * ARENA.gridMm,
    ),
    y: Math.min(
      Math.floor(ARENA.heightMm / ARENA.gridMm) * ARENA.gridMm,
      Math.round(input.y / ARENA.gridMm) * ARENA.gridMm,
    ),
  };
}
export function normalizeObstacles(input = []) {
  if (!Array.isArray(input) || input.length > 25) throw Error('Use at most 25 drawn obstacles.');
  return input.map((r) => {
    if (
      !r ||
      !['x', 'y', 'width', 'height'].every((key) => finite(r[key])) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width < 1 ||
      r.height < 1 ||
      r.x + r.width > ARENA.widthMm ||
      r.y + r.height > ARENA.heightMm
    )
      throw Error('Obstacle rectangles must stay inside the measured floor.');
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}
export function clearanceRadius(settings) {
  const s = normalizeSettings(settings);
  if (s.robotLengthMm === null || s.robotWidthMm === null)
    throw Error(
      'Enter the full robot length and width before calculating a route. Wheel spacing is not the full footprint.',
    );
  return Math.hypot(s.robotLengthMm / 2, s.robotWidthMm / 2) + s.clearanceMm;
}
export function expandedObstacles(obstacles, radius) {
  return normalizeObstacles(obstacles).map((r) => ({
    x: r.x - radius,
    y: r.y - radius,
    width: r.width + 2 * radius,
    height: r.height + 2 * radius,
  }));
}
function segmentIntersectsRectangle(a, b, r) {
  let enter = 0,
    leave = 1;
  for (const [key, low, high] of [
    ['x', r.x, r.x + r.width],
    ['y', r.y, r.y + r.height],
  ]) {
    const delta = b[key] - a[key];
    if (delta === 0) {
      if (a[key] < low || a[key] > high) return false;
    } else {
      const t1 = (low - a[key]) / delta,
        t2 = (high - a[key]) / delta;
      enter = Math.max(enter, Math.min(t1, t2));
      leave = Math.min(leave, Math.max(t1, t2));
      if (enter > leave) return false;
    }
  }
  return true;
}
export function segmentAllowed(a, b, obstacles, radius) {
  if (!finite(radius) || radius < 0) return false;
  if (
    ![a, b].every(
      (p) =>
        p &&
        finite(p.x) &&
        finite(p.y) &&
        p.x >= radius &&
        p.x <= ARENA.widthMm - radius &&
        p.y >= radius &&
        p.y <= ARENA.heightMm - radius,
    )
  )
    return false;
  return !obstacles.some((r) => segmentIntersectsRectangle(a, b, r));
}
export function planRoute({ settings, start, goal, obstacles = [] }) {
  const radius = clearanceRadius(settings),
    from = normalizePoint(start),
    to = normalizePoint(goal);
  if (!from || !to) throw Error('Set the robot start and destination on the map.');
  const blocked = expandedObstacles(obstacles, radius);
  if (!segmentAllowed(from, from, blocked, radius))
    throw Error('The start is too close to an obstacle or floor edge for this robot footprint.');
  if (!segmentAllowed(to, to, blocked, radius))
    throw Error(
      'The destination is too close to an obstacle or floor edge for this robot footprint.',
    );
  const key = (p) => `${p.x},${p.y}`,
    distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const startKey = key(from),
    goalKey = key(to);
  const open = [{ p: from, g: 0, f: distance(from, to) }],
    costs = new Map([[startKey, 0]]),
    previous = new Map(),
    visited = new Set();
  while (open.length) {
    open.sort((a, b) => a.f - b.f || a.g - b.g || a.p.x - b.p.x || a.p.y - b.p.y);
    const current = open.shift(),
      id = key(current.p);
    if (visited.has(id)) continue;
    if (id === goalKey) {
      const points = [to];
      let cursor = goalKey;
      while (cursor !== startKey) {
        const parent = previous.get(cursor);
        points.push(parent);
        cursor = key(parent);
      }
      points.reverse();
      return {
        source: 'manual-rehearsal',
        points,
        lengthMm: current.g,
        clearanceRadiusMm: radius,
        gridMm: ARENA.gridMm,
        executionEnabled: false,
      };
    }
    visited.add(id);
    for (const dx of [-10, 0, 10])
      for (const dy of [-10, 0, 10]) {
        if (dx === 0 && dy === 0) continue;
        const next = { x: current.p.x + dx, y: current.p.y + dy },
          nextKey = key(next);
        if (visited.has(nextKey) || !segmentAllowed(current.p, next, blocked, radius)) continue;
        const cost = current.g + distance(current.p, next);
        if (cost >= (costs.get(nextKey) ?? Infinity)) continue;
        costs.set(nextKey, cost);
        previous.set(nextKey, current.p);
        open.push({ p: next, g: cost, f: cost + distance(next, to) });
      }
  }
  return {
    source: 'manual-rehearsal',
    points: [],
    lengthMm: null,
    clearanceRadiusMm: radius,
    gridMm: ARENA.gridMm,
    executionEnabled: false,
  };
}
