# Application Source Map

The application is served as one local Streamlit component. Run `streamlit_app.py` from the repository root; open `index.html` through a web server only when developing the standalone browser application.

| File or folder | Responsibility |
| --- | --- |
| index.html | Seven-view dashboard document and shared controls |
| streamlit_window_connection.js | Validated readiness/viewport handshake, keyboard scroll access and view scroll reset; no telemetry returned to Python |
| warehouse_simulation_controller.js | Browser state, movement, approvals, navigation and operator actions |
| mission_scheduling_and_routes.js | Journey feasibility, own-bay return, reservations and charging-aware queue model |
| warehouse_racks_and_aisle_layout.js | Shared twelve-rack geometry, bin stops, lane segments and graph defaults |
| warehouse_graph_and_pathfinding.js | Graph validation, distance/time Dijkstra, real search trace and pose anchoring |
| interactive_route_map.js | Independent map controls, closures, directions, solver trace and playback |
| three_dimensional_warehouse_view.js | WebGL camera, scene, live/simulated poses and optional overlays |
| two_dimensional_warehouse_view.js | Canvas compatibility renderer |
| warehouse_building_and_robot_models.js | Rack, carton and robot geometry |
| industrial_building_and_equipment.js | Reference hall, receiving/dispatch equipment and industrial fixtures |
| stock_and_battery_forecast.js | Isolated forecast worker |
| robot_measurement_validation.js | MQTT packet identity, schema, sequence and age validation |
| esp32_connection_controls.js | Secure subscription UI and three read-only device slots |
| robot_state_estimation_and_calibration.js | Observer, residuals, recording/replay and chronological calibration |
| twin_model_validation_workspace.js | State agreement, calibration, evidence and paired-study controls |
| paired_dispatch_policy_experiments.js | Deterministic frozen-snapshot policy comparisons |
| dispatch_experiment_worker.js | Isolated experiment execution |
| interface_motion_and_transitions.js | Motion preferences and lifecycle-aware interface effects |
| saved_screen_theme.js | Early saved-theme selection |
| screen_styles/streamlit_workspace_scroll.css | Embedded workspace scroll region with persistent header/navigation |
| screen_styles/ | Layout, component, route-map and appearance styles |
| display_fonts/ | Bundled fonts and license notices |
| external_libraries/ | Bundled Three.js/MQTT modules and their licenses |
| esp32_robot_firmware/ | Starter sketch, example settings, setup guide and matching ZIP |
| engineering/ | Architecture, final audit, validation evidence and optional edge kit |

The folder contains the complete audited application. Browser state remains session-local; export Activity CSV or Twin lab JSON evidence before reloading. Hardware credentials are supplied interactively and are not committed.

See [project architecture](../project_guides/01_system_architecture.md) and the [final audit](engineering/FINAL_AUDIT.md).
