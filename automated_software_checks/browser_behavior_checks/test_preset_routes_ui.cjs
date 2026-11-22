const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(
  'backend_streamlit_and_telemetry/vision_control/preset_routes.html',
  'utf8',
);
const dashboard = 'https://richris-replenishment-digital-twin-s99b4letmnfusbbh6sjab9.streamlit.app';
const dom = new JSDOM(
  html.replace('__AMR_SESSION__', 'test-only').replace('__AMR_DASHBOARD_ORIGIN__', dashboard),
  {
    url: 'http://127.0.0.1:8765/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  },
);
const w = dom.window,
  d = w.document,
  $ = (id) => d.getElementById(id);
const intervals = new Map(),
  calls = [],
  parentMessages = [];
Object.defineProperty(w, 'parent', {
  value: {
    postMessage: (value, origin) => parentMessages.push({ value, origin }),
  },
});
let hidden = false;
Object.defineProperty(d, 'hidden', { get: () => hidden });
w.setInterval = (f, n) => {
  intervals.set(n, f);
  return n;
};
let state = {
  state: 'idle',
  message: 'Connect',
  connected: false,
  ready: false,
  hardware: null,
  controller_ip: '10.55.54.112',
  min_voltage_v: 6.0,
  max_pwm: 200,
  busy: false,
  measurements: { version: 1, samples: {} },
  last_test: null,
  stations: {
    E: { front_mm: [290, 75] },
    A: { front_mm: [630, 350] },
    B: { front_mm: [205, 430] },
  },
  routes: [
    {
      id: 'E-A',
      start: 'E',
      destination: 'A',
      start_facing: 'DOWN',
      end_facing: 'RIGHT',
      start_centre_mm: [290, 160],
      goal_centre_mm: [545, 350],
      steps: [
        { motion: 'left', amount: 126.6897 },
        { motion: 'forward', amount: 318.0016 },
        { motion: 'right', amount: 36.6897 },
      ],
    },
    {
      id: 'A-B',
      start: 'A',
      destination: 'B',
      start_facing: 'RIGHT',
      end_facing: 'UP',
      start_centre_mm: [545, 350],
      goal_centre_mm: [205, 345],
      steps: [{ motion: 'right', amount: 179.1575 }],
    },
  ],
};
w.fetch = async (path, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ path, body, options });
  if (path === '/api/connect') {
    state.connected = true;
    state.ready = true;
  }
  if (path === '/api/start' || path === '/api/trial') {
    state.busy = true;
    state.state = 'running';
  }
  if (path === '/api/stop') {
    state.busy = false;
    state.state = 'stopped';
  }
  if (path === '/api/confirm-arrival') state.state = 'operator_confirmed';
  return { ok: true, json: async () => structuredClone(state) };
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const change = (id) => $(id).dispatchEvent(new w.Event('change'));
(async () => {
  w.eval(d.querySelector('script').textContent);
  await flush();
  assert.equal(parentMessages.length, 1);
  assert.equal(parentMessages[0].origin, dashboard);
  assert.deepEqual(JSON.parse(JSON.stringify(parentMessages[0].value)), {
    type: 'amr-preset:ready',
    version: 1,
  });
  assert(calls.every((c) => ['/api/status', '/api/presence'].includes(c.path)));
  assert($('start').disabled);
  assert.match($('placement').textContent, /E.*29, 7.5.*DOWN/);
  assert.match($('steps').textContent, /126.7°.*31.8 cm.*36.7°/);
  assert.deepEqual(
    Array.from($('route').options, (o) => o.value),
    ['E-A', 'A-B', 'B-E'],
  );
  $('connect').click();
  await flush();
  assert($('start').disabled); // Measurements, not merely connection, needed.
  $('test-clear').checked = true;
  change('test-clear');
  d.querySelector('[data-trial="left"]').click();
  await flush();
  const trial = calls.find((c) => c.path === '/api/trial');
  assert.equal(trial.body.motion, 'left');
  assert.equal(trial.body.pwm, 200);
  assert.equal($('pwm').max, '200');
  assert.equal(trial.body.confirmed, true);
  assert.equal($('test-clear').checked, false);
  assert($('start').disabled);
  $('stop').click();
  await flush();
  state.state = 'trial_complete';
  state.last_test = { id: 'a'.repeat(32), motion: 'forward', saved: false };
  await intervals.get(300)();
  await flush();
  assert.equal($('measurement').hidden, false);
  $('amount').value = '2.5';
  $('coast').value = '0.5';
  $('measured').checked = true;
  $('save-measurement').click();
  await flush();
  const result = calls.find((c) => c.path === '/api/measurement').body;
  assert.equal(result.amount, 25);
  assert.equal(result.stopping_mm, 5);
  state.last_test = null;
  state.measurements.samples = {
    forward: { rate: 20, pwm: 200 },
    left: { rate: 30, pwm: 200 },
    right: { rate: 30, pwm: 200 },
  };
  await intervals.get(300)();
  await flush();
  assert($('start').disabled);
  $('placed').checked = true;
  change('placed');
  assert.equal($('start').disabled, false);
  $('route').value = 'A-B';
  change('route');
  assert.equal($('placed').checked, false);
  assert($('start').disabled);
  $('placed').checked = true;
  change('placed');
  $('start').click();
  await flush();
  assert.equal(calls.filter((c) => c.path === '/api/start').length, 1);
  assert.equal(calls.find((c) => c.path === '/api/start').body.route, 'A-B');
  assert.equal($('placed').checked, false);
  $('start').click();
  await flush();
  assert.equal(calls.filter((c) => c.path === '/api/start').length, 1);
  hidden = true;
  d.dispatchEvent(new w.Event('visibilitychange'));
  await flush();
  assert(calls.some((c) => c.path === '/api/presence' && c.body.active === false));
  const count = calls.filter((c) => c.path === '/api/start').length;
  hidden = false;
  d.dispatchEvent(new w.Event('visibilitychange'));
  await flush();
  assert.equal(calls.filter((c) => c.path === '/api/start').length, count);
  state.busy = false;
  state.state = 'sequence_complete';
  await intervals.get(300)();
  await flush();
  assert.equal($('confirm-arrival').hidden, false);
  assert.equal(calls.filter((c) => c.path === '/api/confirm-arrival').length, 0);
  $('confirm-arrival').click();
  await flush();
  assert.equal(calls.filter((c) => c.path === '/api/confirm-arrival').length, 1);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  await flush();
  assert(calls.filter((c) => c.path === '/api/stop').length >= 2);
  state.message = 'Stopped: ESP32 reported not ready (receiver state: unavailable)';
  state.last_stop = {
    hardware: { battery_voltage_v: 7.64, age_ms: 261, ready: false, state: 'unavailable' },
  };
  state.hardware = {
    battery_voltage_v: 7.65,
    age_ms: 100,
    ready: true,
    state: 'stopped',
    left_duty: 0,
    right_duty: 0,
  };
  const movementCalls = calls.filter((c) => ['/api/start', '/api/trial'].includes(c.path)).length;
  await intervals.get(300)();
  await flush();
  assert.match($('status').textContent, /ESP32 reported not ready/);
  assert.match($('feedback').textContent, /7.65 V.*100 ms old.*Receiver ready/);
  assert.match($('feedback').textContent, /Cutoff 6.00 V/);
  assert.match($('feedback').textContent, /App PWM limit 200/);
  assert.equal($('stop-detail').hidden, false);
  assert.match(
    $('stop-detail').textContent,
    /At the stop: 7.64 V.*261 ms old.*Receiver not ready.*unavailable/,
  );
  assert.equal(
    calls.filter((c) => ['/api/start', '/api/trial'].includes(c.path)).length,
    movementCalls,
  );
  assert(!html.includes('getUserMedia'));
  dom.window.close();
  console.log(
    'PASS: preset controls require measured timing and explicit Start; hiding cancels, arrival stays human-confirmed.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  dom.window.close();
});
