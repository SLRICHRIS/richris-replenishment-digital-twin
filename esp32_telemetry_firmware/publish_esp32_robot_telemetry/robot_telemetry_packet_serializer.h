#pragma once

#include <stddef.h>
#include <stdio.h>

// Used by the Arduino publisher and the native cross-validator contract test.
// Measurement strings have already been bounded and encoded as JSON or null.
inline int
encodeTelemetryPacket(char *payload, size_t capacity, const char *deviceId,
                      const char *bootId, unsigned long long sequence,
                      unsigned long long capturedMs, unsigned long uptimeMs,
                      const char *state, const char *battery, const char *pose,
                      const char *speed, int rssi, const char *firmware,
                      const char *frameId = "warehouse-01") {
  return snprintf(
      payload, capacity,
      "{\"v\":1,\"device_id\":\"%s\",\"boot_id\":\"%s\",\"seq\":%llu,"
      "\"sent_at_ms\":%llu,\"uptime_ms\":%lu,\"state\":\"%s\","
      "\"battery_pct\":%s,\"pose\":%s,\"speed_mps\":%s,"
      "\"wifi_rssi_dbm\":%d,\"firmware\":\"%s\",\"frame_id\":\"%s\",\"pose_"
      "source\":\"external\"}",
      deviceId, bootId, sequence, capturedMs, uptimeMs, state, battery, pose,
      speed, rssi, firmware, frameId);
}
