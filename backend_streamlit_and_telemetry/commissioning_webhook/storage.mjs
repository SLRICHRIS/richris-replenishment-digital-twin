export const COLUMNS = ('robot_id boot_id seq schema_version message_type received_at client_id topic sample_time_s interval_s left_pulses_total right_pulses_total left_pulse_hz right_pulse_hz rpm_calibration_confirmed left_rpm right_rpm commanded_motion motor_output pwm_duty direction_measured gyro_available battery_available imu_who_am_i imu_sample_time_s accel_x_g accel_y_g accel_z_g gyro_x_dps gyro_y_dps gyro_z_dps gyro_z_rad_s gyro_bias_estimate_rad_s yaw_estimate_deg battery_sample_time_s battery_bus_voltage_v battery_shunt_voltage_mv battery_voltage_v battery_current_a battery_power_w battery_continuity device_soc_estimate_percent predictive_models_ready payload_sha256 payload quality_notes').split(' ');
const SQL = `INSERT INTO public.amr_commissioning_samples (${COLUMNS.join(',')}) VALUES (${COLUMNS.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT (robot_id,boot_id,seq) DO NOTHING RETURNING seq`;
export async function persistRecord(pool, record) {
  const values = COLUMNS.map(key => ['payload', 'quality_notes'].includes(key) ? JSON.stringify(record[key]) : record[key]);
  const inserted = await pool.query(SQL, values);
  if (inserted.rowCount === 1) return 'stored';
  const existing = await pool.query('SELECT payload_sha256 FROM public.amr_commissioning_samples WHERE robot_id=$1 AND boot_id=$2 AND seq=$3', [record.robot_id, record.boot_id, record.seq]);
  if (!existing.rows.length) throw new Error('Packet identity not visible; retry');
  return existing.rows[0].payload_sha256 === record.payload_sha256 ? 'duplicate' : 'conflict';
}
export async function checkStorage(pool) {
  await pool.query(`SELECT ${COLUMNS.join(',')} FROM public.amr_commissioning_samples LIMIT 0`);
}
