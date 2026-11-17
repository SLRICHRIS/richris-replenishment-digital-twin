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
      right_rim_speed_m_s: 0.01884955592153876,
    },
    commissioning: {
      wheel_detail: '60 mm wheels · 100 mm spacing · 20 counted pulses per turn.',
      imu_detail: 'X forward, Y left, Z up. Zero bias is a default.',
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
assert.equal(d.getElementById('physical-wheel-left').textContent, '0 pulses / 0.00 Hz');
assert.equal(d.getElementById('physical-wheel-rpm').textContent, 'L 0.0 / R 6.0');
assert.equal(d.getElementById('physical-wheel-speed').textContent, 'L 0.0000 m/s / R 0.0188 m/s');
assert.match(d.getElementById('physical-imu-profile').textContent, /Zero bias is a default/);
assert.equal(d.getElementById('physical-recommendations').querySelector('img'), null);
assert.match(d.getElementById('physical-model-limit').textContent, /direction.*calibration/);
assert.equal(d.getElementById('python-amr01-soc').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-forecast').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-gyro').textContent, '0.02000');
assert.equal(d.getElementById('python-amr01-bias').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-corrected-gyro').textContent, 'Unavailable');
assert.equal(
  d.getElementById('python-amr01-battery-input').textContent,
  'Voltage = 0.820 V\nCurrent = -0.0003 A',
);
assert.equal(d.getElementById('python-amr01-power').textContent, '-0.000246 W');
for (const field of ['soc', 'pose', 'energy', 'residual', 'runtime', 'forecast']) {
  assert.equal(d.getElementById('python-amr01-' + field).textContent, 'Unavailable');
}
assert.match(d.getElementById('python-amr01-travel').textContent, /L = Unavailable/);
assert.match(d.getElementById('python-amr01-speed').textContent, /R = Unavailable/);
assert.match(d.getElementById('hardware-summary').textContent, /Receiving physical telemetry/);
assert.equal(d.getElementById('python-amr01-age').textContent, '0.5 s');
assert.equal(d.getElementById('python-amr01-battery-input-note').hidden, false);
assert.match(d.getElementById('python-amr01-battery-input-note').textContent, /below 1 V/);
payload.physical_telemetry.fresh = false;
payload.physical_telemetry.state = 'stale';
payload.physical_telemetry.label = 'Telemetry out of date';
render();
assert.equal(d.getElementById('physical-voltage').textContent, 'Unavailable');
assert.equal(d.getElementById('physical-status').textContent, 'Telemetry out of date');
assert.equal(d.getElementById('physical-wheel-rpm').textContent, 'L Unavailable / R Unavailable');
assert.equal(d.getElementById('python-amr01-gyro').textContent, 'Unavailable');
assert.match(d.getElementById('python-amr01-battery-input').textContent, /Voltage = Unavailable/);
assert.equal(d.getElementById('python-amr01-power').textContent, 'Unavailable');
assert.equal(d.getElementById('python-amr01-battery-input-note').hidden, true);
// Switching to demo cannot reuse the physical inputs, even if its fresh flag remains set.
payload.physical_telemetry.fresh = true;
payload.mode = 'demo';
render();
assert.equal(d.getElementById('physical-telemetry').hidden, true);
assert.equal(d.getElementById('python-amr01-gyro').textContent, 'Unavailable');
assert.match(d.getElementById('python-amr01-battery-input').textContent, /Voltage = Unavailable/);
assert.equal(d.getElementById('python-amr01-battery-input-note').hidden, true);
console.log(
  'PASS: physical telemetry stays distinct from calibrated models, suppresses stale values and renders sensor text safely.',
);
