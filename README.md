# Warehouse Replenishment Digital Twin

Replenish v2.1.0 runs the audited warehouse dashboard in Streamlit. It includes a twelve-rack reference warehouse, three virtual AMRs, an interactive indoor route map, supervised missions, read-only ESP32 telemetry and the Twin lab.

The runtime is self-contained: Streamlit serves the local application folder; the browser runs the simulation, route solver and experiment workers. No ChatGPT login or hosted Site iframe is required.

## Run

```sh
python -m pip install -r requirements.txt
python -m streamlit run streamlit_app.py
```

Use Python 3.12. Streamlit Community Cloud settings:

| Field | Value |
| --- | --- |
| Repository | SLRICHRIS/richris-replenishment-digital-twin |
| Branch | main |
| Main file path | streamlit_app.py |
| Python version | 3.12 |
| Runtime dependency | streamlit==1.65.0 |

An existing Community Cloud app connected to this branch receives committed updates automatically. Simulation needs no secrets. Hardware credentials are entered in the browser connection panel and are not sent to Python.

## Project flow

| Read | Purpose |
| --- | --- |
| [System architecture](project_guides/01_system_architecture.md) | Runtime, data sources and authority |
| [Installation and deployment](project_guides/02_installation_and_deployment.md) | Local setup and Streamlit hosting |
| [Operator guide](project_guides/03_operator_guide.md) | All seven workspace views |
| [Software capabilities and audit](project_guides/04_software_capabilities_and_audit.md) | Routing, model rules and validation limits |
| [Application source map](digital_twin_application/README.md) | Literal filenames and responsibilities |
| [Automated checks](automated_tests/README.md) | Reproduce the software checks |
| [Verification results](test_results/README.md) | Evidence for this migration |

Four A–D bins are monitored; eight reserve racks are reference decoration. The graph has 22 nodes and 27 bidirectional links. Virtual dispatch reserves one complete outbound-and-return journey at a time. Hardware integration receives measurements only; physical movement, LabVIEW command acknowledgments and industrial commissioning remain pending.

This update imports the audited Site release `e8dbe22a7ef06e7016f2a2bf35251a4086f910be` into the existing readable repository layout. [Migration fingerprints](test_results/audited_source_migration.json) record the source and adapted files.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes. External components retain their [respective licenses](digital_twin_application/ownership_and_external_software_licenses.txt).

