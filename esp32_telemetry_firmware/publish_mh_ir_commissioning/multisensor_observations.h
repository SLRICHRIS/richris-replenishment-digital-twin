#pragma once
#include "mh_ir_controller.h"

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
