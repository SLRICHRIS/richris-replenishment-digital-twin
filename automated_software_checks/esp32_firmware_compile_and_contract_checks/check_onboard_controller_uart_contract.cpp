// Native execution of the production UART/command header with ArduinoJson.
// Mock transport only; this test does not drive a physical robot.
#include <ArduinoJson.h>
#include <assert.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <string>
#include <sys/time.h>
#include <vector>
using byte = unsigned char;
const bool ENABLE_CONTROLLER_UART = true;
const char CONTROLLER_FRAME_ID[] = "warehouse-01";
const char TOPIC_PREFIX[] = "richris/warehouse01";
char deviceId[] = "amr-01", bootId[] = "01234567abcdef00";
enum class RobotState { Unknown, Idle, Moving, Paused, Charging, Fault };
struct Measurements {
  float batteryPct = NAN, speedMps = NAN, xM = NAN, yM = NAN, headingDeg = NAN;
  RobotState state = RobotState::Unknown;
};
struct MockSerial {
  std::string output, input;
  size_t offset = 0;
  size_t write(uint8_t c) {
    output += char(c);
    return 1;
  }
  size_t write(const uint8_t *buffer, size_t size) {
    output.append(reinterpret_cast<const char *>(buffer), size);
    return size;
  }
  void println() { output += '\n'; }
  int available() { return int(input.size() - offset); }
  int read() { return input[offset++]; }
} Serial2;
struct MockMqtt {
  std::vector<std::string> acknowledgments;
  bool publish(const char *, const uint8_t *buffer, size_t size, bool) {
    acknowledgments.emplace_back(reinterpret_cast<const char *>(buffer), size);
    return true;
  }
} mqtt;
#include "onboard_controller_sensor_and_override_bridge.h"

void sensor(const std::string &extras) {
  controllerCapturedMs = 0;
  std::string raw = "{\"kind\":\"measurements\",\"captured_at_ms\":" +
                    std::to_string(wallTimeMs()) + "," + extras + "}";
  snprintf(controllerLine, sizeof(controllerLine), "%s", raw.c_str());
  processControllerLine();
}
std::string status() {
  JsonDocument packet;
  assert(!deserializeJson(packet, mqtt.acknowledgments.back()));
  return packet["status"].as<std::string>();
}
int main() {
  assert(isnan(readMeasurements().speedMps));
  sensor("\"frame_id\":\"warehouse-01\",\"battery_pct\":0,\"speed_mps\":0,"
         "\"state\":\"idle\",\"resume_allowed\":true,\"pose\":{\"x_m\":1,\"y_"
         "m\":2,\"heading_deg\":90}");
  Measurements m = readMeasurements();
  assert(m.batteryPct == 0 && m.speedMps == 0 && m.xM == 1 &&
         m.headingDeg == 90);
  assert(m.state == RobotState::Idle && controllerResumeAllowed);
  sensor("\"frame_id\":\"wrong-map\",\"battery_pct\":null,\"speed_mps\":true,"
         "\"pose\":{\"x_m\":1,\"y_m\":2,\"heading_deg\":90}");
  assert(isnan(readMeasurements().batteryPct) &&
         isnan(readMeasurements().speedMps) && isnan(readMeasurements().xM));
  controllerCapturedMs = wallTimeMs() - 2000;
  assert(isnan(readMeasurements().speedMps));
  JsonDocument request;
  request["v"] = 1;
  request["command_id"] = "0123456789abcdef0123456789abcdef";
  request["device_id"] = deviceId;
  request["target_boot_id"] = bootId;
  request["action"] = "stop";
  request["issued_at_ms"] = wallTimeMs();
  request["expires_at_ms"] = wallTimeMs() + 2000;
  char commandTopic[] = "richris/warehouse01/amr-01/commands";
  std::string raw;
  serializeJson(request, raw);
  receiveOperatorCommand(commandTopic, reinterpret_cast<byte *>(raw.data()),
                         raw.size());
  assert(status() == "accepted");
  const std::string forwarded = Serial2.output;
  assert(forwarded.find("operator_override") != std::string::npos);
  receiveOperatorCommand(commandTopic, reinterpret_cast<byte *>(raw.data()),
                         raw.size());
  assert(Serial2.output == forwarded && status() == "accepted");
  Serial2.input =
      "{\"kind\":\"execution_ack\",\"command_id\":"
      "\"0123456789abcdef0123456789abcdef\",\"status\":\"executed\"}\n";
  pollController();
  assert(status() == "executed" && pendingCommandId[0] == '\0');
  receiveOperatorCommand(commandTopic, reinterpret_cast<byte *>(raw.data()),
                         raw.size());
  assert(Serial2.output == forwarded && status() == "executed");
  request["command_id"] = "ffffffffffffffffffffffffffffffff";
  request["target_boot_id"] = "ffffffffffffffff";
  raw.clear();
  serializeJson(request, raw);
  const size_t accepted = mqtt.acknowledgments.size();
  receiveOperatorCommand(commandTopic, reinterpret_cast<byte *>(raw.data()),
                         raw.size());
  assert(mqtt.acknowledgments.size() == accepted);
  request["target_boot_id"] = bootId;
  request["action"] = "resume";
  raw.clear();
  serializeJson(request, raw);
  receiveOperatorCommand(commandTopic, reinterpret_cast<byte *>(raw.data()),
                         raw.size());
  assert(status() == "rejected" && Serial2.output == forwarded);
  request["command_id"] = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  request["action"] = "stop";
  raw.clear();
  serializeJson(request, raw);
  receiveOperatorCommand(commandTopic, reinterpret_cast<byte *>(raw.data()),
                         raw.size());
  assert(status() == "accepted" && pendingCommandId[0]);
  const size_t beforeTimeout = mqtt.acknowledgments.size();
  pendingCommandExpiry = wallTimeMs() - 1;
  pollController();
  assert(!pendingCommandId[0] && mqtt.acknowledgments.size() == beforeTimeout);
  puts("PASS: production UART sensor parsing, zero/null/type/frame/age gates, "
       "actual execution ACK, duplicate suppression, boot binding and guarded "
       "resume.");
}
