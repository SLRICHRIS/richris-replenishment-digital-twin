const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '../../frontend_warehouse_dashboard');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  url: 'https://example.streamlit.app/component/workspace/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window,
  doc = w.document,
  sent = [];
const parent = {
  innerHeight: 900,
  postMessage: (message) => sent.push(message),
  addEventListener() {},
  removeEventListener() {},
};
Object.defineProperty(w, 'parent', { value: parent });
w.requestAnimationFrame = () => {};
for (const file of [
  'python_sensor_twin_readouts.js',
  'streamlit_frame_connection_and_scrolling.js',
]) {
  vm.runInContext(
    fs.readFileSync(path.join(root, 'browser_modules/streamlit_frame_connection', file), 'utf8'),
    dom.getInternalVMContext(),
  );
}
doc.dispatchEvent(new w.Event('DOMContentLoaded'));
const payload = {
  mode: 'demo',
  status: 'Synthetic fixed trial',
  robots: {
    amr01: {
      quality: 'OK',
      stale: false,
      age_s: 0.1,
      soc: 0.8,
      energy_wh: 0.01,
      gyro_bias_rad_s: 0.01,
      pose: [1, 2, 0.3],
      raw: {
        gyro_z_rad_s: 0.2,
        battery_voltage_v: 7.4,
        battery_current_a: 0.6,
        robot_state: '<img src=x onerror=alert(1)>',
      },
      derived: {
        power_w: 4.44,
        ds_left_m: 0.01,
        ds_right_m: 0.02,
        corrected_gyro_rad_s: 0.19,
        v_left_m_s: 0.1,
        v_right_m_s: 0.2,
        residual_rad_s: 0.12,
        advisory: true,
      },
      forecast_pose: [2, 3, 0.4],
      runtime_hours: 2,
      history: [
        { sample_time_s: 0, residual_rad_s: 0 },
        { sample_time_s: 1, residual_rad_s: 0.12 },
      ],
    },
  },
};
function deliver(source, origin) {
  w.dispatchEvent(
    new w.MessageEvent('message', {
      source,
      origin,
      data: { type: 'streamlit:render', args: { python_twin: payload } },
    }),
  );
}
deliver({}, w.location.origin);
assert.equal(doc.documentElement.dataset.pythonTwin, undefined);
deliver(parent, 'https://untrusted.example');
assert.equal(doc.documentElement.dataset.pythonTwin, undefined);
deliver(parent, w.location.origin);
assert.equal(doc.documentElement.dataset.pythonTwin, 'true');
assert.equal(doc.getElementById('python-amr01-soc').textContent, '80.000%');
assert.equal(doc.getElementById('python-amr01-battery-input').textContent, '7.400 / 0.6000');
assert.equal(doc.getElementById('python-amr01-travel').textContent, '0.01000 / 0.02000');
assert.equal(doc.getElementById('python-amr01-corrected-gyro').textContent, '0.19000');
assert.equal(doc.querySelectorAll('.python-sensor-cards > article').length, 6);
assert.equal(doc.querySelectorAll('.slide-equation').length, 6);
assert.match(doc.getElementById('python-amr01-advisory').textContent, /Sustained/);
assert.equal(doc.getElementById('python-amr01-advisory').dataset.alert, 'true');
assert.equal(doc.getElementById('python-amr02-quality'), null, 'AMR-02 is removed from the DOM');
assert.equal(
  doc.getElementById('python-amr01-state').querySelector('img'),
  null,
  'text-only sensor values',
);
assert.match(doc.getElementById('python-amr01-plot').getAttribute('points'), /490\.00/);
const floor = doc.getElementById('environment').innerHTML;
doc.body.dataset.view = 'hardware';
doc.getElementById('main-content').scrollTop = 200;
deliver(parent, w.location.origin);
assert.equal(doc.body.dataset.view, 'hardware', 'updates preserve navigation');
assert.equal(doc.getElementById('main-content').scrollTop, 200, 'updates preserve scroll');
assert.equal(
  doc.getElementById('environment').innerHTML,
  floor,
  'sensor data never overwrite the virtual fleet',
);
doc.getElementById('python-source-live').click();
const action = sent.at(-1);
assert.equal(action.type, 'streamlit:setComponentValue');
assert.equal(action.value.mode, 'live');
assert.equal(action.value.action, 'sensor_source');
assert.equal(typeof action.value.nonce, 'string');
doc.getElementById('python-model-inspection').click();
assert.equal(sent.at(-1).value.action, 'model_inspection');
const before = sent.length;
doc.dispatchEvent(
  new w.CustomEvent('python-twin:action', { detail: { action: 'motor_command', mode: 'live' } }),
);
assert.equal(sent.length, before, 'no arbitrary action bridge');
payload.robots.amr01 = { quality: 'STALE', stale: true, history: [] };
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-amr01-soc').textContent, '—');
assert.match(doc.getElementById('python-amr01-advisory').textContent, /suspended/);
setImmediate(() => dom.window.close());
console.log(
  'PASS: original workspace receives Python-only sensor values; source identity, XSS-safe text, freshness, no floor mutation, navigation/scroll preservation and allowlisted source/inspection actions.',
);
