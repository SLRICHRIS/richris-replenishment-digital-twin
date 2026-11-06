/*
 * © 2026 S L RICHRIS. All rights reserved.
 * Purely for educational purposes. ESP32 telemetry and controller UART bridge.
 * Motor control and emergency-stop interlocks remain on the onboard controller.
 * Reference dependencies: Arduino-ESP32 3.3.12, PubSubClient 2.8,
 * ArduinoJson 7.x.
 */
#include "esp32_wifi_and_mqtt_settings.h"
#include "robot_telemetry_packet_serializer.h"
#include <NetworkClientSecure.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <esp_system.h>
#include <math.h>
#include <sys/time.h>
#include <time.h>

#if AMR_SLOT != 1
#error "AMR_SLOT must be 1 (AMR-01)."
#endif

NetworkClientSecure tls;
PubSubClient mqtt(tls);
char deviceId[8], topic[180], clientId[48], bootId[17];
uint32_t lastPublish = 0, lastMqttAttempt = 0, lastWifiAttempt = 0;
uint64_t sequence = 0;
bool configured = false;
static const char FIRMWARE[] = "richris-esp32-1.1.0";

enum class RobotState { Unknown, Idle, Moving, Paused, Charging, Fault };
const char *stateName(RobotState state);
const char *stateName(RobotState state) {
  switch (state) {
  case RobotState::Idle:
    return "idle";
  case RobotState::Moving:
    return "moving";
  case RobotState::Paused:
    return "paused";
  case RobotState::Charging:
    return "charging";
  case RobotState::Fault:
    return "fault";
  default:
    return "unknown";
  }
}

struct Measurements {
  float batteryPct = NAN;
  float speedMps = NAN;
  float xM = NAN, yM = NAN, headingDeg = NAN;
  RobotState state = RobotState::Unknown;
};

#include "onboard_controller_sensor_and_override_bridge.h"

bool inRange(float value, float lo, float hi) {
  return isfinite(value) && value >= lo && value <= hi;
}
void numberOrNull(char *out, size_t size, float value, float lo, float hi) {
  if (inRange(value, lo, hi))
    snprintf(out, size, "%.4f", value);
  else
    snprintf(out, size, "null");
}

void publishTelemetry() {
  timeval now;
  gettimeofday(&now, nullptr);
  if (now.tv_sec < 1704067200)
    return;
  const uint64_t epochMs =
      controllerCapturedMs && wallTimeMs() <= controllerCapturedMs + 1000
          ? controllerCapturedMs
          : wallTimeMs();
  const Measurements m = readMeasurements();
  char battery[24], speed[24], pose[160], payload[768];
  numberOrNull(battery, sizeof(battery), m.batteryPct, 0, 100);
  numberOrNull(speed, sizeof(speed), m.speedMps, 0, 10);
  if (inRange(m.xM, 0, 12) && inRange(m.yM, 0, 20.0f / 3.0f) &&
      inRange(m.headingDeg, -360, 360)) {
    snprintf(pose, sizeof(pose),
             "{\"x_m\":%.4f,\"y_m\":%.4f,\"heading_deg\":%.4f}", m.xM, m.yM,
             m.headingDeg);
  } else
    snprintf(pose, sizeof(pose), "null");
  const int count = encodeTelemetryPacket(
      payload, sizeof(payload), deviceId, bootId,
      (unsigned long long)++sequence, (unsigned long long)epochMs,
      (unsigned long)millis(), stateName(m.state), battery, pose, speed,
      WiFi.RSSI(), FIRMWARE, CONTROLLER_FRAME_ID);
  if (count <= 0 || count >= int(sizeof(payload))) {
    Serial.println("Telemetry encoding failed");
    return;
  }
  if (!mqtt.publish(topic, reinterpret_cast<const uint8_t *>(payload),
                    size_t(count), false)) {
    Serial.println("Telemetry send failed; next sample will retry");
  }
}

bool containsText(const char *value, const char *fragment) {
  return strstr(value, fragment) != nullptr;
}

void setup() {
  Serial.begin(115200);
  if (containsText(WIFI_SSID, "YOUR_") ||
      containsText(MQTT_HOST, "example.com") ||
      containsText(MQTT_USERNAME, "YOUR_") ||
      containsText(MQTT_PASSWORD, "YOUR_") ||
      !containsText(BROKER_ROOT_CA, "-----BEGIN CERTIFICATE-----")) {
    Serial.println("Complete esp32_wifi_and_mqtt_settings.h with Wi-Fi, broker "
                   "credentials and trusted root CA.");
    return;
  }
  snprintf(deviceId, sizeof(deviceId), "amr-%02d", AMR_SLOT);
  snprintf(bootId, sizeof(bootId), "%08lx%08lx", (unsigned long)esp_random(),
           (unsigned long)esp_random());
  snprintf(clientId, sizeof(clientId), "richris_%s_%012llx", deviceId,
           (unsigned long long)ESP.getEfuseMac());
  const int topicLength =
      snprintf(topic, sizeof(topic), "%s/%s/telemetry", TOPIC_PREFIX, deviceId);
  if (topicLength < 0 || topicLength >= int(sizeof(topic))) {
    Serial.println("Topic prefix is too long");
    return;
  }
  tls.setCACert(BROKER_ROOT_CA);
  tls.setTimeout(5000);
  tls.setHandshakeTimeout(10);
  mqtt.setServer(MQTT_HOST, MQTT_TLS_PORT);
  mqtt.setCallback(receiveOperatorCommand);
  if (ENABLE_CONTROLLER_UART)
    Serial2.begin(CONTROLLER_UART_BAUD, SERIAL_8N1, CONTROLLER_UART_RX_PIN,
                  CONTROLLER_UART_TX_PIN);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(20);
  mqtt.setSocketTimeout(5);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  configured = true;
  Serial.println(
      "Telemetry publisher ready. Waiting for Wi-Fi and clock sync.");
}

void loop() {
  if (!configured) {
    delay(100);
    return;
  }
  pollController();
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiAttempt >= 15000) {
      lastWifiAttempt = now;
      WiFi.reconnect();
    }
    delay(5);
    return;
  }
  if (time(nullptr) < 1704067200) {
    delay(20);
    return;
  }
  if (!mqtt.connected()) {
    if (now - lastMqttAttempt >= 5000) {
      lastMqttAttempt = now;
      if (mqtt.connect(clientId, MQTT_USERNAME, MQTT_PASSWORD)) {
        char commandTopic[180];
        snprintf(commandTopic, sizeof(commandTopic), "%s/%s/commands",
                 TOPIC_PREFIX, deviceId);
        mqtt.subscribe(commandTopic, 1);
        Serial.println("Broker connected; controller command topic requested");
      } else {
        Serial.print("Broker connection failed, code ");
        Serial.println(mqtt.state());
      }
    }
    delay(5);
    return;
  }
  mqtt.loop();
  if (now - lastPublish >= TELEMETRY_INTERVAL_MS) {
    lastPublish = now;
    publishTelemetry();
  }
  delay(2);
}
