# Warehouse Replenishment Digital Twin

Replenish v2.1.0 is a Streamlit-hosted warehouse dashboard with twelve reference racks, three virtual AMRs, shortest-path route exploration, supervised missions, read-only ESP32 telemetry and a Twin lab.

## Run the dashboard

Use Python 3.12. Run these commands from the repository root:

```sh
python -m pip install -r requirements.txt
python -m streamlit run streamlit_app.py
```

Node.js is needed only for frontend development checks. The deployed dashboard serves its JavaScript, fonts, workers and downloads locally.

## Repository layout

| Location | Responsibility | Start here |
| --- | --- | --- |
| `frontend_warehouse_dashboard/` | Browser interface, warehouse rendering, simulation, routing and telemetry display | [Frontend file guide](frontend_warehouse_dashboard/frontend_dashboard_source_file_guide.md) |
| `backend_streamlit_and_telemetry/` | Python Streamlit host and optional MQTT/SQLite observation recorder | [Backend file guide](backend_streamlit_and_telemetry/backend_streamlit_and_telemetry_file_guide.md) |
| `esp32_telemetry_firmware/` | ESP32 telemetry sketch and example connection settings | [Firmware guide](esp32_telemetry_firmware/esp32_telemetry_firmware_file_guide.md) |
| `automated_software_checks/` | Separate frontend, backend and integration checks | [Testing guide](automated_software_checks/software_check_commands_and_coverage.md) |
| `project_documentation/` | Architecture, setup, operator guide, model limits and verification | [Documentation index](project_documentation/project_documentation_index.md) |
| `project_maintenance_scripts/` | Rebuild downloadable kits and record repository fingerprints | [Maintenance guide](project_maintenance_scripts/repository_maintenance_commands.md) |
| `streamlit_app.py` | Thin deployment entrypoint calling the Python host | [Host implementation](backend_streamlit_and_telemetry/streamlit_dashboard_host.py) |
| `requirements.txt` | Pinned dashboard Python dependency | Streamlit 1.65.0 |
| `package.json` | Named development and verification commands | `npm test` |
| `.streamlit/config.toml` | Streamlit server and appearance configuration | Used by the root entrypoint |

The browser runs simulation, Dijkstra and model workers. Python hosts those browser files; the optional edge process archives observations independently. [Project flow and module responsibilities](project_documentation/repository_structure_and_project_flow.md) explain the complete path from launch to routing, telemetry and model validation.

## Streamlit Community Cloud settings

| Field | Value |
| --- | --- |
| Repository | `SLRICHRIS/richris-replenishment-digital-twin` |
| Branch | `main` |
| Main file path | `streamlit_app.py` |
| Python version | `3.12` |

These settings remain unchanged after the folder reorganization. Deploy the complete repository. [Local setup and deployment](project_documentation/deployment_and_local_setup.md) includes Windows and Linux commands.

## File names and responsibilities

Read [the purpose of every file](project_documentation/all_repository_file_purposes.md). Project names describe the work they perform; only framework entry, dependency, configuration and package files retain their standard names.

## Read and verify

- [System architecture](project_documentation/dashboard_and_telemetry_system_architecture.md)
- [Dashboard operator guide](project_documentation/dashboard_operator_guide.md)
- [Software capabilities and limits](project_documentation/implemented_dashboard_features_and_limits.md)
- [Recorded verification](project_documentation/software_check_results_and_source_history/current_software_check_results.md)
- [Old-to-new file map](project_documentation/software_check_results_and_source_history/audited_application_file_path_history.json)

Four A–D bins are monitored; eight reserve racks are reference decoration. The graph has 22 nodes and 27 bidirectional links. Virtual dispatch reserves one complete outward-and-return journey at a time. Physical movement, sensor commissioning and a LabVIEW command/acknowledgment channel require separate integration. Hardware credentials are supplied at runtime and must never be committed.

The audited application lineage starts at Site commit `e8dbe22a7ef06e7016f2a2bf35251a4086f910be`; the reorganization preserves its application behavior and the Streamlit workspace scrolling fix.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes. External components retain their [respective licenses](project_ownership_and_external_software_licenses.txt).
