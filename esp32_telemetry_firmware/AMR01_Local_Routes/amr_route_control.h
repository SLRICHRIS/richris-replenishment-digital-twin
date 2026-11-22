// Direct Wi-Fi V1/H1 route receiver, derived from working Wireless H1 r3.
// The motor task is the only runtime output writer. MQTT publishes telemetry only.
#pragma once
#include <mbedtls/md.h>
#include <sys/time.h>
#include "route_http_protocol.h"

namespace amr_route {
static_assert(AMR_ROUTE_MAX_PWM > 0 && AMR_ROUTE_MAX_PWM <= 60, "Invalid route PWM cap");
static_assert(AMR_ROUTE_MIN_PACK_V >= 6.0 && AMR_ROUTE_MIN_PACK_V <= 7.4, "Check receiver cutoff");

static portMUX_TYPE driveMux = portMUX_INITIALIZER_UNLOCKED;
static amr_vision::Guard guard;
static bool linked = false, ready = false, motorOnline = false;
static uint32_t linkedGeneration = 0;
static bool routeKeyReady = false;
static char receiverBoot[33]{};
static uint64_t utcMs();
static void identity(char* dst);
static bool networkReady() {
  return routeKeyReady && amr_wifi::snapshot().hasIP &&
      WiFi.status() == WL_CONNECTED && utcMs() >= 1700000000000ULL;
}
static uint64_t neutralUntil = 0;
static int actualLeft = 0, actualRight = 0;
static Motion sampledRequest = Motion::stopped;
static bool appliedFromRoute = false;

struct MotorSnapshot {
  int left;
  int right;
  Motion request;
  uint8_t selectedDuty;
  bool remote;
};

static Motion asMotion(int left, int right) {
  if (left == 0 && right == 0) return Motion::stopped;
  if (left > 0 && right > 0) return Motion::forward;
  if (left < 0 && right < 0) return Motion::backward;
  return right > left ? Motion::left : Motion::right;
}

static MotorSnapshot snapshot() {
  portENTER_CRITICAL(&driveMux);
  MotorSnapshot result = {actualLeft, actualRight, sampledRequest, controller.configuredDuty(), appliedFromRoute};
  portEXIT_CRITICAL(&driveMux);
  return result;
}

// Caller holds driveMux. A stop from USB or the local dashboard cancels the
// route and prevents a delayed drive packet for that route from restarting it.
static void localStop(uint64_t now) {
  controller.stop();
  guard.stop("local_stop");
  ready = false;
  neutralUntil = now + DIRECTION_INTERLOCK_US;
}

static bool localCommand(char command) {
  const uint64_t now = esp_timer_get_time();
  portENTER_CRITICAL(&driveMux);
  bool accepted = true;
  if (command == 'S' || command == 's') {
    localStop(now);
  } else if (!motorOnline || guard.active || appliedFromRoute || now < neutralUntil) {
    accepted = false;
  } else {
    accepted = controller.command(command, now);
    if (accepted && controller.requested() != Motion::stopped) ready = false;
  }
  portEXIT_CRITICAL(&driveMux);
  return accepted;
}

static bool localSpeed(uint8_t value) {
  const uint64_t now = esp_timer_get_time();
  portENTER_CRITICAL(&driveMux);
  bool accepted = value == 0 || (!guard.active && !appliedFromRoute);
  if (accepted) {
    controller.setDuty(value);
    if (value == 0) localStop(now);
  }
  portEXIT_CRITICAL(&driveMux);
  return accepted;
}

// Positive logical wheel duty uses the polarity already verified in this
// robot's LAN sketch. Keep STBY low while changing pins and on every failure.
static bool writeWheels(int left, int right) {
  digitalWrite(STBY, LOW);
  bool ok = writeMotorPwm(PWMA, 0);
  ok = writeMotorPwm(PWMB, 0) && ok;
  digitalWrite(AIN1, left < 0 ? HIGH : LOW);
  digitalWrite(AIN2, left > 0 ? HIGH : LOW);
  digitalWrite(BIN1, right < 0 ? HIGH : LOW);
  digitalWrite(BIN2, right > 0 ? HIGH : LOW);
  if (ok && (left || right)) {
    ok = writeMotorPwm(PWMA, std::abs(left));
    ok = writeMotorPwm(PWMB, std::abs(right)) && ok;
    if (ok) digitalWrite(STBY, HIGH);
    else {
      writeMotorPwm(PWMA, 0);
      writeMotorPwm(PWMB, 0);
    }
  }
  portENTER_CRITICAL(&pulseMux);
  leftPulses.directionSign = ok ? (left > 0) - (left < 0) : 0;
  rightPulses.directionSign = ok ? (right > 0) - (right < 0) : 0;
  portEXIT_CRITICAL(&pulseMux);
  return ok;
}

static void localWheels(amr_ir::DriveOutput output, int& left, int& right) {
  left = right = 0;
  switch (output.motion) {
    case Motion::forward: left = right = output.duty; break;
    case Motion::backward: left = right = -int(output.duty); break;
    case Motion::left: right = output.duty; break;
    case Motion::right: left = output.duty; break;
    default: break;
  }
}

static void motorTick() {
  amr_ir::Sensors sensors;
  portENTER_CRITICAL(&sensorMux);
  sensors = currentSensors;
  portEXIT_CRITICAL(&sensorMux);
  const uint64_t now = esp_timer_get_time();
  const double seconds = now / 1000000.0;
  const bool sensorReady = startupReady && amr_ir::finiteImu(sensors) && amr_ir::finiteBattery(sensors)
      && amr_ir::freshAt(seconds, sensors.imuTimeS, .1)
      && amr_ir::freshAt(seconds, sensors.batteryTimeS, .5)
      && sensors.packV > AMR_ROUTE_MIN_PACK_V;
  // Route readiness is LAN/time based. A broker outage has no authority here.
  const uint32_t generation = amr_wifi::snapshot().generation;
  const bool online = networkReady();
  const bool linkChanged = online != linked || generation != linkedGeneration;
  char nextEpoch[33]{};
  if (online && linkChanged) identity(nextEpoch);
  int left = 0, right = 0, previousLeft, previousRight;
  Motion request;
  portENTER_CRITICAL(&driveMux);
  if (linkChanged) {
    // A disconnect/reconnect may occur between two motor ticks. Its recorded
    // generation still cancels motion and retires the old route identity.
    controller.stop();
    if (online) guard.connection(receiverBoot, nextEpoch);
    else guard.stop("unavailable");
    linked = online;
    linkedGeneration = generation;
    ready = false;
  }
  controller.expire(now);
  previousLeft = actualLeft;
  previousRight = actualRight;
  const bool localIdle = controller.requested() == Motion::stopped;
  // The camera must continue to see a healthy, stopped receiver throughout
  // arrival verification. The neutral interval governs a new arm request.
  ready = motorOnline && linked && sensorReady && localIdle;
  if (ready && !*guard.route && !guard.active) guard.state = "idle";
  guard.tick(now, ready);
  const bool fromRoute = guard.active;
  if (fromRoute) {
    left = guard.left; right = guard.right;
    request = asMotion(left, right);
  } else {
    if (appliedFromRoute) neutralUntil = now + DIRECTION_INTERLOCK_US;
    localWheels(controller.output(now), left, right);
    request = controller.requested();
  }
  const bool outputsEnabled = motorOnline;
  portEXIT_CRITICAL(&driveMux);
  bool ok = outputsEnabled;
  if (ok && (left != previousLeft || right != previousRight)) ok = writeWheels(left, right);
  if (!ok) { digitalWrite(STBY, LOW); left = right = 0; }

  portENTER_CRITICAL(&driveMux);
  if (!ok) {
    motorOnline = ready = false;
    controller.stop();
    guard.stop("unavailable");
    request = Motion::stopped;
  }
  if ((previousLeft || previousRight) && !left && !right) neutralUntil = now + DIRECTION_INTERLOCK_US;
  actualLeft = left; actualRight = right;
  sampledRequest = request;
  appliedFromRoute = fromRoute && ok;
  portEXIT_CRITICAL(&driveMux);
}

static void motorTask(void*) {
  for (;;) {
    motorTick();
    vTaskDelay(1);
  }
}

static uint64_t utcMs() {
  timeval tv;
  gettimeofday(&tv, nullptr);
  return uint64_t(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

static void identity(char* dst) {
  for (int i=0; i<4; ++i) snprintf(dst + 8*i, 9, "%08lx", static_cast<unsigned long>(esp_random()));
}

static bool sign(const char* body, char* output) {
  if (!routeKeyReady) return false;
  const auto* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  unsigned char mac[32];
  if (!info || mbedtls_md_hmac(info, reinterpret_cast<const unsigned char*>(AMR_ROUTE_KEY), 64,
      reinterpret_cast<const unsigned char*>(body), std::strlen(body), mac)) return false;
  for (int i=0; i<32; ++i) snprintf(output + 2*i, 3, "%02x", unsigned(mac[i]));
  return true;
}

struct SendStats {
  uint32_t packets = 0;
  uint32_t lastMs = 0;
};
static portMUX_TYPE reportMux = portMUX_INITIALIZER_UNLOCKED;
static SendStats telemetryWrites, heartbeatWrites;

static void recordWrite(SendStats& stats) {
  const uint32_t now = millis();
  portENTER_CRITICAL(&reportMux);
  ++stats.packets;
  stats.lastMs = now;
  portEXIT_CRITICAL(&reportMux);
}

static void printStatus() {
  portENTER_CRITICAL(&reportMux);
  const SendStats sensor = telemetryWrites, h1 = heartbeatWrites;
  portEXIT_CRITICAL(&reportMux);
  const uint32_t now = millis();
  const auto ageSeconds = [now](const SendStats& s) -> long {
    return s.packets ? long((now - s.lastMs) / 1000U) : -1L;
  };
  Serial.printf("AMR NET | telemetry writes=%lu age_s=%ld | H1 HTTP replies=%lu age_s=%ld | Wi-Fi=%s (-1 age means no write yet)\n",
      (unsigned long)sensor.packets, ageSeconds(sensor), (unsigned long)h1.packets,
      ageSeconds(h1), WiFi.status() == WL_CONNECTED ? "connected" : "offline");
  const auto network = amr_wifi::snapshot();
  Serial.printf("AMR WIFI | IP=%s | RSSI=%d dBm | disconnects=%lu | last_reason=%u | HTTP=%s | starts=%lu\n",
      WiFi.localIP().toString().c_str(), int(WiFi.RSSI()), (unsigned long)network.disconnects,
      network.lastReason, amr_wifi::http.started ? "listening" : "waiting", (unsigned long)amr_wifi::http.starts);
}

static void reportConnectFailure(const char* channel, PubSubClient& client, WiFiClientSecure& socket) {
  const int state = client.state();
  if (state == MQTT_CONNECTION_TIMEOUT) {
    Serial.printf("%s MQTT connect failed: state=%d. No broker login reply within 15 seconds. Retrying.\n", channel, state);
    return;
  }
  char text[96] = {};
  const int tlsError = socket.lastError(text, sizeof(text));
  if (state == MQTT_CONNECT_FAILED && tlsError < 0)
    Serial.printf("%s MQTT connect failed: state=%d TLS=%d %s. Retrying.\n", channel, state, tlsError, text);
  else
    Serial.printf("%s MQTT connect failed: state=%d. Retrying.\n", channel, state);
}

// Telemetry is the sole MQTT client; its blocking login runs off the motor/HTTP tasks.
static void connectTelemetry(const char* id, uint32_t& lastAttempt) {
  const bool connected = tls.login(mqtt, id, MQTT_USERNAME, MQTT_PASSWORD);
  lastAttempt = millis();
  if (connected) Serial.println("Telemetry publisher connected to EMQX.");
  else reportConnectFailure("Telemetry", mqtt, tls);
}

static bool publishTelemetry(const char* payload, size_t length) {
  // Use the original sketch's single MQTT write whenever its full buffer is available.
  const size_t overhead = MQTT_MAX_HEADER_SIZE + 2 + std::strlen(TOPIC);
  const bool fits = length + overhead <= mqtt.getBufferSize();
  const bool sent = fits ? mqtt.publish(TOPIC, payload, false) :
      (mqtt.beginPublish(TOPIC, length, false) &&
       mqtt.write(reinterpret_cast<const uint8_t*>(payload), length) == length && mqtt.endPublish());
  if (sent) {
    recordWrite(telemetryWrites);
    return true;
  }
  // A partial frame must never be followed by the next packet on the same stream.
  tls.stop();
  return false;
}

static bool validRouteKey() {
  if (std::strlen(AMR_ROUTE_KEY) != 64 || std::strspn(AMR_ROUTE_KEY, "0123456789abcdef") != 64) return false;
#ifdef AMR_CONTROL_KEY
  if (*AMR_CONTROL_KEY && !std::strcmp(AMR_ROUTE_KEY, AMR_CONTROL_KEY)) return false;
#endif
  return true;
}

static amr_route_wire::Result acceptPacket(const char* packet, size_t length) {
  amr_vision::Command command;
  const auto decoded = amr_route_wire::decode(packet, length, sign, command);
  if (decoded != amr_route_wire::Result::accepted) return decoded;
  const uint64_t utc = utcMs(), now = esp_timer_get_time();
  const bool online = networkReady();
  portENTER_CRITICAL(&driveMux);
  const bool arm = std::strcmp(command.op, "arm") == 0;
  const bool resting = !actualLeft && !actualRight && !appliedFromRoute && now >= neutralUntil;
  const bool mayDrive = online && linked && ready && motorOnline && controller.requested() == Motion::stopped
      && (!arm || resting);
  const bool accepted = guard.accept(command, utc, now, mayDrive, AMR_ROUTE_MAX_PWM);
  if (accepted && !std::strcmp(command.op, "stop")) neutralUntil = now + DIRECTION_INTERLOCK_US;
  portEXIT_CRITICAL(&driveMux);
  return accepted ? amr_route_wire::Result::accepted : amr_route_wire::Result::rejected;
}

static void handleCommand() {
  webServer.sendHeader("Cache-Control", "no-store");
  if (!webServer.hasArg("plain")) {
    webServer.send(400, "application/json", "{\"ok\":false,\"error\":\"signed V1 body required\"}");
    return;
  }
  const String packet = webServer.arg("plain");
  const auto result = acceptPacket(packet.c_str(), packet.length());
  if (result == amr_route_wire::Result::accepted)
    webServer.send(200, "application/json", "{\"ok\":true}");
  else if (result == amr_route_wire::Result::unauthorized)
    webServer.send(401, "application/json", "{\"ok\":false,\"error\":\"signature rejected\"}");
  else if (result == amr_route_wire::Result::malformed)
    webServer.send(400, "application/json", "{\"ok\":false,\"error\":\"invalid signed command\"}");
  else
    webServer.send(409, "application/json", "{\"ok\":false,\"error\":\"route guard rejected command\"}");
}

static void handleHardware() {
  static uint32_t sequence = 0;
  amr_vision::Guard current;
  int left, right;
  bool isReady;
  const bool online = networkReady();
  portENTER_CRITICAL(&driveMux);
  current = guard;
  left = actualLeft; right = actualRight;
  isReady = online && linked && ready;
  portEXIT_CRITICAL(&driveMux);
  amr_ir::Sensors sensors;
  portENTER_CRITICAL(&sensorMux); sensors = currentSensors; portEXIT_CRITICAL(&sensorMux);
  const double now = esp_timer_get_time() / 1000000.0;
  const bool battery = amr_ir::finiteBattery(sensors) && amr_ir::freshAt(now, sensors.batteryTimeS, .5);
  char packet[470];
  const int length = amr_route_wire::hardware(packet, sizeof(packet), current, sequence++, left, right,
      battery ? int(sensors.packV * 1000) : 0, isReady, utcMs(), sign);
  webServer.sendHeader("Cache-Control", "no-store");
  if (length < 0) {
    webServer.send(503, "application/json", "{\"ok\":false,\"error\":\"route signing unavailable\"}");
    return;
  }
  // Reading status never renews the guard's motor-command deadline.
  webServer.send(200, "text/plain", packet);
  recordWrite(heartbeatWrites);
}

static void setupReceiver() {
  digitalWrite(STBY, LOW);
  identity(receiverBoot);
  char epoch[33]; identity(epoch);
  guard.connection(receiverBoot, epoch);
  routeKeyReady = validRouteKey();
  if (!routeKeyReady) Serial.println("LAN routes disabled: configure a distinct 64-character route key.");
  motorOnline = pwmReady && writeWheels(0, 0);
  if (xTaskCreatePinnedToCore(motorTask, "amr01-motor", 4096, nullptr, 3, nullptr, 1) != pdPASS) {
    motorOnline = false;
    Serial.println("Motor task could not start. Outputs disabled.");
  }
}
}  // namespace amr_route
