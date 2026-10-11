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
| `frontend/src/app/warehouse_dashboard_controller.js`, `frontend/src/simulation/mission_scheduling_and_routes.js` | Operator workflow and supervised virtual dispatch |
| `frontend/src/telemetry/robot_measurement_validation.js`, `frontend/src/telemetry/esp32_connection_panel.js` | MQTT subscription, packet identity/freshness and three device slots |
| `frontend/src/twin/robot_state_estimation_and_calibration.js` | Asset observer, residual gates, recording/replay and chronological calibration |
| `frontend/src/warehouse/warehouse_reference_layout.js` | Shared twelve-rack reference geometry, loading stops, lanes and default route graph |
| `frontend/src/visualization/industrial_building_and_equipment.js` | Cutaway hall, receiving/dispatch equipment and surrounding industrial fixtures |
| `frontend/src/routing/warehouse_graph_and_pathfinding.js` | Directed graph, distance/time routing, lane closures and on-segment pose anchoring |
| `frontend/src/routing/interactive_route_map.js`, `frontend/styles/interactive_route_map.css` | Interactive reference map, traced Dijkstra search, directions and route playback |
| `frontend/src/twin/paired_dispatch_policy_experiments.js`, `frontend/src/workers/dispatch_policy_experiment_worker.js` | Deterministic paired dispatch experiments; no hardware access |
| `frontend/src/twin/twin_model_validation_workspace.js` | State agreement, calibration, experiments and evidence UI |
| `backend/edge/` | Optional MQTT-to-SQLite archive and LabVIEW inventory adapter |
| `docs/digital_twin_architecture_and_validation_plan.md` | Architecture, model boundaries and physical validation protocol |
| `docs/final_system_feature_audit.md` | Final feature alignment audit, resolved defects, evidence and remaining validation |
| `firmware/esp32_robot_telemetry/` | Previously verified ESP32 starter firmware and setup guide |

## Verification

```sh
node tests/frontend/test_robot_telemetry.mjs
node tests/frontend/test_mission_approval_and_routes.mjs
node tests/frontend/test_shortest_path_optimality.mjs
node tests/frontend/test_route_map_solver_and_playback.mjs
node tests/frontend/test_route_map_user_interactions.cjs
node tests/frontend/test_warehouse_scene_geometry.mjs
node tests/frontend/test_twin_calibration_and_replay.mjs
node tests/frontend/test_dashboard_user_interactions.cjs
node tests/frontend/test_interface_animation_and_lifecycle.cjs
node tests/frontend/test_cross_feature_alignment.mjs
node tests/frontend/test_streamlit_window_bridge_and_scroll.cjs
python -m unittest discover -s tests/backend -p 'test_*.py' -v
```

The frontend uses HTML/CSS/ES modules, hosted by the separate Python backend. Fonts and vendor modules are bundled. Test results establish software behavior, not physical accuracy or industrial safety certification. Live browser/GPU visual verification has not been performed in this environment.

The motion and route-map DOM tests require `jsdom` 26.1.x available to Node (for example, through a development `NODE_PATH`). The other JavaScript checks require only Node. The edge unit tests require only Python's standard library; network use installs the separate edge requirements.

The 11 October 2026 final audit aligns the reference axes across maps, both navigation legs, reassignment geometry, inventory frame/monotonic/source gates, fitted speed limits and worker/replay lifecycle. It also verifies explicit separation between the charging-aware operating simulator and the graph-only, docked, no-charger comparison study. See `docs/final_system_feature_audit.md` for the release decision and evidence.
