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
      quality_label: 'Demonstration data',
      quality_detail: 'Synthetic trial. No physical robot is connected.',
      quality_tone: 'info',
      stale: false,
      age_s: 0.1,
      soc: 0.8,
      energy_wh: 0.01,
      gyro_bias_rad_s: 0.01,
      residual_threshold_rad_s: 0.04,
      residual_hold_s: 0.5,
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
assert.equal(doc.getElementById('python-amr01-soc').textContent, '80.0%');
assert.equal(
  doc.getElementById('python-amr01-battery-input').textContent,
  'Voltage = 7.40 V\nCurrent = 0.600 A',
);
assert.equal(doc.getElementById('python-amr01-travel').textContent, 'L = 0.0100 m\nR = 0.0200 m');
assert.equal(
  doc.getElementById('python-amr01-pose').textContent,
  'x = 1.000 m\ny = 2.000 m\nHeading = 0.300 rad',
);
assert.equal(doc.getElementById('python-data-notice').dataset.tone, 'info');
assert.match(doc.getElementById('python-data-detail').textContent, /No physical robot/);
assert.equal(doc.getElementById('python-amr01-age').textContent, 'Fixed demo trial');
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
assert.match(doc.getElementById('python-amr01-plot').getAttribute('d'), /L490\.00/);
assert.match(doc.getElementById('python-amr01-threshold').textContent, /0\.040 rad\/s for 0\.50 s/);
assert.equal(
  doc.getElementById('python-amr01-threshold-upper').getAttribute('visibility'),
  'visible',
);
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
const current = payload.robots.amr01;
payload.mode = 'live';
payload.robots.amr01 = {
  ...current,
  quality: 'STALE',
  quality_label: 'Readings out of date',
  quality_detail: 'No current reading is available.',
  quality_tone: 'warning',
  stale: true,
};
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-amr01-soc').textContent, 'Unavailable');
assert.match(doc.getElementById('python-amr01-advisory').textContent, /suspended/);
assert.equal(
  doc.getElementById('python-amr01-forecast').textContent,
  'Unavailable',
  'stale payload cannot retain an earlier forecast',
);
assert.equal(doc.getElementById('python-amr01-runtime').textContent, 'Unavailable');
assert.equal(doc.getElementById('python-data-title').textContent, 'Readings out of date');
assert.equal(doc.getElementById('python-data-notice').dataset.tone, 'warning');
assert.match(doc.getElementById('python-amr01-plot-range').textContent, /historical data/);
payload.robots.amr01 = { ...current, quality: 'CONTINUITY_LOST', continuity_lost: true };
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-amr01-runtime').textContent, 'Unavailable');
assert.match(doc.getElementById('python-amr01-forecast-note').textContent, /partial/);
payload.robots.amr01 = {
  ...current,
  quality: 'SEQUENCE_GAP',
  derived: { ...current.derived, residual_valid: false, residual_rad_s: null },
  history: [
    { sample_time_s: 0, residual_rad_s: 0 },
    { sample_time_s: 1, residual_rad_s: null },
    { sample_time_s: 2, residual_rad_s: 0.1 },
  ],
};
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-amr01-forecast').textContent, 'Unavailable');
assert.equal(
  (doc.getElementById('python-amr01-plot').getAttribute('d').match(/M/g) || []).length,
  2,
  'plot does not join across missing comparisons',
);
payload.robots.amr01 = {
  ...current,
  raw: { ...current.raw, battery_current_a: 0 },
  runtime_hours: null,
};
deliver(parent, w.location.origin);
assert.match(doc.getElementById('python-amr01-forecast-note').textContent, /zero current/);
assert.match(doc.getElementById('python-amr01-battery-input').textContent, /0\.000 A/);
payload.robots = {};
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-amr01-pose').textContent, 'Unavailable');
assert.equal(doc.getElementById('python-data-title').textContent, 'No sensor data');

// Production loads the bridge in <head> and the readout at the end of <body>.
// Streamlit may send only one render for identical fragment arguments.
function verifyStartup(order) {
  const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(
    markup.indexOf('streamlit_frame_connection_and_scrolling.js') <
      markup.indexOf('python_sensor_twin_readouts.js'),
  );
  const startup = new JSDOM(markup, {
    url: 'https://example.streamlit.app/~/+/component/workspace/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = startup.window,
    document = win.document,
    messages = [];
  let readyState = order === 'late-readout' ? 'complete' : 'loading';
  Object.defineProperty(document, 'readyState', { get: () => readyState });
  const initial = { mode: 'demo', status: 'Synthetic fixed trial', robots: { amr01: current } };
  const receive = () =>
    win.dispatchEvent(
      new win.MessageEvent('message', {
        source: parentWindow,
        origin: win.location.origin,
        data: { type: 'streamlit:render', args: { python_twin: initial } },
      }),
    );
  const parentWindow = {
    innerHeight: 900,
    postMessage(message) {
      messages.push(message);
      if (message.type === 'streamlit:componentReady') receive();
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(win, 'parent', { value: parentWindow });
  win.requestAnimationFrame = () => {};
  const load = (file) =>
    vm.runInContext(
      fs.readFileSync(path.join(root, 'browser_modules/streamlit_frame_connection', file), 'utf8'),
      startup.getInternalVMContext(),
    );
  load('streamlit_frame_connection_and_scrolling.js');
  if (readyState === 'loading')
    assert(!messages.some((m) => m.type === 'streamlit:componentReady'), 'wait for body scripts');
  if (order === 'early-render') receive();
  load('python_sensor_twin_readouts.js');
  readyState = 'complete';
  document.dispatchEvent(new win.Event('DOMContentLoaded'));
  assert.equal(document.documentElement.dataset.pythonTwin, 'true', order);
  assert.equal(document.getElementById('python-amr01-soc').textContent, '80.0%', order);
  assert.equal(messages.filter((m) => m.type === 'streamlit:componentReady').length, 1);
  document.dispatchEvent(new win.Event('DOMContentLoaded'));
  assert.equal(
    messages.filter((m) => m.type === 'streamlit:componentReady').length,
    1,
    'ready is sent once',
  );
  startup.window.close();
}
for (const order of ['normal', 'early-render', 'late-readout']) verifyStartup(order);
setImmediate(() => dom.window.close());
console.log(
  'PASS: original workspace receives Python-only sensor values; source identity, XSS-safe text, freshness, no floor mutation, navigation/scroll preservation and allowlisted source/inspection actions.',
);
