# Python backend

Run the dashboard from the repository root with `python -m streamlit run streamlit_app.py`.

| File | Responsibility |
| --- | --- |
| [streamlit_dashboard_host.py](streamlit_dashboard_host.py) | Configure Streamlit, locate `frontend/`, register the workspace and retain stable identity on rerun |
| [edge/mqtt_observation_recorder.py](edge/mqtt_observation_recorder.py) | Optional separate MQTT subscriber, packet validation, SQLite archive, recording export and inventory publisher |
| [edge/labview_inventory_adapter.py](edge/labview_inventory_adapter.py) | Pure acquisition function for a LabVIEW Python Node; validate actual capture timestamps and counts |
| [edge/reference_warehouse_graph.example.json](edge/reference_warehouse_graph.example.json) | Illustrative route graph; survey and replace it before physical use |
| [edge/requirements.txt](edge/requirements.txt) | MQTT dependency needed only for optional edge networking |

`__init__.py` files mark Python packages so imports work consistently from the repository root and from the extracted edge kit.

The Streamlit host serves browser assets and receives the readiness/viewport handshake. Simulation and route computation run in browser modules. MQTT viewer credentials remain in the browser session; the edge recorder uses its own runtime environment and credentials. There is no motor command API in this backend.

For edge installation, recorder/export commands and LabVIEW usage, read [the observation recorder setup](../docs/edge_observation_recorder_setup.md). [Backend tests](../tests/backend/test_mqtt_observation_recorder.py) run without a broker.
