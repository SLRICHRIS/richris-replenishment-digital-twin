// Synthetic test evidence. Only use in isolated test databases/branches.
export function envelope(now = Date.now()) {
  return {
    topic: 'robot/amr01/commissioning', username: 'publisher-amr01',
    clientid: 'amr01-ir-0123456789abcdef', broker_received_at_ms: now,
    payload: {
      schema_version: 1, message_type: 'mh_ir_commissioning', robot_id: 'amr01', boot_id: '0123456789abcdef', seq: 17,
      sample_time_s: 10, interval_s: .5, left_pulses_total: 3, right_pulses_total: 4,
      left_pulse_hz: 2, right_pulse_hz: 4, rpm_calibration_confirmed: false, left_rpm: null, right_rpm: null,
      commanded_motion: 'stopped', motor_output: 'stopped', pwm_duty: 0, direction_measured: false,
      gyro_available: true, battery_available: true, predictive_models_ready: false,
      imu_who_am_i: 0x70, imu_sample_time_s: 9.99, accel_g: [0, 0, 1], gyro_dps: [0, 0, 1.145916],
      gyro_z_rad_s: .02, gyro_bias_estimate_rad_s: .001, yaw_estimate_deg: 2,
      battery_sample_time_s: 9.8, battery_bus_voltage_v: 7.4, battery_shunt_voltage_mv: 0,
      battery_voltage_v: 7.4, battery_current_a: .5, battery_power_w: 3.7,
      battery_continuity: true, soc_estimate_percent: null,
    },
  };
}
