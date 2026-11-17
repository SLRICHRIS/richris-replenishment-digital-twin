import { createHash } from 'node:crypto';

export const TOPIC = 'robot/amr01/commissioning';
export const USERNAME = 'publisher-amr01';
export const MAX_BODY_BYTES = 16384;
const PREFIX = 'amr01-ir-';
const MOTIONS = new Set(['stopped', 'forward', 'backward', 'left', 'right']);
const FIELDS = new Set(('schema_version message_type robot_id boot_id seq sample_time_s interval_s left_pulses_total right_pulses_total left_pulse_hz right_pulse_hz rpm_calibration_confirmed left_rpm right_rpm commanded_motion motor_output pwm_duty direction_measured gyro_available battery_available predictive_models_ready imu_who_am_i imu_sample_time_s accel_g gyro_dps gyro_z_rad_s gyro_bias_estimate_rad_s yaw_estimate_deg battery_sample_time_s battery_bus_voltage_v battery_shunt_voltage_mv battery_voltage_v battery_current_a battery_power_w battery_continuity soc_estimate_percent').split(' '));
export class InvalidTelemetry extends Error {}
const fail = (shape = null) => {
  const error = new InvalidTelemetry('Invalid commissioning telemetry');
  if (shape) error.shape = shape;
  throw error;
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e15;
function number(value, min = -1e15, max = 1e15) {
  if (!finite(value) || value < min || value > max) fail();
  return value;
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}
function boolean(value) { if (typeof value !== 'boolean') fail(); return value; }
function nullable(value, min, max) { return value === null ? null : number(value, min, max); }
function triple(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) fail();
  return value;
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

// This contract cannot admit unsigned wheel counts into signed odometry.
export function validateEnvelope(envelope, nowMs = Date.now()) {
  if (!object(envelope) || Object.keys(envelope).some(k => !['topic', 'username', 'clientid', 'broker_received_at_ms', 'payload'].includes(k))) fail();
  if (envelope.topic !== TOPIC || envelope.username !== USERNAME || typeof envelope.clientid !== 'string' || !/^amr01-ir-[0-9a-f]{16}$/.test(envelope.clientid)) fail();
  const received = integer(envelope.broker_received_at_ms, 1577836800000, nowMs + 5000);
  let p = envelope.payload;
  if (typeof p === 'string') {
    if (Buffer.byteLength(p) > MAX_BODY_BYTES) fail();
    try { p = JSON.parse(p); } catch { fail(); }
  }
  if (!object(p) || Object.keys(p).length !== FIELDS.size || Object.keys(p).some(k => !FIELDS.has(k))) {
    const keys = object(p) ? Object.keys(p) : [];
    fail({ kind: p === null ? 'null' : Array.isArray(p) ? 'array' : typeof p,
      expected_fields: FIELDS.size, actual_fields: keys.length,
      missing_fields: [...FIELDS].filter(k => !keys.includes(k)),
      extra_fields: keys.filter(k => !FIELDS.has(k)).length });
  }
  if (p.schema_version !== 1 || p.message_type !== 'mh_ir_commissioning' || p.robot_id !== 'amr01' || p.boot_id !== envelope.clientid.slice(PREFIX.length)) fail();
  if (p.direction_measured !== false || p.predictive_models_ready !== false) fail();
  const r = {
    robot_id: 'amr01', boot_id: p.boot_id,
    seq: integer(p.seq, 0, 4294967295), schema_version: 1,
    message_type: p.message_type, received_at: new Date(received),
    client_id: envelope.clientid, topic: TOPIC,
    sample_time_s: number(p.sample_time_s, 0), interval_s: number(p.interval_s, Number.MIN_VALUE),
    left_pulses_total: integer(p.left_pulses_total, 0, Number.MAX_SAFE_INTEGER),
    right_pulses_total: integer(p.right_pulses_total, 0, Number.MAX_SAFE_INTEGER),
    left_pulse_hz: number(p.left_pulse_hz, 0), right_pulse_hz: number(p.right_pulse_hz, 0),
    rpm_calibration_confirmed: boolean(p.rpm_calibration_confirmed),
    left_rpm: nullable(p.left_rpm, 0), right_rpm: nullable(p.right_rpm, 0),
    commanded_motion: p.commanded_motion, motor_output: p.motor_output,
    pwm_duty: integer(p.pwm_duty, 0, 255), direction_measured: false,
    gyro_available: boolean(p.gyro_available), battery_available: boolean(p.battery_available),
    imu_who_am_i: integer(p.imu_who_am_i, 0, 255),
    battery_continuity: boolean(p.battery_continuity),
    device_soc_estimate_percent: nullable(p.soc_estimate_percent, 0, 100),
    predictive_models_ready: false,
  };
  if (!MOTIONS.has(r.commanded_motion) || !MOTIONS.has(r.motor_output)) fail();
  if (r.interval_s <= 0) fail();
  if (!r.rpm_calibration_confirmed && (r.left_rpm !== null || r.right_rpm !== null)) fail();
  if (r.rpm_calibration_confirmed && (r.left_rpm === null || r.right_rpm === null)) fail();
  if (r.gyro_available) {
    const a = triple(p.accel_g), g = triple(p.gyro_dps);
    if (![0x68, 0x70].includes(r.imu_who_am_i)) fail();
    r.imu_sample_time_s = number(p.imu_sample_time_s, 0, r.sample_time_s);
    if (r.sample_time_s - r.imu_sample_time_s > .100001) fail();
    [r.accel_x_g, r.accel_y_g, r.accel_z_g] = a;
    [r.gyro_x_dps, r.gyro_y_dps, r.gyro_z_dps] = g;
    r.gyro_z_rad_s = number(p.gyro_z_rad_s);
    if (Math.abs(r.gyro_z_rad_s - g[2] * Math.PI / 180) > .000001) fail();
  } else {
    for (const k of ['imu_sample_time_s', 'accel_g', 'gyro_dps', 'gyro_z_rad_s']) if (p[k] !== null) fail();
    for (const k of ['imu_sample_time_s', 'accel_x_g', 'accel_y_g', 'accel_z_g', 'gyro_x_dps', 'gyro_y_dps', 'gyro_z_dps', 'gyro_z_rad_s']) r[k] = null;
  }
  r.gyro_bias_estimate_rad_s = nullable(p.gyro_bias_estimate_rad_s);
  r.yaw_estimate_deg = nullable(p.yaw_estimate_deg, -180, 180);
  if (r.yaw_estimate_deg !== null && (!r.gyro_available || r.gyro_bias_estimate_rad_s === null)) fail();
  const batteryFields = ['battery_sample_time_s', 'battery_bus_voltage_v', 'battery_shunt_voltage_mv', 'battery_voltage_v', 'battery_current_a', 'battery_power_w'];
  if (r.battery_available) {
    for (const k of batteryFields) r[k] = number(p[k]);
    if (r.battery_sample_time_s < 0 || r.battery_sample_time_s > r.sample_time_s || r.sample_time_s - r.battery_sample_time_s > .500001 || !(r.battery_voltage_v > 0 && r.battery_voltage_v <= 32)) fail();
    if (Math.abs(r.battery_voltage_v - (r.battery_bus_voltage_v + r.battery_shunt_voltage_mv / 1000)) > .0001 || Math.abs(r.battery_power_w - r.battery_voltage_v * r.battery_current_a) > .0001) fail();
  } else {
    for (const k of batteryFields) { if (p[k] !== null) fail(); r[k] = null; }
  }
  if (r.device_soc_estimate_percent !== null && (!r.battery_available || !r.battery_continuity)) fail();
  r.quality_notes = [];
  if (!r.gyro_available) r.quality_notes.push('imu_unavailable');
  if (!r.battery_available) r.quality_notes.push('battery_unavailable');
  if (r.battery_voltage_v !== null && r.battery_voltage_v < 1) r.quality_notes.push('battery_source_needs_check');
  if (!r.rpm_calibration_confirmed) r.quality_notes.push('rpm_calibration_unconfirmed');
  r.quality_notes.push('wheel_direction_unmeasured', 'model_calibration_unverified');
  r.payload = p; // Semantic device payload, not a claim to retain original wire bytes.
  r.payload_sha256 = createHash('sha256').update(canonical(p)).digest('hex');
  return r;
}
