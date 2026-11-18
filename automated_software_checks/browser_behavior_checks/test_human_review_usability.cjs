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
w.dispatchEvent(new w.Event('pagehide'));
w.close();
console.log(
  'PASS: actionable calibration blockers, isolated practice, owned decision gates, preserved inputs, request/reply/verification separation, expiry and safe text.',
);
