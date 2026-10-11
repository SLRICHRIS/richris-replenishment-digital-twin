# Repository structure and flow

The [file-purpose catalog](all_repository_file_purposes.md) lists every current path. Framework entrypoint/package filenames keep their required standard names; project modules describe their purpose.

| Area | Responsibility |
| --- | --- |
| `frontend_warehouse_dashboard/browser_modules/dashboard_navigation_and_appearance/` | Operator interface and virtual event loop |
| `frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/` | Mission checks, motion, node/segment/corridor window scheduling |
| `frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/` | Shared metric graph, Dijkstra and interactive trace/navigation |
| `frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/` | Position observer, calibration, evidence replay and frozen policy study |
| `frontend_warehouse_dashboard/browser_modules/background_calculation_workers/` | Forecast and experiment computation without control authority |
| `backend_streamlit_and_telemetry/` | Streamlit hosting and independent observation/control services |
| `esp32_telemetry_firmware/` | MQTT packet serializer and onboard sensor/override UART bridge |
| `automated_software_checks/` | Browser behavior, Python services, packet contracts and real hosting |

## Execution

The root entrypoint calls the Streamlit host, which serves `frontend_warehouse_dashboard/index.html`. The page loads the trusted-parent scroll/viewport bridge and dashboard modules. Mission routing, route-map previews and policy branches share the graph solver. Mission execution and forecasts share the reservation model.

The browser subscribes to measured MQTT observations. The historian subscribes independently and exports durable SQLite sessions. The Coordinator runs separately on the control platform, accepting local LabVIEW/operator requests and recording device execution ACKs. Its module imports no prediction code. [System architecture](dashboard_and_telemetry_system_architecture.md) defines authority and timing.

## Generated downloads

The maintenance script builds two ZIP kits and browser guide copies from canonical source paths. Integration checks compare every member byte-for-byte and reject stale downloads. Backend/firmware source stays outside browser module folders.

Use [frontend](../frontend_warehouse_dashboard/frontend_dashboard_source_file_guide.md), [backend](../backend_streamlit_and_telemetry/backend_streamlit_and_telemetry_file_guide.md) and [firmware](../esp32_telemetry_firmware/esp32_telemetry_firmware_file_guide.md) guides to find implementation details. Historical rename maps and repetitive logs have been removed; preceding versions remain in Git history.
