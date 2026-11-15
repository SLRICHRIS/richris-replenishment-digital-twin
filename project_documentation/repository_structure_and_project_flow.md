# Repository structure and flow

The [file-purpose catalog](all_repository_file_purposes.md) lists every current path. Framework entrypoint/package filenames keep their required standard names; project modules describe their purpose.

| Area | Responsibility |
| --- | --- |
| `frontend_warehouse_dashboard/browser_modules/dashboard_navigation_and_appearance/` | Operator interface and virtual event loop |
| `frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/` | Mission checks, motion, node/segment/corridor window scheduling |
| `frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/` | Shared metric graph, Dijkstra and interactive trace/navigation |
| `frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/` | Position observer, calibration, evidence replay and frozen policy study |
| `frontend_warehouse_dashboard/browser_modules/background_calculation_workers/` | Forecast and experiment computation without control authority |
| `backend_streamlit_and_telemetry/` | Streamlit host and active `predictive_twin/` sensor models; older services are legacy |
| `esp32_telemetry_firmware/` | Active direct-sensor publisher; older UART bridge retained as legacy |
| `automated_software_checks/` | Browser behavior, Python services, packet contracts and real hosting |

## Execution

The root entrypoint calls the Streamlit host, which serves `frontend_warehouse_dashboard/index.html`. The page loads the trusted-parent scroll/viewport bridge and dashboard modules. Mission routing, route-map previews and policy branches share the graph solver. Mission execution and forecasts share the reservation model.

AMR-01 direct sensors publish raw v2 telemetry to EMQX. The independent Python worker validates it, computes motion/battery/residuals and writes PostgreSQL. Streamlit reads stored results and sends public values to Sensor models; credentials stay private. The browser owns a separate single-AMR mission/stock simulation. Local odometry has no surveyed transform into the 3D floor yet. The older browser v1 subscriber, SQLite/LabVIEW adapter and Coordinator are legacy reference services, outside the active sensor path. [System architecture](dashboard_and_telemetry_system_architecture.md) defines the current boundary.

## Generated downloads

The maintenance script builds two ZIP kits and browser guide copies from canonical source paths. Integration checks compare every member byte-for-byte and reject stale downloads. Backend/firmware source stays outside browser module folders.

Use [frontend](../frontend_warehouse_dashboard/frontend_dashboard_source_file_guide.md), [backend](../backend_streamlit_and_telemetry/backend_streamlit_and_telemetry_file_guide.md) and [firmware](../esp32_telemetry_firmware/esp32_telemetry_firmware_file_guide.md) guides to find implementation details. Historical rename maps and repetitive logs have been removed; preceding versions remain in Git history.
