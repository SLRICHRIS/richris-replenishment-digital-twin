# Automated Function Checks

These programs check software behavior. They are not physical robot experiments.

| File | What it checks |
|---|---|
| mission_approval_and_route_checks.mjs | Routes, mission feasibility and forecasting |
| robot_telemetry_checks.mjs | Device identity, measurements, ordering and freshness |
| interface_animation_checks.cjs | Animation behavior, focus, themes and reduced motion |
| dashboard_interaction_checks.cjs | Approval, queues, aisle reservations and delivery cycles |
| streamlit_window_connection_checks.cjs | Communication with the Streamlit host page |
| test_streamlit_startup.py | Startup and stable component identity after a rerun |
| check_project_file_links.py | References between renamed files and guides |
| check_served_application_files.py | Real server startup and delivery of application files |

Commands: [deployment and startup guide](../project_guides/04_streamlit_deployment_instructions.md). Evidence: [test_results/](../test_results/).

Software checks do not establish physical safety, sensor accuracy, device connectivity or visual correctness in every browser.
