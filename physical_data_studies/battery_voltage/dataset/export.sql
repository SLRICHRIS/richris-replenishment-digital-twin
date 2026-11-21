-- Frozen read-only projection of the AMR-01 commissioning stream.
-- Export UTF-8 CSV with a header and blank fields for SQL NULL.
SELECT
    s.robot_id::text AS robot_id,
    s.boot_id::text AS boot_id,
    s.seq::text AS seq,
    to_char(s.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at_utc,
    to_char(s.stored_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stored_at_utc,
    s.sample_time_s::text AS sample_time_s,
    s.interval_s::text AS interval_s,
    s.payload->>'firmware_revision' AS firmware_revision,
    s.left_pulses_total::text AS left_pulses_total,
    s.right_pulses_total::text AS right_pulses_total,
    s.left_pulse_hz::text AS left_pulse_hz,
    s.right_pulse_hz::text AS right_pulse_hz,
    s.rpm_calibration_confirmed::text AS rpm_calibration_confirmed,
    s.left_rpm::text AS left_rpm,
    s.right_rpm::text AS right_rpm,
    s.commanded_motion::text AS commanded_motion,
    s.motor_output::text AS motor_output,
    s.pwm_duty::text AS pwm_duty,
    s.direction_measured::text AS direction_measured,
    s.gyro_available::text AS gyro_available,
    s.imu_who_am_i::text AS imu_who_am_i,
    s.imu_sample_time_s::text AS imu_sample_time_s,
    s.accel_x_g::text AS accel_x_g,
    s.accel_y_g::text AS accel_y_g,
    s.accel_z_g::text AS accel_z_g,
    s.gyro_x_dps::text AS gyro_x_dps,
    s.gyro_y_dps::text AS gyro_y_dps,
    s.gyro_z_dps::text AS gyro_z_dps,
    s.gyro_z_rad_s::text AS gyro_z_rad_s,
    s.gyro_bias_estimate_rad_s::text AS gyro_bias_estimate_rad_s,
    s.yaw_estimate_deg::text AS yaw_estimate_deg,
    s.battery_available::text AS battery_available,
    s.battery_sample_time_s::text AS battery_sample_time_s,
    s.battery_bus_voltage_v::text AS battery_bus_voltage_v,
    s.battery_shunt_voltage_mv::text AS battery_shunt_voltage_mv,
    s.battery_voltage_v::text AS battery_voltage_v,
    s.battery_current_a::text AS battery_current_a,
    s.battery_power_w::text AS battery_power_w,
    s.battery_continuity::text AS battery_continuity,
    s.device_soc_estimate_percent::text AS device_soc_estimate_percent,
    s.predictive_models_ready::text AS predictive_models_ready,
    s.payload_sha256::text AS payload_sha256
FROM public.amr_commissioning_samples AS s
WHERE s.robot_id = 'amr01'
  AND s.topic = 'robot/amr01/commissioning'
  AND s.message_type = 'mh_ir_commissioning'
  AND s.client_id = 'amr01-ir-' || s.boot_id
  AND s.received_at <= TIMESTAMPTZ '2026-11-21T19:21:37.463612Z'
  AND s.stored_at <= TIMESTAMPTZ '2026-11-21T19:21:37.463612Z'
ORDER BY s.boot_id, s.seq;
