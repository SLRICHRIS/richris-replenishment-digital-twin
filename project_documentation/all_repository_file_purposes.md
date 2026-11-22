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
| `automated_software_checks/browser_behavior_checks/test_manager_movement_and_fleet_replanning.mjs` | Verify movable manager restrictions, reactive fleet routes, waiting poses, reserve gates and traffic clearance. |
| `automated_software_checks/browser_behavior_checks/test_mission_inventory_and_model_consistency.mjs` | Verify or measure mission inventory and model consistency. |
| `automated_software_checks/browser_behavior_checks/test_single_amr_route_time_windows.mjs` | Verify or measure multi robot time window reservations. |
| `automated_software_checks/browser_behavior_checks/test_robot_state_calibration_and_recording_replay.mjs` | Verify or measure robot state calibration and recording replay. |
| `automated_software_checks/browser_behavior_checks/test_robot_telemetry_identity_and_freshness.mjs` | Verify or measure robot telemetry identity and freshness. |
| `automated_software_checks/browser_behavior_checks/test_route_map_solver_and_playback.mjs` | Verify or measure route map solver and playback. |
| `automated_software_checks/browser_behavior_checks/test_route_map_user_interactions.cjs` | Verify or measure route map user interactions. |
| `automated_software_checks/browser_behavior_checks/test_shortest_path_optimality.mjs` | Verify or measure shortest path optimality. |
| `automated_software_checks/browser_behavior_checks/test_streamlit_frame_connection_and_scrolling.cjs` | Verify or measure streamlit frame connection and scrolling. |
| `automated_software_checks/browser_behavior_checks/test_warehouse_scene_geometry.mjs` | Verify or measure warehouse scene geometry. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/check_onboard_controller_uart_contract.cpp` | Verify or measure onboard controller uart contract. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/check_mh_ir_controller.cpp` | Exercise the real local command timeout, direction interlock, unsigned pulse debounce/wrap and diagnostic packet encoder in native C++. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/verify_mh_ir_commissioning.py` | Parse actual firmware JSON independently, enforce model-source isolation and compile the MH IR Arduino sketch. |
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
| `backend_streamlit_and_telemetry/predictive_twin/database_inspection.py` | Provide sanitized, cached read-only archive payloads and the fallback Streamlit record/attribute browser, independently from measured calibration. |
| `esp32_telemetry_firmware/esp32_telemetry_firmware_file_guide.md` | Explain esp32 telemetry firmware file guide. |
| `esp32_telemetry_firmware/publish_mh_ir_commissioning/publish_mh_ir_commissioning.ino` | Preserve final TB6612/MH IR/IMU/INA219 wiring and local Serial commands while publishing checked multisensor commissioning telemetry over MQTT/TLS. |
| `esp32_telemetry_firmware/publish_mh_ir_commissioning/mh_ir_controller.h` | Share tested local motor request logic, cumulative pulse debounce and truthful diagnostic JSON encoding without model equations or Arduino dependencies. |
| `esp32_telemetry_firmware/publish_mh_ir_commissioning/example_esp32_wifi_and_mqtt_settings.h` | Public placeholder Wi-Fi/TLS settings, actual supplied pins, local timeout/interlock and unconfirmed pulses-per-revolution settings. |
| `project_documentation/mh_ir_hardware_commissioning.md` | Explain the supplied single-channel hardware, exact wiring, commissioning packet boundary, private configuration and physical work needed for the six models. |
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
| `frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/manager_relocation_and_fleet_route_replanning.js` | Validate manager placement and atomically replan active robot journeys and time-window reservations. |
| `frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/compare_dispatch_policies_with_shared_inputs.js` | Implement compare dispatch policies with shared inputs. |
| `frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/robot_model_validation_and_experiment_panel.js` | Implement robot model validation and experiment panel. |
| `frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js` | Implement robot state estimation calibration and replay. |
| `frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/interactive_route_map_and_algorithm_playback.js` | Implement interactive route map and algorithm playback. |
| `frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js` | Implement warehouse graph validation and dijkstra routing. |
| `frontend_warehouse_dashboard/browser_modules/streamlit_frame_connection/streamlit_frame_connection_and_scrolling.js` | Implement streamlit frame connection and scrolling. |
| `frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js` | Implement reference warehouse racks aisles and route graph. |
| `frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/warehouse_manager_standing_zones_and_route_clearance.js` | Define manager standing locations, validate restricted-zone metadata and check route-segment clearance. |
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
| `.github/workflows/digital-twin-checks.yml` | Run Python, browser, hosting and direct-sensor firmware compilation checks. |
| `.streamlit/secrets.example.toml` | Public placeholder settings; measured calibrations and private broker credentials are supplied separately. |
| `automated_software_checks/predictive_twin_checks/test_models.py` | Verify test models of the active Python sensor twin. |
| `automated_software_checks/predictive_twin_checks/test_mqtt_service.py` | Verify test mqtt service of the active Python sensor twin. |
| `automated_software_checks/predictive_twin_checks/test_telemetry.py` | Verify test telemetry of the active Python sensor twin. |
| `backend_streamlit_and_telemetry/predictive_twin/__init__.py` | Mark the active Python sensor twin package. |
| `backend_streamlit_and_telemetry/predictive_twin/dashboard.py` | Render Python model outputs and the separate inventory experiment in Streamlit. |
| `backend_streamlit_and_telemetry/predictive_twin/demo.py` | Generate clearly labelled deterministic synthetic raw measurements. |
| `backend_streamlit_and_telemetry/predictive_twin/models.py` | Implement slide equations and forecasts with explicit units and validation. |
| `backend_streamlit_and_telemetry/predictive_twin/mqtt_service.py` | Subscribe server-side over verified TLS without issuing commands. |
| `backend_streamlit_and_telemetry/predictive_twin/telemetry.py` | Validate raw packets and maintain isolated per-robot model state and freshness. |
| `esp32_telemetry_firmware/publish_raw_sensor_telemetry/example_esp32_wifi_and_mqtt_settings.h` | Configure direct-sensor firmware using public placeholders only. |
| `esp32_telemetry_firmware/publish_raw_sensor_telemetry/publish_raw_sensor_telemetry.ino` | Publish direct encoder/gyro/battery observations; keep motors in standby for commissioning. |
| `project_documentation/slide_to_code_mapping.md` | Document slide to code mapping. |
| `project_documentation/single_amr_alignment_validation.md` | Document two robot alignment validation. |
| `project_documentation/single_amr_sensor_twin_setup.md` | Document two robot sensor twin setup. |
| `requirements-dev.txt` | Install the active app and research verification dependencies. |
| `research_baseline/.gitignore` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/Dockerfile` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/README.md` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/compose.yaml` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/docs/00_guided_walkthrough.md` | Explain the synthetic replenishment scenario and walkthrough. |
| `research_baseline/docs/01_system_architecture.md` | Describe the research inventory API architecture. |
| `research_baseline/docs/02_inventory_and_events.md` | Define reserve/transit/pick stock and task event semantics. |
| `research_baseline/docs/03_modelling_choices.md` | Document synthetic inventory model assumptions. |
| `research_baseline/docs/04_validation_protocol.md` | Document the research model validation protocol. |
| `research_baseline/docs/05_streamlit_deployment.md` | Document the standalone research Streamlit entry point. |
| `research_baseline/docs/06_source_credit.md` | Attribute the research inventory workflow sources. |
| `research_baseline/docs/07_security_and_limitations.md` | Document research API boundaries and synthetic-data limitations. |
| `research_baseline/examples/telemetry_example.json` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/requirements-backend.txt` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/requirements-dev.txt` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/requirements.txt` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/start_linux_macos.sh` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/start_windows.bat` | Configure or launch the standalone research inventory experiment. |
| `research_baseline/streamlit_app.py` | Render the detailed synthetic warehouse walkthrough and policy comparison. |
| `research_baseline/tests/test_api.py` | Verify the research api model. |
| `research_baseline/tests/test_explain.py` | Verify the research explain model. |
| `research_baseline/tests/test_mqtt_gateway.py` | Verify the research mqtt gateway model. |
| `research_baseline/tests/test_simulation.py` | Verify the research simulation model. |
| `research_baseline/warehouse_twin/__init__.py` | Mark the research inventory model package. |
| `research_baseline/warehouse_twin/api.py` | Serve the synthetic inventory API, quarantine endpoint, event stream and web assets. |
| `research_baseline/warehouse_twin/database.py` | Persist synthetic runs, immutable events and quarantined legacy telemetry in SQLite. |
| `research_baseline/warehouse_twin/explain.py` | Derive inventory-event explanations without changing authoritative state. |
| `research_baseline/warehouse_twin/mqtt_gateway.py` | Forward legacy x/y observations to the research API quarantine; not the active raw-sensor path. |
| `research_baseline/warehouse_twin/simulation.py` | Execute deterministic replenishment events and enforce inventory conservation. |
| `research_baseline/web/app.js` | Display the research API inventory and event experiment in a browser. |
| `research_baseline/web/index.html` | Define the research API web view. |
| `research_baseline/web/style.css` | Style the research API web view. |
| `automated_software_checks/browser_behavior_checks/test_python_sensor_twin_workspace.cjs` | Verify trusted Python display messages, text-only rendering, freshness, preserved floor state and source-selection actions. |
| `automated_software_checks/predictive_twin_checks/test_workspace_payload.py` | Verify public component data, bounded history, private-setting isolation and stale forecast suppression. |
| `backend_streamlit_and_telemetry/predictive_twin/workspace_payload.py` | Build public Python-derived sensor readouts for the Sensor models view. |
| `automated_software_checks/predictive_twin_checks/test_demo_trials.py` | Independently verify generated trial outcomes, analytic motion/energy expectations, evidence replay, source matching and altered-result rejection. |
| `project_maintenance_scripts/replay_generated_trial.py` | Replay downloaded generated packets without PostgreSQL and verify source fingerprints, final state, forecasts and recommendations. |
| `project_documentation/demonstration_and_evidence_guide.md` | Explain the demonstration sequence, expected trial outcomes, replay command and limits of software versus hardware evidence. |
| `backend_streamlit_and_telemetry/predictive_twin/amr_connection.py` | Manage the optional session-bound EMQX subscriber and leased PostgreSQL writer behind operator authorization; expose sanitized pipeline readiness. |
| `backend_streamlit_and_telemetry/predictive_twin/insights.py` | Derive operator recommendations from current, continuous sensor-model evidence and distinguish generated examples. |
| `frontend_warehouse_dashboard/browser_modules/streamlit_frame_connection/amr_connection_panel.js` | Render connection stages, protected controls and Python-derived guidance without persisting credentials in the browser. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/amr_connection_panel_styles.css` | Style the responsive connection, pipeline, insight and recommendation panels in both themes. |
| `automated_software_checks/predictive_twin_checks/test_amr_connection.py` | Verify authorization, subscription timeout, exclusive writer ownership, cleanup and the real sensor-to-database pipeline using isolated test inputs. |
| `automated_software_checks/predictive_twin_checks/test_insights.py` | Verify freshness and continuity gates, charge-reserve and motion-disagreement guidance, calibration and demo identity. |
| `frontend_warehouse_dashboard/browser_modules/streamlit_frame_connection/python_sensor_twin_readouts.js` | Render Python sensor values and the shared read-only archive browser with safe text cells, dataset selection and JSON export; no browser model calculations. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/python_sensor_twin_panel_styles.css` | Define the shared single-AMR visual system, responsive model cards, warehouse view, archive tables and connection/empty states. |
| `automated_software_checks/browser_behavior_checks/test_single_amr_configuration.mjs` | Construct warehouse geometry and verify exactly one robot, one dock and one registered telemetry identity. |
| `backend_streamlit_and_telemetry/predictive_twin/database.py` | Structured PostgreSQL raw sample, calibration and derived-state SQLAlchemy records and read-only snapshot query. |
| `backend_streamlit_and_telemetry/predictive_twin/ingest_worker.py` | Independent always-on MQTT-to-PostgreSQL ingestion service; models sensors before transactional persistence. |
| `automated_software_checks/predictive_twin_checks/test_database.py` | Test SQLite-isolated telemetry persistence, packet replay suppression and calibration mismatch. |
| `automated_software_checks/predictive_twin_checks/test_postgres_integration.py` | Integration-check actual PostgreSQL persistence with linked raw and derived measurements. |
| `project_documentation/postgresql_sensor_pipeline.md` | Installation, schema, private credentials, database roles, and live physical commissioning limitations. |
| `project_maintenance_scripts/probe_emqx_connection.py` | Read-only EMQX Cloud TLS authorization and raw sensor packet smoke test, with no SQL writes. |
| `project_documentation/emqx_cloud_amr01_integration.md` | Official EMQX Serverless broker configuration, topic ACLs, ESP32 publisher, ingestion-worker and PostgreSQL integration guide. |
| `project_maintenance_scripts/provision_amr_sensor_database.py` | Admin-only PostgreSQL database provisioning, additive checkpoint migration and validation, separate from live MQTT worker. |

## Website human review and action

| File | Purpose |
| --- | --- |
| `backend_streamlit_and_telemetry/predictive_twin/human_review.py` | Shared operator review policy, durable audit and acknowledgement/outcome verification. |
| `backend_streamlit_and_telemetry/predictive_twin/human_review_workspace.py` | Session-isolated rehearsal and authenticated physical website decisions. |
| `backend_streamlit_and_telemetry/predictive_twin/intervention_service.py` | Server-owned review service, PostgreSQL ownership and opt-in MQTT intervention transport. |
| `project_maintenance_scripts/provision_operator_review_database.py` | Admin-only additive provisioning of the operator review audit table. |
| `frontend_warehouse_dashboard/browser_modules/streamlit_frame_connection/human_review_panel.js` | Human review rehearsal controls and physical outcome display. |
| `frontend_warehouse_dashboard/browser_modules/streamlit_frame_connection/system_architecture_workspace.js` | Interactive read-only sensor, vision, model and power journeys with conservative server-reported status. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/system_architecture_styles.css` | Responsive architecture diagrams, component inspection and recorded setup presentation. |
| `automated_software_checks/browser_behavior_checks/test_system_architecture_workspace.cjs` | Verify architecture navigation, status freshness, source isolation, safe rendering and command-free exploration. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/human_review_panel_styles.css` | Responsive styling for the human review workflow and audit trail. |
| `project_documentation/website_human_review_and_action.md` | Website operator workflow, private settings, command contract and physical readiness. |
| `automated_software_checks/predictive_twin_checks/test_human_review.py` | Review policy tests for stale evidence, duplicate approval, acknowledgements and outcome verification. |

| `automated_software_checks/predictive_twin_checks/test_website_review.py` | Authorization, session ownership, server evidence and physical simulation boundaries. |
| `project_maintenance_scripts/website_review_writer_grant.sql` | Narrow review-audit DML grant for the existing restricted server writer. |

| `esp32_telemetry_firmware/publish_mh_ir_commissioning/multisensor_observations.h` | Sensor snapshot validation, yaw/charge continuity and bounded JSON with explicit units and nulls. |
| `esp32_telemetry_firmware/publish_mh_ir_commissioning/UPLOAD_STEPS.md` | Exact private-package upload steps, local motor behavior, wiring and prediction boundaries. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/check_multisensor_observations.cpp` | Execute final PWM settings, sensor encoding, unit conversion, nonfinite/stale rejection and integration-gap behavior. |

| `project_maintenance_scripts/build_arduino_cloud_import.py` | Reproduce and verify the four-file Arduino Cloud import ZIP with public placeholder settings only. |
| `esp32_telemetry_firmware/downloads/AMR01_Arduino_Cloud_Import.zip` | Directly importable current multisensor sketch and three headers; contains no owner credentials or operator code. |
| `automated_software_checks/browser_behavior_checks/test_physical_telemetry_display.cjs` | Check physical readout visibility, stale suppression and safe text rendering. |
| `automated_software_checks/predictive_twin_checks/test_physical_telemetry.py` | Check optional storage, receive-time freshness, bounded records and model isolation. |
| `automated_software_checks/predictive_twin_checks/test_observed_energy.py` | Check recorded Wh integration, signed current, missing intervals and duplicate/restart handling. |
| `automated_software_checks/predictive_twin_checks/test_observed_motion.py` | Check command-inferred local odometry, gyro comparison, direction evidence and segment recovery. |
| `backend_streamlit_and_telemetry/commissioning_webhook/build.mjs` | Bundle the HTTP receiver and dependencies for Node.js 24 deployment. |
| `backend_streamlit_and_telemetry/commissioning_webhook/contract.mjs` | Validate the installed unsigned sensor packet, preserve units and build immutable evidence hashes. |
| `backend_streamlit_and_telemetry/commissioning_webhook/emqx_body_template.json.tmpl` | HTTP action template for the protected broker-to-database hop. |
| `backend_streamlit_and_telemetry/commissioning_webhook/emqx_rule.sql` | Select the exact installed-device topic and its broker receive timestamp. |
| `backend_streamlit_and_telemetry/commissioning_webhook/handler.mjs` | Authenticate and bound HTTP telemetry requests before database access. |
| `backend_streamlit_and_telemetry/commissioning_webhook/index.mjs` | Neon Functions entrypoint for the protected EMQX telemetry receiver. |
| `backend_streamlit_and_telemetry/commissioning_webhook/package-lock.json` | Reproducible dependency lock for the protected telemetry receiver. |
| `backend_streamlit_and_telemetry/commissioning_webhook/package.json` | Pinned build and runtime dependencies for the protected telemetry receiver. |
| `backend_streamlit_and_telemetry/commissioning_webhook/schema.sql` | Add the optional physical telemetry table, index and limited runtime grants. |
| `backend_streamlit_and_telemetry/commissioning_webhook/storage.mjs` | Insert typed evidence idempotently with the restricted writer account. |
| `backend_streamlit_and_telemetry/commissioning_webhook/tests/contract.test.mjs` | Check admission, authentication, bounded input, retry behavior and error sanitization. |
| `backend_streamlit_and_telemetry/commissioning_webhook/tests/fixture.mjs` | Synthetic packet fixture used only in isolated software and staging checks. |
| `backend_streamlit_and_telemetry/predictive_twin/physical_telemetry.py` | Read stored observations without promoting them into calibrated predictions. |
| `backend_streamlit_and_telemetry/predictive_twin/observed_energy.py` | Reconstruct and increment recorded motor-branch energy from stored battery samples. |
| `backend_streamlit_and_telemetry/predictive_twin/observed_motion.py` | Reconstruct display-only local odometry and gyro residual from coherent recorded pulse evidence. |
| `backend_streamlit_and_telemetry/predictive_twin/commissioning_profile.py` | Record supplied AMR-01 geometry, pending IMU/battery evidence and unsigned wheel estimates. |
| `project_documentation/physical_sensor_recording.md` | Current ESP32-to-EMQX-to-database deployment and measurement interpretation guide. |

| `automated_software_checks/browser_behavior_checks/test_a0_vision_route_preview.mjs` | Check conservative measured-floor footprint planning, continuous obstacle collision and blocked scenes without physical execution. |
| `automated_software_checks/browser_behavior_checks/test_overhead_camera_workspace.mjs` | Check local setup/rehearsal invalidation, camera permission cleanup and command-free review/export. |
| `frontend_warehouse_dashboard/browser_modules/vision_routing/a0_route_preview.js` | Pure measured-floor grid planner with conservative full-body clearance and continuous segment collision checks. |
| `frontend_warehouse_dashboard/browser_modules/vision_routing/overhead_camera_workspace.js` | Local camera setup/preview, manual obstacle map, route rehearsal and browser-only human review with no command bridge. |
| `frontend_warehouse_dashboard/dashboard_stylesheets/vision_routing_styles.css` | Responsive measured-paper camera setup, manual map and route review styling. |
| `project_documentation/overhead_camera_route_provision.md` | Explain camera provision, manual planning limits and measurements/integration needed before physical routing. |
| `automated_software_checks/browser_behavior_checks/test_physical_route_execution.mjs` | Verify physical approval, fresh evidence and stop interactions. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/check_vision_drive_guard.cpp` | Exercise firmware arm, expiry, replay, motor cap and reversal guards. |
| `automated_software_checks/predictive_twin_checks/test_vision_camera.py` | Implement and verify the protected physical route workflow. |
| `automated_software_checks/predictive_twin_checks/test_vision_execution.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/predictive_twin/vision_execution_workspace.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/vision_control/__init__.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/vision_control/agent.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/vision_control/camera.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/vision_control/contracts.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/vision_control/coordinator.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/vision_control/desktop_agent.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/vision_control/example_camera_config.json` | Provide uncommissioned camera and measured motor configuration placeholders. |
| `backend_streamlit_and_telemetry/vision_control/protocol.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/vision_control/requirements-vision.txt` | Pin optional USB-camera controller dependencies. |
| `backend_streamlit_and_telemetry/vision_control/route_audit.sql` | Provision the separate durable route decision audit. |
| `backend_streamlit_and_telemetry/vision_control/service.py` | Implement and verify the protected physical route workflow. |
| `backend_streamlit_and_telemetry/vision_control/setup_camera.py` | Implement and verify the protected physical route workflow. |
| `esp32_telemetry_firmware/publish_mh_ir_commissioning/vision_drive_guard.h` | Enforce the ESP32 route lease, boot epoch and bounded wheel outputs. |
| `frontend_warehouse_dashboard/browser_modules/vision_routing/physical_route_execution.js` | Render authenticated physical route review and bounded server actions. |
| `project_documentation/human_approved_physical_route_execution.md` | Explain physical route setup, approval, firmware and commissioning boundaries. |

| `automated_software_checks/browser_behavior_checks/test_vision_routing_workflow.mjs` | Verify guided stages, mode isolation, physical presence release, camera cleanup, accessible navigation and shared setup lifecycle. |
| `frontend_warehouse_dashboard/browser_modules/vision_routing/vision_routing_workspace.js` | Coordinate the Physical AMR and Practice modes with one shared measurement form and explicit camera/presence lifecycle. |

| `automated_software_checks/browser_behavior_checks/test_human_review_usability.cjs` | Check actionable readiness, source isolation, operator ownership, preserved decision inputs, expiry and separate request/reply/sensor outcomes. |

| `automated_software_checks/browser_behavior_checks/test_manual_motor_control.mjs` | Verify one-shot approval and manual control page lifecycle. |
| `automated_software_checks/predictive_twin_checks/test_manual_motor_control.py` | Implement or verify authenticated one-shot manual motor control. |
| `backend_streamlit_and_telemetry/predictive_twin/manual_control_workspace.py` | Implement or verify authenticated one-shot manual motor control. |
| `backend_streamlit_and_telemetry/vision_control/manual.py` | Implement or verify authenticated one-shot manual motor control. |
| `backend_streamlit_and_telemetry/vision_control/held_manual.py` | Coordinate authenticated human-held motor leases, release, input expiry and restart fences. |
| `automated_software_checks/predictive_twin_checks/test_held_manual.py` | Verify held driving offline, receiver limits, zero-output arming, source expiry and replay prevention. |
| `esp32_telemetry_firmware/AMR01_Manual_WiFi/AMR01_Manual_WiFi.ino` | Preserve the supplied working sketch while adding authenticated expiring Wi-Fi motor commands. |
| `esp32_telemetry_firmware/AMR01_Manual_WiFi/example_esp32_wifi_and_mqtt_settings.h` | Public placeholders for private Wi-Fi, telemetry and manual receiver settings. |
| `frontend_warehouse_dashboard/browser_modules/vision_routing/manual_motor_control.js` | Render attended manual motor review and bridge server-owned approvals. |
| `project_documentation/manual_motor_control_setup.md` | Step-by-step private connection setup and feedback interpretation for manual AMR control. |
| `project_maintenance_scripts/add_manual_receiver_to_working_sketch.py` | Implement or verify authenticated one-shot manual motor control. |

| `backend_streamlit_and_telemetry/predictive_twin/control_presence.py` | Synchronize the selected manual or vision control page atomically when Streamlit coalesces view events; cancel only the departing session’s owned requests. |

| `amr01_camera_setup.py` | Safe standalone Windows executable entry point for one-time Logitech camera calibration/background capture. |
| `amr01_camera_agent.py` | Standalone Windows executable entry point for the protected, calibrated vision-to-EMQX controller. |
| `.github/workflows/build-windows-amr-camera.yml` | Build and smoke-test unsigned Windows camera toolkit executables without bundling operator secrets. |
| `project_documentation/windows_camera_agent_no_python.md` | Explain how to download and commission the Windows toolkit without installing Python locally. |

| `backend_streamlit_and_telemetry/vision_control/battery_policy.py` | Enforce separate low-battery advisory and unoverrideable critical-voltage cutoff for AMR route decisions. |
| `automated_software_checks/predictive_twin_checks/test_battery_policy.py` | Verify signed advisory human decisions, zero-output pause, continued-route limits and absolute critical-voltage stopping. |
| `backend_streamlit_and_telemetry/vision_control/battery_policy.py` | Deterministic physical voltage policy: operator may decline low-battery diversion only above non-overridable critical cutoff. |
| `automated_software_checks/predictive_twin_checks/test_battery_policy.py` | Regression test three-way battery conditions, signed human reviews, replay protection and hard-stop dominance. |
| `backend_streamlit_and_telemetry/vision_control/browser_camera.py` | Receive webcam frames through Streamlit WebRTC, annotate ArUco IDs, capture checkerboard/empty floor and derive server-verified poses only after physical calibration. |
| `backend_streamlit_and_telemetry/vision_control/browser_gateway.py` | Fail-closed server MQTT transport, signed camera scene and audited Agent route follower after explicit physical WebRTC commissioning. |
| `backend_streamlit_and_telemetry/vision_control/browser_receiver_service.py` | Checks signed ESP32 feedback on the existing receiver connection and connects the commissioned browser camera to the audited route coordinator. |
| `backend_streamlit_and_telemetry/vision_control/browser_streamlit_workspace.py` | Render on-page browser camera, calibration, measured camera settings and protected EMQX controls in Streamlit. |
| `automated_software_checks/predictive_twin_checks/test_browser_camera.py` | Verify server-side ArUco marker detection, reference capture and no uncommissioned control path. |
| `project_documentation/streamlit_webrtc_amr_camera.md` | Commission the server-side Streamlit WebRTC webcam, ArUco tracker and protected MQTT control gates. |

## Physical data studies

| File | Purpose |
| --- | --- |
| `physical_data_studies/.gitignore` | Exclude local prediction exports and study environments. |
| `physical_data_studies/.gitattributes` | Preserve binary reports and compressed data; keep study text line endings stable on Windows. |
| `physical_data_studies/README.md` | Explain the study, measured counts, results and reproduction steps. |
| `physical_data_studies/SHA256SUMS.txt` | Record SHA-256 fingerprints for the packaged study files. |
| `physical_data_studies/battery_voltage/AMR01_Data_Study_Report.pdf` | Present the completed voltage data study, methods and measured held-out results. |
| `physical_data_studies/battery_voltage/README.md` | Explain the study, measured counts, results and reproduction steps. |
| `physical_data_studies/battery_voltage/SHA256SUMS.txt` | Record SHA-256 fingerprints for the packaged study files. |
| `physical_data_studies/battery_voltage/dataset/AMR01_Model_Dataset.csv` | Store 1,518 labelled voltage examples with history, future target and chronological split. |
| `physical_data_studies/battery_voltage/dataset/boot_sessions.csv` | Inventory packet counts, chronological partitions and eligible examples by ESP32 boot. |
| `physical_data_studies/battery_voltage/dataset/count.sql` | Reproduce the frozen physical packet count against an authorized database connection. |
| `physical_data_studies/battery_voltage/dataset/data_dictionary.md` | Define sensor fields, units, feature columns, target construction and evaluation metadata. |
| `physical_data_studies/battery_voltage/dataset/export.sql` | Define the fixed noncredential projection of physical commissioning records. |
| `physical_data_studies/battery_voltage/dataset/physical_packets.csv.gz` | Losslessly store all 68,130 physical packets with 42 selected telemetry/provenance fields. |
| `physical_data_studies/battery_voltage/dataset/snapshot.json` | Record the frozen database count, extraction cutoff, firmware inventory and sensor coverage. |
| `physical_data_studies/battery_voltage/evaluation/data_audit.json` | Account for input quality, exclusions, window construction and split counts. |
| `physical_data_studies/battery_voltage/evaluation/results.json` | Record chosen model settings, held-out scores and study-specific evaluation details. |
| `physical_data_studies/battery_voltage/evaluation/test_metrics.csv` | Compare the trained model and simple baselines on the same held-out forecast origins. |
| `physical_data_studies/battery_voltage/evaluation/test_metrics_by_boot.csv` | Report held-out forecasting errors separately for each eligible boot. |
| `physical_data_studies/battery_voltage/evaluation/test_predictions.csv` | Retain every held-out target and all method predictions for independent scoring. |
| `physical_data_studies/battery_voltage/evaluation/validation_grid.csv` | Retain validation scores for every candidate model setting. |
| `physical_data_studies/battery_voltage/model/voltage_ridge.json` | Store fitted voltage-model coefficients, intercept, scaler and input order. |
| `physical_data_studies/battery_voltage/requirements.txt` | Pin the numerical and machine-learning dependencies used by the offline studies. |
| `physical_data_studies/battery_voltage/study.py` | Preprocess voltage packets, build labelled windows, fit Ridge and evaluate held-out boots. |
| `physical_data_studies/methodology.md` | Explain data acquisition, preprocessing, training and evaluation with linked evidence. |
| `physical_data_studies/gyroscope/AMR01_Gyro_Study_Report.pdf` | Present the completed gyro data study, held-out results and offset sensitivity. |
| `physical_data_studies/gyroscope/README.md` | Explain the study, measured counts, results and reproduction steps. |
| `physical_data_studies/gyroscope/SHA256SUMS.txt` | Record SHA-256 fingerprints for the packaged study files. |
| `physical_data_studies/gyroscope/data/AMR01_Gyro_Model_Dataset.csv` | Store 18,766 labelled gyro examples with source sequences, features, future target and split. |
| `physical_data_studies/gyroscope/data/AMR01_Gyro_Packets.csv.gz` | Losslessly store the 17-field gyro projection of the same 68,130 physical packets. |
| `physical_data_studies/gyroscope/data/boot_sessions.csv` | Inventory packet counts, chronological partitions and eligible examples by ESP32 boot. |
| `physical_data_studies/gyroscope/data/data_dictionary.md` | Define sensor fields, units, feature columns, target construction and evaluation metadata. |
| `physical_data_studies/gyroscope/data/source.json` | Identify the shared physical export, source hash, units and original software versions. |
| `physical_data_studies/gyroscope/evaluation/boot_gyro_offsets.csv` | Inspect raw and bias-corrected gyro levels and motor output for each boot. |
| `physical_data_studies/gyroscope/evaluation/data_audit.json` | Account for input quality, exclusions, window construction and split counts. |
| `physical_data_studies/gyroscope/evaluation/offset_sensitivity.csv` | Report fixed-prediction sensitivity to the flagged zero-output gyro boot. |
| `physical_data_studies/gyroscope/evaluation/results.json` | Record chosen model settings, held-out scores and study-specific evaluation details. |
| `physical_data_studies/gyroscope/evaluation/test_metrics.csv` | Compare the trained model and simple baselines on the same held-out forecast origins. |
| `physical_data_studies/gyroscope/evaluation/test_metrics_by_boot.csv` | Report held-out forecasting errors separately for each eligible boot. |
| `physical_data_studies/gyroscope/evaluation/test_predictions.csv` | Retain every held-out target and all method predictions for independent scoring. |
| `physical_data_studies/gyroscope/evaluation/validation_baselines.csv` | Retain validation scores for the simple gyro forecasting methods. |
| `physical_data_studies/gyroscope/evaluation/validation_grid.csv` | Retain validation scores for every candidate model setting. |
| `physical_data_studies/gyroscope/gyro_study.py` | Preprocess gyro packets, build labelled windows, fit boosted trees and evaluate held-out boots. |
| `physical_data_studies/gyroscope/model/gyro_forecaster.json` | Store the fitted gradient-boosted trees and feature order for portable inference. |
| `physical_data_studies/gyroscope/requirements.txt` | Pin the numerical and machine-learning dependencies used by the offline studies. |
| `physical_data_studies/gyroscope/verify_study.py` | Trace every gyro forecast window to source packets and check portable-model predictions and subgroup scores. |
| `physical_data_studies/reproduce.py` | Verify source fingerprints, rebuild both studies in temporary folders and compare all recorded datasets, model parameters and evaluations. |
| `physical_data_studies/requirements.txt` | Pin the numerical and machine-learning dependencies used by the offline studies. |
| `physical_data_studies/source_manifest.json` | Record original archive/report fingerprints, the shared snapshot and lossless source packaging. |
| `.github/workflows/physical-data-studies.yml` | Reproduce both physical data studies on relevant changes and manual runs using Python 3.12. |

## Live sensor recommendations

| File | Purpose |
| --- | --- |
| `backend_streamlit_and_telemetry/predictive_twin/sensor_recommendations.py` | Compute bounded live sensor screening checks and the operator response catalog without sending commands. |
| `frontend_warehouse_dashboard/browser_modules/vision_routing/live_sensor_recommendations.js` | Show sensor coverage, prioritized evidence and review links beside direct Wi-Fi control, with local freshness expiry. |
| `automated_software_checks/predictive_twin_checks/test_sensor_recommendations.py` | Exercise sag, output/feedback disagreements, sensor validity and continuous same-boot screening windows. |
| `automated_software_checks/browser_behavior_checks/test_live_sensor_recommendations.mjs` | Verify freshness expiry, demo isolation, safe text and recommendation-to-review navigation without actuation. |
| `project_documentation/live_sensor_recommendations.md` | Explain measured channels, screening thresholds, available responses and the direct-control human review workflow. |


## Operator workspace audit

| File | Purpose |
| --- | --- |
| `frontend_warehouse_dashboard/browser_modules/streamlit_frame_connection/operator_overview.js` | Show an observe-decide-act workflow with separate telemetry, review and local-controller states. |
| `automated_software_checks/browser_behavior_checks/test_operator_overview.cjs` | Check current/source status, review gates and navigation shortcuts without actuation. |
| `project_documentation/operator_workspace_audit.md` | Record the dashboard clarity, flow, logic, stale-data and visual audit with implemented fixes and validation limits. |

## Direct Wi-Fi ArUco routes

| File | Purpose |
| --- | --- |
| `amr01_local_twin.py` | Launch the laptop camera, local route-review workspace and authenticated direct Wi-Fi transport without starting movement. |
| `backend_streamlit_and_telemetry/vision_control/local_twin.py` | Serve the laptop ArUco workspace, retain local approval audit and connect the existing camera/follower contracts to the LAN receiver. |
| `backend_streamlit_and_telemetry/vision_control/local_transport.py` | Exchange signed, expiring route commands and fresh controller feedback with the fixed ESP32 address without proxies, redirects or MQTT. |
| `backend_streamlit_and_telemetry/vision_control/local_twin.html` | Present local camera calibration, route preview, explicit human decisions and camera-verified execution status. |
| `esp32_telemetry_firmware/AMR01_Local_Routes/AMR01_Local_Routes.ino` | Build the ESP32 firmware variant with local signed route control and separate sensor telemetry publication. |
| `esp32_telemetry_firmware/AMR01_Local_Routes/amr_wireless_app.h` | Preserve the working board wiring, sensor acquisition and manual HTTP controller while serving local route endpoints. |
| `esp32_telemetry_firmware/AMR01_Local_Routes/amr_route_control.h` | Own bounded wheel outputs, direct route sessions, signed feedback and manual-stop precedence independently of MQTT command delivery. |
| `esp32_telemetry_firmware/AMR01_Local_Routes/route_http_protocol.h` | Validate local HTTP route-command framing and authentication. |
| `esp32_telemetry_firmware/AMR01_Local_Routes/vision_drive_guard.h` | Reject expired, replayed or conflicting commands and enforce route output leases on the ESP32. |
| `esp32_telemetry_firmware/AMR01_Local_Routes/amr_mqtt_transport.h` | Support the retained EMQX telemetry publisher without making the broker the route-command transport. |
| `esp32_telemetry_firmware/AMR01_Local_Routes/example_private_amr_settings.h` | Provide placeholder Wi-Fi, telemetry and distinct route-key settings for the locally excluded private configuration. |
| `project_documentation/direct_wifi_aruco_routes.md` | Explain Windows startup, one-time receiver upload, local calibration, measured configuration, route decisions and verification limits. |
| `frontend_warehouse_dashboard/browser_modules/vision_routing/local_aruco_control.js` | Embed the laptop route workspace and end its session when the operator leaves or hides the dashboard view. |
| `automated_software_checks/browser_behavior_checks/test_local_aruco_embed.mjs` | Check local-workspace embedding, explicit launch and session teardown without connecting to a robot. |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/AMR01_Local_Routes.zip` | Reproducible local-route firmware kit containing canonical source, placeholder settings and setup guidance without private credentials. |
| `esp32_telemetry_firmware/AMR01_Local_Routes/.gitignore` | Exclude the private Wi-Fi, telemetry and route-key header from the firmware source tree. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/check_local_route_protocol.cpp` | Exercise signed route-command framing, expiry and rejection boundaries without physical actuation. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/check_local_route_runtime.cpp` | Exercise the real local receiver runtime and motor-output safeguards with native hardware stubs. |
| `automated_software_checks/esp32_firmware_compile_and_contract_checks/verify_local_routes.py` | Run local-route native checks and verify the firmware's direct-control source contract. |
| `automated_software_checks/predictive_twin_checks/test_local_twin.py` | Verify local route audit, camera freshness, operator presence, calibration invalidation, HTTP guards and authenticated receiver transport using mocks. |
| `automated_software_checks/browser_behavior_checks/test_local_twin_ui.cjs` | Verify local camera-route UI freshness, explicit actions, calibration and session teardown with mocked endpoints and no hardware actuation. |
