# Working Digital Twin Application

This folder contains the application displayed inside Streamlit.

| File or folder | Meaning |
|---|---|
| [index.html](index.html) | Dashboard entry page; this standard name is required by the local component |
| [warehouse_simulation_controller.js](warehouse_simulation_controller.js) | Coordinates simulation, mission controls and displayed values |
| [mission_scheduling_and_routes.js](mission_scheduling_and_routes.js) | Checks missions and calculates routes, queue timing and battery reserve |
| [stock_and_battery_forecast.js](stock_and_battery_forecast.js) | Produces forecast advice from the model |
| [three_dimensional_warehouse_view.js](three_dimensional_warehouse_view.js) | Displays the interactive 3D warehouse |
| [esp32_connection_controls.js](esp32_connection_controls.js) | Connects to three ESP32 measurement topics |
| [robot_measurement_validation.js](robot_measurement_validation.js) | Checks received measurements |
| screen_styles/ | Layout, color and animation rules |
| display_fonts/ | Locally served typefaces and their licenses |
| external_libraries/ | Bundled third-party software and licenses |
| esp32_robot_firmware/ | Arduino starter, example connection settings and device setup instructions |

See the [complete file guide](../project_guides/05_file_and_folder_guide.md) for all filenames.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes. External software retains its own licenses.
