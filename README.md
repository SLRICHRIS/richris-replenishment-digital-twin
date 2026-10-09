# Three-Robot Warehouse Digital Twin

**Project overview and documentation.**  
**Project owner: S L RICHRIS**  
**Purpose: Educational demonstration of warehouse replenishment with human-approved robot missions.**

AMR means **Autonomous Mobile Robot**. This application shows three virtual robots, shelf stock, mission approval, route timing, battery estimates and optional measurements received from three ESP32 devices.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.

## Recommended reading order

| Order | Guide | What it explains |
|---|---|---|
| 1 | [Project overview](project_guides/01_project_overview.md) | Objective, implemented features and limitations |
| 2 | [How the system works](project_guides/02_how_the_digital_twin_works.md) | Approval, robot movement, forecasting and ESP32 measurements |
| 3 | [Demonstration steps](project_guides/03_demonstration_steps.md) | What to demonstrate and what to observe |
| 4 | [Deployment and startup](project_guides/04_streamlit_deployment_instructions.md) | Hosting on Streamlit and running on a computer |
| Reference | [File and folder guide](project_guides/05_file_and_folder_guide.md) | Literal file purposes and previous-to-current filenames |
| Evidence | [Verification summary](test_results/verification_summary.md) | Recorded checks and their limitations |

## Folder meanings

| Folder | Meaning in plain English |
|---|---|
| [project_guides/](project_guides/) | Project explanations, demonstration steps and setup instructions |
| [digital_twin_application/](digital_twin_application/) | Working dashboard, simulation, 3D models and ESP32 connection files |
| [automated_tests/](automated_tests/) | Programs that check mission logic, measurements and interface interactions |
| [test_results/](test_results/) | Recorded test outputs and the file-integrity record |

## Standard files kept in the main folder

| File or folder | Literal purpose |
|---|---|
| [streamlit_app.py](streamlit_app.py) | Starts Streamlit and displays the digital twin |
| [requirements.txt](requirements.txt) | Lists the Python package to install |
| [.streamlit/config.toml](.streamlit/config.toml) | Streamlit display and server settings |
| [package.json](package.json) | JavaScript test commands and development dependency |
| [package-lock.json](package-lock.json) | Exact JavaScript dependency versions for repeatable installation |
| [.gitignore](.gitignore) | Files Git must exclude, including private connection settings |
| [README.md](README.md) | This automatically displayed introduction |

These conventional filenames support the deployment and development tools. Their names and purposes are explained rather than changed.

## Hosting settings

| Setting | Value |
|---|---|
| GitHub repository | SLRICHRIS/richris-replenishment-digital-twin |
| Branch | main |
| Streamlit main file | streamlit_app.py |
| Python | 3.12 |
| Simulation secrets | None required |

The launcher now points to digital_twin_application. The existing Streamlit main-file setting stays **streamlit_app.py**.

## Scope

The simulation and forecasts use a deterministic model. ESP32 integration receives measurements; it does not send physical driving or emergency-stop commands. LabVIEW remains a separate project.

Original project work belongs to S L RICHRIS. External software and fonts retain their own licenses: [ownership and software-license notice](digital_twin_application/ownership_and_external_software_licenses.txt).
