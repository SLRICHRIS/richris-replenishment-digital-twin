#pragma once

#include <ArduinoJson.h>

// This UART carries actual measurements and execution ACKs from the AMR
// controller. Motor pins, battery dividers and encoder pinouts belong to that
// controller.
static Measurements controllerMeasurements;
static uint64_t controllerCapturedMs = 0;
static bool controllerResumeAllowed = false;
static char controllerLine[1024];
static size_t controllerLineLength = 0;
static bool controllerLineOverflow = false;
static char pendingCommandId[33] = "";
static uint64_t pendingCommandExpiry = 0;

struct RememberedCommand {
  char id[33] = "";
  char status[12] = "accepted";
  uint64_t expiresMs = 0;
};
static RememberedCommand commands[32];

uint64_t wallTimeMs() {
  timeval now;
  gettimeofday(&now, nullptr);
  return uint64_t(now.tv_sec) * 1000ULL + now.tv_usec / 1000;
}

bool commandIdValid(const char *id) {
  if (!id || strlen(id) != 32)
    return false;
  for (size_t i = 0; i < 32; ++i) {
    if (!((id[i] >= '0' && id[i] <= '9') || (id[i] >= 'a' && id[i] <= 'f')))
      return false;
  }
  return true;
}

void publishCommandAck(const char *id, const char *status, const char *reason) {
  if (!commandIdValid(id))
    return;
  JsonDocument ack;
  ack["v"] = 1;
  ack["device_id"] = deviceId;
  ack["boot_id"] = bootId;
  ack["command_id"] = id;
  ack["status"] = status;
  ack["reason"] = reason;
  char payload[512], ackTopic[180];
  size_t length = serializeJson(ack, payload, sizeof(payload));
  snprintf(ackTopic, sizeof(ackTopic), "%s/%s/command_ack", TOPIC_PREFIX,
           deviceId);
  mqtt.publish(ackTopic, reinterpret_cast<const uint8_t *>(payload), length,
               false);
}

void rememberStatus(const char *id, const char *status) {
  for (auto &command : commands) {
    if (strcmp(command.id, id) == 0)
      snprintf(command.status, sizeof(command.status), "%s", status);
  }
}

void receiveOperatorCommand(char *receivedTopic, byte *payload,
                            unsigned int length) {
  char expectedTopic[180];
  snprintf(expectedTopic, sizeof(expectedTopic), "%s/%s/commands", TOPIC_PREFIX,
           deviceId);
  if (strcmp(receivedTopic, expectedTopic) != 0 || length > 1024)
    return;
  JsonDocument packet;
  if (deserializeJson(packet, payload, length))
    return;
  const char *id = packet["command_id"] | "";
  const char *target = packet["target_boot_id"] | "";
  const char *asset = packet["device_id"] | "";
  const char *action = packet["action"] | "";
  if (!commandIdValid(id) || strcmp(asset, deviceId) != 0 ||
      strcmp(target, bootId) != 0)
    return;
  const uint64_t now = wallTimeMs();
  if (!packet["v"].is<int>() || packet["v"].as<int>() != 1 ||
      !packet["issued_at_ms"].is<uint64_t>() ||
      !packet["expires_at_ms"].is<uint64_t>())
    return;
  const uint64_t issued = packet["issued_at_ms"],
                 expires = packet["expires_at_ms"];
  if (now < 1704067200000ULL || expires <= now || expires <= issued ||
      expires - issued > 5000 || issued > now + 5000)
    return;
  RememberedCommand *freeSlot = nullptr;
  for (auto &command : commands) {
    if (command.expiresMs > now && strcmp(command.id, id) == 0) {
      publishCommandAck(id, command.status,
                        "Duplicate request; controller not called again");
      return;
    }
    if (command.expiresMs <= now)
      freeSlot = &command;
  }
  if (!freeSlot) {
    publishCommandAck(id, "rejected", "Replay cache is full");
    return;
  }
  snprintf(freeSlot->id, sizeof(freeSlot->id), "%s", id);
  freeSlot->expiresMs = expires;
  const bool allowed = strcmp(action, "stop") == 0 ||
                       strcmp(action, "pause") == 0 ||
                       strcmp(action, "resume") == 0;
  if (!ENABLE_CONTROLLER_UART || !allowed || pendingCommandId[0]) {
    rememberStatus(id, "rejected");
    publishCommandAck(
        id, "rejected",
        "Controller unavailable, action invalid or earlier command pending");
    return;
  }
  if (strcmp(action, "resume") == 0 &&
      (!controllerResumeAllowed || now > controllerCapturedMs + 1000)) {
    rememberStatus(id, "rejected");
    publishCommandAck(id, "rejected",
                      "Fresh controller permission is required for resume");
    return;
  }
  snprintf(pendingCommandId, sizeof(pendingCommandId), "%s", id);
  pendingCommandExpiry = expires;
  packet["kind"] = "operator_override";
  serializeJson(packet, Serial2);
  Serial2.println();
  rememberStatus(id, "accepted");
  publishCommandAck(
      id, "accepted",
      "Forwarded to onboard controller; execution not yet confirmed");
}

void processControllerLine() {
  JsonDocument packet;
  if (deserializeJson(packet, controllerLine))
    return;
  const char *kind = packet["kind"] | "";
  if (strcmp(kind, "execution_ack") == 0) {
    const char *id = packet["command_id"] | "";
    const char *status = packet["status"] | "";
    if (!pendingCommandId[0] || strcmp(id, pendingCommandId) != 0 ||
        wallTimeMs() >= pendingCommandExpiry)
      return;
    if (strcmp(status, "executed") != 0 && strcmp(status, "rejected") != 0)
      return;
    rememberStatus(id, status);
    publishCommandAck(id, status,
                      "Onboard controller execution acknowledgment");
    pendingCommandId[0] = '\0';
    return;
  }
  if (strcmp(kind, "measurements") != 0 ||
      !packet["captured_at_ms"].is<uint64_t>())
    return;
  const uint64_t captured = packet["captured_at_ms"], now = wallTimeMs();
  if (captured <= controllerCapturedMs || captured + 1000 < now ||
      captured > now + 250)
    return;
  Measurements measured;
  measured.batteryPct = packet["battery_pct"].is<float>()
                            ? packet["battery_pct"].as<float>()
                            : NAN;
  measured.speedMps =
      packet["speed_mps"].is<float>() ? packet["speed_mps"].as<float>() : NAN;
  const char *frame = packet["frame_id"] | "";
  if (strcmp(frame, CONTROLLER_FRAME_ID) == 0) {
    measured.xM = packet["pose"]["x_m"].is<float>()
                      ? packet["pose"]["x_m"].as<float>()
                      : NAN;
    measured.yM = packet["pose"]["y_m"].is<float>()
                      ? packet["pose"]["y_m"].as<float>()
                      : NAN;
    measured.headingDeg = packet["pose"]["heading_deg"].is<float>()
                              ? packet["pose"]["heading_deg"].as<float>()
                              : NAN;
  }
  const char *state = packet["state"] | "unknown";
  if (strcmp(state, "idle") == 0)
    measured.state = RobotState::Idle;
  else if (strcmp(state, "moving") == 0)
    measured.state = RobotState::Moving;
  else if (strcmp(state, "paused") == 0)
    measured.state = RobotState::Paused;
  else if (strcmp(state, "charging") == 0)
    measured.state = RobotState::Charging;
  else if (strcmp(state, "fault") == 0)
    measured.state = RobotState::Fault;
  controllerMeasurements = measured;
  controllerCapturedMs = captured;
  controllerResumeAllowed = packet["resume_allowed"].is<bool>() &&
                            packet["resume_allowed"].as<bool>();
}

void pollController() {
  if (!ENABLE_CONTROLLER_UART)
    return;
  // Bound work in each loop; a noisy measurement sender cannot monopolize MQTT.
  unsigned int budget = 256;
  while (Serial2.available() && budget--) {
    const char character = char(Serial2.read());
    if (character == '\n') {
      if (!controllerLineOverflow && controllerLineLength) {
        controllerLine[controllerLineLength] = '\0';
        processControllerLine();
      }
      controllerLineLength = 0;
      controllerLineOverflow = false;
    } else if (character != '\r') {
      if (controllerLineLength < sizeof(controllerLine) - 1)
        controllerLine[controllerLineLength++] = character;
      else
        controllerLineOverflow = true;
    }
  }
  if (pendingCommandId[0] && wallTimeMs() >= pendingCommandExpiry) {
    // Missing execution evidence is a timeout, not a controller rejection.
    // Let the Coordinator's own monotonic deadline record unconfirmed
    // execution.
    rememberStatus(pendingCommandId, "timed_out");
    pendingCommandId[0] = '\0';
  }
}

Measurements readMeasurements() {
  if (!ENABLE_CONTROLLER_UART || wallTimeMs() > controllerCapturedMs + 1000)
    return Measurements{};
  return controllerMeasurements;
}
