> Historical/reference workspace. The active single-AMR Python sensor path is documented in the root README and `project_documentation/single_amr_sensor_twin_setup.md`.

# ESP32 firmware

| File in `publish_esp32_robot_telemetry/` | Responsibility |
| --- | --- |
| `publish_esp32_robot_telemetry.ino` | Wi-Fi/TLS/MQTT setup, clock, bounded main loop and telemetry publishing |
| `robot_telemetry_packet_serializer.h` | Exact version-1 packet encoding shared with the native cross-validator check |
| `onboard_controller_sensor_and_override_bridge.h` | Fresh measured UART input, expiring boot-bound overrides, duplicate protection and actual controller execution ACKs |
| `example_esp32_wifi_and_mqtt_settings.h` | Public placeholder settings; UART remains disabled until actual pins are specified |

Arduino requires matching folder/sketch names. Copy the example to the private configured header and install Arduino-ESP32 3.3.12, PubSubClient 2.8 and ArduinoJson 7.4.2. Keep credentials out of Git. [Connection setup](../project_documentation/esp32_wifi_and_telemetry_setup.md) and [controller commissioning](../project_documentation/operator_override_channel_and_hardware_commissioning.md) define how to connect.
