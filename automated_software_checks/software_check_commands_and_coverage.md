# Automated verification

Run from the repository root. Use Python 3.12 with the pinned dashboard requirements, Node.js and jsdom 26.1.0 for development checks. Node.js is not needed to deploy the Streamlit dashboard.

```sh
python -m pip install -r requirements.txt
npm ci
npm test
python -m unittest discover -s automated_software_checks/python_telemetry_service_checks -p 'test_*.py' -v
python -m unittest discover -s automated_software_checks/streamlit_and_repository_integration_checks -p 'test_*.py' -v
python automated_software_checks/streamlit_and_repository_integration_checks/check_streamlit_frontend_file_delivery.py
python automated_software_checks/streamlit_and_repository_integration_checks/check_repository_links_source_boundaries_and_downloads.py
python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py --check
python project_maintenance_scripts/record_and_verify_repository_file_hashes.py --check
```

## Frontend checks

| File under `browser_behavior_checks/` in this test folder | Coverage |
| --- | --- |
| `test_robot_telemetry_identity_and_freshness.mjs` | Identity, schema, null/zero, freshness, monotonic expiry and diagnostics |
| `test_mission_approval_and_routes.mjs` | Both route legs, reserves, reservations, charging and forecast worker |
| `test_shortest_path_optimality.mjs` | 2,940 independent route oracle checks, ties, closures and routing objectives |
| `test_route_map_solver_and_playback.mjs` | 288 route/trace/direction/playback combinations |
| `test_route_map_user_interactions.cjs` | Pointer, touch, keyboard, isolation and lifecycle |
| `test_warehouse_scene_geometry.mjs` | Twelve racks, clearance, 24 journey pairs and scene geometry |
| `test_robot_state_calibration_and_recording_replay.mjs` | Observer, holdout, faults, recording import and paired comparisons |
| `test_dashboard_user_interactions.cjs` | Review/approval/reassignment, source isolation and Twin lab flow |
| `test_interface_animation_and_lifecycle.cjs` | Focus, persistent DOM, motion preferences, themes and worker cleanup |
| `test_mission_inventory_and_model_consistency.mjs` | 288 reassignment configurations, inventory and model/study gates |
| `test_streamlit_frame_connection_and_scrolling.cjs` | Readiness, trusted parent, sizing, seven-view scrolling, focus and cleanup |

## Backend and integration checks

| Test path | Coverage |
| --- | --- |
| [python_telemetry_service_checks/test_mqtt_recorder_and_labview_inventory_adapter.py](python_telemetry_service_checks/test_mqtt_recorder_and_labview_inventory_adapter.py) | Six standard-library tests for validation, replay rejection, LabVIEW counts and SQLite export |
| [streamlit_and_repository_integration_checks/test_streamlit_dashboard_host.py](streamlit_and_repository_integration_checks/test_streamlit_dashboard_host.py) | Actual Streamlit host registration and stable identity on rerun |
| [streamlit_and_repository_integration_checks/check_streamlit_frontend_file_delivery.py](streamlit_and_repository_integration_checks/check_streamlit_frontend_file_delivery.py) | Real local HTTP/WebSocket process; every frontend file's bytes and MIME type |
| [streamlit_and_repository_integration_checks/check_repository_links_source_boundaries_and_downloads.py](streamlit_and_repository_integration_checks/check_repository_links_source_boundaries_and_downloads.py) | Repository and browser references, worker locations, folder boundaries, download/source bytes and private-setting exclusions |

Frontend DOM checks use a test renderer. These results establish software behavior and local hosting; physical robot accuracy, real broker operation, deployed-browser WebGL and the hosted Streamlit Cloud session require separate verification. [Recorded results](../project_documentation/software_check_results_and_source_history/current_software_check_results.md) identify the runtime and scope.
