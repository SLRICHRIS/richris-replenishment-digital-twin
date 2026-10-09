# Application Source Map

The [Streamlit launcher](../streamlit_app.py) serves this folder through index.html.

| File | Responsibility |
|---|---|
| [warehouse_simulation_controller.js](warehouse_simulation_controller.js) | Simulation state, mission controls and displayed values |
| [mission_scheduling_and_routes.js](mission_scheduling_and_routes.js) | Route calculations, mission feasibility and queue timing |
| [stock_and_battery_forecast.js](stock_and_battery_forecast.js) | Stock and battery forecast worker |
| [warehouse_building_and_robot_models.js](warehouse_building_and_robot_models.js) | Warehouse geometry and robot models |
| [three_dimensional_warehouse_view.js](three_dimensional_warehouse_view.js) | 3D rendering and camera controls |
| [two_dimensional_warehouse_view.js](two_dimensional_warehouse_view.js) | Canvas fallback renderer |
| [esp32_connection_controls.js](esp32_connection_controls.js) | Broker connection and device panels |
| [robot_measurement_validation.js](robot_measurement_validation.js) | Message identity, measurements, ordering and freshness |
| [interface_motion_and_transitions.js](interface_motion_and_transitions.js) | Animations, transitions and reduced-motion behavior |
| [saved_screen_theme.js](saved_screen_theme.js) | Initial saved appearance |
| [streamlit_window_connection.js](streamlit_window_connection.js) | Streamlit component communication and frame height |
| [index.html](index.html) | Dashboard structure and resource loading |

| Folder | Responsibility |
|---|---|
| [screen_styles/](screen_styles/) | Layout, themes, typography and animation styles |
| [display_fonts/](display_fonts/) | Hanken Grotesk and IBM Plex Mono font files and licenses |
| [external_libraries/](external_libraries/) | Bundled Three.js and MQTT.js dependencies |
| [esp32_robot_firmware/](esp32_robot_firmware/) | Arduino telemetry starter and connection instructions |

[Ownership and external software licenses](ownership_and_external_software_licenses.txt)
