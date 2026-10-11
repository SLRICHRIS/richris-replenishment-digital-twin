// Copy this file to esp32_wifi_and_mqtt_settings.h inside the ReplenishESP32 sketch folder.
// Keep esp32_wifi_and_mqtt_settings.h private. Never upload real credentials with the Site source.
#pragma once

#define AMR_SLOT 1  // Use 1, 2 and 3 on the three separate boards.

static const char WIFI_SSID[] = "YOUR_WIFI_NAME";
static const char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
static const char MQTT_HOST[] = "broker.example.com"; // Host only, no URL scheme.
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
