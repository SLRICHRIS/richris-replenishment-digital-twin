# Browser frontend

Streamlit serves this directory as one local component. The browser runs the simulation, routing and model workers. Launch from the repository root with `python -m streamlit run streamlit_app.py`.

## Source file guide

| File | Responsibility |
| --- | --- |
| [index.html](index.html) | Seven-view dashboard document and shared controls |
| [src/app/warehouse_dashboard_controller.js](src/app/warehouse_dashboard_controller.js) | State, navigation, movement, approvals and operator actions |
| [src/app/interface_motion_and_transitions.js](src/app/interface_motion_and_transitions.js) | Motion preferences, DOM updates and lifecycle effects |
| [src/app/saved_screen_theme.js](src/app/saved_screen_theme.js) | Early saved-theme selection before the dashboard renders |
| [src/hosting/streamlit_window_bridge.js](src/hosting/streamlit_window_bridge.js) | Trusted readiness/height handshake and workspace scroll lifecycle |
| [src/simulation/mission_scheduling_and_routes.js](src/simulation/mission_scheduling_and_routes.js) | Journey feasibility, own-bay return, reservations and charging-aware queue |
| [src/routing/warehouse_graph_and_pathfinding.js](src/routing/warehouse_graph_and_pathfinding.js) | Graph validation, distance/time Dijkstra, actual trace and pose anchoring |
| [src/routing/interactive_route_map.js](src/routing/interactive_route_map.js) | Independent map, closures, directions, search trace and playback |
| [src/telemetry/esp32_connection_panel.js](src/telemetry/esp32_connection_panel.js) | Secure MQTT subscription UI and three read-only device slots |
| [src/telemetry/robot_measurement_validation.js](src/telemetry/robot_measurement_validation.js) | Packet identity, schema, sequence, age and diagnostics |
| [src/twin/robot_state_estimation_and_calibration.js](src/twin/robot_state_estimation_and_calibration.js) | Observer, residuals, recording/replay and chronological calibration |
| [src/twin/twin_model_validation_workspace.js](src/twin/twin_model_validation_workspace.js) | State agreement, calibration, evidence and paired-study UI |
| [src/twin/paired_dispatch_policy_experiments.js](src/twin/paired_dispatch_policy_experiments.js) | Deterministic frozen-snapshot policy comparisons |
| [src/workers/stock_and_battery_forecast_worker.js](src/workers/stock_and_battery_forecast_worker.js) | Isolated stock and battery forecast worker |
| [src/workers/dispatch_policy_experiment_worker.js](src/workers/dispatch_policy_experiment_worker.js) | Isolated advisory experiment execution |
| [src/warehouse/warehouse_reference_layout.js](src/warehouse/warehouse_reference_layout.js) | Shared racks, aisles, stops, industrial fixtures and graph defaults |
| [src/visualization/three_dimensional_warehouse_view.js](src/visualization/three_dimensional_warehouse_view.js) | WebGL camera, poses and overlays |
| [src/visualization/two_dimensional_warehouse_view.js](src/visualization/two_dimensional_warehouse_view.js) | Canvas compatibility renderer |
| [src/visualization/warehouse_building_and_robot_models.js](src/visualization/warehouse_building_and_robot_models.js) | Rack, carton, aisle and robot geometry |
| [src/visualization/industrial_building_and_equipment.js](src/visualization/industrial_building_and_equipment.js) | Hall, receiving/dispatch equipment and industrial fixtures |

## Supporting folders

| Location | Responsibility |
| --- | --- |
| [styles/streamlit_workspace_scroll.css](styles/streamlit_workspace_scroll.css) | Embedded workspace scrolling while header/navigation remain visible |
| `styles/` | Layout, themes, hardware, route-map, mission, lab and motion styles |
| `assets/warehouse_application_icon.svg` | Application icon |
| `assets/fonts/` | Bundled font files and their license notices |
| `vendor/three/` | Bundled Three.js modules and upstream license |
| `vendor/mqtt/` | Bundled MQTT browser library and upstream license |
| [downloads/](downloads/README.md) | Generated starter kits and document reading copies |

Module imports are relative to each source file. Worker URLs are relative to `index.html`; their targets live in `src/workers/` and are checked by integration verification. Browser state remains session-local. Export Activity CSV or Twin lab JSON evidence before reloading.

Read the [runtime architecture](../docs/system_architecture.md) and [project flow](../docs/repository_structure_and_project_flow.md) for the connections between these files.
