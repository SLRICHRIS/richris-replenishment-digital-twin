#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include "mh_ir_controller.h"

int main() {
  using amr_ir::Motion;
  amr_ir::PulseCounter pulses;
  for (uint32_t time : {0U, 1000U, 1999U, 2000U, 4000U}) pulses.edge(time, 2000);
  assert(pulses.total == 3);
  amr_ir::PulseCounter wrapping;
  wrapping.edge(UINT32_MAX - 999, 2000);
  wrapping.edge(999, 2000);  // 1,999 us, still noise
  assert(wrapping.total == 1);
  wrapping.edge(1000, 2000);  // 2,000 us across wrap
  assert(wrapping.total == 2);

  amr_ir::LocalController controller;
  assert(controller.output(0).motion == Motion::stopped);
  controller.command('+', 0);
  assert(controller.configuredDuty() == 195);
  assert(controller.output(1000000).motion == Motion::stopped);
  controller.command('F', 1000000);
  assert(controller.output(1149999).motion == Motion::stopped);
  assert(controller.output(1150000).motion == Motion::forward);
  controller.command('B', 1200000);
  assert(controller.output(1349999).motion == Motion::stopped);
  controller.command('B', 1300000);  // a repeat must not prolong the interlock
  assert(controller.output(1350000).motion == Motion::backward);
  pulses.edge(6000, 2000);
  assert(pulses.total == 4);  // backward commands cannot invent a pulse sign
  controller.command('S', 1400000);
  assert(controller.output(1400000).motion == Motion::stopped);
  controller.command('+', 1500000);
  assert(controller.output(1500000).motion == Motion::stopped);

  controller.command('L', 2000000);
  assert(controller.output(2150000).motion == Motion::left);
  controller.command('?', 4900000);
  assert(controller.output(5000000).motion == Motion::stopped);  // unknown input is no heartbeat
  controller.command('+', 5100000);
  assert(controller.output(5100000).motion == Motion::stopped);  // speed cannot rearm expired motion
  controller.command('R', 6000000);
  assert(controller.output(6150000).motion == Motion::right);
  assert(controller.output(5999999).motion == Motion::stopped);  // clock discontinuity
  for (int n = 0; n < 30; ++n) controller.command('+', 7000000);
  assert(controller.configuredDuty() == 255);
  for (int n = 0; n < 30; ++n) controller.command('-', 7000000);
  assert(controller.configuredDuty() == 0);

  amr_ir::Observation sample;
  sample.leftTotal = 26; sample.rightTotal = 44;
  sample.leftDelta = 6; sample.rightDelta = 4;
  sample.sampleTimeS = 12; sample.intervalS = 2;
  sample.requested = Motion::backward;
  sample.output = Motion::backward;
  sample.duty = 180; sample.seq = 11;
  char packet[1024];
  assert(amr_ir::encodeDiagnostic(packet, sizeof packet, "a1b2c3d4", sample, false, 2, 1) > 0);
  assert(std::strstr(packet, "\"left_rpm\":null"));
  assert(!std::strstr(packet, "encoder_left_count"));
  assert(amr_ir::encodeDiagnostic(packet, 16, "a1b2c3d4", sample, true, 2, 1) == -1);
  assert(amr_ir::encodeDiagnostic(packet, sizeof packet, "bad\"boot", sample, true, 2, 1) == -1);
  assert(amr_ir::encodeDiagnostic(packet, sizeof packet, "a1b2c3d4", sample, true, 0, 1) == -1);
  assert(amr_ir::encodeDiagnostic(packet, sizeof packet, "a1b2c3d4", sample, true, 2, 1) > 0);
  std::puts(packet);  // parsed independently by Python and rejected by the actual twin gate
  return 0;
}
