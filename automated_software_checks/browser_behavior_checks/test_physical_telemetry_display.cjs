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
      right_rim_speed_m_s: 0.02042035224833366,
    },
    commissioning: {
      wheel_detail: '65 mm wheels · 100 mm spacing · 20 counted pulses per turn.',
      imu_detail: 'X forward, Y left, Z up. Reported bias 0.02 needs its sign, axis and unit.',
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
assert.match(d.getElementById('physical-imu-profile').textContent, /sign, axis and unit/);
assert.match(d.getElementById('physical-battery-profile').textContent, /2,200 mAh.*unverified/);
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
payload.physical_telemetry.age_s = 997.8;
d.querySelector('.physical-guidance').open = true;
render();
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
assert.match(d.getElementById('python-amr01-battery-input').textContent, /Voltage = Unavailable/);
assert.equal(d.getElementById('python-amr01-power').textContent, 'Unavailable');
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
assert.match(d.getElementById('python-amr01-battery-input').textContent, /Voltage = Unavailable/);
assert.equal(d.getElementById('python-amr01-battery-input-note').hidden, true);
console.log(
  'PASS: physical telemetry stays distinct from calibrated models, suppresses stale values and renders sensor text safely.',
);
