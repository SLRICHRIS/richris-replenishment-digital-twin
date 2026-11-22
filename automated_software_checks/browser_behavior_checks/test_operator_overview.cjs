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
const scrollFrames = [];
w.requestAnimationFrame = (callback) => {
  scrollFrames.push(callback);
  return scrollFrames.length;
};
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
frame.id = 'lc-frame';
d.body.append(frame);
d.dispatchEvent(new w.CustomEvent('local-controller:view'));
assert.equal(el('control-title').textContent, 'Preset routes panel open');
assert.match(el('control-detail').textContent, /does not authorize motion/);
frame.remove();
d.dispatchEvent(new w.CustomEvent('local-controller:view'));
assert.equal(el('control-title').textContent, 'Preset station routes');
let local = 0;
d.getElementById('vision-mode-local').addEventListener('click', () => local++);
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
assert.equal(local, 1);
assert.match(el('review-detail').textContent, /Preset movement uses the local controller/);
assert.equal(readings, 1);
assert.equal(review, 1);
assert.equal(d.getElementById('amr-connection-workspace').open, true);
assert.deepEqual(
  actions,
  [],
  'Workflow shortcuts cannot connect a device, approve, or send a motor request',
);
async function checkConnectionScrollOrder() {
  scrollFrames.length = 0;
  const main = d.getElementById('main-content'),
    settings = d.getElementById('amr-connection-workspace');
  d.body.dataset.view = 'hardware';
  settings.open = false;
  main.scrollTop = 250;
  let reveals = 0;
  settings.scrollIntoView = () => {
    reveals++;
    main.scrollTop = 500;
  };
  d.getElementById('tab-vision').addEventListener('click', () => {
    d.body.dataset.view = 'vision';
  });
  const reset = new w.MutationObserver(() => {
    main.scrollTop = 0;
  });
  reset.observe(d.body, { attributes: true, attributeFilter: ['data-view'] });
  el('connect').click();
  assert.equal(settings.open, true);
  assert.equal(reveals, 0, 'Connection navigation waits until after the host tab reset');
  await Promise.resolve();
  assert.equal(main.scrollTop, 0);
  scrollFrames.splice(0).forEach((callback) => callback());
  assert.equal(main.scrollTop, 500, 'Connection settings remain visible after host reset');
  assert.equal(reveals, 1);
  el('connect').click();
  d.body.dataset.view = 'hardware';
  await Promise.resolve();
  scrollFrames.splice(0).forEach((callback) => callback());
  assert.equal(reveals, 1, 'A quick navigation away cannot scroll a different page');
  reset.disconnect();
  assert.deepEqual(actions, [], 'Section navigation never dispatches commands');
  w.close();
  console.log(
    'PASS: operator workflow source/freshness/access distinctions and section navigation after host reset, without actuation.',
  );
}
checkConnectionScrollOrder().catch((error) => {
  w.close();
  console.error(error);
  process.exitCode = 1;
});
