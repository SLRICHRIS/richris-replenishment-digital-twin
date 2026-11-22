#pragma once
/* AMR-01 local Wi-Fi dashboard and protected H1 route receiver
 * Open this sketch with the adjacent headers. Serial Monitor runs at 115200.
 * Keep the board stationary during the gyro startup measurement.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include "amr_mqtt_transport.h"
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
#include <algorithm>

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
bool readRegisters(uint8_t address, uint8_t reg, uint8_t* data, uint8_t count);
bool writeRegister(uint8_t reg, uint8_t value);
int16_t signedWord(const uint8_t* bytes, uint8_t index);
bool readImu(amr_ir::Sensors& s);
void initializeSensors();
void sensorTask(void*);
void networkTask(void*);
void setup();
void loop();

#include "private_amr_settings.h"

// User's current wiring: do not substitute the older quadrature sketch's pins.
static constexpr int PWMA = 25, AIN1 = 26, AIN2 = 27;
static constexpr int PWMB = 14, BIN1 = 32, BIN2 = 33, STBY = 13;
static constexpr int LEFT_IR_PIN = 18, RIGHT_IR_PIN = 19;
// One FALLING edge = one encoder pulse. Tune only after measuring the sensor's
// maximum pulse frequency; 2000 us rejects edges closer than 2 ms (500 Hz).
static constexpr uint32_t ENCODER_DEBOUNCE_US = 2000;
static constexpr uint32_t PWM_FREQ = 1000;
static constexpr uint8_t PWM_RESOLUTION = 8;
// Wireless dead-man timeout: browser refreshes held commands every 200 ms.
// If Wi-Fi/browser commands stop arriving, the robot stops automatically.
static constexpr uint64_t LOCAL_COMMAND_TIMEOUT_US = 700000;
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
  void setDuty(uint8_t value) { duty_ = value; }
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
      "\"firmware_revision\":\"AMR01-Local-Routes-r1\",\"robot_id\":\"amr01\",\"boot_id\":\"%s\",\"seq\":%lu,"
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
 * Local HTTP carries authenticated route commands and H1 feedback; MQTT publishes telemetry only.
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
amr_mqtt::Socket tls;
PubSubClient mqtt(tls);
WebServer webServer(80);
bool webServerStarted = false;
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

#include "amr_route_control.h"

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

// ===== WIRELESS WEB DASHBOARD =====
// Served directly by the ESP32 at http://<ESP32-IP>/ on the same Wi-Fi network.
static const char DASHBOARD_HTML[] PROGMEM = R"HTML(
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>AMR-01 Control</title>
<style>
:root{color-scheme:dark;--bg:#0b1220;--panel:#121e30;--line:#26364d;--text:#edf4ff;--muted:#9fb0c7;--blue:#3182f6;--red:#e34c5b;--green:#21b887}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px system-ui,Segoe UI,Arial,sans-serif;padding:18px;max-width:900px;margin:auto}h1{font-size:25px;margin:0}header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px}.sub{color:var(--muted);font-size:13px}.pill{border:1px solid var(--line);padding:7px 11px;border-radius:20px;font-size:12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:15px;margin-bottom:13px}.panel h2{font-size:15px;margin:0 0 12px;color:#c8d8ed}.drive{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;max-width:360px;margin:0 auto}.drive button{height:70px;font-size:24px}.btn{border:0;border-radius:13px;background:#263a55;color:white;font-weight:700;touch-action:none;user-select:none}.btn:active{filter:brightness(1.3);transform:scale(.98)}.primary{background:var(--blue)}.stop{background:var(--red);width:100%;height:58px;font-size:19px;margin-top:10px}.metric{background:#0d1727;border-radius:11px;padding:11px}.metric span{display:block;color:var(--muted);font-size:12px}.metric strong{font-size:20px;display:block;margin-top:4px;overflow-wrap:anywhere}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.wide{grid-column:1/-1}.range{width:100%;accent-color:var(--blue)}.row{display:flex;justify-content:space-between;align-items:center;gap:10px}.small{font-size:12px;color:var(--muted)}.state{color:var(--green)}@media(min-width:650px){.metrics{grid-template-columns:repeat(4,minmax(0,1fr))}}
</style></head><body>
<header><div><h1>AMR-01</h1><div class="sub">Wireless robot control & live telemetry</div></div><div id="conn" class="pill">Connecting…</div></header>
<section class="panel"><h2>Drive control</h2><div class="drive">
<div></div><button class="btn primary" data-cmd="F">▲<div class="small">Forward</div></button><div></div>
<button class="btn primary" data-cmd="R">◀<div class="small">Left</div></button><button class="btn" id="centerStop">■<div class="small">Stop</div></button><button class="btn primary" data-cmd="L">▶<div class="small">Right</div></button>
<div></div><button class="btn primary" data-cmd="B">▼<div class="small">Backward</div></button><div></div></div>
<button class="btn stop" id="stop">EMERGENCY STOP</button><p class="small">Press and hold a direction. Releasing the button stops the robot. If the browser connection is lost, a 0.7-second command timeout stops motion.</p></section>
<section class="panel"><div class="row"><h2>Motor speed</h2><strong id="speedText">160 / 255</strong></div><input id="speed" class="range" type="range" min="0" max="255" value="160"><div class="row small"><span>Slow</span><span>Fast</span></div></section>
<section class="panel"><div class="row"><h2>Live sensor values</h2><span id="updated" class="small">Waiting for data</span></div><div class="metrics">
<div class="metric"><span>Battery voltage</span><strong id="voltage">—</strong></div><div class="metric"><span>Current</span><strong id="current">—</strong></div><div class="metric"><span>Power</span><strong id="power">—</strong></div><div class="metric"><span>Battery estimate</span><strong id="soc">—</strong></div>
<div class="metric"><span>Gyro Z</span><strong id="gyro">—</strong></div><div class="metric"><span>Relative yaw</span><strong id="yaw">—</strong></div><div class="metric"><span>Left encoder pulses</span><strong id="left">—</strong></div><div class="metric"><span>Right encoder pulses</span><strong id="right">—</strong></div>
<div class="metric"><span>Requested motion</span><strong id="motion">stopped</strong></div><div class="metric"><span>PWM duty</span><strong id="pwm">—</strong></div><div class="metric"><span>IMU</span><strong id="imu">—</strong></div><div class="metric"><span>INA219</span><strong id="ina">—</strong></div></div></section>
<section class="panel"><h2>Connection</h2><div class="small" id="ip">ESP32 address: —</div><div class="small">MQTT telemetry continues independently to the existing EMQX commissioning topic.</div></section>
<script>
const $=id=>document.getElementById(id);let active=null,keep=null;
async function send(c){try{await fetch('/cmd?c='+encodeURIComponent(c),{cache:'no-store'});}catch(e){$('conn').textContent='Connection lost';}}
function stop(){if(keep){clearInterval(keep);keep=null;}active=null;send('S');}
function start(c){if(active===c)return; if(keep)clearInterval(keep);active=c;send(c);keep=setInterval(()=>{if(active)send(active)},200);}
document.querySelectorAll('[data-cmd]').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();start(b.dataset.cmd)});['pointerup','pointercancel','pointerleave','lostpointercapture'].forEach(ev=>b.addEventListener(ev,e=>{if(active===b.dataset.cmd)stop()}));});
$('stop').addEventListener('click',stop);$('centerStop').addEventListener('click',stop);window.addEventListener('pointerup',()=>{if(active)stop()});window.addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
let speedTimer; $('speed').addEventListener('input',()=>{$('speedText').textContent=$('speed').value+' / 255';clearTimeout(speedTimer);speedTimer=setTimeout(()=>fetch('/speed?v='+$('speed').value).catch(()=>{}),120)});
const fmt=(v,u='',d=2)=>v===null||v===undefined?'—':Number(v).toFixed(d)+u;
async function refresh(){try{let r=await fetch('/status',{cache:'no-store'});if(!r.ok)throw Error();let d=await r.json();$('conn').textContent='Wi-Fi connected';$('conn').classList.add('state');$('ip').textContent='ESP32 address: '+d.ip;$('voltage').textContent=fmt(d.voltage,' V');$('current').textContent=fmt(d.current,' A',3);$('power').textContent=fmt(d.power,' W');$('soc').textContent=d.soc===null?'Not calibrated':fmt(d.soc,' %');$('gyro').textContent=fmt(d.gz,' °/s');$('yaw').textContent=fmt(d.yaw,' °');$('left').textContent=d.left;$('right').textContent=d.right;$('motion').textContent=d.motion;$('pwm').textContent=d.pwm+' / 255';$('imu').textContent=d.imu?'Available':'Unavailable';$('ina').textContent=d.ina?'Available':'Unavailable';$('updated').textContent='Updated '+new Date().toLocaleTimeString();if(document.activeElement!==$('speed')){$('speed').value=d.pwm;$('speedText').textContent=d.pwm+' / 255';}}catch(e){$('conn').textContent='Dashboard disconnected';$('conn').classList.remove('state');}}
setInterval(refresh,500);refresh();
window.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();start(({ArrowUp:'F',ArrowDown:'B',ArrowLeft:'L',ArrowRight:'R'})[e.key]);}else if(e.key===' '){e.preventDefault();stop();}});window.addEventListener('keyup',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))stop();});
</script></body></html>
)HTML";

void handleDashboardRoot() {
  webServer.send_P(200, "text/html", DASHBOARD_HTML);
}
void handleDashboardCommand() {
  if (!webServer.hasArg("c") || webServer.arg("c").length() != 1) {
    webServer.send(400, "application/json", "{\"ok\":false,\"error\":\"missing command\"}"); return;
  }
  const char c = webServer.arg("c")[0];
  if (c == 'Z' || c == 'z') {
    portENTER_CRITICAL(&sensorMux); yawResetRequested = true; portEXIT_CRITICAL(&sensorMux);
    webServer.send(200, "application/json", "{\"ok\":true}"); return;
  }
  if (!strchr("FfBbLlRrSs", c)) {
    webServer.send(400, "application/json", "{\"ok\":false,\"error\":\"unknown command\"}"); return;
  }
  if (!amr_route::localCommand(c)) {
    webServer.send(409, "application/json", "{\"ok\":false,\"error\":\"local drive unavailable or route active\"}"); return;
  }
  webServer.send(200, "application/json", "{\"ok\":true}");
}
void handleDashboardSpeed() {
  if (!webServer.hasArg("v")) { webServer.send(400, "text/plain", "missing speed"); return; }
  int value = webServer.arg("v").toInt();
  if (value < 0 || value > 255) { webServer.send(400, "text/plain", "speed must be 0..255"); return; }
  if (!amr_route::localSpeed(uint8_t(value))) {
    webServer.send(409, "application/json", "{\"ok\":false,\"error\":\"route active\"}"); return;
  }
  webServer.send(200, "application/json", "{\"ok\":true}");
}
void handleDashboardStatus() {
  amr_ir::Sensors sensors;
  amr_ir::Observation observation;
  portENTER_CRITICAL(&sensorMux); sensors = currentSensors; portEXIT_CRITICAL(&sensorMux);
  portENTER_CRITICAL(&observationMux); observation = latestObservation; portEXIT_CRITICAL(&observationMux);
  const auto motor = amr_route::snapshot();
  char json[768];
  const bool battery = amr_ir::finiteBattery(sensors);
  const bool imu = amr_ir::finiteImu(sensors);
  const int n = snprintf(json, sizeof(json),
    "{\"ip\":\"%s\",\"voltage\":%s,\"current\":%s,\"power\":%s,\"soc\":%s,\"gz\":%s,\"yaw\":%s,\"left\":%llu,\"right\":%llu,\"motion\":\"%s\",\"pwm\":%u,\"imu\":%s,\"ina\":%s}",
    WiFi.localIP().toString().c_str(),
    battery ? String(sensors.packV,3).c_str() : "null",
    battery ? String(sensors.currentA,4).c_str() : "null",
    battery ? String(sensors.powerW,3).c_str() : "null",
    sensors.socValid ? String(sensors.socPercent,2).c_str() : "null",
    imu ? String(sensors.gz,3).c_str() : "null",
    sensors.yawValid ? String(sensors.yawDeg,2).c_str() : "null",
    (unsigned long long)observation.leftTotal, (unsigned long long)observation.rightTotal,
    amr_ir::motionName(motor.request), motor.remote ? unsigned(std::max(std::abs(motor.left), std::abs(motor.right))) : unsigned(motor.selectedDuty),
    imu ? "true" : "false", battery ? "true" : "false");
  if (n > 0 && size_t(n) < sizeof(json)) webServer.send(200, "application/json", json);
  else webServer.send(500, "application/json", "{\"error\":\"status encoding failed\"}");
}
void configureDashboard() {
  webServer.on("/", HTTP_GET, handleDashboardRoot);
  webServer.on("/cmd", HTTP_GET, handleDashboardCommand);
  webServer.on("/speed", HTTP_GET, handleDashboardSpeed);
  webServer.on("/status", HTTP_GET, handleDashboardStatus);
  webServer.on("/api/route/command", HTTP_POST, amr_route::handleCommand);
  webServer.on("/api/route/hardware", HTTP_GET, amr_route::handleHardware);
  webServer.onNotFound([](){ webServer.send(404, "text/plain", "Not found"); });
}

// TLS/MQTT waits never operate the motor GPIOs or the I2C bus.
void networkTask(void*) {
  if (!*WIFI_SSID || strcmp(WIFI_SSID, "YOUR_WIFI_SSID") == 0 ||
      strcmp(WIFI_PASSWORD, "YOUR_WIFI_PASSWORD") == 0) {
    Serial.println("Enter your Wi-Fi name/password in the settings block at the top, then upload again.");
    vTaskDelete(nullptr); return;
  }
  const bool mqttConfigured = *MQTT_HOST && *MQTT_USERNAME &&
      strcmp(MQTT_PASSWORD, "YOUR_NEW_EMQX_PUBLISHER_PASSWORD") != 0;
  Serial.println("Connecting to Wi-Fi. Keep the 2.4 GHz hotspot and its internet connection on.");
  WiFi.mode(WIFI_STA);
  // Route feedback needs prompt reception. Modem sleep can defer packets to
  // the hotspot's DTIM interval; keep the radio awake instead of extending
  // the signed command leases or accepting stale controller feedback.
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  // Signed LAN leases need UTC even when telemetry credentials/broker are absent.
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  if (mqttConfigured) {
    tls.setCACert(BROKER_ROOT_CA);
    tls.setHandshakeTimeout(5);
    mqtt.setServer(MQTT_HOST, 8883);
    mqtt.setSocketTimeout(2);
    if (!mqtt.setBufferSize(3072)) Serial.println("Telemetry will stream packets using the smaller MQTT buffer.");
  } else {
    Serial.println("MQTT credentials not configured: browser dashboard will run, MQTT publishing is paused.");
  }
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
    } else if (mqttConfigured && time(nullptr) >= 1700000000) {
      if (!mqtt.connected() && uint32_t(now - lastAttempt) >= 5000) {
        if (mqtt.getBufferSize() >= 256 || mqtt.setBufferSize(256)) {
          char clientId[64];
          snprintf(clientId, sizeof clientId, "amr01-ir-%s", bootId);
          amr_route::connectTelemetry(clientId, lastAttempt);
        } else {
          lastAttempt = now;
          Serial.println("Telemetry publisher waiting for its MQTT header buffer. Retrying.");
        }
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
          if (length <= 0) {
            static uint32_t lastNotice = millis()-5000;
            if (uint32_t(now-lastNotice) >= 5000) {
              lastNotice = now;
              Serial.println("Telemetry could not encode this sensor sample.");
            }
          } else if (amr_route::publishTelemetry(payload, size_t(length))) {
            if (!sentAny) Serial.println("First telemetry packet written to EMQX.");
            sentSequence = sample.seq;
            sentAny = true;
          } else {
            lastAttempt = millis();
            Serial.println("Telemetry packet write interrupted. Reconnecting.");
          }
        }
      }
    }
    if (wifiConnected && mqttConfigured && time(nullptr) < 1700000000 && uint32_t(now-lastClockNotice) >= 10000) {
      lastClockNotice = now;
      Serial.println("Waiting for internet time. TLS remains protected; check hotspot internet access.");
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void setup() {
  pinMode(STBY,OUTPUT); digitalWrite(STBY,LOW);
  for (int pin : {AIN1,AIN2,BIN1,BIN2}) { pinMode(pin,OUTPUT); digitalWrite(pin,LOW); }
  Serial.begin(115200);
  pwmReady = attachMotorPwm();
  pinMode(LEFT_IR_PIN,INPUT_PULLUP); pinMode(RIGHT_IR_PIN,INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(LEFT_IR_PIN),countLeftPulse,FALLING);
  attachInterrupt(digitalPinToInterrupt(RIGHT_IR_PIN),countRightPulse,FALLING);
  initializeSensors();
  configureDashboard();
  snprintf(bootId,sizeof bootId,"%08lx%08lx",static_cast<unsigned long>(esp_random()),static_cast<unsigned long>(esp_random()));
  Serial.println("AMR-01 Local Routes r1. HTTP manual/route controls are independent of MQTT. Serial 115200.");
  Serial.println("F/B: both wheels. L: right wheel forward only. R: left wheel forward only. Dashboard: open the printed ESP32 IP address.");
  Serial.println("Encoder signed direction is inferred from motor commands; RPM needs confirmed PPR.");
  if (!pwmReady) Serial.println("PWM setup failed: motors remain disabled");
  if (xTaskCreatePinnedToCore(sensorTask,"amr01-sensors",6144,nullptr,2,nullptr,0) != pdPASS) {
    startupReady = false; Serial.println("Sensor task unavailable: motors remain disabled");
  }
  amr_route::setupReceiver();
  if (xTaskCreatePinnedToCore(networkTask,"amr01-network",16384,nullptr,1,nullptr,0) != pdPASS)
    Serial.println("Network task unavailable. Local readings/control remain independent.");
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
  if (!webServerStarted && WiFi.status() == WL_CONNECTED) {
    webServer.begin();
    webServerStarted = true;
    Serial.printf("AMR-01 dashboard: http://%s/\n", WiFi.localIP().toString().c_str());
  }
  if (webServerStarted) webServer.handleClient();
  for (int n = 0; n < 32 && Serial.available() > 0; ++n) {
    const char command = char(Serial.read());
    if (command == 'Z' || command == 'z') {
      portENTER_CRITICAL(&sensorMux); yawResetRequested = true; portEXIT_CRITICAL(&sensorMux);
      Serial.println("Yaw reset requested (local relative gyro estimate)");
    } else if (strchr("FfBbLlRrSs+-", command)) {
      if (amr_route::localCommand(command)) {
        if (command == 'S' || command == 's') Serial.println("STOP");
        else Serial.printf("Local command accepted; selected PWM %u\n", unsigned(amr_route::snapshot().selectedDuty));
      } else Serial.println("Local drive unavailable or route active.");
    } else if (command == '?') {
      amr_route::printStatus();
    }
  }
  static uint32_t lastReport = millis();
  if (uint32_t(millis()-lastReport) >= 10000) {
    lastReport = millis();
    amr_route::printStatus();
  }
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
    const auto motor = amr_route::snapshot();
    sample.requested = motor.request;
    sample.output = amr_route::asMotion(motor.left, motor.right);
    sample.duty = uint8_t(std::max(std::abs(motor.left), std::abs(motor.right)));
    sample.seq = sequence++;
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
