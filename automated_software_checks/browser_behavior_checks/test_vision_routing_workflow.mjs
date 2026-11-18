import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createVisionRoutingWorkspace } from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/vision_routing_workspace.js';
const html = fs.readFileSync(
  new URL('../../frontend_warehouse_dashboard/index.html', import.meta.url),
  'utf8',
);
const dom = new JSDOM(html, { url: 'https://example.test', pretendToBeVisual: true });
const w = dom.window,
  d = w.document,
  actions = [];
d.body.dataset.view = 'vision';
d.addEventListener('python-twin:action', (e) => actions.push(e.detail));
const page = createVisionRoutingWorkspace(w),
  el = (id) => d.getElementById(id);
assert.equal(createVisionRoutingWorkspace(w), null);
assert.equal(el('vision-routing-shell').dataset.mode, 'physical');
assert.equal(el('vision-practice-pane').hidden, true);
assert.equal(el('pr-step-panel-1').hidden, false);
assert.equal(el('pr-map-card').hidden, true, 'Setup does not show an empty execution map');
assert.equal(d.querySelectorAll('#vision-settings-form').length, 1);
assert.ok(el('pr-step-panel-1').contains(el('vision-settings-form')));
assert.equal(el('vision-camera-height').value, '92');
assert.equal(el('vision-robot-length').value, '180');
assert.equal(el('vision-robot-width').value, '150');
assert.equal(el('vision-robot-height').value, '150');
assert.equal(el('vision-marker-height').value, '150');
el('pr-to-connect').click();
assert.equal(page.physical.getStage(), 2);
assert.equal(el('pr-login').hidden, true);
assert.equal(el('pr-to-plan').disabled, true);
el('pr-source').click();
assert.deepEqual(actions.at(-1), { action: 'sensor_source', mode: 'live' });
page.physical.render({
  can_unlock: false,
  physical_mode: true,
  missing: ['Attended commissioning'],
  feedback: '<img src=x onerror=alert(1)>',
});
assert.equal(el('pr-feedback').querySelector('img'), null);
assert.match(el('pr-feedback').textContent, /<img/);
assert.equal(el('pr-login').hidden, true);
el('vision-mode-practice').click();
assert.equal(el('vision-physical-pane').hidden, true);
assert.equal(el('vision-practice-pane').hidden, false);
assert.equal(actions.at(-1).command, 'view');
assert.equal(actions.at(-1).active, false, 'Practice releases physical presence authorization');
const before = actions.length;
function input(id, value) {
  el(id).value = value;
  el(id).dispatchEvent(new w.Event('input'));
}
// These are isolated hypothetical rehearsal dimensions, never trusted hardware inputs.
input('vision-robot-length', '80');
input('vision-robot-width', '60');
input('vision-robot-height', '75');
input('vision-marker-height', '65');
input('vision-start-x', '100');
input('vision-start-y', '100');
input('vision-goal-x', '320');
input('vision-goal-y', '520');
el('vision-plan').click();
el('vision-approve').click();
assert.equal(page.practice.snapshot().decision.executionEnabled, false);
assert.equal(
  actions.length,
  before,
  'Practice emits no production capture, decision or drive command',
);
let stopped = 0;
const track = new w.EventTarget();
track.stop = () => stopped++;
w.HTMLVideoElement.prototype.play = async () => {};
Object.defineProperty(w.navigator, 'mediaDevices', {
  value: {
    async getUserMedia() {
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    },
  },
});
el('vision-camera-start').click();
await Promise.resolve();
await Promise.resolve();
assert.equal(el('vision-camera-status').textContent, 'In-browser preview');
d.querySelector('[data-vision-open-setup]').click();
assert.equal(el('vision-routing-shell').dataset.mode, 'physical');
assert.equal(page.physical.getStage(), 1);
assert.equal(d.activeElement, el('pr-step-1'));
assert.equal(stopped, 1, 'Returning to physical control releases the browser camera');
assert.equal(actions.at(-1).active, true);
el('pr-step-1').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
assert.equal(page.physical.getStage(), 2);
assert.equal(d.activeElement, el('pr-step-2'));
el('vision-mode-physical').dispatchEvent(
  new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }),
);
assert.equal(d.activeElement, el('vision-mode-practice'));
assert.equal(el('vision-physical-pane').hidden, true);
page.destroy();
assert.equal(
  el('vision-settings-form').closest('#physical-route-execution'),
  null,
  'Teardown restores the shared setup form',
);
const restored = createVisionRoutingWorkspace(w);
assert.equal(d.querySelectorAll('#vision-settings-form').length, 1);
restored.destroy();
w.close();
console.log(
  'PASS: guided physical stages, separate command-free practice, mode presence, camera release, keyboard navigation and shared-form lifecycle.',
);
