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
| `frontend/` | Browser interface, warehouse rendering, simulation, routing and telemetry display | [Frontend file guide](frontend/README.md) |
| `backend/` | Python Streamlit host and optional MQTT/SQLite observation recorder | [Backend file guide](backend/README.md) |
| `firmware/` | ESP32 telemetry sketch and example connection settings | [Firmware guide](firmware/README.md) |
| `tests/` | Separate frontend, backend and integration checks | [Testing guide](tests/README.md) |
| `docs/` | Architecture, setup, operator guide, model limits and verification | [Documentation index](docs/README.md) |
| `tools/` | Rebuild downloadable kits and record repository fingerprints | [Maintenance guide](tools/README.md) |
| `streamlit_app.py` | Thin deployment entrypoint calling the Python host | [Host implementation](backend/streamlit_dashboard_host.py) |
| `requirements.txt` | Pinned dashboard Python dependency | Streamlit 1.65.0 |
| `package.json` | Named development and verification commands | `npm test` |
| `.streamlit/config.toml` | Streamlit server and appearance configuration | Used by the root entrypoint |

The browser runs simulation, Dijkstra and model workers. Python hosts those browser files; the optional edge process archives observations independently. [Project flow and module responsibilities](docs/repository_structure_and_project_flow.md) explain the complete path from launch to routing, telemetry and model validation.

## Streamlit Community Cloud settings

| Field | Value |
| --- | --- |
| Repository | `SLRICHRIS/richris-replenishment-digital-twin` |
| Branch | `main` |
| Main file path | `streamlit_app.py` |
| Python version | `3.12` |

These settings remain unchanged after the folder reorganization. Deploy the complete repository. [Local setup and deployment](docs/deployment_and_local_setup.md) includes Windows and Linux commands.

## Read and verify

- [System architecture](docs/system_architecture.md)
- [Dashboard operator guide](docs/dashboard_operator_guide.md)
- [Software capabilities and limits](docs/software_capabilities_and_limits.md)
- [Recorded verification](docs/verification/README.md)
- [Old-to-new file map](docs/verification/repository_path_migration.json)

Four A–D bins are monitored; eight reserve racks are reference decoration. The graph has 22 nodes and 27 bidirectional links. Virtual dispatch reserves one complete outward-and-return journey at a time. Physical movement, sensor commissioning and a LabVIEW command/acknowledgment channel require separate integration. Hardware credentials are supplied at runtime and must never be committed.

The audited application lineage starts at Site commit `e8dbe22a7ef06e7016f2a2bf35251a4086f910be`; the reorganization preserves its application behavior and the Streamlit workspace scrolling fix.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes. External components retain their [respective licenses](ownership_and_external_software_licenses.txt).
