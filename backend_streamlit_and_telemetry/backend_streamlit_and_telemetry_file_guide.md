# Python backend

Run `python -m streamlit run streamlit_app.py` from the root.

| Source | Responsibility |
| --- | --- |
| [streamlit_dashboard_host.py](streamlit_dashboard_host.py) | Serve the browser component with stable registration/rerun identity |
| [mqtt_telemetry_recorder_and_inventory_publisher.py](mqtt_recording_and_inventory_bridge/mqtt_telemetry_recorder_and_inventory_publisher.py) | Validate observations, archive SQLite sessions, export and publish measured stock |
| [labview_inventory_observation_adapter.py](mqtt_recording_and_inventory_bridge/labview_inventory_observation_adapter.py) | Convert actual LabVIEW acquisition/counts to validated input |
| [operator_override_command_coordinator.py](operator_override_control_channel/operator_override_command_coordinator.py) | Independent local HTTP/MQTT command path, idempotency, device execution ACKs and monotonic latency journal |
| [labview_operator_override_http_adapter.py](operator_override_control_channel/labview_operator_override_http_adapter.py) | Python Node interface for requesting/polling an operator command |
| [example_warehouse_route_graph_for_calibration.json](mqtt_recording_and_inventory_bridge/example_warehouse_route_graph_for_calibration.json) | Reference graph to survey/confirm before physical use |
| [mqtt_recorder_network_dependencies.txt](mqtt_recording_and_inventory_bridge/mqtt_recorder_network_dependencies.txt) | Optional paho-mqtt networking dependency |

Simulation/prediction remains in browser modules. The control process runs on the separate Coordinator platform and imports no prediction module. [Recorder setup](../project_documentation/mqtt_sqlite_recorder_and_labview_adapter_setup.md) and [override commissioning](../project_documentation/operator_override_channel_and_hardware_commissioning.md) provide the runtime commands. Package `__init__.py` files support root/extracted-kit imports.


`vision_control/` contains measured camera tracking, local route following, authenticated wire contracts, server approval/audit and the Windows USB-camera runner. `predictive_twin/vision_execution_workspace.py` owns the private operator session; browser geometry never becomes a physical command.
