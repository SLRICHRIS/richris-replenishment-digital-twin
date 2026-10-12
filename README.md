# RICHRIS Replenishment Digital Twin

A three-AMR replenishment project with an industrial reference warehouse, interactive Dijkstra routing, cooperative virtual dispatch, measured telemetry, calibration/replay and a separate operator override service.

## Run the dashboard

```sh
python -m pip install -r requirements.txt
python -m streamlit run streamlit_app.py
```

Streamlit Community Cloud: repository `SLRICHRIS/richris-replenishment-digital-twin`, branch `main`, entrypoint `streamlit_app.py`, Python 3.12. Streamlit is pinned to 1.65.0. Node is needed only for development checks.

## Repository boundaries

| Folder | Responsibility |
| --- | --- |
| [frontend_warehouse_dashboard](frontend_warehouse_dashboard/frontend_dashboard_source_file_guide.md) | Interface, reference scene, routing, virtual missions and twin models |
| [backend_streamlit_and_telemetry](backend_streamlit_and_telemetry/backend_streamlit_and_telemetry_file_guide.md) | Streamlit host, MQTT/SQLite recorder and independent operator Coordinator |
| [esp32_telemetry_firmware](esp32_telemetry_firmware/esp32_telemetry_firmware_file_guide.md) | Telemetry serializer and measured/controller UART bridge |
| [automated_software_checks](automated_software_checks/software_check_commands_and_coverage.md) | Browser, Python, packet-contract, latency and hosting checks |
| [project_documentation](project_documentation/project_documentation_index.md) | Architecture, use, setup and validation |
| [project_maintenance_scripts](project_maintenance_scripts/repository_maintenance_commands.md) | Deterministic starter-kit/document rebuild |

Start with [system architecture](project_documentation/dashboard_and_telemetry_system_architecture.md), [current verification](project_documentation/software_verification_results/current_software_check_results.md), [hardware commissioning](project_documentation/operator_override_channel_and_hardware_commissioning.md), or [every file's purpose](project_documentation/all_repository_file_purposes.md).

The reference floor has 12 racks, four monitored A–D bins, eight decorative reserves and two movable reference managers. Use **Move managers** to drag their **No AMR entry** areas. Applied positions update the warehouse scene and replan virtual robot journeys with clearance, return reserve and new traffic windows. Unavailable routes hold the fleet; queued missions require fresh approval. Virtual robots share node/segment/corridor time windows. Physical control uses the separate Coordinator and onboard execution ACKs; the browser viewer remains read-only. Sensor wiring, native LabVIEW VI, measured ground truth, personnel tracking and hardware latency require the physical setup.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes. [External software licenses](project_ownership_and_external_software_licenses.txt).
