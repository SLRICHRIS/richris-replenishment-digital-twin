/* Direct raw-sensor telemetry for the single-AMR Python twin.
 * Arduino ESP32 + PubSubClient + Adafruit MPU6050/INA219/Unified Sensor/BusIO.
 * Motor standby stays LOW: integrate a commissioned LOCAL motion controller
 * separately. This observation sketch does not receive MQTT motor commands.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_INA219.h>
#include <esp_timer.h>
#include <time.h>
#include "esp32_wifi_and_mqtt_settings.h"

WiFiClientSecure tls;
PubSubClient mqtt(tls);
Adafruit_MPU6050 imu;
Adafruit_INA219 battery;
portMUX_TYPE encoderMux = portMUX_INITIALIZER_UNLOCKED;
volatile int64_t leftCount = 0, rightCount = 0;
volatile uint8_t previousLeft = 0, previousRight = 0;
// x4 quadrature transition table; both channels interrupt on both edges.
DRAM_ATTR const int8_t transitions[16] = {0,-1,1,0,1,0,0,-1,-1,0,0,1,0,1,-1,0};
char bootId[24], topic[64];
uint32_t sequence = 0, lastSampleMs = 0, lastConnectMs = 0;

void ARDUINO_ISR_ATTR leftEdge() {
  portENTER_CRITICAL_ISR(&encoderMux);
  uint8_t next = (digitalRead(LEFT_A) << 1) | digitalRead(LEFT_B);
  leftCount += LEFT_SIGN * transitions[(previousLeft << 2) | next];
  previousLeft = next;
  portEXIT_CRITICAL_ISR(&encoderMux);
}
void ARDUINO_ISR_ATTR rightEdge() {
  portENTER_CRITICAL_ISR(&encoderMux);
  uint8_t next = (digitalRead(RIGHT_A) << 1) | digitalRead(RIGHT_B);
  rightCount += RIGHT_SIGN * transitions[(previousRight << 2) | next];
  previousRight = next;
  portEXIT_CRITICAL_ISR(&encoderMux);
}
void setup() {
  Serial.begin(115200);
  pinMode(MOTOR_STBY, OUTPUT);
  digitalWrite(MOTOR_STBY, LOW);
  if (strcmp(ROBOT_ID, "amr01")) {
    Serial.println("Use amr01 only");
    while (true) delay(100);
  }
  Wire.begin(21, 22);
  Wire.setTimeOut(20);
  if (!imu.begin(0x68) || !battery.begin()) {
    Serial.println("Sensor missing; no synthetic values will be published");
    while (true) delay(100);
  }
  imu.setGyroRange(MPU6050_RANGE_250_DEG);
  imu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  battery.setCalibration_32V_2A();
  for (int pin : {LEFT_A, LEFT_B, RIGHT_A, RIGHT_B}) pinMode(pin, INPUT_PULLUP);
  previousLeft = (digitalRead(LEFT_A) << 1) | digitalRead(LEFT_B);
  previousRight = (digitalRead(RIGHT_A) << 1) | digitalRead(RIGHT_B);
  attachInterrupt(digitalPinToInterrupt(LEFT_A), leftEdge, CHANGE);
  attachInterrupt(digitalPinToInterrupt(LEFT_B), leftEdge, CHANGE);
  attachInterrupt(digitalPinToInterrupt(RIGHT_A), rightEdge, CHANGE);
  attachInterrupt(digitalPinToInterrupt(RIGHT_B), rightEdge, CHANGE);
  snprintf(bootId, sizeof bootId, "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
  snprintf(topic, sizeof topic, "robot/%s/state", ROBOT_ID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  tls.setCACert(BROKER_ROOT_CA);
  mqtt.setServer(MQTT_HOST, 8883);
  mqtt.setBufferSize(768);
  mqtt.setSocketTimeout(2);
}
void loop() {
  // TLS requires a valid wall clock; device monotonic time still drives models.
  if (WiFi.status() != WL_CONNECTED || time(nullptr) < 1700000000) {
    delay(10);
    return;
  }
  if (!mqtt.connected()) {
    if (millis() - lastConnectMs > 5000) {
      lastConnectMs = millis();
      char clientId[64];
      snprintf(clientId, sizeof clientId, "%s-%s", ROBOT_ID, bootId);
      mqtt.connect(clientId, MQTT_USERNAME, MQTT_PASSWORD);
    }
    return;
  }
  mqtt.loop();
  if (millis() - lastSampleMs < SAMPLE_PERIOD_MS) return;
  lastSampleMs = millis();
  sensors_event_t acceleration, gyro, temperature;
  if (!imu.getEvent(&acceleration, &gyro, &temperature)) return;
  // Battery + -> INA219 VIN+; VIN- -> all robot loads. Bus register is VIN-.
  float shuntV = battery.getShuntVoltage_mV() / 1000.0f;
  float voltageV = battery.getBusVoltage_V() + shuntV;
  float currentA = CURRENT_SIGN * battery.getCurrent_mA() / 1000.0f;
  int64_t left, right;
  portENTER_CRITICAL(&encoderMux);
  left = leftCount; right = rightCount;
  portEXIT_CRITICAL(&encoderMux);
  double sampleSeconds = esp_timer_get_time() / 1000000.0;
  if (!isfinite(gyro.gyro.z) || !isfinite(voltageV) || !isfinite(currentA) || voltageV <= 0) return;
  char payload[640];
  int length = snprintf(payload, sizeof payload,
      "{\"schema_version\":2,\"robot_id\":\"%s\",\"boot_id\":\"%s\",\"seq\":%lu,"
      "\"sample_time_s\":%.6f,\"encoder_left_count\":%lld,\"encoder_right_count\":%lld,"
      "\"gyro_z_rad_s\":%.6f,\"battery_voltage_v\":%.4f,\"battery_current_a\":%.6f,"
      "\"robot_state\":\"standby\"}", ROBOT_ID, bootId, (unsigned long)sequence++,
      sampleSeconds, (long long)left, (long long)right, gyro.gyro.z, voltageV, currentA);
  if (length > 0 && length < (int)sizeof payload) mqtt.publish(topic, payload, false);
  // PubSubClient publishes QoS 0. Cumulative counts tolerate short packet loss;
  // long gaps suspend integration in Python. Reboot before sequence wraps.
}
