# Testing

First complete [local installation](../project_guides/02_installation_and_deployment.md). Use Node.js 24 for JavaScript checks and the project's Python environment for Python checks.

## Commands

Run from the repository's main folder:

Replace `python` below with `.venv\Scripts\python` on Windows or `.venv/bin/python` on macOS/Linux to use the installed project environment.

```sh
npm ci
npm test
python -m unittest discover -s automated_tests -v
python automated_tests/check_project_file_links.py
python automated_tests/check_served_application_files.py
```

npm ci installs the test dependency recorded in package-lock.json. Node.js is needed for development checks only.

## Coverage

| Check | File |
|---|---|
| Routes, mission feasibility and forecasts | mission_approval_and_route_checks.mjs |
| Device identity, valid measurements and freshness | robot_telemetry_checks.mjs |
| Animation, focus, themes and reduced motion | interface_animation_checks.cjs |
| Approval, queue order, reservations and delivery cycles | dashboard_interaction_checks.cjs |
| Streamlit component communication | streamlit_window_connection_checks.cjs |
| Python startup and component identity after rerun | test_streamlit_startup.py |
| Local references and firmware download consistency | check_project_file_links.py |
| Actual server startup and asset delivery | check_served_application_files.py |

Recorded outputs and evidence limits are in [test_results](../test_results/README.md).
