# Documentation index

Start with [single-AMR commissioning](single_amr_sensor_twin_setup.md), [equation/paper/slide mapping](slide_to_code_mapping.md), [current software evidence](single_amr_alignment_validation.md) and [scope](implemented_dashboard_features_and_limits.md). The active path is ESP32 raw v2 sensors → EMQX → Python worker → PostgreSQL → Streamlit Sensor models and Database.

| Guide | Use it to understand |
| --- | --- |
| [Repository structure and project flow](repository_structure_and_project_flow.md) | Folder boundaries, source files and execution flow |
| [System architecture](dashboard_and_telemetry_system_architecture.md) | State sources, route graph, mission lifecycle and authority |
| [Deployment and local setup](deployment_and_local_setup.md) | Run locally or configure Streamlit Community Cloud |
| [Dashboard operator guide](dashboard_operator_guide.md) | Use Floor, Sensor models, Missions, Activity, Detailed readings and Database |
| [Software capabilities and limits](implemented_dashboard_features_and_limits.md) | Tested behavior and remaining physical integration |
| [Digital twin architecture and validation plan](digital_twin_architecture_and_validation_plan.md) | Current sensor models, synchronisation boundary and physical evaluation plan |
| [Final system feature audit](digital_twin_feature_alignment_audit.md) | Feature alignment, corrections and deliberate model differences |
| [Software verification evidence](routing_and_robot_model_software_verification.md) | Detailed algorithm, model and synthetic validation results |
| [ESP32 Wi-Fi and telemetry setup](esp32_wifi_and_telemetry_setup.md) | Legacy v1/UART setup; not current direct-sensor commissioning |
| [Edge observation recorder setup](mqtt_sqlite_recorder_and_labview_adapter_setup.md) | Legacy v1 archive and LabVIEW adapter; outside current path |
| [Operator override and commissioning](operator_override_channel_and_hardware_commissioning.md) | Legacy separate command service; outside current path |
| [Current verification record](software_verification_results/current_software_check_results.md) | Historical October reference results; use current AMR-01 evidence above |

Edit these canonical documents. Reading copies in `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/` are generated for dashboard access; rebuild them with `python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py`.
