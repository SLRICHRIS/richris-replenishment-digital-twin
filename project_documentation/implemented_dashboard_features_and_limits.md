# Implemented capabilities

| Capability | Current behavior | Source of detail |
| --- | --- | --- |
| Industrial warehouse view | 12 racks, 4 active bins, 8 decorative reserves, three AMRs | [Operator guide](dashboard_operator_guide.md) |
| Interactive routing | 22 nodes/27 links, Dijkstra trace, distance/time modes, closures and directions | [Routing verification](routing_and_robot_model_software_verification.md) |
| Cooperative dispatch | Human approval, concurrent safe node/segment/corridor windows, bay return and battery reserve | [System architecture](dashboard_and_telemetry_system_architecture.md) |
| Measured twin | Three validated MQTT slots, position observer, chronological calibration, replay and frozen policy studies | [Model contract](digital_twin_architecture_and_validation_plan.md) |
| Observation archive | Durable MQTT-to-SQLite recordings and LabVIEW inventory adapter | [Recorder guide](mqtt_sqlite_recorder_and_labview_adapter_setup.md) |
| Operator override | Separate Coordinator HTTP/MQTT path, controller ACKs and software latency experiment | [Commissioning guide](operator_override_channel_and_hardware_commissioning.md) |

[Current verification](software_verification_results/current_software_check_results.md) distinguishes executable software checks from physical evidence still to collect.
