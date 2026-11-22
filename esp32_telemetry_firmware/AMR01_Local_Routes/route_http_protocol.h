#pragma once
#include <cstddef>
#include <cstdio>
#include <cstring>
#include "vision_drive_guard.h"

namespace amr_route_wire {
constexpr size_t MAX_PACKET_BYTES = 450;
enum class Result { accepted, malformed, unauthorized, rejected };
using Sign = bool (*)(const char*, char*);

// The signing callback supplies exactly 64 lowercase HMAC-SHA256 hex digits.
// Only authenticated bodies reach the production V1 parser and motor guard.
inline Result decode(const char* packet, size_t length, Sign sign, amr_vision::Command& command) {
  if (!packet || !sign || length < 100 || length > MAX_PACKET_BYTES ||
      std::memchr(packet, '\0', length)) return Result::malformed;
  char body[MAX_PACKET_BYTES + 1], expected[65];
  std::memcpy(body, packet, length); body[length] = '\0';
  char* signature = std::strrchr(body, '|');
  if (!signature || std::strlen(signature + 1) != 64) return Result::malformed;
  *signature++ = '\0';
  if (!sign(body, expected)) return Result::unauthorized;
  unsigned different = 0;
  for (int i = 0; i < 64; ++i) different |= unsigned(expected[i] ^ signature[i]);
  if (different) return Result::unauthorized;
  return amr_vision::parse(body, command) ? Result::accepted : Result::malformed;
}

inline int hardware(char* packet, size_t size, const amr_vision::Guard& guard,
                    uint32_t sequence, int left, int right, int batteryMv,
                    bool ready, uint64_t utc, Sign sign) {
  if (!packet || !size || !sign) return -1;
  char body[390], mac[65];
  const int length = std::snprintf(body, sizeof(body), "H1|%s|%s|%lu|%s|%lu|%s|%d|%d|%d|%d|%llu",
      guard.boot, guard.epoch, static_cast<unsigned long>(sequence),
      *guard.route ? guard.route : "00000000000000000000000000000000",
      static_cast<unsigned long>(guard.seq), guard.state, left, right, batteryMv,
      ready ? 1 : 0, static_cast<unsigned long long>(utc));
  if (length <= 0 || size_t(length) >= sizeof(body) || !sign(body, mac)) return -1;
  const int written = std::snprintf(packet, size, "%s|%s", body, mac);
  return written > 0 && size_t(written) < size ? written : -1;
}
}  // namespace amr_route_wire
