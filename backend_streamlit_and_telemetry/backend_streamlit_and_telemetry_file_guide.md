# Python backend

Run the dashboard from the repository root with `python -m streamlit run streamlit_app.py`.

| File | Responsibility |
| --- | --- |
| [streamlit_dashboard_host.py](streamlit_dashboard_host.py) | Configure Streamlit, locate `frontend_warehouse_dashboard/`, register the workspace and retain stable identity on rerun |
| [mqtt_recording_and_inventory_bridge/mqtt_telemetry_recorder_and_inventory_publisher.py](mqtt_recording_and_inventory_bridge/mqtt_telemetry_recorder_and_inventory_publisher.py) | Optional separate MQTT subscriber, packet validation, SQLite archive, recording export and inventory publisher |
| [mqtt_recording_and_inventory_bridge/labview_inventory_observation_adapter.py](mqtt_recording_and_inventory_bridge/labview_inventory_observation_adapter.py) | Pure acquisition function for a LabVIEW Python Node; validate actual capture timestamps and counts |
| [mqtt_recording_and_inventory_bridge/example_warehouse_route_graph_for_calibration.json](mqtt_recording_and_inventory_bridge/example_warehouse_route_graph_for_calibration.json) | Illustrative route graph; survey and replace it before physical use |
| [mqtt_recording_and_inventory_bridge/mqtt_recorder_network_dependencies.txt](mqtt_recording_and_inventory_bridge/mqtt_recorder_network_dependencies.txt) | MQTT dependency needed only for optional edge networking |

`__init__.py` files mark Python packages so imports work consistently from the repository root and from the extracted edge kit.

The Streamlit host serves browser assets and receives the readiness/viewport handshake. Simulation and route computation run in browser modules. MQTT viewer credentials remain in the browser session; the edge recorder uses its own runtime environment and credentials. There is no motor command API in this backend.

For edge installation, recorder/export commands and LabVIEW usage, read [the observation recorder setup](../project_documentation/mqtt_sqlite_recorder_and_labview_adapter_setup.md). [Backend tests](../automated_software_checks/python_telemetry_service_checks/test_mqtt_recorder_and_labview_inventory_adapter.py) run without a broker.
