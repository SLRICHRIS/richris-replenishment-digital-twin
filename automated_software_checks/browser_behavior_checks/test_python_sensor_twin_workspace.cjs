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
  'amr_connection_panel.js',
  'human_review_panel.js',
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
      quality_label: 'Demo data',
      quality_detail: 'Fixed teaching trial with generated sensor values.',
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
const style = doc.createElement('style');
style.textContent = fs.readFileSync(
  path.join(root, 'dashboard_stylesheets/python_sensor_twin_panel_styles.css'),
  'utf8',
);
doc.head.append(style);
for (const selector of [
  '#tab-missions',
  '#tab-activity',
  '#operation-brief',
  '.rack-register',
  '.outlook',
  '.session-action',
]) {
  assert.equal(
    w.getComputedStyle(doc.querySelector(selector)).display,
    'none',
    selector + ' is absent from the hosted UI',
  );
}
assert.equal(w.getComputedStyle(doc.getElementById('python-database-inspection')).display, 'flex');

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
assert.match(doc.getElementById('python-data-detail').textContent, /generated sensor values/);
assert.equal(doc.getElementById('python-amr01-age').textContent, 'Fixed demo trial');
assert.equal(doc.getElementById('hardware-summary').textContent, 'Sensor data: demo');
assert.equal(doc.getElementById('python-amr01-corrected-gyro').textContent, '0.19000');
assert.equal(doc.querySelectorAll('.python-sensor-cards > article').length, 6);
assert.equal(doc.querySelectorAll('.slide-equation').length, 6);
for (const card of doc.querySelectorAll('.python-sensor-cards > article')) {
  assert.equal(
    card.querySelector('.slide-equation').open,
    false,
    'supporting detail starts collapsed',
  );
  for (const source of card.querySelectorAll('[data-model-paper]'))
    assert(source.closest('details'), 'paper links remain with their model inside its disclosure');
}
assert(doc.getElementById('python-database-inspection').closest('.navigation-rail'));

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
doc.getElementById('python-database-inspection').click();
assert.equal(
  sent.at(-1).value.action,
  'model_inspection',
  'the navigation click does not request data before the outgoing view closes',
);
doc.dispatchEvent(new w.CustomEvent('python-twin:database-open'));
assert.equal(sent.at(-1).value.action, 'database_browse');
assert.equal(sent.at(-1).value.active, true);
assert.equal(sent.at(-1).value.dataset, 'amr_commissioning_samples');
assert.equal(doc.querySelector('.twin-records-browser').getAttribute('aria-busy'), 'true');
const before = sent.length;
doc.dispatchEvent(
  new w.CustomEvent('python-twin:action', { detail: { action: 'motor_command', mode: 'live' } }),
);
assert.equal(sent.length, before, 'no arbitrary action bridge');
// Shared archive: real records, safe cell rendering, selection races and stable refresh.
payload.database = {
  state: 'ready',
  label: 'Connected',
  detail: 'Read only',
  dataset: 'amr_commissioning_samples',
  title: 'Device telemetry',
  description: 'Physical records',
  kind: 'Table',
  limit: 50,
  columns: ['robot_id', 'robot_state'],
  rows: [{ robot_id: 'amr01', robot_state: '<img src=x onerror=alert(1)>' }],
  attributes: [
    { Attribute: 'robot_id', 'PostgreSQL type': 'VARCHAR(16)', Required: true, Key: 'Primary key' },
  ],
  rows_state: 'ready',
};
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-db-status').textContent, 'Connected');
assert.equal(doc.getElementById('python-db-export').disabled, false);
assert.equal(doc.querySelector('.twin-records-browser').getAttribute('aria-busy'), 'false');
const recordRegion = doc.getElementById('python-db-records-table');
recordRegion.focus();
assert.equal(
  doc.activeElement,
  recordRegion,
  'record table can receive keyboard focus for scrolling',
);
assert.equal(recordRegion.getAttribute('role'), 'region');
assert.equal(recordRegion.getAttribute('aria-label'), 'Stored sensor records');
assert.equal(
  doc.querySelector('#python-db-records-table img'),
  null,
  'stored strings never become markup',
);
assert.match(doc.querySelector('#python-db-records-table').textContent, /<img src=x/);
const stableTable = doc.querySelector('#python-db-records-table table');
deliver(parent, w.location.origin);
assert.equal(
  doc.querySelector('#python-db-records-table table'),
  stableTable,
  'unchanged rows preserve table DOM',
);
doc.getElementById('python-db-attributes-tab').click();
assert.equal(doc.getElementById('python-db-records').hidden, true);
const fieldRegion = doc.getElementById('python-db-attributes-table');
fieldRegion.focus();
assert.equal(doc.activeElement, fieldRegion, 'field definitions can receive keyboard focus');
assert.equal(fieldRegion.getAttribute('aria-label'), 'Sensor field definitions');
doc
  .getElementById('python-db-attributes-tab')
  .dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
assert.equal(doc.getElementById('python-db-records').hidden, false);
assert.equal(doc.activeElement.id, 'python-db-records-tab');
const archiveChoice = doc.getElementById('python-db-dataset');
archiveChoice.value = 'amr_encoder_readings';
archiveChoice.dispatchEvent(new w.Event('change'));
assert.equal(
  doc.querySelector('#python-db-attributes-table table'),
  null,
  'old field definitions disappear while another dataset loads',
);
assert.equal(doc.querySelector('.twin-records-browser').getAttribute('aria-busy'), 'true');
archiveChoice.value = 'amr_commissioning_samples';
archiveChoice.dispatchEvent(new w.Event('change'));
deliver(parent, w.location.origin);
assert(
  doc.querySelector('#python-db-attributes-table table'),
  'rapid return to the original dataset still renders an identical response',
);
assert.equal(doc.getElementById('python-db-export').disabled, false);
archiveChoice.value = 'amr_encoder_readings';
archiveChoice.dispatchEvent(new w.Event('change'));
assert.equal(sent.at(-1).value.dataset, 'amr_encoder_readings');
assert.equal(doc.getElementById('python-db-export').disabled, true);
deliver(parent, w.location.origin);
assert.equal(
  doc.getElementById('python-db-title').textContent,
  'Wheel encoders',
  'late old rows cannot relabel a new selection',
);
payload.database = {
  ...payload.database,
  dataset: 'amr_encoder_readings',
  title: 'Wheel encoders',
  kind: 'View',
  rows: [],
};
deliver(parent, w.location.origin);
assert.equal(
  doc.getElementById('python-db-empty-title').textContent,
  'No records in Wheel encoders',
);
assert.match(doc.getElementById('python-db-empty-detail').textContent, /Choose Device telemetry/);
assert.equal(doc.querySelector('.twin-records-browser').getAttribute('aria-busy'), 'false');
assert.equal(doc.getElementById('python-db-export').disabled, true);
payload.database = { ...payload.database, rows_state: 'error' };
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-db-empty-title').textContent, 'Records could not be read');
assert.equal(doc.getElementById('python-db-row-count').textContent, 'Records unavailable');
payload.database = {
  ...payload.database,
  state: 'unreachable',
  label: 'Database connection failed',
  rows_state: 'unavailable',
};
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-db-empty-title').textContent, 'Archive unavailable');
assert(
  doc.querySelector('#python-db-attributes-table table'),
  'field definitions remain available without storage',
);
let actionCount = sent.length;
for (const bad of [
  { dataset: 'pg_authid', active: true },
  { dataset: 'amr_sensor_samples', active: 'true' },
])
  doc.dispatchEvent(
    new w.CustomEvent('python-twin:action', { detail: { action: 'database_browse', ...bad } }),
  );
assert.equal(
  sent.length,
  actionCount,
  'the archive bridge only accepts known datasets and a boolean visibility flag',
);
doc.dispatchEvent(new w.CustomEvent('python-twin:database-close'));
assert.equal(sent.at(-1).value.active, false, 'leaving the archive stops database polling');
delete payload.database;
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
assert.equal(doc.getElementById('hardware-summary').textContent, 'Sensor data: No sensor data');
payload.notice = {
  label: 'Measured calibration required',
  detail: 'The database is configured. Confirm measured calibration before interpreting estimates.',
  tone: 'warning',
};
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-data-title').textContent, 'Measured calibration required');
assert.match(doc.getElementById('python-data-detail').textContent, /database is configured/);
assert.equal(doc.getElementById('python-data-notice').dataset.tone, 'warning');
assert.equal(doc.getElementById('python-amr01-forecast').textContent, 'Unavailable');
assert.match(doc.querySelector('#activity .session-card').textContent, /AMR-01 · 1 virtual robot/);
assert.doesNotMatch(doc.querySelector('#help-dialog').textContent, /Hardware displays/);

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
let evidenceJSON,
  cleanupDownload,
  revokedURLs = 0,
  objectURLs = 0;
w.Blob = class {
  constructor(parts) {
    evidenceJSON = parts[0];
  }
};
w.URL.createObjectURL = () => 'blob:test-evidence-' + ++objectURLs;
w.URL.revokeObjectURL = () => revokedURLs++;
const originalSetTimeout = w.setTimeout;
w.setTimeout = (callback, delay) => {
  assert.equal(delay, 1000);
  cleanupDownload = callback;
};
payload.mode = 'demo';
payload.robots.amr01 = current;
payload.demo_trial = {
  id: 'baseline',
  label: 'Baseline run',
  source: 'synthetic',
  packet_count: 121,
  calibration: { capacity_ah: 2 },
  packets: [{ seq: 0 }],
  source_sha256: {},
};
deliver(parent, w.location.origin);
const evidenceLink = doc.getElementById('python-demo-export');
assert.equal(doc.getElementById('python-demo-controls').hidden, false);
assert.equal(evidenceLink.tagName, 'A', 'evidence uses a native browser download link');
assert.equal(evidenceLink.getAttribute('aria-disabled'), 'false');
assert.equal(evidenceLink.getAttribute('href'), 'blob:test-evidence-1');
deliver(parent, w.location.origin);
assert.equal(objectURLs, 1, 'unchanged polling preserves the current download URL');
doc.getElementById('python-demo-trial').value = 'disagreement';
doc.getElementById('python-demo-trial').dispatchEvent(new w.Event('change'));
assert.equal(sent.at(-1).value.action, 'demo_trial');
assert.equal(sent.at(-1).value.trial, 'disagreement');
assert.equal(evidenceLink.getAttribute('aria-disabled'), 'true');
assert.equal(
  evidenceLink.hasAttribute('href'),
  false,
  'pending trial cannot download old evidence',
);
const disabledClick = new w.MouseEvent('click', { cancelable: true });
assert.equal(evidenceLink.dispatchEvent(disabledClick), false);
deliver(parent, w.location.origin);
assert.equal(
  doc.getElementById('python-demo-trial').value,
  'disagreement',
  'old payload cannot reset a pending choice',
);
assert.equal(evidenceLink.hasAttribute('href'), false);
assert.match(doc.getElementById('python-data-detail').textContent, /Loading/);
payload.demo_trial = {
  ...payload.demo_trial,
  id: 'disagreement',
  label: 'Sustained sensor disagreement',
};
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-demo-controls').getAttribute('aria-busy'), 'false');
assert.equal(evidenceLink.getAttribute('aria-disabled'), 'false');
assert.equal(evidenceLink.getAttribute('href'), 'blob:test-evidence-2');
assert.equal(evidenceLink.download, 'amr01_disagreement_synthetic_trial.json');
const exportedTrial = JSON.parse(evidenceJSON);
assert.equal(exportedTrial.evidence_format, 'amr01.synthetic-trial.v1');
assert.equal(exportedTrial.source, 'synthetic');
assert.equal(exportedTrial.hardware_validation, false);
assert.equal(exportedTrial.trial.id, 'disagreement');
assert.equal(exportedTrial.outputs.amr01.soc, current.soc);
assert.equal(revokedURLs, 0, 'previous URL remains available while an existing download starts');
cleanupDownload();
assert.equal(revokedURLs, 1, 'superseded URL is released');
w.setTimeout = originalSetTimeout;
payload.mode = 'live';
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('python-demo-controls').hidden, true);
assert.equal(evidenceLink.hasAttribute('href'), false);
assert.equal(evidenceLink.hasAttribute('download'), false);
assert.equal(evidenceLink.getAttribute('aria-disabled'), 'true');
assert.equal(objectURLs, 2, 'physical readings cannot be exported under a generated-trial label');
delete payload.demo_trial;
doc.dispatchEvent(new w.CustomEvent('python-twin:connection-open'));
assert.equal(sent.at(-1).value.action, 'connection_view');
assert.equal(sent.at(-1).value.active, true);
payload.amr_connection = {
  configured: false,
  authorized: false,
  state: 'disconnected',
  detail: 'Private setup required',
  missing: ['EMQX subscriber credentials'],
  stages: [],
  insights: {
    ready: false,
    metrics: [],
    recommendations: [
      {
        title: 'Measured calibration required',
        detail: 'Confirm measured settings.',
        tone: 'warning',
      },
    ],
  },
};
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('amr-link-connect').disabled, true);
assert.equal(doc.getElementById('amr-link-state').textContent, 'Setup required');
assert.equal(doc.getElementById('amr-insights-empty').hidden, false);
assert.match(doc.getElementById('amr-live-recommendations').textContent, /Measured calibration/);
payload.amr_connection.configured = true;
payload.amr_connection.missing = [];
deliver(parent, w.location.origin);
doc.getElementById('amr-access-code').value = 'private-test-operator-code';
doc.getElementById('amr-link-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
assert.equal(sent.at(-1).value.action, 'connection_control');
assert.equal(sent.at(-1).value.command, 'connect');
assert.equal(sent.at(-1).value.access_code, 'private-test-operator-code');
assert.equal(
  doc.getElementById('amr-access-code').value,
  '',
  'operator code is cleared after submission',
);
assert.equal(w.localStorage.length, 0, 'no connection credentials are persisted');
const commandsBefore = sent.length;
doc.dispatchEvent(
  new w.CustomEvent('python-twin:action', {
    detail: { action: 'connection_control', command: 'drive', access_code: '' },
  }),
);
assert.equal(sent.length, commandsBefore, 'connection controls cannot publish motor commands');
payload.amr_connection.state = 'connecting';
payload.amr_connection.authorized = true;
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('amr-link-connect').disabled, true);
assert.equal(doc.getElementById('amr-link-disconnect').disabled, false);
assert.equal(doc.getElementById('amr-code-field').hidden, true);
payload.amr_connection.state = 'subscribed';
payload.amr_connection.subscribed = true;
payload.amr_connection.stages = [
  { label: 'ESP32 over Wi-Fi', state: 'waiting', detail: 'Waiting for physical samples' },
];
payload.amr_connection.insights.recommendations[0].title = '<img src=x onerror=alert(1)>';
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('amr-link-state').textContent, 'EMQX subscribed');
assert.match(doc.getElementById('amr-pipeline').textContent, /Waiting for physical samples/);
assert.equal(doc.getElementById('amr-live-recommendations').querySelector('img'), null);
doc.getElementById('amr-link-disconnect').click();
assert.equal(sent.at(-1).value.command, 'disconnect');
doc.dispatchEvent(new w.CustomEvent('python-twin:connection-close'));
assert.equal(sent.at(-1).value.action, 'connection_view');
assert.equal(sent.at(-1).value.active, false);
payload.human_review = {
  demo: true,
  eligible: true,
  source: 'Demo rehearsal',
  state_label: 'Ready for review',
  detail: 'Generated evidence only',
  recommendations: [],
  review: null,
};
deliver(parent, w.location.origin);
doc.getElementById('human-review-create').click();
assert.equal(sent.at(-1).value.action, 'human_review');
assert.equal(sent.at(-1).value.command, 'create');
payload.human_review.review = {
  review_id: 'a'.repeat(32),
  state: 'pending',
  evidence: {
    seq: 10,
    source: 'demo',
    recommendations: [{ title: '<img src=x onerror=alert(1)>' }],
  },
  events: [{ state: 'pending', detail: '<script>unsafe</script>' }],
};
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('human-review-form').hidden, false);
assert.equal(doc.getElementById('human-review').querySelector('img,script'), null);
doc.getElementById('human-review-action').value = 'pause';
doc.getElementById('human-review-reason').value = 'Inspect sustained disagreement';
doc.getElementById('human-review-form').dispatchEvent(
  new w.SubmitEvent('submit', {
    cancelable: true,
    submitter: doc.querySelector('#human-review-form button[value="approve"]'),
  }),
);
assert.equal(sent.at(-1).value.command, 'decide');
assert.equal(sent.at(-1).value.intervention, 'pause');
assert.equal(sent.at(-1).value.reason, 'Inspect sustained disagreement');
payload.human_review.demo = false;
payload.human_review.source = 'Website operator review';
payload.human_review.can_unlock = true;
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('human-review-controls').hidden, true);
assert.equal(doc.getElementById('human-review-form').hidden, true);
const reviewsBefore = sent.length;
doc
  .getElementById('human-review-form')
  .dispatchEvent(new w.SubmitEvent('submit', { cancelable: true }));
assert.equal(sent.length, reviewsBefore, 'Locked physical review cannot be approved');
doc.getElementById('human-review-code').value = 'private-test-code';
doc.getElementById('human-review-operator').value = 'operator01';
doc
  .getElementById('human-review-login')
  .dispatchEvent(new w.SubmitEvent('submit', { cancelable: true }));
assert.equal(sent.at(-1).value.command, 'login');
assert.equal(sent.at(-1).value.access_code, 'private-test-code');
assert.equal(sent.at(-1).value.operator, 'operator01');
assert.equal(doc.getElementById('human-review-code').value, '');
payload.human_review.authorized = true;
payload.human_review.can_review = true;
payload.human_review.owns_review = false;
deliver(parent, w.location.origin);
assert.equal(
  doc.getElementById('human-review-form').hidden,
  true,
  'Another session owns the displayed review',
);
payload.human_review.owns_review = true;
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('human-review-form').hidden, false);
doc
  .getElementById('human-review-form')
  .dispatchEvent(new w.SubmitEvent('submit', { cancelable: true }));
assert.equal(sent.at(-1).value.command, 'decide');
payload.human_review.review.state = 'sent';
deliver(parent, w.location.origin);
assert.equal(doc.getElementById('human-review-response').hidden, true);
const beforeFakeAck = sent.length;
doc.getElementById('human-review-response').click();
assert.equal(sent.length, beforeFakeAck, 'No simulated physical device response');
setImmediate(() => dom.window.close());
console.log(
  'PASS: original workspace receives Python-only sensor values; source identity, XSS-safe text, freshness, no floor mutation, navigation/scroll preservation and allowlisted source/inspection actions.',
);
