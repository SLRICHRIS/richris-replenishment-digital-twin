# ESP32 robot telemetry firmware

| File | Responsibility |
| --- | --- |
| [esp32_robot_telemetry/esp32_robot_telemetry.ino](esp32_robot_telemetry/esp32_robot_telemetry.ino) | Publish one board's measured telemetry with its assigned AMR slot |
| [esp32_robot_telemetry/robot_connection_settings.example.h](esp32_robot_telemetry/robot_connection_settings.example.h) | Example Wi-Fi, broker, certificate and identity settings |

Arduino requires the sketch filename to match its folder name. Copy the example header to `robot_connection_settings.h` locally; the configured header is ignored by Git and excluded from the download kit.

Follow [Wi-Fi setup and the telemetry contract](../docs/esp32_wifi_and_telemetry_setup.md). The starter publishes measurements only. Unconfigured pose, speed and battery fields remain unknown.

After changing firmware or setup instructions, run `python tools/build_dashboard_downloads.py` from the repository root. The Hardware panel then offers the matching [starter kit](../frontend/downloads/esp32_robot_telemetry_starter_kit.zip).
