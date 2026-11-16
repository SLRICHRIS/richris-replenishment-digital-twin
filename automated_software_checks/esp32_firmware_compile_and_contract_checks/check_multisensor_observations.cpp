#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include "multisensor_observations.h"

int main() {
  using namespace amr_ir;
  LocalController controller(3000000,150000,160,20);
  controller.command('+',0); assert(controller.configuredDuty() == 180);
  controller.command('-',1); assert(controller.configuredDuty() == 160);
  assert(controller.output(100000).motion == Motion::stopped);
  ChargeTracker unknown(2200,100,false);
  unknown.accept(1,.6); unknown.accept(1.2,.6);
  assert(!unknown.socValid());
  ChargeTracker charge(2200,90,true);
  charge.accept(1,.6); charge.accept(1.2,.6);
  assert(std::abs(charge.usedMah()-.6*.2*1000/3600) < 1e-12);
  assert(charge.percent() < 90);
  charge.accept(1.4,-.6);  // Trapezoidal average at discharge/charge transition is zero.
  assert(std::abs(charge.usedMah()-.6*.2*1000/3600) < 1e-12);
  charge.accept(2.1,.6); assert(!charge.continuous() && !charge.socValid());
  charge.accept(2.3,.6); assert(!charge.socValid());  // A gap cannot silently reset SOC.
  YawTracker yaw; yaw.accept(1,10); yaw.accept(1.05,10);
  assert(yaw.valid() && std::abs(yaw.angleDegrees()-.5) < 1e-12);
  yaw.invalidate(); yaw.accept(1.06,10); assert(!yaw.valid());
  yaw.reset(); yaw.accept(1.07,10); assert(yaw.valid() && yaw.angleDegrees() == 0);
  yaw.accept(2,10); assert(!yaw.valid());
  Observation sample; sample.sampleTimeS = 12; sample.intervalS = .5;
  sample.leftTotal = 26; sample.rightTotal = 44;
  sample.leftDelta = 6; sample.rightDelta = 4; sample.seq = 23;
  Sensors s; s.imuValid = true; s.batteryValid = true; s.biasAvailable = true;
  s.whoAmI = 0x70; s.imuTimeS = 11.99; s.batteryTimeS = 11.9;
  s.ax = .1; s.ay = -.2; s.az = 1; s.gx = 1; s.gy = 2; s.gz = 180;
  s.biasDps = 1; s.yawValid = true; s.yawDeg = 45;
  s.busV = 7.34; s.shuntMv = 60; s.packV = 7.4; s.currentA = .6; s.powerW = 4.44;
  s.socPercent = 90; s.socValid = true;
  char packet[2560];
  assert(encodeMultisensor(packet,sizeof packet,"a1b2c3d4",sample,s,false,1,1) > 0);
  std::puts(packet);
  s.gz = NAN; s.currentA = NAN; s.socPercent = NAN;
  assert(encodeMultisensor(packet,sizeof packet,"a1b2c3d4",sample,s,false,1,1) > 0);
  assert(!std::strstr(packet,"nan") && !std::strstr(packet,"inf"));
  std::puts(packet);
  s.gz = 180; s.currentA = .6; s.socPercent = 90;
  s.imuTimeS = 11; s.batteryTimeS = 11;
  assert(encodeMultisensor(packet,sizeof packet,"a1b2c3d4",sample,s,true,2,1) > 0);
  std::puts(packet);
  assert(encodeMultisensor(packet,32,"a1b2c3d4",sample,s,false,1,1) == -1);
  return 0;
}
