// Copy this file to esp32_wifi_and_mqtt_settings.h inside the
// publish_esp32_robot_telemetry sketch folder. Keep
// esp32_wifi_and_mqtt_settings.h private. Never upload real credentials with
// the Site source.
#pragma once

#define AMR_SLOT 1 // Use 1, 2 and 3 on the three separate boards.

static const char WIFI_SSID[] = "YOUR_WIFI_NAME";
static const char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
static const char MQTT_HOST[] =
    "broker.example.com"; // Host only, no URL scheme.
static const uint16_t MQTT_TLS_PORT = 8883;
static const char MQTT_USERNAME[] = "YOUR_AMR_PUBLISHER_USERNAME";
static const char MQTT_PASSWORD[] = "YOUR_AMR_PUBLISHER_PASSWORD";
static const char TOPIC_PREFIX[] = "richris/warehouse01";

// Paste the trusted ROOT CA supplied by your broker provider, including the
// BEGIN/END CERTIFICATE lines. Do not use setInsecure() to skip verification.
static const char BROKER_ROOT_CA[] = R"PEM(
PASTE_BROKER_ROOT_CA_CERTIFICATE_HERE
)PEM";

// Telemetry target: one sample per second. Wi-Fi/TLS latency is variable.
static const uint32_t TELEMETRY_INTERVAL_MS = 1000;

// Enable only after specifying the RX/TX GPIOs used by YOUR AMR controller.
// Never connect 5 V logic directly to ESP32 GPIOs. Use the correct level
// interface.
#define ENABLE_CONTROLLER_UART 0
#define CONTROLLER_UART_RX_PIN -1
#define CONTROLLER_UART_TX_PIN -1
static const uint32_t CONTROLLER_UART_BAUD = 115200;
static const char CONTROLLER_FRAME_ID[] = "warehouse-01";
#if ENABLE_CONTROLLER_UART &&                                                  \
    (CONTROLLER_UART_RX_PIN < 0 || CONTROLLER_UART_TX_PIN < 0)
#error "Set the real controller UART GPIO pins before enabling the bridge."
#endif
