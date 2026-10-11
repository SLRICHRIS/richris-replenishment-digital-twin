# ESP32 robot telemetry firmware

| File | Responsibility |
| --- | --- |
| [publish_esp32_robot_telemetry/publish_esp32_robot_telemetry.ino](publish_esp32_robot_telemetry/publish_esp32_robot_telemetry.ino) | Publish one board's measured telemetry with its assigned AMR slot |
| [publish_esp32_robot_telemetry/example_esp32_wifi_and_mqtt_settings.h](publish_esp32_robot_telemetry/example_esp32_wifi_and_mqtt_settings.h) | Example Wi-Fi, broker, certificate and identity settings |

Arduino requires the sketch filename to match its folder name. Copy the example header to `esp32_wifi_and_mqtt_settings.h` locally; the configured header is ignored by Git and excluded from the download kit.

Follow [Wi-Fi setup and the telemetry contract](../project_documentation/esp32_wifi_and_telemetry_setup.md). The starter publishes measurements only. Unconfigured pose, speed and battery fields remain unknown.

After changing firmware or setup instructions, run `python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py` from the repository root. The Hardware panel then offers the matching [starter kit](../frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/esp32_robot_telemetry_starter_kit.zip).
