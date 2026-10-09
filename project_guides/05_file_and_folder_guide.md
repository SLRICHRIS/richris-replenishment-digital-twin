# File and Folder Guide

Filenames describe each file's job. Application behavior is preserved while paths and references are updated.

## Main application files

| File | Literal meaning |
|---|---|
| [warehouse_simulation_controller.js](../digital_twin_application/warehouse_simulation_controller.js) | Runs the warehouse simulation and coordinates screen controls. |
| [mission_scheduling_and_routes.js](../digital_twin_application/mission_scheduling_and_routes.js) | Calculates routes, checks proposed missions and coordinates the approved queue. |
| [stock_and_battery_forecast.js](../digital_twin_application/stock_and_battery_forecast.js) | Calculates stock and battery forecast advice. |
| [three_dimensional_warehouse_view.js](../digital_twin_application/three_dimensional_warehouse_view.js) | Draws the three-dimensional warehouse and manages the camera. |
| [two_dimensional_warehouse_view.js](../digital_twin_application/two_dimensional_warehouse_view.js) | Draws the alternative canvas view when the 3D renderer is unavailable. |
| [warehouse_building_and_robot_models.js](../digital_twin_application/warehouse_building_and_robot_models.js) | Builds the warehouse objects and robot models. |
| [esp32_connection_controls.js](../digital_twin_application/esp32_connection_controls.js) | Provides broker connection controls and three ESP32 device panels. |
| [robot_measurement_validation.js](../digital_twin_application/robot_measurement_validation.js) | Validates robot identity, measurements, packet order and freshness. |
| [interface_motion_and_transitions.js](../digital_twin_application/interface_motion_and_transitions.js) | Coordinates interface animation, transitions and reduced-motion behavior. |
| [saved_screen_theme.js](../digital_twin_application/saved_screen_theme.js) | Loads the saved screen appearance before the interface is displayed. |
| [streamlit_window_connection.js](../digital_twin_application/streamlit_window_connection.js) | Connects the dashboard frame to Streamlit and sets its display height. |
| [application_icon.svg](../digital_twin_application/application_icon.svg) | The application icon. |
| [ownership_and_external_software_licenses.txt](../digital_twin_application/ownership_and_external_software_licenses.txt) | Ownership information and third-party software/font licenses. |
| [font_definitions.css](../digital_twin_application/screen_styles/font_definitions.css) | Loads the local typefaces. |
| [base_page_layout.css](../digital_twin_application/screen_styles/base_page_layout.css) | Defines base page layout and common screen elements. |
| [dark_and_bright_themes.css](../digital_twin_application/screen_styles/dark_and_bright_themes.css) | Defines dark and bright color themes. |
| [workspace_panel_layout.css](../digital_twin_application/screen_styles/workspace_panel_layout.css) | Aligns workspace panels and screen controls. |
| [hardware_connection_panel.css](../digital_twin_application/screen_styles/hardware_connection_panel.css) | Styles ESP32 connection forms and device panels. |
| [mission_review_and_dispatch.css](../digital_twin_application/screen_styles/mission_review_and_dispatch.css) | Styles mission review, dispatch and operational controls. |
| [shared_interface_components.css](../digital_twin_application/screen_styles/shared_interface_components.css) | Defines shared interface components and visual details. |
| [interface_animation_styles.css](../digital_twin_application/screen_styles/interface_animation_styles.css) | Defines interface animation styles. |
| [index.html](../digital_twin_application/index.html) | The dashboard entry page; the component expects this standard filename. |

## Robot firmware files

| File | Literal meaning |
|---|---|
| [ESP32_Robot_Telemetry.ino](../digital_twin_application/esp32_robot_firmware/ESP32_Robot_Telemetry/ESP32_Robot_Telemetry.ino) | Arduino program that publishes device measurements over Wi-Fi. |
| [robot_connection_settings.example.h](../digital_twin_application/esp32_robot_firmware/ESP32_Robot_Telemetry/robot_connection_settings.example.h) | An empty example for Wi-Fi, broker and robot-slot settings. Copy it to robot_connection_settings.h locally. |
| [esp32_wifi_and_telemetry_setup.md](../digital_twin_application/esp32_robot_firmware/esp32_wifi_and_telemetry_setup.md) | Device setup, measurement fields and connection instructions. |
| [esp32_robot_telemetry_starter_kit.zip](../digital_twin_application/esp32_robot_firmware/esp32_robot_telemetry_starter_kit.zip) | Downloadable starter source and instructions. |

The Arduino sketch folder and .ino filename match. The configured robot_connection_settings.h file is intentionally not stored in GitHub.

## Meaning of file extensions

| Extension | Meaning |
|---|---|
| .py | Python program. |
| .js | Browser JavaScript program. |
| .mjs / .cjs | JavaScript module formats used by the automated checks. |
| .html | Screen contents and structure. |
| .css | Screen layout, colors, fonts and visual behavior. |
| .ino | Arduino firmware source for an ESP32 board. |
| .h | C/C++ header; this project's example contains connection settings. |
| .md | Formatted project explanation that GitHub can display. |
| .txt | Plain-text notice or recorded result. |
| .json / .toml | Structured configuration or dependency information. |
| .woff / .woff2 | Font files. |
| .svg | Scalable vector graphic. |
| .zip | Downloadable archive of multiple files. |

## Why some names stay conventional

streamlit_app.py remains the configured deployment entry point. requirements.txt is used for Python dependency installation. index.html is the component entry page. README.md is automatically shown by GitHub. package.json and package-lock.json support JavaScript development checks. .streamlit/config.toml and .gitignore are tool configuration files.

Bundled third-party libraries and fonts retain their original filenames and license text inside external_libraries and display_fonts.

## Previous names and current locations

| Previous location | Current location |
|---|---|
| DEPLOYMENT.txt | project_guides/04_streamlit_deployment_instructions.md |
| SHA256SUMS.txt | test_results/file_integrity_sha256.txt |
| VALIDATION.md | test_results/verification_summary.md |
| frontend/NOTICE.txt | digital_twin_application/ownership_and_external_software_licenses.txt |
| frontend/app.js | digital_twin_application/warehouse_simulation_controller.js |
| frontend/dispatch.js | digital_twin_application/mission_scheduling_and_routes.js |
| frontend/favicon.svg | digital_twin_application/application_icon.svg |
| frontend/fonts.css | digital_twin_application/screen_styles/font_definitions.css |
| frontend/hardware/ReplenishESP32/ReplenishESP32.ino | digital_twin_application/esp32_robot_firmware/ESP32_Robot_Telemetry/ESP32_Robot_Telemetry.ino |
| frontend/hardware/ReplenishESP32/config.example.h | digital_twin_application/esp32_robot_firmware/ESP32_Robot_Telemetry/robot_connection_settings.example.h |
| frontend/hardware/SETUP.md | digital_twin_application/esp32_robot_firmware/esp32_wifi_and_telemetry_setup.md |
| frontend/hardware/replenish-esp32-starter.zip | digital_twin_application/esp32_robot_firmware/esp32_robot_telemetry_starter_kit.zip |
| frontend/hardware.css | digital_twin_application/screen_styles/hardware_connection_panel.css |
| frontend/hardware.js | digital_twin_application/esp32_connection_controls.js |
| frontend/index.html | digital_twin_application/index.html |
| frontend/interface.css | digital_twin_application/screen_styles/shared_interface_components.css |
| frontend/motion.css | digital_twin_application/screen_styles/interface_animation_styles.css |
| frontend/motion.js | digital_twin_application/interface_motion_and_transitions.js |
| frontend/operations.css | digital_twin_application/screen_styles/mission_review_and_dispatch.css |
| frontend/predictor.js | digital_twin_application/stock_and_battery_forecast.js |
| frontend/scene-canvas.js | digital_twin_application/two_dimensional_warehouse_view.js |
| frontend/scene.js | digital_twin_application/three_dimensional_warehouse_view.js |
| frontend/streamlit-host.js | digital_twin_application/streamlit_window_connection.js |
| frontend/style.css | digital_twin_application/screen_styles/base_page_layout.css |
| frontend/telemetry.js | digital_twin_application/robot_measurement_validation.js |
| frontend/theme-init.js | digital_twin_application/saved_screen_theme.js |
| frontend/themes.css | digital_twin_application/screen_styles/dark_and_bright_themes.css |
| frontend/warehouse.js | digital_twin_application/warehouse_building_and_robot_models.js |
| frontend/workspace.css | digital_twin_application/screen_styles/workspace_panel_layout.css |
| tests/dispatch.test.mjs | automated_tests/mission_approval_and_route_checks.mjs |
| tests/http_smoke.py | automated_tests/check_served_application_files.py |
| tests/motion.test.cjs | automated_tests/interface_animation_checks.cjs |
| tests/streamlit-host.test.cjs | automated_tests/streamlit_window_connection_checks.cjs |
| tests/telemetry.test.mjs | automated_tests/robot_telemetry_checks.mjs |
| tests/test_streamlit_app.py | automated_tests/test_streamlit_startup.py |
| tests/workspace.test.cjs | automated_tests/dashboard_interaction_checks.cjs |
| verification-http.txt | test_results/served_application_file_test_results.txt |
| verification-javascript.txt | test_results/mission_and_interface_test_results.txt |
| verification-python.txt | test_results/streamlit_startup_test_results.txt |
| frontend/fonts/ | digital_twin_application/display_fonts/ |
| frontend/vendor/ | digital_twin_application/external_libraries/ |

See [automated tests](../automated_tests/README.md) and [test results](../test_results/README.md) for the meaning of each check and evidence file.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
