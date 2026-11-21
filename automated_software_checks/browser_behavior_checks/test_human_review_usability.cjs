const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '../../frontend_warehouse_dashboard');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  url: 'https://example.test',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window,
  d = w.document,
  el = (id) => d.getElementById('human-review-' + id),
  actions = [];
d.addEventListener('python-twin:action', (e) => actions.push(JSON.parse(JSON.stringify(e.detail))));
const style = d.createElement('style');
style.textContent = fs.readFileSync(
  path.join(root, 'dashboard_stylesheets/human_review_panel_styles.css'),
  'utf8',
);
d.head.append(style);
w.eval(
  fs.readFileSync(
    path.join(root, 'browser_modules/streamlit_frame_connection/human_review_panel.js'),
    'utf8',
  ),
);
d.dispatchEvent(new w.Event('DOMContentLoaded'));
let now = Date.now();
w.Date.now = () => now;
const input = (id, value) => {
  el(id).value = value;
  el(id).dispatchEvent(new w.Event('input', { bubbles: true }));
};
const baseline = {
  demo: false,
  eligible: false,
  authorized: false,
  owns_review: false,
  can_unlock: false,
  can_review: false,
  commands_enabled: false,
  missing: ['Measured AMR-01 calibration'],
  recommendations: [],
  review: null,
};
function render(update = {}, extra = {}) {
  d.dispatchEvent(
    new w.CustomEvent('python-twin:render', {
      detail: {
        mode: update.demo ? 'demo' : 'live',
        ...extra,
        human_review: { ...baseline, ...update },
      },
    }),
  );
}
render();
assert.match(el('state').textContent, /Finish sensor calibration/);
assert.match(el('checklist').textContent, /measured sensor calibration/);
assert.equal(el('auth').hidden, true);
assert.equal(el('controls').hidden, true);
assert.equal(el('technical').open, false, 'Implementation details start collapsed');
assert.equal(el('calibration-help').hidden, false);
assert.equal(w.getComputedStyle(el('form')).display, 'none', 'Hidden gates beat layout rules');
assert.equal(actions.length, 0, 'Rendering a blocker never attempts a command');
el('practice').click();
assert.deepEqual(actions.at(-1), { action: 'sensor_source', mode: 'demo' });
let navigated = 0;
d.getElementById('tab-connection').addEventListener('click', () => navigated++);
el('connection').click();
assert.equal(navigated, 1);
const rec = [{ title: 'Inspect motion sensors', detail: 'Compare the current motion readings.' }];
const ready = { demo: true, eligible: true, can_review: true, missing: [], recommendations: rec };
render(ready);
assert.equal(el('preparation').hidden, true);
assert.equal(el('step-2').getAttribute('aria-current'), 'step');
assert.equal(el('create').disabled, false);
el('create').click();
assert.deepEqual(actions.at(-1), { action: 'human_review', command: 'create' });
const row = {
  review_id: 'b'.repeat(32),
  state: 'pending',
  expires_at: now / 1000 + 30,
  evidence: { seq: 23, source: 'demo', recommendations: rec },
  events: [],
  verified_samples: 0,
  command: null,
  ack: null,
};
render({ ...ready, review: row });
assert.equal(el('form').hidden, false);
assert.equal(el('create').hidden, true);
const approve = el('form').querySelector('button[value="approve"]');
assert.equal(approve.disabled, true, 'Reason is required');
assert.equal(el('action').value, 'no_action');
el('reason').focus();
input('reason', 'Inspect the wheel readings');
el('action').value = 'pause';
el('action').dispatchEvent(new w.Event('change'));
render({ ...ready, review: row });
assert.equal(d.activeElement, el('reason'), 'Polling preserves decision focus');
assert.equal(el('action').value, 'pause', 'Polling preserves the selected response');
assert.equal(el('reason').value, 'Inspect the wheel readings');
assert.equal(approve.textContent, 'Approve pause request');
approve.click();
assert.equal(actions.at(-1).command, 'decide');
assert.equal(actions.at(-1).intervention, 'pause');
assert.equal(actions.at(-1).review_id, row.review_id);
assert.equal('evidence' in actions.at(-1), false);
const command = { action: 'pause' };
render({ ...ready, review: { ...row, state: 'sent', command } });
assert.match(el('state').textContent, /Waiting for the AMR/);
assert.equal(el('step-3').getAttribute('aria-current'), 'step');
assert.equal(el('response').hidden, false);
assert.equal(el('response').textContent, 'Simulate AMR reply');
assert.match(el('result-checks').textContent, /0 of 3/);
el('response').click();
assert.equal(actions.at(-1).command, 'response');
render({
  ...ready,
  review: {
    ...row,
    state: 'acknowledged',
    command,
    ack: { status: 'applied' },
    verified_samples: 1,
  },
});
assert.match(el('state').textContent, /checking fresh readings/);
assert.match(el('result-checks').textContent, /1 of 3/);
assert.equal(el('response').textContent, 'Simulate 3 fresh readings');
render({
  ...ready,
  review: { ...row, state: 'verified', command, ack: { status: 'applied' }, verified_samples: 3 },
});
assert.equal(el('summary').dataset.kind, 'success');
assert.match(el('result-checks').textContent, /3 of 3/);
assert.equal(el('response').hidden, true);
assert.match(el('result-note').textContent, /Practice result only/);
const physical = {
  ...ready,
  demo: false,
  authorized: true,
  owns_review: true,
  can_unlock: true,
  commands_enabled: false,
};
render({ ...physical, review: { ...row, evidence: { ...row.evidence, source: 'live' } } });
assert.equal(el('reason').value, '', 'Physical source never inherits the practice draft');
el('action').value = 'pause';
input('reason', 'Record the requested response');
assert.equal(approve.textContent, 'Record approval only');
assert.match(el('action-help').textContent, /cannot run later/);
render({ ...physical, review: { ...row, state: 'blocked' } });
assert.match(el('state').textContent, /not delivered/);
assert.match(el('summary-detail').textContent, /Nothing is queued/);
assert.notEqual(el('summary').dataset.kind, 'success');
render({ ...physical, review: { ...row, state: 'sent', command } });
assert.equal(el('response').hidden, true);
const before = actions.length;
el('response').click();
assert.equal(actions.length, before, 'Physical ACK cannot be simulated');
render({ ...physical, owns_review: false, review: row });
assert.equal(el('form').hidden, true);
el('form').dispatchEvent(new w.SubmitEvent('submit', { cancelable: true, submitter: approve }));
assert.equal(actions.length, before, 'Another operator review cannot be adopted');
render({ ...physical, authorized: false, review: null });
assert.equal(el('auth').hidden, false);
el('operator').value = 'operator01';
el('code').value = 'private-fixture-code';
el('login').dispatchEvent(new w.Event('submit', { cancelable: true }));
assert.equal(actions.at(-1).command, 'login');
assert.equal(el('code').value, '');
render({ ...physical, review: row });
input('reason', 'A physical response');
render({ ...physical, eligible: false, review: row });
assert.equal(approve.disabled, true, 'Stale/ineligible evidence blocks approval');
assert.equal(
  el('form').querySelector('button[value="reject"]').disabled,
  false,
  'Rejecting remains available',
);
now += 31000;
render({ ...physical, review: row });
assert.equal(el('form').hidden, true);
assert.equal(el('create').disabled, false);
assert.match(el('state').textContent, /timed out/);
render({
  ...physical,
  review: null,
  recommendations: [{ title: '<img src=x onerror=alert(1)>', detail: '<script>unsafe</script>' }],
  feedback: '<svg onload=alert(1)>',
});
assert.equal(el('recommendations').querySelector('img,script'), null);
assert.equal(el('feedback').querySelector('svg'), null);
assert.match(el('recommendations').textContent, /<img/);
const observations = { ...physical, observation_only: true, review: null };
render(observations);
assert.equal(el('create').disabled, false);
assert.match(el('step-1-detail').textContent, /Live sensor evidence/);
assert.match(el('step-3-detail').textContent, /Fresh sensor follow-up/);
assert.deepEqual(
  Array.from(el('action').options, (o) => o.value),
  ['no_action', 'inspect', 'recharge'],
);
assert.match(el('availability').textContent, /Observation review enabled/);
const observationRow = {
  ...row,
  expires_at: now / 1000 + 30,
  evidence: {
    ...row.evidence,
    source: 'live',
    scope: 'physical_observation',
    measurements: { battery_voltage_v: 6.2 },
  },
};
render({ ...observations, review: observationRow });
el('action').value = 'recharge';
input('reason', 'Check battery power before the next drive');
render({ ...observations, review: observationRow });
assert.equal(el('action').value, 'recharge', 'Observation draft survives sensor polling');
assert.equal(approve.textContent, 'Record decision');
approve.click();
assert.equal(actions.at(-1).intervention, 'recharge');
const observationResult = {
  ...observationRow,
  state: 'observing',
  decision: { action: 'recharge' },
  verified_samples: 1,
  events: [
    {
      state: 'observing',
      detail: 'New reading',
      observation: {
        measurements: { battery_voltage_v: 6.3 },
        recommendations: [{ title: 'Charge before driving' }],
      },
    },
  ],
};
render({ ...observations, review: observationResult });
assert.match(el('result-checks').textContent, /Not issued.*1 of 3/s);
assert.match(el('result-note').textContent, /6.200 → 6.300 V/);
assert.doesNotMatch(el('result-checks').textContent, /applied|AMR response/);
render({
  ...observations,
  review: { ...observationResult, state: 'observed', verified_samples: 3 },
});
assert.match(el('state').textContent, /Follow-up readings recorded/);
assert.match(el('result-note').textContent, /do not confirm/);
assert.equal(el('create').disabled, false);
render(
  { ...observations, eligible: false },
  {
    insights: {
      recommendations: [{ title: 'Restore the live ESP32 feed', detail: 'Check power and Wi-Fi.' }],
    },
  },
);
assert.match(el('checklist').textContent, /Restore the live ESP32 feed/);
assert.doesNotMatch(el('summary-detail').textContent, /calibrat/);
let driveNavigation = 0;
const handoffs = [];
d.addEventListener('human-review:drive', (event) => handoffs.push(event.detail));
d.getElementById('tab-vision').addEventListener('click', () => driveNavigation++);
d.getElementById('vision-mode-manual').addEventListener('click', () => driveNavigation++);
const localConnect = d.createElement('button');
localConnect.id = 'mc-connect';
let connections = 0;
localConnect.addEventListener('click', () => connections++);
d.body.append(localConnect);
const count = actions.length;
el('drive').click();
assert.equal(driveNavigation, 2);
assert.equal(connections, 1, 'Explicit handoff opens the native controller page');
assert.equal(actions.length, count, 'Drive shortcut navigates only; no motor command');
const catalog = [
  { id: 'no_action', label: 'Keep monitoring', detail: 'Compare the next readings.' },
  {
    id: 'inspect_power',
    label: 'Inspect motor power',
    detail: 'Check VM and STBY with power off.',
  },
  {
    id: 'lower_power',
    label: 'Review lower power',
    detail: 'Stop first and select a verified lower setting.',
  },
];
render({ ...observations, available_actions: catalog, review: null });
const priorActions = actions.length;
d.dispatchEvent(new w.CustomEvent('human-review:open', { detail: { action: 'inspect_power' } }));
assert.equal(actions.length, priorActions, 'Recommendation selection does not capture or approve');
render({ ...observations, available_actions: catalog, review: observationRow });
assert.equal(
  el('action').value,
  'inspect_power',
  'Suggested response survives explicit evidence capture',
);
assert.match(el('action-help').textContent, /VM and STBY/);
input('reason', 'Check supply wiring');
render({ ...observations, available_actions: catalog, review: observationRow });
assert.equal(el('action').value, 'inspect_power');
assert.equal(el('reason').value, 'Check supply wiring');
render({
  ...observations,
  available_actions: catalog,
  review: { ...observationResult, decision: { decision: 'approve', action: 'lower_power' } },
});
el('drive').click();
assert.equal(handoffs.at(-1).label, 'Review lower power');
assert.equal(actions.length, priorActions, 'Handing off a saved response cannot send a command');
render({ ...observations, demo: true, observation_only: false, review: null });
render({ ...observations, available_actions: catalog, review: observationRow });
assert.equal(el('action').value, 'no_action', 'Changing sources clears a suggested action');
w.dispatchEvent(new w.Event('pagehide'));
w.close();
console.log(
  'PASS: actionable calibration blockers, isolated practice, owned decision gates, preserved inputs, request/reply/verification separation, expiry and safe text.',
);
