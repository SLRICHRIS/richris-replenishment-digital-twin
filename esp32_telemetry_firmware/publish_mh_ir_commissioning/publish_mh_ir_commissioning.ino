/* Local serial control + truthful MH single-channel commissioning telemetry.
 * F/B/L/R/S/+/- remain local Serial commands at 115200 baud. No MQTT commands.
 * Pin map matches the supplied TB6612FNG / MH IR controller.
 * This is NOT the signed-quadrature schema-v2 publisher used by the six models.
 * Test on a secured stand with the wheels clear; use a physical power cutoff.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <esp_timer.h>
#include <time.h>
#include "esp32_wifi_and_mqtt_settings.h"
#include "mh_ir_controller.h"

using amr_ir::Motion;
portMUX_TYPE pulseMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE observationMux = portMUX_INITIALIZER_UNLOCKED;
volatile amr_ir::PulseCounter leftPulses, rightPulses;
amr_ir::LocalController controller(LOCAL_COMMAND_TIMEOUT_US, DIRECTION_INTERLOCK_US);
amr_ir::Observation latestObservation;
bool observationReady = false, pwmReady = false;
WiFiClientSecure tls;
PubSubClient mqtt(tls);
char bootId[24];
static const char TOPIC[] = "robot/amr01/commissioning";
static_assert(LOCAL_COMMAND_TIMEOUT_US > DIRECTION_INTERLOCK_US,
    "Command timeout must exceed the direction interlock");
static_assert(LEFT_PULSES_PER_REV > 0 && RIGHT_PULSES_PER_REV > 0,
    "Pulses per revolution must be positive");

void ARDUINO_ISR_ATTR countLeftPulse() {
  const uint32_t now = micros();
  portENTER_CRITICAL_ISR(&pulseMux);
  leftPulses.edge(now, DEBOUNCE_US);
  portEXIT_CRITICAL_ISR(&pulseMux);
}
void ARDUINO_ISR_ATTR countRightPulse() {
  const uint32_t now = micros();
  portENTER_CRITICAL_ISR(&pulseMux);
  rightPulses.edge(now, DEBOUNCE_US);
  portEXIT_CRITICAL_ISR(&pulseMux);
}

void applyDrive(const amr_ir::DriveOutput& drive) {
  static Motion previous = Motion::stopped;
  static int previousDuty = -1;
  if (previous == drive.motion && previousDuty == drive.duty) return;
  // Disable the bridge before changing direction pins or PWM.
  digitalWrite(STBY, LOW);
  if (pwmReady) { ledcWrite(PWMA, 0); ledcWrite(PWMB, 0); }
  bool leftForward = false, rightForward = false;
  switch (drive.motion) {
    case Motion::forward: leftForward = true; rightForward = true; break;
    case Motion::backward: break;
    case Motion::left: rightForward = true; break;
    case Motion::right: leftForward = true; break;
    default: break;
  }
  const bool enabled = pwmReady && drive.motion != Motion::stopped && drive.duty > 0;
  digitalWrite(AIN1, enabled && leftForward ? HIGH : LOW);
  digitalWrite(AIN2, enabled && !leftForward ? HIGH : LOW);
  digitalWrite(BIN1, enabled && rightForward ? HIGH : LOW);
  digitalWrite(BIN2, enabled && !rightForward ? HIGH : LOW);
  if (enabled) {
    const bool leftOk = ledcWrite(PWMA, drive.duty);
    const bool rightOk = ledcWrite(PWMB, drive.duty);
    if (leftOk && rightOk) digitalWrite(STBY, HIGH);
    else { pwmReady = false; controller.stop(); }
  }
  previous = drive.motion;
  previousDuty = drive.duty;
}

// Network handshakes run separately; they never call the motor GPIO functions.
// Local watchdog/Serial processing continue in loop() during TLS reconnects.
void networkTask(void*) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  tls.setCACert(BROKER_ROOT_CA);
  tls.setHandshakeTimeout(5);
  mqtt.setServer(MQTT_HOST, 8883);
  mqtt.setSocketTimeout(2);
  if (!mqtt.setBufferSize(1280)) { vTaskDelete(nullptr); return; }
  uint32_t lastAttempt = millis() - 5000, lastWifiAttempt = millis();
  uint32_t sentSequence = 0;
  bool sentAny = false;
  for (;;) {
    const uint32_t now = millis();
    if (WiFi.status() != WL_CONNECTED) {
      if (uint32_t(now - lastWifiAttempt) >= 10000) {
        lastWifiAttempt = now;
        WiFi.reconnect();
      }
    } else if (time(nullptr) >= 1700000000) {
      if (!mqtt.connected() && uint32_t(now - lastAttempt) >= 5000) {
        lastAttempt = now;
        char clientId[64];
        snprintf(clientId, sizeof clientId, "amr01-ir-%s", bootId);
        if (mqtt.connect(clientId, MQTT_USERNAME, MQTT_PASSWORD))
          Serial.println("EMQX connected: commissioning topic only");
        else Serial.println("EMQX connect failed; check private TLS/client settings");
      }
      if (mqtt.connected()) {
        mqtt.loop();
        amr_ir::Observation sample;
        bool ready;
        portENTER_CRITICAL(&observationMux);
        sample = latestObservation;
        ready = observationReady;
        portEXIT_CRITICAL(&observationMux);
        const double age = esp_timer_get_time() / 1000000.0 - sample.sampleTimeS;
        if (ready && age >= 0 && age <= 2.0 && (!sentAny || sample.seq != sentSequence)) {
          char payload[1024];
          const int length = amr_ir::encodeDiagnostic(payload, sizeof payload, bootId, sample,
              PULSE_CALIBRATION_CONFIRMED, LEFT_PULSES_PER_REV, RIGHT_PULSES_PER_REV);
          if (length > 0 && mqtt.publish(TOPIC, payload, false)) {
            sentSequence = sample.seq;
            sentAny = true;
          }
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void setup() {
  // Set standby LOW before any potentially slow Serial/network setup.
  pinMode(STBY, OUTPUT);
  digitalWrite(STBY, LOW);
  for (int pin : {AIN1, AIN2, BIN1, BIN2}) { pinMode(pin, OUTPUT); digitalWrite(pin, LOW); }
  Serial.begin(115200);
  const bool leftAttached = ledcAttach(PWMA, PWM_FREQ, PWM_RESOLUTION);
  const bool rightAttached = ledcAttach(PWMB, PWM_FREQ, PWM_RESOLUTION);
  pwmReady = leftAttached && rightAttached;
  applyDrive({Motion::stopped, 0});
  if (!pwmReady) Serial.println("PWM setup failed: motors remain disabled");
  pinMode(LEFT_IR_PIN, INPUT_PULLUP);
  pinMode(RIGHT_IR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(LEFT_IR_PIN), countLeftPulse, FALLING);
  attachInterrupt(digitalPinToInterrupt(RIGHT_IR_PIN), countRightPulse, FALLING);
  snprintf(bootId, sizeof bootId, "%08lx%08lx",
      static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  Serial.println("AMR-01 MH IR commissioning: F B L R S + -");
  Serial.printf("Motion commands expire after %.2f s; repeat to continue. No remote motor control.\n",
      LOCAL_COMMAND_TIMEOUT_US / 1000000.0);
  Serial.println("Counts are unsigned. RPM withheld until pulse calibration is confirmed.");
  if (xTaskCreatePinnedToCore(networkTask, "amr01-network", 12288, nullptr, 1, nullptr, 0) != pdPASS)
    Serial.println("Network task unavailable; local control remains active");
}

void loop() {
  const uint64_t now = static_cast<uint64_t>(esp_timer_get_time());
  controller.expire(now);
  for (int n = 0; n < 32 && Serial.available() > 0; ++n) {
    const char command = static_cast<char>(Serial.read());
    if (pwmReady && controller.command(command, now)) {
      Serial.printf("Local request: %s; configured PWM: %u\n",
          amr_ir::motionName(controller.requested()), unsigned(controller.configuredDuty()));
    }
  }
  amr_ir::DriveOutput drive = controller.output(now);
  applyDrive(drive);
  if (!pwmReady) drive = {Motion::stopped, 0};
  static uint64_t previousTime = 0, previousLeft = 0, previousRight = 0;
  static uint32_t sequence = 0;
  if (now - previousTime >= 1000000) {
    amr_ir::Observation sample;
    portENTER_CRITICAL(&pulseMux);
    sample.leftTotal = leftPulses.total;
    sample.rightTotal = rightPulses.total;
    portEXIT_CRITICAL(&pulseMux);
    sample.leftDelta = sample.leftTotal - previousLeft;
    sample.rightDelta = sample.rightTotal - previousRight;
    sample.sampleTimeS = now / 1000000.0;
    sample.intervalS = (now - previousTime) / 1000000.0;
    sample.requested = controller.requested();
    sample.output = drive.motion;
    sample.duty = drive.duty;
    sample.seq = sequence++;
    previousTime = now;
    previousLeft = sample.leftTotal;
    previousRight = sample.rightTotal;
    portENTER_CRITICAL(&observationMux);
    latestObservation = sample;
    observationReady = true;
    portEXIT_CRITICAL(&observationMux);
    Serial.printf("Unsigned pulse totals: L=%llu R=%llu; interval=%.3f s\n",
        static_cast<unsigned long long>(sample.leftTotal),
        static_cast<unsigned long long>(sample.rightTotal), sample.intervalS);
    if (PULSE_CALIBRATION_CONFIRMED)
      Serial.printf("RPM magnitude: L=%.2f R=%.2f\n",
          sample.leftDelta * 60.0 / (sample.intervalS * LEFT_PULSES_PER_REV),
          sample.rightDelta * 60.0 / (sample.intervalS * RIGHT_PULSES_PER_REV));
  }
  delay(2);
}
