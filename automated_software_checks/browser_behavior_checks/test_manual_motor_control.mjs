import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createManualMotorPanel } from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/manual_motor_control.js';
const dom = new JSDOM(
  '<body data-view="vision"><div id="vision-routing-shell" data-mode="manual"></div><div id="manual-motor-control"></div></body>',
  { pretendToBeVisual: true },
);
const w = dom.window,
  d = w.document,
  actions = [];
d.addEventListener('python-twin:action', (e) => actions.push(e.detail));
const panel = createManualMotorPanel(w),
  el = (id) => d.getElementById('mc-' + id);
assert.equal(el('prepare').disabled, true);
assert.equal(el('code').disabled, false, 'Operator field remains editable');
const review = {
  review_id: 'a'.repeat(32),
  direction: 'F',
  pwm: 40,
  duration_ms: 250,
  state: 'manual_review',
  reason: 'Review',
};
panel.render({
  authorized: true,
  can_unlock: true,
  physical_mode: true,
  ready: true,
  review,
  feedback: '<img src=x>',
});
assert.equal(el('feedback').querySelector('img'), null);
el('reason').value = 'Clear floor observed';
el('reason').dispatchEvent(new w.Event('input'));
el('approve').click();
el('approve').click();
assert.equal(
  actions.filter((a) => a.command === 'approve').length,
  1,
  'Double clicks cannot repeat a pending approval',
);
assert.equal(el('approve').disabled, true);
panel.render({
  authorized: true,
  ready: true,
  review: { ...review, state: 'manual_stopped', reason: 'ESP32 reports zero motor outputs' },
});
assert.equal(el('review').hidden, true);
assert.match(el('outcome').textContent, /zero motor outputs/);
d.dispatchEvent(new w.CustomEvent('vision-routing:mode'));
assert.equal(actions.at(-1).active, true);
d.getElementById('vision-routing-shell').dataset.mode = 'practice';
d.dispatchEvent(new w.CustomEvent('vision-routing:mode'));
assert.equal(actions.at(-1).active, false);
// Diagnostic text explains a blocked button without making a motor request.
const countBefore = actions.length;
panel.render({
  authorized: true,
  physical_mode: true,
  ready: false,
  transport: { state: 'login_rejected', connected: false, reason: '<img src=x>' },
  diagnostics: { packet_count: 0 },
});
assert.match(el('connection').textContent, /rejected the website login/);
assert.equal(el('transport').querySelector('img'), null);
assert.equal(el('prepare').disabled, true);
panel.render({
  authorized: true,
  physical_mode: true,
  ready: false,
  transport: { state: 'subscribed', connected: true },
  diagnostics: {
    packet_count: 3,
    accepted_count: 0,
    rejected_count: 3,
    last_issue: 'clock_ahead',
    clock_age_ms: -2000,
  },
});
assert.match(el('connection').textContent, /clock\/freshness/);
assert.match(el('clock').textContent, /-2000 ms/);
assert.match(el('hint').textContent, /ahead of the server/);
assert.equal(el('prepare').disabled, true);
panel.render({
  authorized: true,
  ready: false,
  transport: { state: 'subscribed', connected: true },
  diagnostics: { packet_count: 0 },
});
assert.match(el('connection').textContent, /no valid ESP32 receiver feedback/);
assert.equal(
  actions.length,
  countBefore,
  'Diagnostic updates never emit motor or approval actions',
);
panel.destroy();
w.close();
console.log(
  'PASS: one approval click, editable code, output acknowledgement, escaped feedback and page presence.',
);
