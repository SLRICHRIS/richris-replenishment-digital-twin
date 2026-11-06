// Atomic replanning for manually positioned managers in the virtual warehouse.
// No physical command channel or telemetry state is modified.
import { checkedManagerStandingZones } from '../warehouse_reference_geometry/warehouse_manager_standing_zones_and_route_clearance.js';
import {
  WAREHOUSE_LAYOUT,
  STORAGE_RACKS,
} from '../warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
import {
  MODEL,
  homeFor,
  routePlan,
  routeStats,
  routingSignature,
} from './virtual_mission_scheduling_and_robot_motion.js';
import {
  TRAFFIC_CLEARANCE,
  journeyWindows,
  reserveEarliest,
  conflictingWindows,
} from './node_and_segment_time_window_reservations.js';

export function checkedManagerRelocation(zones) {
  zones = checkedManagerStandingZones(
    zones,
    WAREHOUSE_LAYOUT.width / MODEL.scale,
    WAREHOUSE_LAYOUT.height / MODEL.scale,
  );
  for (const zone of zones) {
    const x = zone.x_m * MODEL.scale,
      y = zone.y_m * MODEL.scale;
    for (const rack of STORAGE_RACKS) {
      const dx = Math.max(0, Math.abs(x - rack.x) - WAREHOUSE_LAYOUT.rackFootprintWidth / 2);
      const dy = Math.max(0, Math.abs(y - rack.y) - WAREHOUSE_LAYOUT.rackFootprintDepth / 2);
      // The fixed-facing person/clipboard model occupies a 64 × 30 unit
      // footprint; the layout gap expands its half extents to 34 × 17.
      if (dx < 34 && dy < 17)
        throw Error('Managers must stand clear of rack footprints. Choose an aisle or open floor.');
    }
  }
  return zones;
}
function orders(items) {
  if (!items.length) return [[]];
  return items.flatMap((item, i) =>
    orders(items.filter((_, j) => i !== j)).map((tail) => [item, ...tail]),
  );
}
function plannedJourney(robot, task, context, routing) {
  const slow = robot.traffic?.slow ?? context.slow;
  const returning = !task || robot.phase === 'inbound' || robot.cancelledDelivery;
  const outbound = routePlan(
    robot,
    returning ? homeFor(robot) : context.bins[task.bin],
    slow,
    routing,
  );
  const inbound = returning
    ? { points: [], seconds: 0, metres: 0, distance: 0 }
    : routePlan(context.bins[task.bin], homeFor(robot), slow, routing);
  const seconds = outbound.seconds + inbound.seconds;
  if (robot.battery + 1e-9 < MODEL.reserve + seconds * MODEL.drain)
    throw Error(
      'AMR-0' + (robot.id + 1) + ' cannot retain its return battery reserve on the new route.',
    );
  const template = journeyWindows(
    robot,
    outbound.points,
    inbound.points,
    (from, route, mode) => routeStats(from, route, mode).seconds,
    slow,
  );
  return {
    outbound,
    inbound,
    seconds,
    metres: outbound.metres + inbound.metres,
    objective: context.routing.objective,
    returning,
    slow,
    template,
  };
}

export function replanFleetForManagerPositions(context, zones) {
  zones = checkedManagerRelocation(zones);
  const routing = { ...context.routing, restrictedZones: zones };
  const movers = context.robots.filter((robot) => robot.route.length);
  const clock = context.trafficClock ?? 0;
  let failure = 'No compatible fleet route is available.';
  let best = null;
  // Only AMR-01 is configured; retain deterministic reservation planning. A not-yet-scheduled robot
  // remains an occupied pose, so an earlier route cannot drive through it.
  for (const order of orders(movers)) {
    const planned = [],
      windows = [];
    try {
      for (const robot of order) {
        const parked = context.robots.filter(
          (other) => other.id !== robot.id && !planned.some((p) => p.robot === other.id),
        );
        const planningRouting = {
          ...routing,
          restrictedZones: [
            ...zones,
            ...parked.map((other) => ({
              id: 'occupied-amr-' + other.id,
              label: 'Waiting AMR ' + other.id,
              x_m: other.x / MODEL.scale,
              y_m: other.y / MODEL.scale,
              radius_m:
                (TRAFFIC_CLEARANCE - WAREHOUSE_LAYOUT.robotRadius - WAREHOUSE_LAYOUT.clearance) /
                MODEL.scale,
            })),
          ],
        };
        const task = context.tasks.find((t) => t.id === robot.task && t.status === 'Active');
        const journey = plannedJourney(robot, task, context, planningRouting);
        const plan = reserveEarliest(journey.template, windows, clock);
        if (!plan) throw Error('A compatible traffic reservation is unavailable.');
        const reserved = plan.windows.map((window) => ({ ...window, robot: robot.id }));
        if (plan.start > clock)
          reserved.push({
            resource: `hold-amr-${robot.id}:${robot.x.toFixed(4)},${robot.y.toFixed(4)}`,
            from: { x: robot.x, y: robot.y },
            to: { x: robot.x, y: robot.y },
            start: clock,
            end: plan.start,
            robot: robot.id,
          });
        windows.push(...reserved);
        journey.signature = routingSignature(routing);
        planned.push({
          robot: robot.id,
          task: task?.id ?? null,
          journey,
          traffic: { ...plan, slow: journey.slow, windows: reserved },
          route: journey.outbound.points,
        });
      }
      if (conflictingWindows(windows)) throw Error('Replanned traffic windows conflict.');
      const score = planned.reduce((sum, p) => sum + p.traffic.release - clock, 0);
      if (!best || score < best.score) best = { plans: planned, score };
    } catch (error) {
      failure = error.message;
    }
  }
  return { routing, held: !best, reason: best ? '' : failure, plans: best?.plans || [] };
}
