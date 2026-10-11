# Repository structure and project flow

## Folder boundaries

| Folder | Contains | Excludes |
| --- | --- | --- |
| `frontend_warehouse_dashboard/browser_modules/dashboard_navigation_and_appearance/` | Dashboard controller, early theme selection and interface motion | Python host and physical motor control |
| `frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/` | Graph validation, Dijkstra, actual search trace and interactive map | Approved mission mutation by the preview |
| `frontend_warehouse_dashboard/browser_modules/robot_mission_simulation/` | Virtual mission feasibility, reservations, motion and charging-aware scheduling | Physical device commands |
| `frontend_warehouse_dashboard/browser_modules/esp32_telemetry_monitoring/` | Browser subscription panel and received measurement validation | Durable Python storage |
| `frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/` | State observer, calibration, recording/replay, paired policy comparisons and lab UI | Broker secrets in worker snapshots |
| `frontend_warehouse_dashboard/browser_modules/background_calculation_workers/` | Isolated stock/battery forecasts and dispatch policy studies | Direct dispatch authority |
| `frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/` | Shared reference racks, aisles, stops and route graph | Claimed survey of the physical testbed |
| `frontend_warehouse_dashboard/browser_modules/warehouse_scene_rendering/` | Three.js scene, industrial geometry and Canvas fallback | Independent versions of routing or mission rules |
| `frontend_warehouse_dashboard/browser_modules/streamlit_frame_connection/` | Streamlit readiness/height protocol and workspace scroll lifecycle | Robot readings sent to Python |
| `frontend_warehouse_dashboard/dashboard_stylesheets/`, `dashboard_images_and_fonts/`, `external_browser_libraries/` | Styles, icon/fonts and licensed browser dependencies | Backend service source |
| `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/` | Generated kits and reading copies from canonical sources | Hand-maintained duplicate implementations |
| `backend_streamlit_and_telemetry/` | Streamlit host and optional Python edge recorder/adapter | Browser rendering code |
| `esp32_telemetry_firmware/` | Arduino sketch and non-secret example settings | Configured connection headers |
| `automated_software_checks/` | Frontend, backend and integration verification | Production runtime dependencies |
| `project_documentation/`, `project_maintenance_scripts/` | Guides, evidence and reproducible maintenance commands | Application state or broker credentials |

## Dashboard startup

```mermaid
flowchart TD
    Entry["streamlit_app.py"] --> Host["backend_streamlit_and_telemetry/streamlit_dashboard_host.py"]
    Host --> Page["frontend_warehouse_dashboard/index.html"]
    Page --> Bridge["Streamlit window bridge"]
    Page --> Controller["Warehouse dashboard controller"]
    Controller --> Missions["Mission scheduling and routes"]
    Controller --> Views["3D scene / Canvas / route map"]
    Missions --> Graph["Shared route graph and Dijkstra"]
    Views --> Graph
    Graph --> Layout["Warehouse reference layout"]
```

The entrypoint delegates to Python hosting. The frontend loads its bridge and theme before the dashboard controller. Mission rules and visual route previews use the same graph module and reference layout. The Streamlit component key stays stable during ordinary reruns. Embedded scrolling is defined by the bridge and `dashboard_stylesheets/streamlit_dashboard_scroll_container.css`, leaving the header and navigation visible.

## Measured state and optional archive

The browser's ESP32 panel subscribes to MQTT over secure WebSockets. `robot_telemetry_validation_and_freshness.js` checks identity, schema, sequence and age before display. `robot_state_estimation_calibration_and_replay.js` separates measured, estimated and predicted state, manages recordings and gates model fitting. The lab freezes a sanitized scenario for the dispatch experiment worker; the worker returns advisory results without movement authority.

The optional `backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/mqtt_telemetry_recorder_and_inventory_publisher.py` process subscribes independently to archive MQTT observations in SQLite. Its export can be imported into the Twin lab. `labview_inventory_observation_adapter.py` transforms actual perception counts into a validated line for a separate publisher process. It does not start or control the LabVIEW VI.

## File names and generated files

Project source filenames use descriptive snake_case names. Framework filenames such as `index.html`, root `README.md`, `requirements.txt`, `package.json` and `__init__.py` retain their standard names. External libraries have descriptive local filenames. Their upstream implementation, exported symbols and license notices are preserved; only import paths change. Arduino's folder and sketch names match.

Canonical source lives in its owning folder. `project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py` creates two ZIP files, three document reading copies and the ownership notice in `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/`. An integration check verifies every archive member against its source and refuses stale downloads. Backend and firmware source are never copied into the frontend module directories.

The [original application path history](software_check_results_and_source_history/audited_application_file_path_history.json) accounts for all 104 previously tracked files. [Historical evidence](software_check_results_and_source_history/previous_release_test_logs_and_file_hashes/) retains previous release logs and original source fingerprints; their old paths describe that historical release. Current fingerprints are recorded separately.

For literal source filenames and responsibilities, read the [frontend guide](../frontend_warehouse_dashboard/frontend_dashboard_source_file_guide.md), [backend guide](../backend_streamlit_and_telemetry/backend_streamlit_and_telemetry_file_guide.md) and [firmware guide](../esp32_telemetry_firmware/esp32_telemetry_firmware_file_guide.md).

The [complete file-purpose catalog](all_repository_file_purposes.md) explains every current file and the framework names that must remain unchanged. The [descriptive rename history](software_check_results_and_source_history/repository_descriptive_name_migration.json) accounts for all 128 files from the preceding GitHub structure.
