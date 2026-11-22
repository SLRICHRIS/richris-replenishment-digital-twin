#pragma once
// Copy to private_amr_settings.h beside the sketch. That file is ignored by Git.
// Keep the existing working 2.4 GHz Wi-Fi and optional telemetry credentials private.
static const char WIFI_SSID[] = "YOUR_WIFI_SSID";
static const char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
static const char MQTT_HOST[] = "";
static const char MQTT_USERNAME[] = "";
static const char MQTT_PASSWORD[] = "";
static const char BROKER_ROOT_CA[] = "";  // Trusted PEM root for the telemetry broker.

// Generate a separate random 32-byte key, written as 64 lowercase hex characters.
// Both firmware and the local route service sign using these 64 ASCII characters.
// Never reuse an operator access code or AMR_CONTROL_KEY. Empty disables routes.
#define AMR_ROUTE_KEY ""
#define AMR_CONTROL_KEY ""
// Match the local route service. Retain the recovered H1 safety limits.
#define AMR_ROUTE_MAX_PWM 60
#define AMR_ROUTE_MIN_PACK_V 6.6
