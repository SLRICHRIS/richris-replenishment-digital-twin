const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const base = path.resolve(__dirname, '../../frontend_warehouse_dashboard');
const dom = new JSDOM(fs.readFileSync(path.join(base, 'index.html'), 'utf8'), {
  runScripts: 'outside-only',
});
const w = dom.window,
  d = w.document,
  timers = [];
let now = Date.now(),
  commands = 0;
w.Date.now = () => now;
w.setInterval = (fn) => {
  timers.push(fn);
  return timers.length;
};
w.fetch = () => {
  throw Error('The architecture guide must not make requests');
};
d.addEventListener('python-twin:action', () => commands++);
const source = fs.readFileSync(
  path.join(base, 'browser_modules/streamlit_frame_connection/system_architecture_workspace.js'),
  'utf8',
);
vm.runInContext(source, dom.getInternalVMContext());
d.dispatchEvent(new w.Event('DOMContentLoaded'));
const el = (id) => d.getElementById('arch-' + id);
const nodes = () => [...d.querySelectorAll('[data-arch-node]')];
assert.equal(nodes().length, 5);
assert.equal(el('previous').disabled, true);
assert.match(el('detail-title').textContent, /Physical sensors/);
el('next').click();
assert.equal(nodes()[1].getAttribute('aria-pressed'), 'true');
assert.equal(el('detail-title').textContent, 'ESP32');
let revealed = 0;
el('inspector').scrollIntoView = () => revealed++;
nodes()[3].click();
assert.equal(revealed, 1, 'Selecting a component reveals its explanation');
assert.equal(el('detail-title').textContent, 'PostgreSQL on Neon');
let target;
d.querySelector('[data-page="database"]').addEventListener('click', () => {
  target = 'database';
});
el('open').click();
assert.equal(target, 'database');
el('tab-vision').click();
assert.match(el('detail-title').textContent, /Logitech/);
el('next').click();
assert.match(el('detail-role').textContent, /same webcam|Logitech webcam/);
assert.match(el('detail-gate').textContent, /Windows Camera app is not required/);
el('tab-vision').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
assert.equal(d.activeElement, el('tab-power'));
assert.equal(nodes().length, 3);
nodes()[1].click();
assert.match(el('detail-title').textContent, /Motor branch/);
assert.match(el('detail-input').textContent, /VIN\+/);
el('tab-models').click();
assert.match(el('detail-gate').textContent, /unsigned/);
assert.equal(el('raw-status').dataset.state, 'unknown');
const payload = {
  mode: 'live',
  physical_telemetry: { state: 'receiving', fresh: true, received_at: new Date(now).toISOString() },
  robots: { amr01: { quality: 'OK', stale: false, age_s: 0, continuity_lost: false, derived: {} } },
  vision_execution: {
    authorized: true,
    available: true,
    physical_mode: true,
    ready: true,
    scene: {
      valid: true,
      floor_width_mm: 425,
      floor_length_mm: 630,
      captured_at_ms: now,
      hardware: { ready: true, age_ms: 0 },
    },
  },
};
const render = () => d.dispatchEvent(new w.CustomEvent('python-twin:render', { detail: payload }));
render();
for (const id of ['raw-status', 'model-status', 'route-status'])
  assert.equal(el(id).dataset.state, 'good');
assert.match(
  el('detail-title').textContent,
  /Calibrated input/,
  'Live updates preserve the selected journey',
);
now += 1000;
timers[0]();
assert.equal(
  el('route-status').dataset.state,
  'pending',
  'Old scenes cannot keep a readiness badge',
);
now += 2000;
timers[0]();
assert.equal(
  el('model-status').dataset.state,
  'pending',
  'Model evidence expires without a new report',
);
now += 3000;
timers[0]();
assert.equal(
  el('raw-status').dataset.state,
  'pending',
  'Sensor evidence expires without a new report',
);
assert.match(el('raw-status').textContent, /Waiting for fresh/);
payload.robots.amr01.continuity_lost = true;
payload.physical_telemetry = { fresh: false, label: '<img src=x onerror=alert(1)>' };
render();
assert.equal(el('raw-status').querySelector('img'), null);
assert.match(el('raw-status').textContent, /<img/);
assert.equal(el('model-status').dataset.state, 'pending');
payload.mode = 'demo';
payload.vision_execution.scene.captured_at_ms = now;
render();
for (const id of ['raw-status', 'model-status', 'route-status'])
  assert.notEqual(el(id).dataset.state, 'good');
now += 6000;
timers[0]();
for (const id of ['raw-status', 'model-status', 'route-status'])
  assert.equal(el(id).dataset.state, 'pending', 'Known blockers survive memoized server reports');
vm.runInContext(source, dom.getInternalVMContext());
assert.equal(timers.length, 1, 'No duplicate initialization or polling');
assert.equal(commands, 0, 'Exploration never dispatches commands or source changes');
w.close();
console.log(
  'PASS: architecture journeys, keyboard inspection, source/freshness status and command-free exploration.',
);
