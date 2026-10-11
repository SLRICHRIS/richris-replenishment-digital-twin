# Automated Checks

Run from the repository root. Node is needed only for development checks; the Streamlit deployment does not require it.

```sh
npm ci
npm test
python -m pip install -r requirements.txt
python -m unittest discover -s automated_tests -p test_streamlit_startup.py
python automated_tests/check_served_application_files.py
python automated_tests/check_project_file_links.py
python -m unittest discover -s digital_twin_application/engineering/edge -p test_gateway.py
```

| Check | Coverage |
| --- | --- |
| robot_telemetry_checks.mjs | Identity, schema, null/zero, freshness, monotonic expiry and diagnostics |
| mission_approval_and_route_checks.mjs | Both route legs, reserves, reservations, charging and forecast worker |
| shortest_path_optimality_checks.mjs | 2,940 oracle comparisons, tie rules, closures, anchoring and routing objectives |
| interactive_route_map_checks.mjs | 288 route/trace/direction/playback combinations |
| route_map_interaction_checks.cjs | Map DOM, pointer/touch/keyboard controls, isolation and lifecycle |
| warehouse_geometry_checks.mjs | Twelve racks, lane clearance, 24 journey pairs and actual scene geometry |
| twin_calibration_and_replay_checks.mjs | Observer, holdout, faults, recording import and paired comparisons |
| dashboard_interaction_checks.cjs | Review/approval/reassignment, source isolation and complete Twin lab flow |
| interface_animation_checks.cjs | Focus, DOM persistence, motion preferences, themes and worker cleanup |
| final_feature_alignment_checks.mjs | 288 reassignment configurations, inventory consistency and model/study gates |
| streamlit_window_connection_checks.cjs | Parent/source validation, readiness, sizing, seven-view scrolling, focus preservation and listener cleanup |
| test_streamlit_startup.py | Real Python host registration and stable identity on rerun |
| check_served_application_files.py | Local HTTP/WebSocket startup and byte-for-byte asset delivery/MIME |
| check_project_file_links.py | Local references, firmware/edge ZIP contents and secret exclusions |

Python's edge unit tests use its standard library. Network use of the optional edge gateway installs the separate requirements in its folder.

DOM tests use jsdom 26.1.0 and a test renderer. These checks do not establish physical robot accuracy, real broker operation, deployed-browser WebGL or Streamlit Community Cloud deployment success.

[Recorded results](../test_results/README.md) identify the tested runtime and release.
