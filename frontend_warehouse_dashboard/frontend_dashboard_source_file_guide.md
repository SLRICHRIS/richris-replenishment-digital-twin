# Browser frontend

Streamlit serves this directory as one local component. The browser runs the simulation, routing and model workers. Launch from the repository root with `python -m streamlit run streamlit_app.py`.

## Source file guide

| File | Responsibility |
| --- | --- |
| [index.html](index.html) | Dashboard document, physical sensor views, overhead-camera setup and shared controls |
| [browser_modules/dashboard_navigation_and_appearance/warehouse_simulation_and_dashboard_controller.js](browser_modules/dashboard_navigation_and_appearance/warehouse_simulation_and_dashboard_controller.js) | State, navigation, movement, approvals and operator actions |
| [browser_modules/dashboard_navigation_and_appearance/dashboard_animation_and_element_updates.js](browser_modules/dashboard_navigation_and_appearance/dashboard_animation_and_element_updates.js) | Motion preferences, DOM updates and lifecycle effects |
| [browser_modules/dashboard_navigation_and_appearance/restore_saved_dashboard_theme.js](browser_modules/dashboard_navigation_and_appearance/restore_saved_dashboard_theme.js) | Early saved-theme selection before the dashboard renders |
| [browser_modules/streamlit_frame_connection/streamlit_frame_connection_and_scrolling.js](browser_modules/streamlit_frame_connection/streamlit_frame_connection_and_scrolling.js) | Trusted readiness/height handshake and workspace scroll lifecycle |
| [browser_modules/robot_mission_simulation/node_and_segment_time_window_reservations.js](browser_modules/robot_mission_simulation/node_and_segment_time_window_reservations.js) | Pure node/segment/corridor windows, earliest compatible departure and shared fleet separation |
| [browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js](browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js) | Journey feasibility, own-bay return, reservations and charging-aware queue |
| [browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js](browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js) | Graph validation, distance/time Dijkstra, actual trace and pose anchoring |
| [browser_modules/shortest_path_and_route_map/interactive_route_map_and_algorithm_playback.js](browser_modules/shortest_path_and_route_map/interactive_route_map_and_algorithm_playback.js) | Independent map, closures, directions, search trace and playback |
| [browser_modules/esp32_telemetry_monitoring/esp32_mqtt_connection_and_status_panel.js](browser_modules/esp32_telemetry_monitoring/esp32_mqtt_connection_and_status_panel.js) | Secure MQTT subscription UI and three read-only device slots |
| [browser_modules/esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness.js](browser_modules/esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness.js) | Packet identity, schema, sequence, age and diagnostics |
| [browser_modules/robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js](browser_modules/robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js) | Observer, residuals, recording/replay and chronological calibration |
| [browser_modules/robot_state_models_and_policy_experiments/robot_model_validation_and_experiment_panel.js](browser_modules/robot_state_models_and_policy_experiments/robot_model_validation_and_experiment_panel.js) | State agreement, calibration, evidence and paired-study UI |
| [browser_modules/robot_state_models_and_policy_experiments/compare_dispatch_policies_with_shared_inputs.js](browser_modules/robot_state_models_and_policy_experiments/compare_dispatch_policies_with_shared_inputs.js) | Deterministic frozen-snapshot policy comparisons |
| [browser_modules/background_calculation_workers/stock_and_battery_forecast_worker.js](browser_modules/background_calculation_workers/stock_and_battery_forecast_worker.js) | Isolated stock and battery forecast worker |
| [browser_modules/background_calculation_workers/dispatch_policy_experiment_worker.js](browser_modules/background_calculation_workers/dispatch_policy_experiment_worker.js) | Isolated advisory experiment execution |
| [browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js](browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js) | Shared racks, aisles, stops, industrial fixtures and graph defaults |
| [browser_modules/warehouse_scene_rendering/warehouse_3d_renderer_and_camera.js](browser_modules/warehouse_scene_rendering/warehouse_3d_renderer_and_camera.js) | WebGL camera, poses and overlays |
| [browser_modules/warehouse_scene_rendering/warehouse_2d_canvas_fallback_renderer.js](browser_modules/warehouse_scene_rendering/warehouse_2d_canvas_fallback_renderer.js) | Canvas compatibility renderer |
| [browser_modules/warehouse_scene_rendering/build_warehouse_racks_cartons_and_robot_models.js](browser_modules/warehouse_scene_rendering/build_warehouse_racks_cartons_and_robot_models.js) | Rack, carton, aisle and robot geometry |
| [browser_modules/warehouse_scene_rendering/build_industrial_hall_and_equipment.js](browser_modules/warehouse_scene_rendering/build_industrial_hall_and_equipment.js) | Hall, receiving/dispatch equipment and industrial fixtures |

## Supporting folders

The camera provision uses [overhead_camera_workspace.js](browser_modules/vision_routing/overhead_camera_workspace.js) for local setup, preview and rehearsal review; [a0_route_preview.js](browser_modules/vision_routing/a0_route_preview.js) provides the pure footprint-aware grid planner. [vision_routing_styles.css](dashboard_stylesheets/vision_routing_styles.css) styles the responsive A0 workspace. See the [camera provision guide](../project_documentation/overhead_camera_route_provision.md) for the commissioning boundary.

| Location | Responsibility |
| --- | --- |
| [dashboard_stylesheets/streamlit_dashboard_scroll_container.css](dashboard_stylesheets/streamlit_dashboard_scroll_container.css) | Embedded workspace scrolling while header/navigation remain visible |
| `dashboard_stylesheets/` | Layout, themes, hardware, route-map, mission, lab and motion styles |
| `dashboard_images_and_fonts/warehouse_dashboard_application_icon.svg` | Application icon |
| `dashboard_images_and_fonts/interface_fonts_and_license_notices/` | Bundled font files and their license notices |
| `external_browser_libraries/threejs_3d_rendering/` | Bundled Three.js modules and upstream license |
| `external_browser_libraries/mqtt_telemetry_messaging/` | Bundled MQTT browser library and upstream license |
| [downloadable_hardware_kits_and_guides/](downloadable_hardware_kits_and_guides/download_kits_and_generated_guides.md) | Generated starter kits and document reading copies |

Module imports are relative to each source file. Worker URLs are relative to `index.html`; their targets live in `browser_modules/background_calculation_workers/` and are checked by integration verification. Vision setup and the drawn map can be saved in local browser storage; camera pixels and review approvals are not persisted. Other browser simulation state remains session-local. Export Activity CSV, Twin lab JSON or the camera setup/rehearsal before reloading.

Read the [runtime architecture](../project_documentation/dashboard_and_telemetry_system_architecture.md) and [project flow](../project_documentation/repository_structure_and_project_flow.md) for the connections between these files.
