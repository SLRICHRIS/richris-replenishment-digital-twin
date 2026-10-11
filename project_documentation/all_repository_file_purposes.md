# Purpose of every repository file

Generated catalog of the current source tree. Historical names and removed evidence remain in Git history.

| File | Purpose |
| --- | --- |
| `.gitignore` | Exclude private credentials, local environments, databases and temporary output. |
| `.prettierrc.json` | Prettier rules for readable JavaScript, embedded HTML and CSS. |
| `.streamlit/config.toml` | Streamlit server and appearance settings. |
| `README.md` | Project overview, launch commands and links to implementation and commissioning guides. |
| `automated_software_checks/__init__.py` | Mark this folder as a Python package for repository and starter-kit imports. |
| `automated_software_checks/browser_behavior_checks/test_dashboard_user_interactions.cjs` | Verify or measure dashboard user interactions. |
| `automated_software_checks/browser_behavior_checks/test_interface_animation_and_lifecycle.cjs` | Verify or measure interface animation and lifecycle. |
| `automated_software_checks/browser_behavior_checks/test_mission_approval_and_routes.mjs` | Verify or measure mission approval and routes. |
| `automated_software_checks/browser_behavior_checks/test_mission_inventory_and_model_consistency.mjs` | Verify or measure mission inventory and model consistency. |
| `automated_software_checks/browser_behavior_checks/test_multi_robot_time_window_reservations.mjs` | Verify or measure multi robot time window reservations. |
| `automated_software_checks/browser_behavior_checks/test_robot_state_calibration_and_recording_replay.mjs` | Verify or measure robot state calibration and recording replay. |
| `automated_software_checks/browser_behavior_checks/test_robot_telemetry_identity_and_freshness.mjs` | Verify or measure robot telemetry identity and freshness. |
| `automated_software_checks/browser_behavior_checks/test_route_map_solver_and_playback.mjs` | Verify or measure route map solver and playback. |
| `automated_software_checks/browser_behavior_checks/test_route_map_user_interactions.cjs` | Verify or measure route map user interactions. |
| `automated_software_checks/browser_behavior_checks/test_shortest_path_optimality.mjs` | Verify or measure shortest path optimality. |
| `automated_software_checks/browser_behavior_checks/test_streamlit_frame_connection_and_scrolling.cjs` | Verify or measure streamlit frame connection and scrolling. |
| `automated_software_checks/browser_behavior_checks/test_warehouse_scene_geometry.mjs` | Verify or measure warehouse scene geometry. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/check_onboard_controller_uart_contract.cpp` | Verify or measure onboard controller uart contract. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/verify_esp32_firmware_build.py` | Verify or measure esp32 firmware build. |
| `automated_software_checks/python_telemetry_service_checks/__init__.py` | Mark this folder as a Python package for repository and starter-kit imports. |
| `automated_software_checks/python_telemetry_service_checks/test_mqtt_recorder_and_labview_inventory_adapter.py` | Verify or measure mqtt recorder and labview inventory adapter. |
| `automated_software_checks/python_telemetry_service_checks/test_operator_override_command_lifecycle.py` | Verify or measure operator override command lifecycle. |
| `automated_software_checks/software_check_commands_and_coverage.md` | Explain software check commands and coverage. |
| `automated_software_checks/streamlit_and_repository_integration_checks/__init__.py` | Mark this folder as a Python package for repository and starter-kit imports. |
| `automated_software_checks/streamlit_and_repository_integration_checks/check_repository_links_source_boundaries_and_downloads.py` | Verify or measure repository links source boundaries and downloads. |
| `automated_software_checks/streamlit_and_repository_integration_checks/check_streamlit_frontend_file_delivery.py` | Verify or measure streamlit frontend file delivery. |
| `automated_software_checks/streamlit_and_repository_integration_checks/measure_override_latency_under_prediction_load.py` | Verify or measure override latency under prediction load. |
| `automated_software_checks/streamlit_and_repository_integration_checks/test_esp32_browser_and_recorder_packet_contract.py` | Verify or measure esp32 browser and recorder packet contract. |
| `automated_software_checks/streamlit_and_repository_integration_checks/test_streamlit_dashboard_host.py` | Verify or measure streamlit dashboard host. |
| `backend_streamlit_and_telemetry/__init__.py` | Mark this folder as a Python package for repository and starter-kit imports. |
| `backend_streamlit_and_telemetry/backend_streamlit_and_telemetry_file_guide.md` | Explain backend streamlit and telemetry file guide. |
| `backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/__init__.py` | Mark this folder as a Python package for repository and starter-kit imports. |
| `backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/example_warehouse_route_graph_for_calibration.json` | Configuration or reference data for example warehouse route graph for calibration. |
| `backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/labview_inventory_observation_adapter.py` | Implement labview inventory observation adapter. |
| `backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/mqtt_recorder_network_dependencies.txt` | Configuration or reference data for mqtt recorder network dependencies. |
| `backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/mqtt_telemetry_recorder_and_inventory_publisher.py` | Implement mqtt telemetry recorder and inventory publisher. |
| `backend_streamlit_and_telemetry/operator_override_control_channel/__init__.py` | Mark the independent control channel as a Python package. |
| `backend_streamlit_and_telemetry/operator_override_control_channel/labview_operator_override_http_adapter.py` | Implement labview operator override http adapter. |
| `backend_streamlit_and_telemetry/operator_override_control_channel/operator_override_command_coordinator.py` | Implement operator override command coordinator. |
| `backend_streamlit_and_telemetry/streamlit_dashboard_host.py` | Implement streamlit dashboard host. |
| `esp32_telemetry_firmware/esp32_telemetry_firmware_file_guide.md` | Explain esp32 telemetry firmware file guide. |
| `esp32_telemetry_firmware/publish_esp32_robot_telemetry/.gitignore` | Configuration or reference data for .gitignore. |
| `esp32_telemetry_firmware/publish_esp32_robot_telemetry/example_esp32_wifi_and_mqtt_settings.h` | ESP32 source or native contract check for example esp32 wifi and mqtt settings. |
| `esp32_telemetry_firmware/publish_esp32_robot_telemetry/onboard_controller_sensor_and_override_bridge.h` | ESP32 source or native contract check for onboard controller sensor and override bridge. |
| `esp32_telemetry_firmware/publish_esp32_robot_telemetry/publish_esp32_robot_telemetry.ino` | ESP32 source or native contract check for publish esp32 robot telemetry. |
| `esp32_telemetry_firmware/publish_esp32_robot_telemetry/robot_telemetry_packet_serializer.h` | ESP32 source or native contract check for robot telemetry packet serializer. |
| `frontend_warehouse_dashboard/browser_modules/background_calculation_workers/dispatch_policy_experiment_worker.js` | Implement dispatch policy experiment worker. |
| `frontend_warehouse_dashboard/browser_modules/background_calculation_workers/stock_and_battery_forecast_worker.js` | Implement stock and battery forecast worker. |
| `frontend_warehouse_dashboard/browser_modules/dashboard_navigation_and_appearance/dashboard_animation_and_element_updates.js` | Implement dashboard animation and element updates. |
| `frontend_warehouse_dashboard/browser_modules/dashboard_navigation_and_appearance/restore_saved_dashboard_theme.js` | Implement restore saved dashboard theme. |
| `frontend_warehouse_dashboard/browser_modules/dashboard_navigation_and_appearance/warehouse_simulation_and_dashboard_controller.js` | Implement warehouse simulation and dashboard controller. |
| `frontend_warehouse_dashboard/browser_modules/esp32_telemetry_monitoring/esp32_mqtt_connection_and_status_panel.js` | Implement esp32 mqtt connection and status panel. |
| `frontend_warehouse_dashboard/browser_modules/esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness.js` | Implement robot telemetry validation and freshness. |
| `frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/node_and_segment_time_window_reservations.js` | Implement node and segment time window reservations. |
| `frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js` | Implement virtual mission scheduling and robot motion. |
| `frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/compare_dispatch_policies_with_shared_inputs.js` | Implement compare dispatch policies with shared inputs. |
| `frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/robot_model_validation_and_experiment_panel.js` | Implement robot model validation and experiment panel. |
| `frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js` | Implement robot state estimation calibration and replay. |
| `frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/interactive_route_map_and_algorithm_playback.js` | Implement interactive route map and algorithm playback. |
| `frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js` | Implement warehouse graph validation and dijkstra routing. |
| `frontend_warehouse_dashboard/browser_modules/streamlit_frame_connection/streamlit_frame_connection_and_scrolling.js` | Implement streamlit frame connection and scrolling. |
| `frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js` | Implement reference warehouse racks aisles and route graph. |
| `frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/build_industrial_hall_and_equipment.js` | Implement build industrial hall and equipment. |
| `frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/build_warehouse_racks_cartons_and_robot_models.js` | Implement build warehouse racks cartons and robot models. |
| `frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/warehouse_2d_canvas_fallback_renderer.js` | Implement warehouse 2d canvas fallback renderer. |
| `frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/warehouse_3d_renderer_and_camera.js` | Implement warehouse 3d renderer and camera. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/barlow_condensed_bold_700_font.woff` | Local dashboard font asset: barlow condensed bold 700 font. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/barlow_condensed_open_font_license.txt` | Configuration or reference data for barlow condensed open font license. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/barlow_condensed_semibold_600_font.woff` | Local dashboard font asset: barlow condensed semibold 600 font. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/hanken_grotesk_open_font_license.txt` | Configuration or reference data for hanken grotesk open font license. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/hanken_grotesk_variable_dashboard_font.woff2` | Local dashboard font asset: hanken grotesk variable dashboard font. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/ibm_plex_mono_medium_500_font.woff` | Local dashboard font asset: ibm plex mono medium 500 font. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/ibm_plex_mono_open_font_license.txt` | Configuration or reference data for ibm plex mono open font license. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/ibm_plex_mono_regular_400_font.woff` | Local dashboard font asset: ibm plex mono regular 400 font. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/ibm_plex_sans_medium_500_font.woff` | Local dashboard font asset: ibm plex sans medium 500 font. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/ibm_plex_sans_open_font_license.txt` | Configuration or reference data for ibm plex sans open font license. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/ibm_plex_sans_regular_400_font.woff` | Local dashboard font asset: ibm plex sans regular 400 font. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/interface_fonts_and_license_notices/ibm_plex_sans_semibold_600_font.woff` | Local dashboard font asset: ibm plex sans semibold 600 font. |
| `frontend_warehouse_dashboard/dashboard_images_and_fonts/warehouse_dashboard_application_icon.svg` | Dashboard visual asset: warehouse dashboard application icon. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/dashboard_animation_and_transition_styles.css` | Style dashboard animation and transition styles. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/dashboard_light_and_dark_theme_colors.css` | Style dashboard light and dark theme colors. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/dashboard_page_and_navigation_layout.css` | Style dashboard page and navigation layout. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/dashboard_workspace_panel_layout.css` | Style dashboard workspace panel layout. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/esp32_mqtt_connection_panel_styles.css` | Style esp32 mqtt connection panel styles. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/interactive_route_map_styles.css` | Style interactive route map styles. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/load_dashboard_font_files.css` | Style load dashboard font files. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/mission_review_and_approval_panel_styles.css` | Style mission review and approval panel styles. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/robot_model_validation_panel_styles.css` | Style robot model validation panel styles. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/shared_dashboard_controls_and_components.css` | Style shared dashboard controls and components. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/streamlit_dashboard_scroll_container.css` | Style streamlit dashboard scroll container. |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/digital_twin_architecture_and_validation_plan.md` | Explain digital twin architecture and validation plan. |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/digital_twin_feature_alignment_audit.md` | Explain digital twin feature alignment audit. |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/download_kits_and_generated_guides.md` | Explain download kits and generated guides. |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/esp32_robot_telemetry_starter_kit.zip` | Generated downloadable starter kit, rebuilt from canonical firmware/backend/documentation sources. |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/esp32_wifi_and_telemetry_setup.md` | Explain esp32 wifi and telemetry setup. |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/mqtt_sqlite_recorder_and_labview_adapter_starter_kit.zip` | Generated downloadable starter kit, rebuilt from canonical firmware/backend/documentation sources. |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/operator_override_channel_and_hardware_commissioning.md` | Explain operator override channel and hardware commissioning. |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/project_ownership_and_external_software_licenses.txt` | Configuration or reference data for project ownership and external software licenses. |
| `frontend_warehouse_dashboard/external_browser_libraries/mqtt_telemetry_messaging/mqtt_browser_telemetry_client.esm.js` | Vendored external browser dependency or its original license: mqtt browser telemetry client.esm. |
| `frontend_warehouse_dashboard/external_browser_libraries/mqtt_telemetry_messaging/mqtt_client_mit_license.txt` | Vendored external browser dependency or its original license: mqtt client mit license. |
| `frontend_warehouse_dashboard/external_browser_libraries/threejs_3d_rendering/threejs_3d_rendering_core.min.js` | Vendored external browser dependency or its original license: threejs 3d rendering core.min. |
| `frontend_warehouse_dashboard/external_browser_libraries/threejs_3d_rendering/threejs_3d_rendering_module.min.js` | Vendored external browser dependency or its original license: threejs 3d rendering module.min. |
| `frontend_warehouse_dashboard/external_browser_libraries/threejs_3d_rendering/threejs_mesh_geometry_utilities.js` | Vendored external browser dependency or its original license: threejs mesh geometry utilities. |
| `frontend_warehouse_dashboard/external_browser_libraries/threejs_3d_rendering/threejs_mit_license.txt` | Vendored external browser dependency or its original license: threejs mit license. |
| `frontend_warehouse_dashboard/external_browser_libraries/threejs_3d_rendering/threejs_room_environment_lighting.js` | Vendored external browser dependency or its original license: threejs room environment lighting. |
| `frontend_warehouse_dashboard/external_browser_libraries/threejs_3d_rendering/threejs_rounded_box_geometry.js` | Vendored external browser dependency or its original license: threejs rounded box geometry. |
| `frontend_warehouse_dashboard/frontend_dashboard_source_file_guide.md` | Explain frontend dashboard source file guide. |
| `frontend_warehouse_dashboard/index.html` | Configuration or reference data for index. |
| `package-lock.json` | Exact JavaScript dependency versions for reproducible npm ci. |
| `package.json` | Pinned development dependencies and named test, formatter and benchmark commands. |
| `project_documentation/all_repository_file_purposes.md` | This catalog of each current repository file. |
| `project_documentation/dashboard_and_telemetry_system_architecture.md` | Explain dashboard and telemetry system architecture. |
| `project_documentation/dashboard_operator_guide.md` | Explain dashboard operator guide. |
| `project_documentation/deployment_and_local_setup.md` | Explain deployment and local setup. |
| `project_documentation/digital_twin_architecture_and_validation_plan.md` | Explain digital twin architecture and validation plan. |
| `project_documentation/digital_twin_feature_alignment_audit.md` | Explain digital twin feature alignment audit. |
| `project_documentation/esp32_wifi_and_telemetry_setup.md` | Explain esp32 wifi and telemetry setup. |
| `project_documentation/implemented_dashboard_features_and_limits.md` | Explain implemented dashboard features and limits. |
| `project_documentation/mqtt_sqlite_recorder_and_labview_adapter_setup.md` | Explain mqtt sqlite recorder and labview adapter setup. |
| `project_documentation/operator_override_channel_and_hardware_commissioning.md` | Explain operator override channel and hardware commissioning. |
| `project_documentation/project_documentation_index.md` | Explain project documentation index. |
| `project_documentation/repository_structure_and_project_flow.md` | Explain repository structure and project flow. |
| `project_documentation/routing_and_robot_model_software_verification.md` | Explain routing and robot model software verification. |
| `project_documentation/software_verification_results/current_software_check_results.md` | Explain current software check results. |
| `project_maintenance_scripts/__init__.py` | Mark this folder as a Python package for repository and starter-kit imports. |
| `project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py` | Implement rebuild dashboard downloads from sources. |
| `project_maintenance_scripts/repository_maintenance_commands.md` | Explain repository maintenance commands. |
| `project_ownership_and_external_software_licenses.txt` | Configuration or reference data for project ownership and external software licenses. |
| `requirements.txt` | Pinned Streamlit dashboard runtime dependency. |
| `streamlit_app.py` | Required deployment entrypoint delegating to the Python dashboard host. |
