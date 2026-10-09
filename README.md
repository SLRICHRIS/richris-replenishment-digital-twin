# Warehouse Replenishment Digital Twin

An educational application for three Autonomous Mobile Robots (AMRs), combining a 3D warehouse, human-approved missions, stock and battery estimates, and optional ESP32 measurements.

## Start here

| Step | Read | Purpose |
|---|---|---|
| 1 | [System architecture](project_guides/01_system_architecture.md) | Understand the data flow and mission rules |
| 2 | [Installation and deployment](project_guides/02_installation_and_deployment.md) | Run locally or deploy on Streamlit |
| 3 | [Operator guide](project_guides/03_operator_guide.md) | Use the dashboard |
| 4 | [Testing](automated_tests/README.md) | Run checks and inspect results |

## Repository layout

| Folder | Contains |
|---|---|
| [digital_twin_application/](digital_twin_application/) | Application source, visual assets and ESP32 starter |
| [project_guides/](project_guides/) | Architecture, setup and operation |
| [automated_tests/](automated_tests/) | Software checks |
| [test_results/](test_results/) | Recorded verification evidence |

**Streamlit entry point:** [streamlit_app.py](streamlit_app.py)  
**Python dependencies:** [requirements.txt](requirements.txt)

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.  
External components retain their [respective licenses](digital_twin_application/ownership_and_external_software_licenses.txt).
