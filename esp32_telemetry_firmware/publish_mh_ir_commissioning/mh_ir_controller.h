#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

// Hardware-independent behavior shared by the real sketch and native checks.
namespace amr_ir {
enum class Motion { stopped, forward, backward, left, right };

inline const char* motionName(Motion motion) {
  switch (motion) {
    case Motion::forward: return "forward";
    case Motion::backward: return "backward";
    case Motion::left: return "left";
    case Motion::right: return "right";
    default: return "stopped";
  }
}

struct PulseCounter {
  uint64_t total = 0;
  uint32_t lastEdgeUs = 0;
  bool seen = false;

  // Unsigned subtraction intentionally handles the 32-bit micros() wrap.
  inline __attribute__((always_inline)) void edge(uint32_t now, uint32_t debounceUs) volatile {
    if (!seen || uint32_t(now - lastEdgeUs) >= debounceUs) {
      total = total + 1;
      lastEdgeUs = now;
      seen = true;
    }
  }
};

struct DriveOutput {
  Motion motion;
  uint8_t duty;
};

class LocalController {
 public:
  explicit LocalController(uint64_t timeoutUs = 3000000, uint64_t interlockUs = 150000)
      : timeoutUs_(timeoutUs), interlockUs_(interlockUs) {}

  void expire(uint64_t now) {
    if (requested_ != Motion::stopped &&
        (now < lastCommandUs_ || now - lastCommandUs_ >= timeoutUs_)) stop();
  }

  bool command(char value, uint64_t now) {
    expire(now);
    Motion next = requested_;
    switch (value) {
      case 'F': case 'f': next = Motion::forward; break;
      case 'B': case 'b': next = Motion::backward; break;
      case 'L': case 'l': next = Motion::left; break;
      case 'R': case 'r': next = Motion::right; break;
      case 'S': case 's': stop(); return true;
      case '+': duty_ = duty_ > 240 ? 255 : uint8_t(duty_ + 15); break;
      case '-': duty_ = duty_ < 15 ? 0 : uint8_t(duty_ - 15); break;
      default: return false;
    }
    if (next != requested_) {
      requested_ = next;
      enableAfterUs_ = now + interlockUs_;
    }
    if (requested_ != Motion::stopped) lastCommandUs_ = now;
    return true;
  }

  DriveOutput output(uint64_t now) {
    expire(now);
    if (requested_ == Motion::stopped || now < enableAfterUs_ || duty_ == 0)
      return {Motion::stopped, 0};
    return {requested_, duty_};
  }

  Motion requested() const { return requested_; }
  uint8_t configuredDuty() const { return duty_; }
  void stop() { requested_ = Motion::stopped; enableAfterUs_ = 0; }

 private:
  Motion requested_ = Motion::stopped;
  uint8_t duty_ = 180;
  uint64_t lastCommandUs_ = 0;
  uint64_t enableAfterUs_ = 0;
  uint64_t timeoutUs_;
  uint64_t interlockUs_;
};

struct Observation {
  uint64_t leftTotal = 0, rightTotal = 0;
  uint64_t leftDelta = 0, rightDelta = 0;
  double sampleTimeS = 0, intervalS = 0;
  Motion requested = Motion::stopped;
  Motion output = Motion::stopped;
  uint8_t duty = 0;
  uint32_t seq = 0;
};

inline int encodeDiagnostic(char* buffer, size_t size, const char* bootId,
                            const Observation& value, bool pprConfirmed,
                            double leftPpr, double rightPpr) {
  if (!buffer || !size || !bootId || !*bootId || std::strlen(bootId) > 32 ||
      std::strspn(bootId, "0123456789abcdefABCDEF-") != std::strlen(bootId) ||
      !std::isfinite(value.sampleTimeS) || value.sampleTimeS < 0 ||
      !std::isfinite(value.intervalS) || value.intervalS <= 0 ||
      !std::isfinite(leftPpr) || leftPpr <= 0 || !std::isfinite(rightPpr) || rightPpr <= 0)
    return -1;
  char leftRpm[48] = "null", rightRpm[48] = "null";
  const double leftHz = double(value.leftDelta) / value.intervalS;
  const double rightHz = double(value.rightDelta) / value.intervalS;
  if (!std::isfinite(leftHz) || !std::isfinite(rightHz)) return -1;
  if (pprConfirmed) {
    const double left = leftHz * 60.0 / leftPpr, right = rightHz * 60.0 / rightPpr;
    if (!std::isfinite(left) || !std::isfinite(right)) return -1;
    const int a = std::snprintf(leftRpm, sizeof leftRpm, "%.6f", left);
    const int b = std::snprintf(rightRpm, sizeof rightRpm, "%.6f", right);
    if (a < 0 || size_t(a) >= sizeof leftRpm || b < 0 || size_t(b) >= sizeof rightRpm)
      return -1;
  }
  const int length = std::snprintf(buffer, size,
      "{\"schema_version\":1,\"message_type\":\"mh_ir_commissioning\","
      "\"robot_id\":\"amr01\",\"boot_id\":\"%s\",\"seq\":%lu,"
      "\"sample_time_s\":%.6f,\"interval_s\":%.6f,"
      "\"left_pulses_total\":%llu,\"right_pulses_total\":%llu,"
      "\"left_pulse_hz\":%.6f,\"right_pulse_hz\":%.6f,"
      "\"rpm_calibration_confirmed\":%s,\"left_rpm\":%s,\"right_rpm\":%s,"
      "\"commanded_motion\":\"%s\",\"motor_output\":\"%s\",\"pwm_duty\":%u,"
      "\"direction_measured\":false,\"gyro_available\":false,"
      "\"battery_available\":false,\"predictive_models_ready\":false}",
      bootId, static_cast<unsigned long>(value.seq), value.sampleTimeS, value.intervalS,
      static_cast<unsigned long long>(value.leftTotal),
      static_cast<unsigned long long>(value.rightTotal), leftHz, rightHz,
      pprConfirmed ? "true" : "false", leftRpm, rightRpm,
      motionName(value.requested), motionName(value.output), unsigned(value.duty));
  return length >= 0 && size_t(length) < size ? length : -1;
}
}  // namespace amr_ir
