/* AMR-01 | Single-file Arduino IDE sketch
 * Open this .ino in Arduino IDE and allow creation of its matching folder.
 * Install esp32 by Espressif Systems (tested 3.3.12), PubSubClient 2.8.0,
 * and Adafruit INA219 1.2.3 with its dependencies.
 * Select the correct ESP32 board and USB port. Serial Monitor: 115200 baud.
 * Private Wi-Fi and broker settings are in the companion header.
 * Keep the robot stationary during startup. Local motion continues until S is received.
 * Publishes commissioning measurements; production prediction ingestion is pending.\n * Encoder signed counts infer direction from commanded motor direction; single-channel sensors do not measure direction.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <mbedtls/md.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <esp_timer.h>
#include <esp_arduino_version.h>
#include <time.h>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

// Explicit declarations keep Arduino's sketch preprocessing independent of type order.
namespace amr_ir {
enum class Motion;
struct Observation;
struct Sensors;
struct DriveOutput;
inline const char* motionName(Motion motion);
inline int encodeDiagnostic(char* buffer, size_t size, const char* bootId,
    const Observation& value, bool pprConfirmed, double leftPpr, double rightPpr,
    bool gyroAvailable, bool batteryAvailable);
inline bool finiteImu(const Sensors& s);
inline bool finiteBattery(const Sensors& s);
inline bool freshAt(double now, double measured, double maximumAge);
inline int encodeMultisensor(char* buffer, size_t size, const char* bootId,
    const Observation& observation, const Sensors& s, bool pprConfirmed,
    double leftPpr, double rightPpr);
}
void ARDUINO_ISR_ATTR countLeftPulse();
void ARDUINO_ISR_ATTR countRightPulse();
bool attachMotorPwm();
bool writeMotorPwm(int pin, uint32_t duty);
void applyDrive(const amr_ir::DriveOutput& drive);
bool readRegisters(uint8_t address, uint8_t reg, uint8_t* data, uint8_t count);
bool writeRegister(uint8_t reg, uint8_t value);
int16_t signedWord(const uint8_t* bytes, uint8_t index);
bool readImu(amr_ir::Sensors& s);
void initializeSensors();
void sensorTask(void*);
void networkTask(void*);
void setup();
void loop();

#include "esp32_wifi_and_mqtt_settings.h"

// User's current wiring: do not substitute the older quadrature sketch's pins.
static constexpr int PWMA = 25, AIN1 = 26, AIN2 = 27;
static constexpr int PWMB = 14, BIN1 = 32, BIN2 = 33, STBY = 13;
static constexpr int LEFT_IR_PIN = 18, RIGHT_IR_PIN = 19;
// One FALLING edge = one encoder pulse. Tune only after measuring the sensor's
// maximum pulse frequency; 2000 us rejects edges closer than 2 ms (500 Hz).
static constexpr uint32_t ENCODER_DEBOUNCE_US = 2000;
static constexpr uint32_t PWM_FREQ = 1000;
static constexpr uint8_t PWM_RESOLUTION = 8;
// 0 disables the local command timeout: motion continues until S is received.
// Use only with the robot supervised and an accessible emergency stop.
static constexpr uint64_t LOCAL_COMMAND_TIMEOUT_US = 0;
static constexpr uint64_t DIRECTION_INTERLOCK_US = 150000;

// Count actual FALLING edges over several wheel revolutions before confirming.
// These 1.0 values reproduce the supplied code's assumption, not a measurement.
static constexpr double LEFT_PULSES_PER_REV = 1.0;
static constexpr double RIGHT_PULSES_PER_REV = 1.0;
static constexpr bool PULSE_CALIBRATION_CONFIRMED = false;

// Final multisensor wiring: shared I2C bus, no motor pin changes.
static constexpr int I2C_SDA_PIN = 21, I2C_SCL_PIN = 22;
static constexpr uint8_t MPU_ADDRESS = 0x68, INA219_ADDRESS_VALUE = 0x40;
static constexpr uint32_t TELEMETRY_INTERVAL_US = 500000;
// Assumptions from the supplied sketch. Confirm capacity, starting charge and
// discharge-positive current polarity before enabling an absolute SOC estimate.
static constexpr double BATTERY_CAPACITY_MAH = 2200.0;
static constexpr double INITIAL_SOC_PERCENT = 100.0;
static constexpr double DISCHARGE_CURRENT_SIGN = 1.0;
// Enabled as requested. This assumes a 2200 mAh battery starting at 100%
// and that positive INA219 current means battery discharge.
static constexpr bool BATTERY_SOC_INITIALIZATION_CONFIRMED = true;


#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <climits>

namespace amr_vision {
struct Command { char boot[33]{},epoch[33]{},route[33]{},op[8]{}; uint32_t seq=0; int left=0,right=0; uint64_t issued=0,expires=0; };
inline bool hex32(const char* s) { if (std::strlen(s)!=32) return false; for(int i=0;i<32;++i) if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f'))) return false; return true; }
inline bool number(const char* s,uint64_t& v) {
  if(!*s) return false;
  v=0;
  for(;*s;++s) { if(*s<'0'||*s>'9'||v>(UINT64_MAX-9)/10) return false; v=v*10+uint64_t(*s-'0'); }
  return true;
}
inline bool duty(const char* s,int& v) { bool neg=*s=='-'; uint64_t n=0; if(!number(s+(neg?1:0),n)||n>160) return false; v=neg?-int(n):int(n); return true; }
// Pass only the authenticated portion, after constant-time HMAC validation.
inline bool parse(char* body,Command& c) {
  char* f[10]; int n=0; f[n++]=body;
  for(char* p=body;*p;++p) if(*p=='|') { *p=0; if(n>=10) return false; f[n++]=p+1; }
  uint64_t seq=0;
  if(n!=10||std::strcmp(f[0],"V1")||!hex32(f[1])||!hex32(f[2])||!hex32(f[3])||!number(f[4],seq)||seq==0||seq>UINT32_MAX||
      (std::strcmp(f[5],"arm")&&std::strcmp(f[5],"drive")&&std::strcmp(f[5],"stop"))||!duty(f[6],c.left)||!duty(f[7],c.right)||!number(f[8],c.issued)||!number(f[9],c.expires)) return false;
  if(std::strcmp(f[5],"drive")&&(c.left||c.right)) return false;
  std::strcpy(c.boot,f[1]); std::strcpy(c.epoch,f[2]); std::strcpy(c.route,f[3]); std::strcpy(c.op,f[5]); c.seq=uint32_t(seq); return true;
}
class Guard {
 public:
  char boot[33]{},epoch[33]{},route[33]{};
  uint32_t seq=0; int left=0,right=0; const char* state="idle"; bool active=false;
  void connection(const char* b,const char* e) { stop("unavailable"); std::strcpy(boot,b); std::strcpy(epoch,e); route[0]=0; seq=0; }
  void stop(const char* reason) { left=right=0; active=false; state=reason; }
  bool accept(const Command& c,uint64_t utc,uint64_t mono,bool ready,int cap) {
    if(!ready||std::strcmp(c.boot,boot)||std::strcmp(c.epoch,epoch)||c.seq<=seq||c.expires<=utc||c.expires-c.issued>500||c.issued>utc+100||c.issued+500<utc||c.expires<c.issued||std::abs(c.left)>cap||std::abs(c.right)>cap) return false;
    if(!std::strcmp(c.op,"arm")) {
      if(active||!std::strcmp(c.route,route)) return false;
      std::strcpy(route,c.route); active=true; left=right=0; targetLeft=targetRight=0; state="armed";
    } else {
      if(!active||std::strcmp(c.route,route)) return false;
      if(!std::strcmp(c.op,"stop")) stop("stopped");
      else { targetLeft=c.left; targetRight=c.right; }
    }
    seq=c.seq; deadline=mono+(c.expires-utc)*1000; return true;
  }
  void tick(uint64_t mono,bool ready) {
    if(!ready) { stop("unavailable"); return; }
    if(!active) return;
    if(mono>=deadline) { stop("expired"); return; }
    const int ls=(targetLeft>0)-(targetLeft<0),rs=(targetRight>0)-(targetRight<0);
    if((ls&&lastLeft&&ls!=lastLeft)||(rs&&lastRight&&rs!=lastRight)) {
      left=right=0; interlockUntil=mono+150000; lastLeft=ls; lastRight=rs; state="interlock";
    }
    if(mono<interlockUntil) return;
    left=targetLeft; right=targetRight;
    if(ls) lastLeft=ls;
    if(rs) lastRight=rs;
    if(left||right) state="moving";
    else if(std::strcmp(state,"armed")) state="interlock";
  }
 private:
  uint64_t deadline=0,interlockUntil=0; int targetLeft=0,targetRight=0,lastLeft=0,lastRight=0;
};
}

#ifndef AMR_VISION_DRIVE_ENABLED
#define AMR_VISION_DRIVE_ENABLED 0
#define AMR_VISION_DRIVE_KEY ""
#define AMR_VISION_MQTT_USERNAME ""
#define AMR_VISION_MQTT_PASSWORD ""
#define AMR_VISION_MAX_PWM 160
#define AMR_VISION_MIN_PACK_V 6.6
#endif
static_assert(AMR_VISION_MAX_PWM > 0 && AMR_VISION_MAX_PWM <= 160,"Vision PWM cap must be 1..160");
static_assert(AMR_VISION_MIN_PACK_V >= 6.0 && AMR_VISION_MIN_PACK_V <= 7.4,"Verify 2S motor-branch cutoff");
portMUX_TYPE visionMux = portMUX_INITIALIZER_UNLOCKED;
amr_vision::Guard visionGuard;
bool visionReady=false, visionLinked=false;
int appliedLeft=0,appliedRight=0;
static const char DRIVE_TOPIC[]="robot/amr01/vision/drive";
static const char HARDWARE_TOPIC[]="robot/amr01/vision/hardware";

// ===== WHEEL SENSORS AND LOCAL DRIVE =====
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
  uint64_t total = 0;             // Absolute pulse total
  int64_t signedTotal = 0;        // Direction inferred from motor command
  int8_t directionSign = 0;       // +1 forward, -1 reverse, 0 stopped
  uint32_t lastEdgeUs = 0;
  bool seen = false;

  // One-channel MH sensors cannot physically measure direction. The sign is
  // assigned from the wheel direction commanded to the motor driver.
  inline __attribute__((always_inline)) void edge(uint32_t now, uint32_t debounceUs) volatile {
    if (!seen || uint32_t(now - lastEdgeUs) >= debounceUs) {
      total = total + 1;
      signedTotal = signedTotal + directionSign;
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
  explicit LocalController(uint64_t timeoutUs = 3000000, uint64_t interlockUs = 150000,
                           uint8_t initialDuty = 180, uint8_t speedStep = 15)
      : duty_(initialDuty), speedStep_(speedStep), timeoutUs_(timeoutUs), interlockUs_(interlockUs) {}

  void expire(uint64_t now) {
    if (timeoutUs_ > 0 && requested_ != Motion::stopped &&
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
      case '+': duty_ = unsigned(duty_) + speedStep_ > 255 ? 255 : uint8_t(duty_ + speedStep_); break;
      case '-': duty_ = duty_ < speedStep_ ? 0 : uint8_t(duty_ - speedStep_); break;
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
  uint8_t speedStep_ = 15;
  uint64_t lastCommandUs_ = 0;
  uint64_t enableAfterUs_ = 0;
  uint64_t timeoutUs_;
  uint64_t interlockUs_;
};

struct Observation {
  uint64_t leftTotal = 0, rightTotal = 0;
  int64_t leftSignedTotal = 0, rightSignedTotal = 0;
  uint64_t leftDelta = 0, rightDelta = 0;
  int64_t leftSignedDelta = 0, rightSignedDelta = 0;
  double sampleTimeS = 0, intervalS = 0;
  Motion requested = Motion::stopped;
  Motion output = Motion::stopped;
  uint8_t duty = 0;
  uint32_t seq = 0;
};

inline int encodeDiagnostic(char* buffer, size_t size, const char* bootId,
                            const Observation& value, bool pprConfirmed,
                            double leftPpr, double rightPpr,
                            bool gyroAvailable = false, bool batteryAvailable = false) {
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
      "\"left_encoder_count\":%lld,\"right_encoder_count\":%lld,"
      "\"left_encoder_count_signed\":%lld,\"right_encoder_count_signed\":%lld,"
      "\"left_pulses_total\":%llu,\"right_pulses_total\":%llu,"
      "\"left_pulses_delta\":%llu,\"right_pulses_delta\":%llu,"
      "\"left_pulses_delta_signed\":%lld,\"right_pulses_delta_signed\":%lld,"
      "\"left_pulse_hz\":%.6f,\"right_pulse_hz\":%.6f,"
      "\"encoder_edge\":\"FALLING\",\"encoder_direction_measured\":false,"
      "\"encoder_direction_source\":\"motor_command_estimate\","
      "\"encoder_direction_note\":\"single_channel_sensor_direction_is_inferred_not_measured\", "
      "\"rpm_calibration_confirmed\":%s,\"left_rpm\":%s,\"right_rpm\":%s,"
      "\"commanded_motion\":\"%s\",\"motor_output\":\"%s\",\"pwm_duty\":%u,"
      "\"direction_measured\":false,\"gyro_available\":%s,"
      "\"battery_available\":%s,\"predictive_models_ready\":false}",
      bootId, static_cast<unsigned long>(value.seq), value.sampleTimeS, value.intervalS,
      static_cast<long long>(value.leftSignedTotal),
      static_cast<long long>(value.rightSignedTotal),
      static_cast<long long>(value.leftSignedTotal),
      static_cast<long long>(value.rightSignedTotal),
      static_cast<unsigned long long>(value.leftTotal),
      static_cast<unsigned long long>(value.rightTotal),
      static_cast<unsigned long long>(value.leftDelta),
      static_cast<unsigned long long>(value.rightDelta),
      static_cast<long long>(value.leftSignedDelta),
      static_cast<long long>(value.rightSignedDelta),
      leftHz, rightHz,
      pprConfirmed ? "true" : "false", leftRpm, rightRpm,
      motionName(value.requested), motionName(value.output), unsigned(value.duty),
      gyroAvailable ? "true" : "false", batteryAvailable ? "true" : "false");
  return length >= 0 && size_t(length) < size ? length : -1;
}
}  // namespace amr_ir

// ===== IMU AND BATTERY OBSERVATIONS =====
namespace amr_ir {
constexpr double DEG_TO_RAD_VALUE = 0.017453292519943295;

struct Sensors {
  bool imuValid = false, batteryValid = false, biasAvailable = false;
  bool yawValid = false, socValid = false, batteryContinuous = true;
  uint8_t whoAmI = 0;
  double imuTimeS = 0, batteryTimeS = 0;
  double ax = 0, ay = 0, az = 0;  // g, +/-2g configuration
  double gx = 0, gy = 0, gz = 0;  // degrees/s, +/-250 degrees/s
  double biasDps = 0, yawDeg = 0;
  double busV = 0, shuntMv = 0, packV = 0, currentA = 0, powerW = 0;
  double chargeUsedMah = 0, socPercent = 0;
};

class ChargeTracker {
 public:
  ChargeTracker(double capacityMah, double initialPercent, bool confirmed)
      : capacity_(capacityMah), initial_(initialPercent), confirmed_(confirmed &&
        std::isfinite(capacityMah) && capacityMah > 0 && std::isfinite(initialPercent) &&
        initialPercent >= 0 && initialPercent <= 100) {}
  void invalidate() { continuous_ = false; anchored_ = false; }
  void accept(double now, double currentA) {
    if (!std::isfinite(now) || !std::isfinite(currentA) || now < 0) { invalidate(); return; }
    if (anchored_) {
      const double dt = now-lastTime_;
      if (dt <= 0 || dt > .5) { invalidate(); }
      else usedMah_ += (lastCurrent_+currentA)*.5*dt*1000.0/3600.0;
    }
    anchored_ = true; lastTime_ = now; lastCurrent_ = currentA;
  }
  bool continuous() const { return continuous_; }
  bool socValid() const { return confirmed_ && continuous_; }
  double usedMah() const { return usedMah_; }
  double percent() const {
    const double value = initial_-usedMah_/capacity_*100.0;
    return value < 0 ? 0 : value > 100 ? 100 : value;
  }
 private:
  double capacity_, initial_, usedMah_ = 0, lastTime_ = 0, lastCurrent_ = 0;
  bool confirmed_, anchored_ = false, continuous_ = true;
};

class YawTracker {
 public:
  void reset() { yaw_ = 0; anchored_ = false; continuous_ = true; }
  void invalidate() { continuous_ = false; anchored_ = false; }
  void accept(double now, double correctedDps) {
    if (!std::isfinite(now) || !std::isfinite(correctedDps) || now < 0) { invalidate(); return; }
    if (anchored_) {
      const double dt = now-lastTime_;
      if (dt <= 0 || dt > .1) invalidate();
      else yaw_ = std::remainder(yaw_+correctedDps*dt,360.0);
    }
    anchored_ = true; lastTime_ = now;
  }
  bool valid() const { return continuous_ && anchored_; }
  double angleDegrees() const { return yaw_; }
 private:
  double yaw_ = 0, lastTime_ = 0;
  bool anchored_ = false, continuous_ = true;
};

inline bool finiteImu(const Sensors& s) {
  return s.imuValid && std::isfinite(s.imuTimeS) && s.imuTimeS >= 0 &&
    std::isfinite(s.ax) && std::isfinite(s.ay) && std::isfinite(s.az) &&
    std::isfinite(s.gx) && std::isfinite(s.gy) && std::isfinite(s.gz);
}
inline bool finiteBattery(const Sensors& s) {
  return s.batteryValid && std::isfinite(s.batteryTimeS) && s.batteryTimeS >= 0 &&
    std::isfinite(s.busV) && std::isfinite(s.shuntMv) && std::isfinite(s.packV) &&
    s.packV > 0 && std::isfinite(s.currentA) && std::isfinite(s.powerW);
}
inline bool freshAt(double now, double measured, double maximumAge) {
  return std::isfinite(measured) && now >= measured && now-measured <= maximumAge;
}

// The commissioning contract intentionally cannot masquerade as signed odometry.
inline int encodeMultisensor(char* buffer, size_t size, const char* bootId,
    const Observation& observation, const Sensors& s, bool pprConfirmed,
    double leftPpr, double rightPpr) {
  const bool imu = finiteImu(s) && freshAt(observation.sampleTimeS,s.imuTimeS,.1);
  const bool battery = finiteBattery(s) && freshAt(observation.sampleTimeS,s.batteryTimeS,.5);
  const bool bias = s.biasAvailable && std::isfinite(s.biasDps);
  const bool yaw = imu && bias && s.yawValid && std::isfinite(s.yawDeg);
  const bool soc = battery && s.socValid && s.batteryContinuous &&
                   std::isfinite(s.socPercent) && s.socPercent >= 0 && s.socPercent <= 100;
  const int base = encodeDiagnostic(buffer,size,bootId,observation,pprConfirmed,
                                   leftPpr,rightPpr,imu,battery);
  if (base < 0) return -1;
  char imuValues[512], batteryValues[512], biasValue[48] = "null", yawValue[48] = "null", socValue[48] = "null";
  int a, b;
  if (imu) a = std::snprintf(imuValues,sizeof imuValues,
      "\"imu_sample_time_s\":%.6f,\"accel_g\":[%.6f,%.6f,%.6f],"
      "\"gyro_dps\":[%.6f,%.6f,%.6f],\"gyro_z_rad_s\":%.9f",
      s.imuTimeS,s.ax,s.ay,s.az,s.gx,s.gy,s.gz,s.gz*DEG_TO_RAD_VALUE);
  else a = std::snprintf(imuValues,sizeof imuValues,
      "\"imu_sample_time_s\":null,\"accel_g\":null,\"gyro_dps\":null,\"gyro_z_rad_s\":null");
  if (battery) b = std::snprintf(batteryValues,sizeof batteryValues,
      "\"battery_sample_time_s\":%.6f,\"battery_bus_voltage_v\":%.6f,"
      "\"battery_shunt_voltage_mv\":%.6f,\"battery_voltage_v\":%.6f,"
      "\"battery_current_a\":%.6f,\"battery_power_w\":%.6f",
      s.batteryTimeS,s.busV,s.shuntMv,s.packV,s.currentA,s.powerW);
  else b = std::snprintf(batteryValues,sizeof batteryValues,
      "\"battery_sample_time_s\":null,\"battery_bus_voltage_v\":null,"
      "\"battery_shunt_voltage_mv\":null,\"battery_voltage_v\":null,"
      "\"battery_current_a\":null,\"battery_power_w\":null");
  if (a < 0 || size_t(a) >= sizeof imuValues || b < 0 || size_t(b) >= sizeof batteryValues) return -1;
  if (bias && (std::snprintf(biasValue,sizeof biasValue,"%.9f",s.biasDps*DEG_TO_RAD_VALUE) >= int(sizeof biasValue))) return -1;
  if (yaw && (std::snprintf(yawValue,sizeof yawValue,"%.6f",s.yawDeg) >= int(sizeof yawValue))) return -1;
  if (soc && (std::snprintf(socValue,sizeof socValue,"%.6f",s.socPercent) >= int(sizeof socValue))) return -1;
  const int extra = std::snprintf(buffer+base-1,size-size_t(base)+1,
      ",\"imu_who_am_i\":%u,%s,\"gyro_bias_estimate_rad_s\":%s,"
      "\"yaw_estimate_deg\":%s,%s,\"battery_continuity\":%s,\"soc_estimate_percent\":%s}",
      unsigned(s.whoAmI),imuValues,biasValue,yawValue,batteryValues,
      s.batteryContinuous ? "true" : "false",socValue);
  return extra >= 0 && size_t(extra) < size-size_t(base)+1 ? base-1+extra : -1;
}
}  // namespace amr_ir

// ===== ESP32 APPLICATION =====
/* AMR-01: user's final TB6612 + MH IR + IMU + INA219 wiring.
 * Local USB commands: F B L R S + - Z, Serial Monitor 115200 baud.
 * Wi-Fi/MQTT/TLS only publishes measurements. No remote motor subscription.
 * Signed pulse counts infer direction from the motor command; not true quadrature direction sensing.
 * Keep still at boot for gyro bias collection. Test with wheels raised.
 */

using amr_ir::Motion;
portMUX_TYPE pulseMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE observationMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE sensorMux = portMUX_INITIALIZER_UNLOCKED;
volatile amr_ir::PulseCounter leftPulses, rightPulses;
amr_ir::LocalController controller(LOCAL_COMMAND_TIMEOUT_US, DIRECTION_INTERLOCK_US,160,20);
amr_ir::Observation latestObservation;
amr_ir::Sensors currentSensors, latestSensors;
bool observationReady = false, pwmReady = false, startupReady = false;
bool yawResetRequested = false;
bool imuInitialized = false, batteryInitialized = false;
Adafruit_INA219 ina219(INA219_ADDRESS_VALUE);
WiFiClientSecure tls;
PubSubClient mqtt(tls);
WiFiClientSecure visionTls;
PubSubClient visionMqtt(visionTls);
char bootId[24];
static const char TOPIC[] = "robot/amr01/commissioning";
static_assert(LOCAL_COMMAND_TIMEOUT_US == 0 || LOCAL_COMMAND_TIMEOUT_US > DIRECTION_INTERLOCK_US,"Enabled timeout must exceed interlock");
static_assert(LEFT_PULSES_PER_REV > 0 && RIGHT_PULSES_PER_REV > 0,"PPR must be positive");
static_assert(DISCHARGE_CURRENT_SIGN == 1.0 || DISCHARGE_CURRENT_SIGN == -1.0,"Current sign must be +1 or -1");

void ARDUINO_ISR_ATTR countLeftPulse() {
  const uint32_t now = micros();
  portENTER_CRITICAL_ISR(&pulseMux); leftPulses.edge(now, ENCODER_DEBOUNCE_US); portEXIT_CRITICAL_ISR(&pulseMux);
}
void ARDUINO_ISR_ATTR countRightPulse() {
  const uint32_t now = micros();
  portENTER_CRITICAL_ISR(&pulseMux); rightPulses.edge(now, ENCODER_DEBOUNCE_US); portEXIT_CRITICAL_ISR(&pulseMux);
}

// Arduino Cloud and desktop installations may use different ESP32 core APIs.
// Core 2 uses explicit LEDC channels; core 3 assigns channels to pins.
bool attachMotorPwm() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  const bool left = ledcAttach(PWMA,PWM_FREQ,PWM_RESOLUTION);
  const bool right = ledcAttach(PWMB,PWM_FREQ,PWM_RESOLUTION);
  return left && right;
#else
  const double left = ledcSetup(0,PWM_FREQ,PWM_RESOLUTION);
  const double right = ledcSetup(1,PWM_FREQ,PWM_RESOLUTION);
  if (!(left > 0) || !(right > 0)) return false;
  ledcAttachPin(PWMA,0);
  ledcAttachPin(PWMB,1);
  return true;
#endif
}
bool writeMotorPwm(int pin, uint32_t duty) {
  if ((pin != PWMA && pin != PWMB) || duty > 255) return false;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  return ledcWrite(pin,duty);
#else
  // This older API has no success return. Do not report this as device execution.
  ledcWrite(pin == PWMA ? 0 : 1,duty);
  return true;
#endif
}

void applyWheelDrive(int left,int right) {
  static int oldLeft=999,oldRight=999;
  if(left==oldLeft && right==oldRight) return;
  digitalWrite(STBY,LOW);
  if(pwmReady) { writeMotorPwm(PWMA,0); writeMotorPwm(PWMB,0); }
  digitalWrite(AIN1,left>0?HIGH:LOW); digitalWrite(AIN2,left<0?HIGH:LOW);
  digitalWrite(BIN1,right>0?HIGH:LOW); digitalWrite(BIN2,right<0?HIGH:LOW);
  bool ok=pwmReady;
  if(ok) ok=writeMotorPwm(PWMA,std::abs(left)) && writeMotorPwm(PWMB,std::abs(right));
  if(ok && (left||right)) digitalWrite(STBY,HIGH);
  if(!ok) { pwmReady=false; controller.stop(); left=right=0; }
  portENTER_CRITICAL(&visionMux); appliedLeft=left; appliedRight=right; portEXIT_CRITICAL(&visionMux);
  portENTER_CRITICAL(&pulseMux);
  leftPulses.directionSign=(left>0)-(left<0);
  rightPulses.directionSign=(right>0)-(right<0);
  portEXIT_CRITICAL(&pulseMux);
  oldLeft=left; oldRight=right;
}
void applyDrive(const amr_ir::DriveOutput& d) {
  int l=0,r=0;
  if(d.motion!=Motion::stopped) {
    l=(d.motion==Motion::forward||d.motion==Motion::right)?d.duty:-d.duty;
    r=(d.motion==Motion::forward||d.motion==Motion::left)?d.duty:-d.duty;
  }
  applyWheelDrive(l,r);
}
uint64_t utcMillis() { struct timeval tv; gettimeofday(&tv,nullptr); return uint64_t(tv.tv_sec)*1000+tv.tv_usec/1000; }
bool visionConfigured() {
  if(!AMR_VISION_DRIVE_ENABLED || std::strlen(AMR_VISION_DRIVE_KEY)!=64 || !*AMR_VISION_MQTT_USERNAME || !*AMR_VISION_MQTT_PASSWORD) return false;
  for(const char* p=AMR_VISION_DRIVE_KEY;*p;++p) if(!((*p>='0'&&*p<='9')||(*p>='a'&&*p<='f'))) return false;
  return true;
}
void randomIdentity(char* s) { for(int i=0;i<4;++i) snprintf(s+i*8,9,"%08lx",static_cast<unsigned long>(esp_random())); }
bool signature(const char* body,char* output) {
  unsigned char mac[32];
  const auto* info=mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if(!info || mbedtls_md_hmac(info,reinterpret_cast<const unsigned char*>(AMR_VISION_DRIVE_KEY),64,reinterpret_cast<const unsigned char*>(body),std::strlen(body),mac)!=0) return false;
  for(int i=0;i<32;++i) snprintf(output+2*i,3,"%02x",mac[i]);
  return true;
}
void visionMessage(char* topic,byte* payload,unsigned int length) {
  if(!visionConfigured() || std::strcmp(topic,DRIVE_TOPIC) || length>450 || length<100) return;
  char body[451]; std::memcpy(body,payload,length); body[length]=0;
  if(std::strlen(body)!=length) return;
  char* last=std::strrchr(body,'|'); if(!last||std::strlen(last+1)!=64) return;
  *last=0; char expected[65]; if(!signature(body,expected)) return;
  unsigned diff=0; for(int i=0;i<64;++i) diff|=unsigned(expected[i]^last[1+i]);
  if(diff) return;
  amr_vision::Command command; if(!amr_vision::parse(body,command)) return;
  const uint64_t utc=utcMillis(),mono=esp_timer_get_time();
  portENTER_CRITICAL(&visionMux);
  visionGuard.accept(command,utc,mono,visionReady&&visionLinked,AMR_VISION_MAX_PWM);
  portEXIT_CRITICAL(&visionMux);
}
void hardwareHeartbeat() {
  if(!visionConfigured()) return;
  static uint32_t sequence=0; static uint32_t last=0;
  if(uint32_t(millis()-last)<150) return; last=millis();
  amr_vision::Guard g; bool ready; int l,r;
  portENTER_CRITICAL(&visionMux); g=visionGuard; ready=visionReady&&visionLinked; l=appliedLeft; r=appliedRight; portEXIT_CRITICAL(&visionMux);
  amr_ir::Sensors sensors;
  portENTER_CRITICAL(&sensorMux); sensors=currentSensors; portEXIT_CRITICAL(&sensorMux);
  char body[400],packet[470],mac[65];
  snprintf(body,sizeof body,"H1|%s|%s|%lu|%s|%lu|%s|%d|%d|%d|%d|%llu",g.boot,g.epoch,static_cast<unsigned long>(sequence++),*g.route?g.route:"00000000000000000000000000000000",static_cast<unsigned long>(g.seq),g.state,l,r,sensors.batteryValid?int(sensors.packV*1000):0,ready?1:0,static_cast<unsigned long long>(utcMillis()));
  if(signature(body,mac)) { snprintf(packet,sizeof packet,"%s|%s",body,mac); visionMqtt.publish(HARDWARE_TOPIC,packet,false); }
}


// Only setup() and the sensor task use Wire/INA219; network and motor loops do not.
bool readRegisters(uint8_t address, uint8_t reg, uint8_t* data, uint8_t count) {
  Wire.beginTransmission(address); Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(address,count) != count) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (uint8_t i = 0; i < count; ++i) data[i] = uint8_t(Wire.read());
  return true;
}
bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDRESS); Wire.write(reg); Wire.write(value);
  return Wire.endTransmission() == 0;
}
int16_t signedWord(const uint8_t* bytes, uint8_t index) {
  return int16_t((uint16_t(bytes[index]) << 8) | bytes[index+1]);
}
bool readImu(amr_ir::Sensors& s) {
  uint8_t bytes[14];
  if (!imuInitialized || !readRegisters(MPU_ADDRESS,0x3B,bytes,sizeof bytes)) return false;
  s.ax = signedWord(bytes,0)/16384.0; s.ay = signedWord(bytes,2)/16384.0;
  s.az = signedWord(bytes,4)/16384.0;
  s.gx = signedWord(bytes,8)/131.0; s.gy = signedWord(bytes,10)/131.0;
  s.gz = signedWord(bytes,12)/131.0;
  s.imuTimeS = esp_timer_get_time()/1000000.0;
  return true;
}
void initializeSensors() {
  Wire.begin(I2C_SDA_PIN,I2C_SCL_PIN); Wire.setClock(400000); Wire.setTimeOut(20);
  uint8_t identity = 0, gyroConfig = 255, accelConfig = 255;
  const bool identified = readRegisters(MPU_ADDRESS,0x75,&identity,1);
  currentSensors.whoAmI = identity;
  Serial.printf("IMU WHO_AM_I = 0x%02X (supported: MPU6050 0x68 / MPU6500 0x70)\n",identity);
  // Both supported chips share these basic +/-2g and +/-250 deg/s registers.
  if (identified && (identity == 0x68 || identity == 0x70) && writeRegister(0x6B,0x00)) {
    delay(100);
    imuInitialized = writeRegister(0x1B,0x00) && writeRegister(0x1C,0x00) &&
      readRegisters(MPU_ADDRESS,0x1B,&gyroConfig,1) &&
      readRegisters(MPU_ADDRESS,0x1C,&accelConfig,1) && gyroConfig == 0 && accelConfig == 0;
  }
  batteryInitialized = ina219.begin(&Wire);
  if (batteryInitialized) {
    ina219.setCalibration_32V_2A();  // Adafruit standard 0.1-ohm shunt profile.
    batteryInitialized = ina219.success();
  }
  Serial.println(batteryInitialized ? "INA219 initialized (standard 0.1-ohm shunt profile)" : "INA219 not found/configuration failed");
  if (!imuInitialized) { Serial.println("IMU identity/configuration failed. Motor control stays disabled."); return; }
  Serial.println("Keep robot STATIONARY. Collecting gyro Z bias for about 3 seconds...");
  uint64_t leftBefore, rightBefore;
  portENTER_CRITICAL(&pulseMux); leftBefore = leftPulses.total; rightBefore = rightPulses.total; portEXIT_CRITICAL(&pulseMux);
  double sum = 0; int valid = 0;
  for (int i = 0; i < 1500; ++i) {
    amr_ir::Sensors reading;
    if (readImu(reading)) { sum += reading.gz; ++valid; }
    delay(2);
  }
  bool wheelsUnchanged;
  portENTER_CRITICAL(&pulseMux); wheelsUnchanged = leftBefore == leftPulses.total && rightBefore == rightPulses.total; portEXIT_CRITICAL(&pulseMux);
  currentSensors.biasAvailable = valid >= 1350 && wheelsUnchanged;
  currentSensors.biasDps = currentSensors.biasAvailable ? sum/valid : 0;
  Serial.println(currentSensors.biasAvailable ? "Gyro bias collected. Stationary setup is an operator assumption, not independent validation." : "Bias collection failed or wheel pulses changed. Keep still and reset before driving.");
  startupReady = imuInitialized && batteryInitialized && currentSensors.biasAvailable;
}

void sensorTask(void*) {
  amr_ir::Sensors s = currentSensors;
  amr_ir::ChargeTracker charge(BATTERY_CAPACITY_MAH,INITIAL_SOC_PERCENT,BATTERY_SOC_INITIALIZATION_CONFIRMED);
  amr_ir::YawTracker yaw;
  uint64_t lastBattery = 0;
  for (;;) {
    bool reset;
    portENTER_CRITICAL(&sensorMux); reset = yawResetRequested; yawResetRequested = false; portEXIT_CRITICAL(&sensorMux);
    if (reset) yaw.reset();
    s.imuValid = readImu(s);
    if (s.imuValid && s.biasAvailable) yaw.accept(s.imuTimeS,s.gz-s.biasDps);
    else yaw.invalidate();
    s.yawValid = s.imuValid && s.biasAvailable && yaw.valid(); s.yawDeg = yaw.angleDegrees();
    const uint64_t now = uint64_t(esp_timer_get_time());
    if (now-lastBattery >= 200000) {
      lastBattery = now;
      bool valid = batteryInitialized;
      uint8_t status[2] = {0,0};
      if (valid) {
        s.busV = ina219.getBusVoltage_V(); valid = ina219.success();
        s.shuntMv = ina219.getShuntVoltage_mV(); valid = ina219.success() && valid;
        s.currentA = ina219.getCurrent_mA()/1000.0*DISCHARGE_CURRENT_SIGN;
        valid = ina219.success() && valid;
        valid = readRegisters(INA219_ADDRESS_VALUE,0x02,status,2) && valid;
      }
      s.packV = s.busV+s.shuntMv/1000.0;
      s.powerW = s.packV*s.currentA;
      s.batteryTimeS = esp_timer_get_time()/1000000.0;
      s.batteryValid = valid && !(status[1] & 1) && std::isfinite(s.packV) &&
        s.packV > 0 && s.packV <= 32.0 && std::isfinite(s.currentA) && std::isfinite(s.powerW);
      if (s.batteryValid) charge.accept(s.batteryTimeS,s.currentA); else charge.invalidate();
      s.batteryContinuous = charge.continuous(); s.chargeUsedMah = charge.usedMah();
      s.socValid = s.batteryValid && charge.socValid();
      if (s.socValid) s.socPercent = charge.percent();
    }
    portENTER_CRITICAL(&sensorMux); currentSensors = s; portEXIT_CRITICAL(&sensorMux);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// TLS/MQTT waits never operate the motor GPIOs or the I2C bus.
void networkTask(void*) {
  if (!*WIFI_SSID || strcmp(WIFI_SSID, "YOUR_WIFI_SSID") == 0 ||
      strcmp(WIFI_PASSWORD, "YOUR_WIFI_PASSWORD") == 0 ||
      strcmp(MQTT_PASSWORD, "YOUR_NEW_EMQX_PUBLISHER_PASSWORD") == 0) {
    Serial.println("Enter your Wi-Fi name/password in the settings block at the top, then upload again.");
    vTaskDelete(nullptr); return;
  }
  Serial.println("Connecting to Wi-Fi. Keep the 2.4 GHz hotspot and its internet connection on.");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  tls.setCACert(BROKER_ROOT_CA);
  tls.setHandshakeTimeout(5);
  mqtt.setServer(MQTT_HOST, 8883);
  mqtt.setSocketTimeout(2);
  if (!mqtt.setBufferSize(3072)) { vTaskDelete(nullptr); return; }
  uint32_t lastAttempt = millis() - 5000, lastWifiAttempt = millis();
  uint32_t sentSequence = 0;
  bool sentAny = false, wifiWasConnected = false;
  uint32_t lastClockNotice = 0;
  for (;;) {
    const uint32_t now = millis();
    const bool wifiConnected = WiFi.status() == WL_CONNECTED;
    if (wifiConnected && !wifiWasConnected) Serial.println("Wi-Fi connected. Waiting for internet clock and EMQX.");
    if (!wifiConnected && wifiWasConnected) Serial.println("Wi-Fi disconnected. Reconnecting; local controls remain independent.");
    wifiWasConnected = wifiConnected;
    if (!wifiConnected) {
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
        amr_ir::Sensors sensors;
        bool ready;
        portENTER_CRITICAL(&observationMux);
        sample = latestObservation;
        sensors = latestSensors;
        ready = observationReady;
        portEXIT_CRITICAL(&observationMux);
        const double age = esp_timer_get_time() / 1000000.0 - sample.sampleTimeS;
        if (ready && age >= 0 && age <= 2.0 && (!sentAny || sample.seq != sentSequence)) {
          char payload[2560];
          const int length = amr_ir::encodeMultisensor(payload, sizeof payload, bootId, sample, sensors,
              PULSE_CALIBRATION_CONFIRMED, LEFT_PULSES_PER_REV, RIGHT_PULSES_PER_REV);
          if (length > 0 && mqtt.publish(TOPIC, payload, false)) {
            sentSequence = sample.seq;
            sentAny = true;
          }
        }
      }
    }
    if (wifiConnected && time(nullptr) < 1700000000 && uint32_t(now-lastClockNotice) >= 10000) {
      lastClockNotice = now;
      Serial.println("Waiting for internet time. TLS remains protected; check hotspot internet access.");
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void visionNetworkTask(void*) {
  visionTls.setCACert(BROKER_ROOT_CA); visionTls.setHandshakeTimeout(5);
  visionMqtt.setServer(MQTT_HOST,8883); visionMqtt.setSocketTimeout(2);
  visionMqtt.setCallback(visionMessage); visionMqtt.setBufferSize(1024);
  uint32_t attempt=millis()-5000;
  for(;;) {
    const bool wifi=WiFi.status()==WL_CONNECTED;
    if(!wifi || !visionMqtt.connected()) {
      portENTER_CRITICAL(&visionMux); visionLinked=false; visionGuard.stop("unavailable"); portEXIT_CRITICAL(&visionMux);
    }
    if(wifi && time(nullptr)>=1700000000) {
      if(!visionMqtt.connected() && uint32_t(millis()-attempt)>=5000) {
        attempt=millis(); char id[64]; snprintf(id,sizeof id,"amr01-vision-%s",bootId);
        if(visionMqtt.connect(id,AMR_VISION_MQTT_USERNAME,AMR_VISION_MQTT_PASSWORD)) {
          char b[33],e[33]; randomIdentity(b); randomIdentity(e);
          portENTER_CRITICAL(&visionMux); visionGuard.connection(b,e); visionLinked=false; portEXIT_CRITICAL(&visionMux);
          const bool subscribed=visionMqtt.subscribe(DRIVE_TOPIC,0);
          portENTER_CRITICAL(&visionMux); visionLinked=subscribed; portEXIT_CRITICAL(&visionMux);
        }
      }
      if(visionMqtt.connected()) { visionMqtt.loop(); hardwareHeartbeat(); }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void setup() {
  pinMode(STBY,OUTPUT); digitalWrite(STBY,LOW);
  for (int pin : {AIN1,AIN2,BIN1,BIN2}) { pinMode(pin,OUTPUT); digitalWrite(pin,LOW); }
  Serial.begin(115200);
  pwmReady = attachMotorPwm();
  applyDrive({Motion::stopped,0});
  pinMode(LEFT_IR_PIN,INPUT_PULLUP); pinMode(RIGHT_IR_PIN,INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(LEFT_IR_PIN),countLeftPulse,FALLING);
  attachInterrupt(digitalPinToInterrupt(RIGHT_IR_PIN),countRightPulse,FALLING);
  initializeSensors();
  snprintf(bootId,sizeof bootId,"%08lx%08lx",static_cast<unsigned long>(esp_random()),static_cast<unsigned long>(esp_random()));
  Serial.println("AMR-01 multisensor Wi-Fi telemetry: F B L R S + - Z, Serial 115200");
  Serial.println("Continuous local drive enabled: F/B/L/R continue until S. + / - change PWM by 20 (start 160, range 0-255). Authenticated Wi-Fi control uses one short expiring command per approval.");
  Serial.println("Encoder signed direction is inferred from motor commands; RPM needs confirmed PPR.");
  if (!pwmReady) Serial.println("PWM setup failed: motors remain disabled");
  if (xTaskCreatePinnedToCore(sensorTask,"amr01-sensors",6144,nullptr,2,nullptr,0) != pdPASS) {
    startupReady = false; Serial.println("Sensor task unavailable: motors remain disabled");
  }
  if (xTaskCreatePinnedToCore(networkTask,"amr01-network",16384,nullptr,1,nullptr,0) != pdPASS)
    Serial.println("Network task unavailable. Local readings/control remain independent.");
  if(visionConfigured() && xTaskCreatePinnedToCore(visionNetworkTask,"amr01-manual",12288,nullptr,1,nullptr,0)!=pdPASS)
    Serial.println("Remote receiver unavailable. Local Serial remains independent.");
}

void loop() {
  amr_ir::Sensors sensors;
  portENTER_CRITICAL(&sensorMux); sensors = currentSensors; portEXIT_CRITICAL(&sensorMux);
  // Read the clock after the snapshot so a concurrent sensor update cannot
  // appear to come from the future and spuriously stop local driving.
  const uint64_t now = uint64_t(esp_timer_get_time());
  const double timeS = now/1000000.0;
  const bool sensorsFresh = amr_ir::finiteImu(sensors) && amr_ir::finiteBattery(sensors) &&
      amr_ir::freshAt(timeS,sensors.imuTimeS,.1) && amr_ir::freshAt(timeS,sensors.batteryTimeS,.5);
  // Manual bench-test drive is independent of IMU/INA219 telemetry validity.
  // PWM setup must succeed; operator must supervise and use S to stop.
  const bool canDrive = pwmReady;
  if (!pwmReady) controller.stop();
  controller.expire(now);
  bool remoteActive;
  portENTER_CRITICAL(&visionMux);
  visionReady=pwmReady && startupReady && sensorsFresh && sensors.packV>=AMR_VISION_MIN_PACK_V && visionConfigured() && (controller.requested()==Motion::stopped || visionGuard.active);
  visionGuard.tick(now,visionReady&&visionLinked); remoteActive=visionGuard.active;
  portEXIT_CRITICAL(&visionMux);
  if(remoteActive) controller.stop();
  for (int n = 0; n < 32 && Serial.available() > 0; ++n) {
    const char command = char(Serial.read());
    if (command == 'Z' || command == 'z') {
      portENTER_CRITICAL(&sensorMux); yawResetRequested = true; portEXIT_CRITICAL(&sensorMux);
      Serial.println("Yaw reset requested (local relative gyro estimate)");
    } else if (command == 'S' || command == 's') {
      controller.stop();
      portENTER_CRITICAL(&visionMux); visionGuard.stop("local_stop"); remoteActive=false; portEXIT_CRITICAL(&visionMux);
      Serial.println("STOP");
    } else if (!remoteActive && canDrive && controller.command(command,now)) {
      Serial.printf("Local request: %s; configured PWM: %u\n",amr_ir::motionName(controller.requested()),unsigned(controller.configuredDuty()));
    } else if (!canDrive && strchr("FfBbLlRr+-",command)) {
      Serial.println("Drive unavailable: PWM setup failed. Check TB6612 wiring and ESP32 PWM.");
    }
  }
  amr_ir::DriveOutput drive = controller.output(uint64_t(esp_timer_get_time()));
  int remoteLeft=0,remoteRight=0;
  portENTER_CRITICAL(&visionMux); remoteActive=visionGuard.active; remoteLeft=visionGuard.left; remoteRight=visionGuard.right; portEXIT_CRITICAL(&visionMux);
  if(remoteActive) {
    controller.stop(); applyWheelDrive(remoteLeft,remoteRight);
    drive.motion=(!remoteLeft&&!remoteRight)?Motion::stopped:(remoteLeft>0?(remoteRight>0?Motion::forward:Motion::right):(remoteRight>0?Motion::left:Motion::backward));
    drive.duty=uint8_t(std::max(std::abs(remoteLeft),std::abs(remoteRight)));
  } else applyDrive(drive);
  if (!pwmReady) drive = {Motion::stopped,0};
  static uint64_t previousTime = 0, previousLeft = 0, previousRight = 0;
  static int64_t previousLeftSigned = 0, previousRightSigned = 0;
  static uint32_t sequence = 0;
  if (now-previousTime >= TELEMETRY_INTERVAL_US) {
    amr_ir::Observation sample;
    portENTER_CRITICAL(&pulseMux);
    sample.leftTotal = leftPulses.total; sample.rightTotal = rightPulses.total;
    sample.leftSignedTotal = leftPulses.signedTotal; sample.rightSignedTotal = rightPulses.signedTotal;
    portEXIT_CRITICAL(&pulseMux);
    sample.leftDelta = sample.leftTotal-previousLeft; sample.rightDelta = sample.rightTotal-previousRight;
    sample.leftSignedDelta = sample.leftSignedTotal-previousLeftSigned;
    sample.rightSignedDelta = sample.rightSignedTotal-previousRightSigned;
    sample.sampleTimeS = now/1000000.0; sample.intervalS = (now-previousTime)/1000000.0;
    sample.requested = controller.requested(); sample.output = drive.motion; sample.duty = drive.duty; sample.seq = sequence++;
    previousTime = now; previousLeft = sample.leftTotal; previousRight = sample.rightTotal;
    previousLeftSigned = sample.leftSignedTotal; previousRightSigned = sample.rightSignedTotal;
    portENTER_CRITICAL(&observationMux); latestObservation = sample; latestSensors = sensors; observationReady = true; portEXIT_CRITICAL(&observationMux);
    Serial.printf("Encoder signed counts L=%lld R=%lld | absolute pulses L=%llu R=%llu\n",
      static_cast<long long>(sample.leftSignedTotal), static_cast<long long>(sample.rightSignedTotal),
      static_cast<unsigned long long>(sample.leftTotal), static_cast<unsigned long long>(sample.rightTotal));
    if (sensorsFresh) {
      Serial.printf("IMU: accel g [%.3f %.3f %.3f], gyro deg/s [%.3f %.3f %.3f]\n",sensors.ax,sensors.ay,sensors.az,sensors.gx,sensors.gy,sensors.gz);
      Serial.printf("Battery input %.3f V, discharge-positive %.4f A, %.3f W\n",sensors.packV,sensors.currentA,sensors.powerW);
    } else Serial.println("Sensor reading unavailable/stale. MQTT marks invalid channels as null.");
    if (sensors.yawValid) Serial.printf("Relative yaw %.2f deg\n",sensors.yawDeg);
    if (sensors.socValid) Serial.printf("Estimated battery level %.2f %%\n",sensors.socPercent);
    else Serial.println("Battery SOC unavailable: initial charge/capacity/polarity unconfirmed or a measurement gap occurred.");
    if (PULSE_CALIBRATION_CONFIRMED) Serial.printf("RPM magnitude L=%.2f R=%.2f\n",sample.leftDelta*60.0/(sample.intervalS*LEFT_PULSES_PER_REV),sample.rightDelta*60.0/(sample.intervalS*RIGHT_PULSES_PER_REV));
  }
  delay(2);
}