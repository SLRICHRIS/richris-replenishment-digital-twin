import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPhysicalRoutePanel } from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/physical_route_execution.js';
const dom = new JSDOM('<body data-view="vision"><div id="physical-route-execution"></div></body>', {
  url: 'https://example.test',
  pretendToBeVisual: true,
});
const w = dom.window,
  d = w.document,
  actions = [];
d.addEventListener('python-twin:action', (e) => actions.push(e.detail));
const panel = createPhysicalRoutePanel(w),
  el = (n) => d.getElementById('pr-' + n);
assert.equal(actions[0].command, 'view');
assert.equal(actions[0].active, true);
assert.ok(el('approve').disabled);
assert.ok(el('capture').disabled);
panel.render({ can_unlock: false, missing: ['Camera commissioning'], physical_mode: true });
assert.ok(el('unlock').disabled);
assert.match(el('missing').textContent, /commissioning/);
const now = Date.now(),
  p = {
    authorized: true,
    available: true,
    physical_mode: true,
    ready: true,
    missing: [],
    scene: {
      valid: true,
      floor_width_mm: 610,
      floor_length_mm: 630,
      seq: 10,
      captured_at_ms: now,
      pose: { x: 300, y: 300, heading: 0 },
      obstacles: [],
      hardware: { ready: true, age_ms: 0, battery_voltage_v: 7.4, left_duty: 0, right_duty: 0 },
    },
    review: {
      review_id: 'a'.repeat(32),
      state: 'pending',
      created_at_ms: now,
      expires_at_ms: now + 60000,
      route: {
        goal: [210, 450],
        length_mm: 300,
        clearance_radius_mm: 100,
        points: [
          [300, 300],
          [210, 450],
        ],
      },
      reason: 'Review required',
    },
  };
panel.render(p);
assert.equal(panel.getStage(), 4);
assert.equal(el('approve').disabled, true, 'A decision needs an entered reason');
assert.equal(el('login').hidden, true);
el('reason').focus();
el('reason').value = 'Clear floor checked';
el('reason').dispatchEvent(new w.Event('input'));
panel.render(p);
assert.equal(panel.getStage(), 4, 'Polling must keep the pending review visible');
assert.equal(d.activeElement, el('reason'), 'Polling preserves decision input focus');
assert.equal(el('approve').disabled, false);
el('goal-x').value = '200';
el('goal-x').dispatchEvent(new w.Event('input'));
assert.ok(el('approve').disabled, 'Changing the draft destination requires a new proposal');
el('goal-x').value = '210';
el('goal-x').dispatchEvent(new w.Event('input'));
assert.equal(el('approve').disabled, false);
el('approve').click();
assert.deepEqual(actions.at(-1), {
  action: 'vision_execution',
  command: 'decide',
  review_id: 'a'.repeat(32),
  decision: 'approve',
  reason: 'Clear floor checked',
});
assert.equal('route' in actions.at(-1), false);
assert.equal('pose' in actions.at(-1), false);
panel.render({ ...p, review: { ...p.review, state: 'running', reason: 'Camera feedback active' } });
assert.equal(el('stop').disabled, false);
assert.equal(panel.getStage(), 5);
panel.showStage(1);
assert.equal(panel.getStage(), 5, 'An active journey stays on its stop and evidence screen');
assert.ok(el('step-1').disabled);
assert.equal(el('approve').disabled, true);
el('stop').click();
assert.equal(actions.at(-1).command, 'stop');
panel.render({ ...p, scene: { ...p.scene, captured_at_ms: now - 10000 } });
assert.equal(el('approve').disabled, true);
assert.equal(el('capture').disabled, true);
assert.equal(el('map-content').childElementCount, 0);
panel.render({ ...p, scene: { ...p.scene, floor_width_mm: 841, floor_length_mm: 1189 } });
assert.equal(el('approve').disabled, true);
assert.equal(el('map-content').childElementCount, 0);
panel.render({ ...p, scene: { ...p.scene, hardware: { ...p.scene.hardware, age_ms: 1000 } } });
assert.ok(el('approve').disabled, 'A stale receiver blocks approval');
assert.ok(el('capture').disabled);
panel.render({ ...p, review: { ...p.review, expires_at_ms: now - 1 } });
assert.ok(el('approve').disabled, 'Expired proposals cannot be approved');
assert.match(el('review-clock').textContent, /expired/);
panel.render({ ...p, physical_mode: false });
assert.equal(el('approve').disabled, true);
d.body.dataset.view = 'sensors';
await new Promise((r) => w.setTimeout(r, 0));
assert.equal(actions.at(-1).active, false);
panel.destroy();
dom.window.close();
console.log(
  'PASS: physical route ownership bridge, missing setup, fresh scene, approve/stop and page-leave controls.',
);
