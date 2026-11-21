const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const root = 'frontend_warehouse_dashboard/';
const dom = new JSDOM(fs.readFileSync(root + 'index.html', 'utf8'), {
  url: 'https://example.test',
  runScripts: 'outside-only',
});
const w = dom.window,
  d = w.document,
  el = (id) => d.getElementById('operator-' + id);
const actions = [];
d.addEventListener('python-twin:action', (e) => actions.push(e.detail));
w.eval(
  fs.readFileSync(root + 'browser_modules/streamlit_frame_connection/operator_overview.js', 'utf8'),
);
d.dispatchEvent(new w.Event('DOMContentLoaded'));
const render = (p) => d.dispatchEvent(new w.CustomEvent('python-twin:render', { detail: p }));
assert.equal(d.documentElement.dataset.standalone, 'true');
assert.match(el('feed-detail').textContent, /full dashboard/);
render({
  mode: 'live',
  physical_telemetry: { fresh: false, age_s: 2400, received_at: '2026-11-21T21:47:59Z' },
  human_review: { eligible: false },
});
assert.equal(el('feed-title').textContent, 'Sensor feed out of date');
assert.match(el('feed-detail').textContent, /40 min ago/);
assert.equal(el('review-title').textContent, 'Fresh evidence needed');
render({
  mode: 'live',
  physical_telemetry: { fresh: true, age_s: 0.2 },
  human_review: { eligible: true, authorized: false },
});
assert.equal(el('feed-title').textContent, 'Fresh sensor data');
assert.equal(el('review-title').textContent, 'Enable operator review');
render({
  mode: 'live',
  physical_telemetry: { fresh: true, age_s: 6 },
  human_review: { eligible: true, authorized: true },
});
assert.notEqual(el('feed-title').textContent, 'Fresh sensor data');
assert.equal(el('review-title').textContent, 'Fresh evidence needed');
render({ mode: 'demo', physical_telemetry: { fresh: true, age_s: 0.1 } });
assert.equal(el('feed-title').textContent, 'Generated example');
assert.equal(el('review-title').textContent, 'Practice review');
render({
  mode: 'live',
  physical_telemetry: { fresh: false, age_s: 60 },
  display_freshness: { dashboard_stalled: true },
});
assert.match(el('source').textContent, /Dashboard updates paused/);
const frame = d.createElement('iframe');
frame.id = 'mc-controller-frame';
d.body.append(frame);
d.dispatchEvent(new w.CustomEvent('manual-controller:view'));
assert.equal(el('control-title').textContent, 'Controller page open');
assert.match(el('control-detail').textContent, /not an acknowledgement/);
frame.remove();
d.dispatchEvent(new w.CustomEvent('manual-controller:view'));
assert.equal(el('control-title').textContent, 'Direct Wi-Fi control');
let drive = 0,
  readings = 0,
  review = 0;
d.getElementById('tab-vision').addEventListener('click', () => drive++);
d.getElementById('tab-hardware').addEventListener('click', () => readings++);
d.addEventListener('human-review:open', () => review++);
el('drive').click();
el('readings').click();
el('decide').click();
el('connect').click();
assert.equal(drive, 2);
assert.equal(readings, 1);
assert.equal(review, 1);
assert.equal(d.getElementById('amr-connection-workspace').open, true);
assert.deepEqual(
  actions,
  [],
  'Workflow shortcuts cannot connect a device, approve, or send a motor request',
);
w.close();
console.log(
  'PASS: operator workflow distinguishes source, freshness, review access and iframe presence without actuation.',
);
