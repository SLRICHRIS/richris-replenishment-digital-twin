# Documentation index

Start with [single-AMR commissioning](single_amr_sensor_twin_setup.md), [equation/paper/slide mapping](slide_to_code_mapping.md), [current software evidence](single_amr_alignment_validation.md) and [scope](implemented_dashboard_features_and_limits.md). The active path is ESP32 raw sensors → EMQX → Python worker → PostgreSQL → Streamlit Sensor models and Database.

| Guide | Use it to understand |
| --- | --- |
| [Website human review and action](website_human_review_and_action.md) | Review recommendations, record operator decisions and verify intervention outcomes |
| [Repository structure and project flow](repository_structure_and_project_flow.md) | Folder boundaries, source files and execution flow |
| [System architecture](dashboard_and_telemetry_system_architecture.md) | State sources, route graph, mission lifecycle and authority |
| [Deployment and local setup](deployment_and_local_setup.md) | Run locally or configure Streamlit Community Cloud |
| [Dashboard operator guide](dashboard_operator_guide.md) | Use Floor, Connect AMR, Sensor models and Database, with detailed readings and export |
| [Software capabilities and limits](implemented_dashboard_features_and_limits.md) | Tested behavior and remaining physical integration |
| [Digital twin architecture and validation plan](digital_twin_architecture_and_validation_plan.md) | Current sensor models, synchronisation boundary and physical evaluation plan |
| [Final system feature audit](digital_twin_feature_alignment_audit.md) | Feature alignment, corrections and deliberate model differences |
| [Software verification evidence](routing_and_robot_model_software_verification.md) | Detailed algorithm, model and synthetic validation results |

## Archived research references

The following documents preserve earlier experiments. Use the single-AMR commissioning guide above for the dashboard's sensor pipeline.

| Reference | Scope |
| --- | --- |
| [UART telemetry setup](esp32_wifi_and_telemetry_setup.md) | Archived controller interface |
| [Observation recorder](mqtt_sqlite_recorder_and_labview_adapter_setup.md) | SQLite recorder and LabVIEW adapter |
| [Operator override service](operator_override_channel_and_hardware_commissioning.md) | Separate command-service experiment |
| [Historical verification record](software_verification_results/current_software_check_results.md) | October reference results |

Edit these canonical documents. Reading copies in `frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/` are generated for dashboard access; rebuild them with `python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py`.
