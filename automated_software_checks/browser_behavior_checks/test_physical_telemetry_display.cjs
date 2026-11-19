const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '../../frontend_warehouse_dashboard');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  runScripts: 'outside-only',
});
const w = dom.window,
  d = w.document;
w.requestAnimationFrame = () => {};
vm.runInContext(
  fs.readFileSync(
    path.join(root, 'browser_modules/streamlit_frame_connection/python_sensor_twin_readouts.js'),
    'utf8',
  ),
  dom.getInternalVMContext(),
);
d.dispatchEvent(new w.Event('DOMContentLoaded'));
const payload = {
  mode: 'live',
  robots: {},
  notice: { label: 'Measured calibration required' },
  physical_telemetry: {
    state: 'receiving',
    label: 'Receiving physical telemetry',
    fresh: true,
    received_at: '2026-11-17T10:00:00+00:00',
    age_s: 0.5,
    seq: 1,
    measurements: {
      interval_s: 0.5,
      left_pulses_total: 0,
      right_pulses_total: 4,
      left_pulse_hz: 0,
      right_pulse_hz: 2,
      gyro_z_rad_s: 0.02,
      yaw_estimate_deg: 2,
      battery_voltage_v: 0.82,
      battery_current_a: -0.0003,
      battery_power_w: -0.000246,
      device_soc_estimate_percent: 100,
    },
    wheel_estimates: {
      left_rpm_magnitude: 0,
      right_rpm_magnitude: 6,
      left_rim_speed_m_s: 0,
      right_rim_speed_m_s: 0.02042035224833366,
      left_travel_magnitude_m: 0,
      right_travel_magnitude_m: 0.01021017612416683,
    },
    gyro_estimates: {
      corrected_gyro_rad_s: 0.019650934149601136,
      bias_rad_s: 0.00034906585039886593,
    },
    commissioning: {
      wheel_detail: '65 mm wheels · 100 mm spacing · 20 counted pulses per turn.',
      imu_detail: 'X forward, Y left, Z up. Stationary Z bias: +0.02°/s.',
      gyro_bias_measured: true,
      reported_gyro_bias_rad_s: { x: null, y: null, z: 0.00034906585039886593 },
      battery_detail: 'Reported pack: 2,200 mAh; starting charge 100%. Capacity is unverified.',
    },
    recommendations: ['Battery wiring needs checking.', '<img src=x onerror=alert(1)>'],
    model_detail:
      'Wheel direction and measured calibration are required before pose and runtime predictions.',
    models_ready: false,
  },
};
function render() {
  d.dispatchEvent(new w.CustomEvent('python-twin:render', { detail: payload }));
}
render();
assert.equal(d.getElementById('physical-telemetry').hidden, false);
assert.equal(d.getElementById('physical-voltage').textContent, '0.820 V');
assert.equal(d.getElementById('physical-current').textContent, '-0.0003 A');
assert.equal(d.getElementById('physical-left-total').getAttribute('aria-label'), null);
assert.equal(d.getElementById('physical-left-total').textContent, '0');
assert.equal(d.getElementById('physical-left-rate').textContent, '0.00');
assert.equal(d.getElementById('physical-right-total').textContent, '4');
assert.equal(d.getElementById('physical-right-rate').textContent, '2.00');
assert.equal(d.getElementById('physical-left-rpm').textContent, '0.0');
assert.equal(d.getElementById('physical-right-rpm').textContent, '6.0');
assert.equal(d.getElementById('physical-left-speed').textContent, '0.0000');
assert.equal(d.getElementById('physical-right-speed').textContent, '0.0204');
assert.equal(d.getElementById('physical-left-total').classList.contains('is-unavailable'), false);
assert.equal(d.getElementById('physical-freshness-note').hidden, true);
assert.equal(d.getElementById('physical-age').textContent, '0.5 s');
assert.equal(d.getElementById('physical-sequence').textContent, '#1');
assert.match(d.getElementById('physical-received').textContent, /17 Nov 2026.*15:30:00/);
assert.equal(d.getElementById('physical-received').title, payload.physical_telemetry.received_at);
assert.equal(d.getElementById('physical-model-state').textContent, 'Models awaiting calibration');
assert.match(d.getElementById('physical-imu-profile').textContent, /Z bias: \+0.02°\/s/);
assert.match(d.getElementById('physical-battery-profile').textContent, /2,200 mAh.*unverified/);
assert.equal(d.getElementById('physical-recommendations').querySelector('img'), null);
assert.match(d.getElementById('physical-model-limit').textContent, /direction.*calibration/);
assert.equal(d.getElementById('python-amr01-soc').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-forecast').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-gyro').textContent, '0.02000');
assert.equal(d.getElementById('python-amr01-bias').textContent, '0.00034907');
assert.equal(d.getElementById('python-amr01-corrected-gyro').textContent, '0.01965');
assert.match(
  d.getElementById('python-amr01-gyro-input-note').textContent,
  /raw Z yaw rate.*recorded stationary Z bias/,
);
assert.equal(
  d.getElementById('python-amr01-battery-input').textContent,
  'Voltage = 0.820 V\nCurrent = -0.0003 A',
);
assert.equal(d.getElementById('python-amr01-power').textContent, '-0.000246 W');
for (const field of ['soc', 'pose', 'energy', 'residual', 'runtime', 'forecast']) {
  assert.equal(d.getElementById('python-amr01-' + field).textContent, 'Unavailable');
}
assert.equal(d.getElementById('python-amr01-travel').textContent, 'L = 0.0000 m\nR = 0.0102 m');
assert.equal(d.getElementById('python-amr01-speed').textContent, 'L = 0.000 m/s\nR = 0.020 m/s');
assert.match(d.getElementById('python-amr01-travel-label').textContent, /magnitude/);
assert.match(d.getElementById('python-amr01-speed-label').textContent, /magnitude/);
assert.equal(d.getElementById('python-amr01-wheel-input-note').hidden, false);
assert.match(d.getElementById('hardware-summary').textContent, /Receiving physical telemetry/);
assert.equal(d.getElementById('python-amr01-age').textContent, '0.5 s');
assert.equal(d.getElementById('python-amr01-battery-input-note').hidden, false);
assert.match(d.getElementById('python-amr01-battery-input-note').textContent, /below 1 V/);
payload.physical_telemetry.motion_observation = {
  state: 'tracking',
  pose: [0.1, 0.2, 0.3],
  residual_rad_s: 0.01234,
  origin_seq: 5,
  resets: 0,
  direction_source: 'motor_command_estimate',
  history: [
    { sample_time_s: 1, residual_rad_s: 0.01, plot_break_before: true },
    { sample_time_s: 1.5, residual_rad_s: null, plot_break_before: true },
    { sample_time_s: 2, residual_rad_s: 0.01234, plot_break_before: false },
  ],
};
render();
assert.equal(
  d.getElementById('python-amr01-pose').textContent,
  'x = 0.100 m\ny = 0.200 m\nHeading = 0.300 rad',
);
assert.equal(d.getElementById('python-amr01-residual').textContent, '0.01234 rad/s');
assert.match(d.getElementById('python-amr01-pose-note').textContent, /motor-command estimates.*#5/);
assert.match(
  d.getElementById('python-amr01-advisory').textContent,
  /Gyro minus wheel turning rate/,
);
assert.equal(d.getElementById('python-amr01-advisory').dataset.alert, 'false');
assert.match(d.getElementById('python-amr01-plot-caption').textContent, /Device sample time/);
assert.equal(
  (d.getElementById('python-amr01-plot').getAttribute('d').match(/M/g) || []).length,
  2,
  'Comparison line breaks across missing readings',
);
assert.equal(d.getElementById('python-amr01-forecast').textContent, 'Unavailable');
payload.physical_telemetry.motion_observation.forecast_pose = [0.5, 0.2, 0.3];
payload.physical_telemetry.runtime_scenario = {
  state: 'ready',
  hours: 3.52,
  capacity_ah: 2.2,
  assumed_start_soc: 1,
  reserve_soc: 0.2,
  actual_remaining_runtime: false,
};
render();
assert.match(d.getElementById('python-amr01-forecast').textContent, /x = 0.500 m/);
assert.equal(d.getElementById('python-amr01-runtime').textContent, '3.52 h');
assert.match(d.getElementById('python-amr01-runtime-label').textContent, /reported-pack scenario/);
assert.match(
  d.getElementById('python-amr01-runtime-note').textContent,
  /2.2 Ah.*assumed 100%.*motor-branch.*actual remaining charge are unknown/,
);
assert.match(
  d.getElementById('python-amr01-forecast-note').textContent,
  /continued for 5 seconds.*expiring motor command/,
);
assert.equal(d.getElementById('python-amr01-soc').textContent, 'Unavailable');
payload.physical_telemetry.runtime_scenario.state = 'no_positive_discharge';
payload.physical_telemetry.runtime_scenario.hours = null;
render();
assert.equal(d.getElementById('python-amr01-runtime').textContent, 'No positive discharge');
assert.match(d.getElementById('python-amr01-runtime-note').textContent, /zero or negative current/);
assert.match(d.getElementById('python-amr01-forecast').textContent, /x = 0.500 m/);
payload.physical_telemetry.runtime_scenario.state = 'battery_unavailable';
render();
assert.equal(d.getElementById('python-amr01-runtime').textContent, 'Unavailable');
assert.match(
  d.getElementById('python-amr01-runtime-note').textContent,
  /valid, current battery sample/,
);
payload.physical_telemetry.motion_observation = {
  ...payload.physical_telemetry.motion_observation,
  state: 'reanchoring',
  pose: null,
  residual_rad_s: null,
  resets: 1,
};
render();
assert.equal(d.getElementById('python-amr01-pose').textContent, 'Unavailable');
assert.match(d.getElementById('python-amr01-pose-note').textContent, /new local origin/);
assert.equal(d.getElementById('python-amr01-forecast').textContent, 'Unavailable');
payload.physical_telemetry.motion_observation = {
  ...payload.physical_telemetry.motion_observation,
  state: 'tracking',
  pose: [0, 0, 0],
  residual_rad_s: 0,
};
render();
assert.equal(d.getElementById('python-amr01-residual').textContent, '0.00000 rad/s');
payload.physical_telemetry.energy_observation = {
  state: 'ready',
  net_wh: -0.00001234,
  covered_s: 30,
  skipped_intervals: 1,
};
render();
assert.equal(d.getElementById('python-amr01-energy').textContent, '-0.00001234 Wh');
assert.match(
  d.getElementById('python-amr01-energy-note').textContent,
  /30.0 s.*recorded intervals/,
);
assert.match(d.getElementById('python-amr01-energy-note').textContent, /omitted/);
assert.equal(d.getElementById('python-amr01-soc').textContent, 'Unavailable');
payload.physical_telemetry.energy_observation = { state: 'anchoring', net_wh: null };
render();
assert.match(d.getElementById('python-amr01-energy').textContent, /Waiting for two/);
payload.physical_telemetry.energy_observation = { state: 'loading', net_wh: null };
render();
assert.match(d.getElementById('python-amr01-energy').textContent, /Calculating/);
payload.physical_telemetry.energy_observation = { state: 'ready', net_wh: 0, covered_s: 1 };
render();
assert.equal(d.getElementById('python-amr01-energy').textContent, '0.00000000 Wh');
payload.physical_telemetry.energy_observation.soc_scenario = {
  state: 'ready',
  percent: 98.5,
  capacity_ah: 2.2,
  assumed_start_soc: 1,
  origin_seq: 1,
  skipped_intervals: 2,
  actual_soc_verified: false,
};
payload.physical_telemetry.motion_observation.gyro_yaw = {
  state: 'tracking',
  degrees: -12.345,
  origin_seq: 5,
  resets: 1,
};
render();
assert.equal(d.getElementById('python-amr01-soc').textContent, '98.50%');
assert.match(d.getElementById('python-amr01-soc-label').textContent, /reported-start scenario/);
assert.match(
  d.getElementById('python-amr01-soc-note').textContent,
  /assumed 100%.*#1.*2.2 Ah.*actual remaining charge.*omitted/,
);
assert.equal(d.getElementById('physical-yaw').textContent, '2.00°', 'Device yaw takes precedence');
payload.physical_telemetry.measurements.yaw_estimate_deg = null;
render();
assert.equal(d.getElementById('physical-yaw').textContent, '-12.35°');
assert.match(
  d.getElementById('physical-yaw-note').textContent,
  /bias-corrected Z gyro.*#5.*drift.*new origin/,
);
payload.physical_telemetry.motion_observation.gyro_yaw.degrees = 0;
render();
assert.equal(d.getElementById('physical-yaw').textContent, '0.00°');
payload.physical_telemetry.energy_observation.soc_scenario.percent = 100.2;
payload.physical_telemetry.energy_observation.soc_scenario.outside_physical_range = true;
render();
assert.equal(d.getElementById('python-amr01-soc').textContent, '100.20%');
assert.match(d.getElementById('python-amr01-soc-note').textContent, /outside 0–100%/);
payload.physical_telemetry.fresh = false;
payload.physical_telemetry.state = 'stale';
payload.physical_telemetry.label = 'Telemetry out of date';
payload.physical_telemetry.age_s = 997.8;
d.querySelector('.physical-guidance').open = true;
render();
assert.equal(d.getElementById('python-amr01-energy').textContent, '0.00000000 Wh');
assert.match(d.getElementById('python-amr01-energy-note').textContent, /Last recorded total/);
assert.equal(d.getElementById('physical-voltage').textContent, '—');
assert.equal(d.getElementById('physical-voltage').getAttribute('aria-label'), 'Unavailable');
assert.equal(d.getElementById('physical-status').textContent, 'Telemetry out of date');
for (const side of ['left', 'right'])
  for (const field of ['total', 'rate', 'rpm', 'speed']) {
    const value = d.getElementById(`physical-${side}-${field}`);
    assert.equal(value.textContent, '—');
    assert.equal(value.getAttribute('aria-label'), 'Unavailable');
    assert.equal(value.classList.contains('is-unavailable'), true);
  }
assert.equal(d.getElementById('physical-freshness-note').hidden, false);
assert.equal(d.getElementById('physical-age').textContent, '16m 37s');
assert.equal(d.querySelector('.physical-guidance').open, true, 'Refresh preserves expanded notes');
assert.equal(d.getElementById('python-amr01-gyro').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-bias').textContent, '0.00034907');
assert.equal(d.getElementById('python-amr01-corrected-gyro').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-pose').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-residual').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-pose-note').hidden, true);
assert.equal(d.getElementById('physical-yaw').textContent, '—');
assert.equal(d.getElementById('python-amr01-soc').textContent, 'Unavailable');
assert.match(d.getElementById('python-amr01-soc-note').textContent, /fresh ESP32 battery/);
assert.equal(d.getElementById('python-amr01-runtime').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-forecast').textContent, 'Unavailable');
assert.match(d.getElementById('python-amr01-forecast-note').textContent, /fresh ESP32 wheel/);
assert.match(d.getElementById('python-amr01-runtime-note').textContent, /fresh ESP32 battery/);
assert.match(d.getElementById('python-amr01-battery-input').textContent, /Voltage = Unavailable/);
assert.equal(d.getElementById('python-amr01-power').textContent, 'Unavailable');
assert.match(d.getElementById('python-amr01-travel').textContent, /L = Unavailable/);
assert.match(d.getElementById('python-amr01-speed').textContent, /R = Unavailable/);
assert.equal(d.getElementById('python-amr01-wheel-input-note').hidden, true);
assert.equal(d.getElementById('python-amr01-battery-input-note').hidden, true);
// Missing/invalid metadata must never look like a new packet or a zero-age observation.
payload.physical_telemetry.received_at = 'not-a-timestamp';
payload.physical_telemetry.age_s = null;
payload.physical_telemetry.seq = 0;
render();
assert.equal(d.getElementById('physical-received').textContent, 'Timestamp unavailable');
assert.equal(d.getElementById('physical-age').textContent, 'Unavailable');
assert.equal(d.getElementById('physical-sequence').textContent, '#0');
payload.physical_telemetry.received_at = null;
payload.physical_telemetry.seq = null;
render();
assert.equal(d.getElementById('physical-received').textContent, 'No packet received yet');
assert.equal(d.getElementById('physical-sequence').textContent, 'Unavailable');
assert.match(d.getElementById('physical-freshness-detail').textContent, /first stored packet/);
payload.physical_telemetry.state = 'unavailable';
render();
assert.match(
  d.getElementById('physical-freshness-detail').textContent,
  /storage could not be read/,
);
payload.physical_telemetry.state = 'clock_skew';
render();
assert.match(d.getElementById('physical-freshness-detail').textContent, /timestamp needs checking/);
let archiveOpened = false;
d.getElementById('python-database-inspection').addEventListener('click', () => {
  archiveOpened = true;
});
d.getElementById('python-db-dataset').value = 'amr_sensor_samples';
d.getElementById('physical-open-archive').click();
assert.equal(archiveOpened, true);
assert.equal(d.getElementById('python-db-dataset').value, 'amr_commissioning_samples');
// Switching to demo cannot reuse the physical inputs, even if its fresh flag remains set.
payload.physical_telemetry.fresh = true;
payload.mode = 'demo';
render();
assert.equal(d.getElementById('physical-telemetry').hidden, true);
assert.equal(d.getElementById('python-amr01-gyro').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-bias').textContent, 'Unavailable');
assert.match(d.getElementById('python-amr01-battery-input').textContent, /Voltage = Unavailable/);
assert.equal(d.getElementById('python-amr01-battery-input-note').hidden, true);
console.log(
  'PASS: physical telemetry stays distinct from calibrated models, suppresses stale values and renders sensor text safely.',
);
