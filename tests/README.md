# Automated verification

Run from the repository root. Use Python 3.12 with the pinned dashboard requirements, Node.js and jsdom 26.1.0 for development checks. Node.js is not needed to deploy the Streamlit dashboard.

```sh
python -m pip install -r requirements.txt
npm ci
npm test
python -m unittest discover -s tests/backend -p 'test_*.py' -v
python -m unittest discover -s tests/integration -p 'test_*.py' -v
python tests/integration/check_streamlit_served_assets.py
python tests/integration/check_repository_file_links.py
python tools/build_dashboard_downloads.py --check
python tools/record_repository_integrity.py --check
```

## Frontend checks

| File under `frontend/` in this test folder | Coverage |
| --- | --- |
| `test_robot_telemetry.mjs` | Identity, schema, null/zero, freshness, monotonic expiry and diagnostics |
| `test_mission_approval_and_routes.mjs` | Both route legs, reserves, reservations, charging and forecast worker |
| `test_shortest_path_optimality.mjs` | 2,940 independent route oracle checks, ties, closures and routing objectives |
| `test_route_map_solver_and_playback.mjs` | 288 route/trace/direction/playback combinations |
| `test_route_map_user_interactions.cjs` | Pointer, touch, keyboard, isolation and lifecycle |
| `test_warehouse_scene_geometry.mjs` | Twelve racks, clearance, 24 journey pairs and scene geometry |
| `test_twin_calibration_and_replay.mjs` | Observer, holdout, faults, recording import and paired comparisons |
| `test_dashboard_user_interactions.cjs` | Review/approval/reassignment, source isolation and Twin lab flow |
| `test_interface_animation_and_lifecycle.cjs` | Focus, persistent DOM, motion preferences, themes and worker cleanup |
| `test_cross_feature_alignment.mjs` | 288 reassignment configurations, inventory and model/study gates |
| `test_streamlit_window_bridge_and_scroll.cjs` | Readiness, trusted parent, sizing, seven-view scrolling, focus and cleanup |

## Backend and integration checks

| Test path | Coverage |
| --- | --- |
| [backend/test_mqtt_observation_recorder.py](backend/test_mqtt_observation_recorder.py) | Six standard-library tests for validation, replay rejection, LabVIEW counts and SQLite export |
| [integration/test_streamlit_dashboard_host.py](integration/test_streamlit_dashboard_host.py) | Actual Streamlit host registration and stable identity on rerun |
| [integration/check_streamlit_served_assets.py](integration/check_streamlit_served_assets.py) | Real local HTTP/WebSocket process; every frontend file's bytes and MIME type |
| [integration/check_repository_file_links.py](integration/check_repository_file_links.py) | Repository and browser references, worker locations, folder boundaries, download/source bytes and private-setting exclusions |

Frontend DOM checks use a test renderer. These results establish software behavior and local hosting; physical robot accuracy, real broker operation, deployed-browser WebGL and the hosted Streamlit Cloud session require separate verification. [Recorded results](../docs/verification/README.md) identify the runtime and scope.
