#pragma once
// Copy to private esp32_wifi_and_mqtt_settings.h. Never commit real credentials.
static const char ROBOT_ID[] = "amr01"; // AMR-01 only
static const char WIFI_SSID[] = "REPLACE";
static const char WIFI_PASSWORD[] = "REPLACE";
static const char MQTT_HOST[] = "your-deployment.emqxsl.com";
static const char MQTT_USERNAME[] = "publisher-amr01";
static const char MQTT_PASSWORD[] = "REPLACE";
static const char BROKER_ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_BROKER_TRUSTED_ROOT_CA
-----END CERTIFICATE-----
)PEM";
static constexpr int LEFT_A = 32, LEFT_B = 33, RIGHT_A = 25, RIGHT_B = 26;
static constexpr int MOTOR_STBY = 23;
// Adjust each sign after rolling that wheel forward by hand.
static constexpr int LEFT_SIGN = 1, RIGHT_SIGN = 1;
// Adafruit INA219 default calibration assumes a 0.1-ohm shunt. Verify yours.
static constexpr float CURRENT_SIGN = 1.0f; // discharge must be positive
static constexpr uint32_t SAMPLE_PERIOD_MS = 50; // target 20 Hz; actual dt is transmitted
