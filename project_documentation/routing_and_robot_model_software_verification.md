# Routing and model verification design

[Current results and runtimes](software_verification_results/current_software_check_results.md) is the single verification record. The [check guide](../automated_software_checks/software_check_commands_and_coverage.md) provides reproduction commands.

## Shortest paths

The production route solver uses Dijkstra with positive metric distance/travel-time weights. Distance/time objectives use deterministic secondary objective, link-count and node-sequence ties. The reference graph has 19 nodes; the ordered candidate array keeps search/trace behavior easy to inspect at this scale. Larger graphs can replace that selection structure with a priority queue while retaining the same oracle tests.

`test_shortest_path_optimality.mjs` compares results to an independently implemented Floyd–Warshall all-pairs algorithm on random directed/closed/disconnected graphs. It also checks the distance/time tradeoff, same-node paths, one-way pose anchoring and unreachable return gates. The oracle does not reuse production Dijkstra.

`test_route_map_solver_and_playback.mjs` checks that instrumented and ordinary search agree, settled costs stay monotonic, directions add up and timed playback follows permitted segments. The DOM suite exercises taps, mouse/touch pan/zoom, closures, endpoint/leg state, keyboard input and dispatch isolation.

Configured manager standing circles exclude an intersecting route segment after adding the 0.48 m model robot clearance. Tests cover crossings with endpoints outside the zone, exact tangency, safe shortest detours in both directions/objectives, directed links, restricted endpoints and same-node requests, restricted pose anchoring, invalid zone metadata, legacy imports and JSON round trips. Default locations preserve every published bay/bin journey. DOM and native Three.js/Canvas geometry checks verify matching markers, labels, standing figures and footprint clearance; these are not browser screenshots or physical personnel-detection tests.

## Cooperative traffic and event consistency

`test_manager_movement_and_fleet_replanning.mjs` verifies manager relocation, routing-cache invalidation, safe partial-segment exits, blocked current poses/returns, reserve gates, cancelled deliveries, fixed departure speeds, waiting forecasts and concurrent atomic replans. The route-map DOM suite checks drag/touch cancellation, keyboard steps, rack rejection, route reopening and placement-hold cleanup. Dashboard cases execute real rerouting through delivery/docking, queued approval invalidation, no-route holds and recovery, retained operator pause and hardware isolation. Scene geometry checks move both personnel and boundaries and verify matching 3D/Canvas network closures. Replanning is conservative: unscheduled robots remain occupied poses; if no priority order yields a compatible plan, traffic remains held.

`test_single_amr_route_time_windows.mjs` checks head-on exclusivity, shared nodes, disjoint segments and geometrically nearby corridors across objectives, closures, speed modes and destinations. It samples every 50 ms and requires enough clearance margin to bound unsampled motion using the sum of maximum speeds. Actual concurrent journeys must occur; per-unit study trips remain exclusive.

Dashboard checks execute the production event loop, compare forecast/actual stock and arrival/charging times, and verify footprint separation, reserve, pause/stop holds, cancellation and reassignment. Cancellation suppresses delivery while keeping the reserved path; geometry helpers still support on-segment route queries. Paired branch checks use the same window planner without mutating the frozen source.

## Measured models

Observer tests score incoming pose against the previous prediction before applying scalar position correction. They cover missing/stale/frame-invalid/divergent/jump cases, boot/sequence gates and replayed anchors. Calibration uses earlier training and later holdout intervals, with model/source isolation and speed/discharge fitting gates. Heading is not filtered. Synthetic fixtures demonstrate software behavior; the [validation plan](digital_twin_architecture_and_validation_plan.md) defines physical ground truth and later-run evaluation.

## Source, packet and firmware contracts

Integration compares every kit member with its canonical source. The packet check compiles the serializer called by `.ino` and feeds actual encoded bytes to browser/Python production validators. Real Arduino builds and a native ArduinoJson contract separately check the UART/controller implementation. These checks exercise software and compilation; physical wiring and actuation remain commissioning evidence.
