# Replenish — three-AMR educational twin

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.

The website combines a supervised replenishment simulator, an interactive **Route map**, three read-only ESP32 telemetry slots, and a separate **Twin lab** for synchronizing asset models, measuring prediction error, calibrating from recordings, and comparing dispatch policies.

Physical AMRs, the central Coordinator and the LabVIEW command/acknowledgment channel are not commissioned by this repository. The UI identifies pending physical validation explicitly. The predictive observer, calibration workflow and scenario comparisons are executable software; the 3D scene is a reference warehouse visualization.

The reference floor contains twelve racks: four active A–D replenishment stations and eight reserve racks with decorative cartons. Three cross aisles and four connecting lanes form a 22-node, 27-link bidirectional graph. The simulator, default Twin lab facility and downloadable example use the same layout. Route checks include a conservative robot footprint and returns from partially travelled segments. A shared reservation still permits one complete virtual journey at a time; this is not a concurrent fleet collision-avoidance controller.

The industrial cutaway surrounds the mapped AMR zone with receiving/dispatch shutters, staged pallets, a parked pallet jack, packing and quality benches, switchgear, guard rails, structural columns and overhead services. All twelve racks have prominent R01–R12 scene markers and a storage-location register. Racks carry A-01 through D-03 addresses and shelf-level tags. These are reference geometry, not measured equipment states. The Facility layer hides the surrounding equipment/building, and Plan hides walls and overhead structure. Route/grid overlays are optional and start hidden.

The mission planner defaults to shortest permitted aisle distance and offers a separate fastest-travel-time objective. Equal distances favor lower travel time, then fewer links and a deterministic node sequence. Three closure scenarios exercise a detour or an unavailable depot connection. Recommendations rank feasible units by round-trip distance (or earliest arrival in time mode), after checking their own bay, reservation and full-trip battery reserve. This is per-journey optimization; it does not claim a globally optimal fleet schedule.

Approval retains both route legs. Route settings lock until approved reservations and moving journeys clear; a speed change updates timing and reserve checks while retaining approved geometry. One chronological queue model includes waiting and known bay charging, and the simulator advances exactly to arrivals, returns and charging thresholds. Route distances, waypoints, minimum return battery and queue wait are visible in the review. The paired experiment uses the same graph, objective and closures in both branches, with its explicitly separate no-charger assumption.

**Route map** provides an indoor navigation preview over the reference graph: select or tap stops, pan and zoom with mouse/touch/keyboard, close individual links, compare shortest-distance and fastest-time routes, and inspect both journey legs. Route playback and turn instructions use the solver's segment timing, including the restricted speed zone. Algorithm mode steps through the actual production Dijkstra trace, with settled nodes, improved predecessor links, ordered candidates and per-node costs. The preview owns its conditions; copying dispatch conditions only reads them and never changes approved missions or sends hardware commands. Reduced motion keeps manual scrubbing and search steps available. This is a reference facility map, not Google Maps integration or live localization.

## Source structure

| Path | Responsibility |
| --- | --- |
| `digital_twin_application/warehouse_simulation_controller.js`, `digital_twin_application/mission_scheduling_and_routes.js` | Operator workflow and supervised virtual dispatch |
| `digital_twin_application/robot_measurement_validation.js`, `digital_twin_application/esp32_connection_controls.js` | MQTT subscription, packet identity/freshness and three device slots |
| `digital_twin_application/robot_state_estimation_and_calibration.js` | Asset observer, residual gates, recording/replay and chronological calibration |
| `digital_twin_application/warehouse_racks_and_aisle_layout.js` | Shared twelve-rack reference geometry, loading stops, lanes and default route graph |
| `digital_twin_application/industrial_building_and_equipment.js` | Cutaway hall, receiving/dispatch equipment and surrounding industrial fixtures |
| `digital_twin_application/warehouse_graph_and_pathfinding.js` | Directed graph, distance/time routing, lane closures and on-segment pose anchoring |
| `digital_twin_application/interactive_route_map.js`, `digital_twin_application/screen_styles/interactive_route_map.css` | Interactive reference map, traced Dijkstra search, directions and route playback |
| `digital_twin_application/paired_dispatch_policy_experiments.js`, `digital_twin_application/dispatch_experiment_worker.js` | Deterministic paired dispatch experiments; no hardware access |
| `digital_twin_application/twin_model_validation_workspace.js` | State agreement, calibration, experiments and evidence UI |
| `digital_twin_application/engineering/edge/` | Optional MQTT-to-SQLite archive and LabVIEW inventory adapter |
| `digital_twin_application/engineering/ARCHITECTURE.md` | Architecture, model boundaries and physical validation protocol |
| `digital_twin_application/engineering/FINAL_AUDIT.md` | Final feature alignment audit, resolved defects, evidence and remaining validation |
| `digital_twin_application/esp32_robot_firmware/` | Previously verified ESP32 starter firmware and setup guide |

## Verification

```sh
node automated_tests/robot_telemetry_checks.mjs
node automated_tests/mission_approval_and_route_checks.mjs
node automated_tests/shortest_path_optimality_checks.mjs
node automated_tests/interactive_route_map_checks.mjs
node automated_tests/route_map_interaction_checks.cjs
node automated_tests/warehouse_geometry_checks.mjs
node automated_tests/twin_calibration_and_replay_checks.mjs
node automated_tests/dashboard_interaction_checks.cjs
node automated_tests/interface_animation_checks.cjs
node automated_tests/final_feature_alignment_checks.mjs
python3 -m unittest discover -s digital_twin_application/engineering/edge -p test_gateway.py
```

The site is buildless HTML/CSS/ES modules. Fonts and vendor modules are bundled. Test results establish software behavior, not physical accuracy or industrial safety certification. Live browser/GPU visual verification has not been performed in this environment.

The motion and route-map DOM tests require `jsdom` 26.1.x available to Node (for example, through a development `NODE_PATH`). The other JavaScript checks require only Node. The edge unit tests require only Python's standard library; network use installs the separate edge requirements.

The 11 October 2026 final audit aligns the reference axes across maps, both navigation legs, reassignment geometry, inventory frame/monotonic/source gates, fitted speed limits and worker/replay lifecycle. It also verifies explicit separation between the charging-aware operating simulator and the graph-only, docked, no-charger comparison study. See `digital_twin_application/engineering/FINAL_AUDIT.md` for the release decision and evidence.
