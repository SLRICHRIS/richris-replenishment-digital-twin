import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createVisionWorkspace } from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/overhead_camera_workspace.js';

const html = fs.readFileSync(
  new URL('../../frontend_warehouse_dashboard/index.html', import.meta.url),
  'utf8',
);
const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
const w = dom.window,
  d = w.document;
const el = (id) => d.getElementById(`vision-${id}`);
const input = (id, value) => {
  el(id).value = value;
  el(id).dispatchEvent(new w.Event('input', { bubbles: true }));
};
let commands = 0;
d.addEventListener('python-twin:action', () => commands++);
w.fetch = () => {
  throw Error('This workspace must not send requests');
};
const workspace = createVisionWorkspace(w);
assert.equal(createVisionWorkspace(w), null, 'No duplicate event handlers');
assert.equal(el('robot-length').value, '');
assert.equal(el('camera-height').value, '');
assert.equal(el('approve').disabled, true);
el('plan').click();
assert.match(el('feedback').textContent, /full robot length and width/);
input('robot-length', '180');
input('robot-width', '140');
input('start-x', '200');
input('start-y', '200');
input('goal-x', '600');
input('goal-y', '900');
el('plan').click();
assert.equal(el('approve').disabled, false);
assert.equal(el('review-state').textContent, 'Awaiting review');
input('review-note', '<img src=x onerror=alert(1)>');
el('approve').click();
assert.match(el('review-state').textContent, /Approved/);
assert.equal(el('review-trail').querySelector('img'), null);
assert.equal(workspace.snapshot().decision.executionEnabled, false);
assert.equal(commands, 0);
input('goal-x', '590');
assert.equal(workspace.snapshot().decision, null);
assert.equal(workspace.snapshot().plan, null);
assert.equal(el('approve').disabled, true);
assert.match(el('review-trail').textContent, /Previous decision invalidated/);
for (const [key, value] of Object.entries({ x: 350, y: 400, width: 120, height: 200 }))
  input(`obstacle-${key}`, String(value));
el('add-obstacle').click();
assert.equal(workspace.snapshot().obstacles.length, 1);
el('plan').click();
el('hold').click();
assert.equal(workspace.snapshot().decision.action, 'hold');
input('clearance', '-1');
assert.equal(workspace.snapshot().plan, null);
assert.equal(el('approve').disabled, true);
el('plan').click();
assert.match(el('feedback').textContent, /between 0 and 200/);
input('clearance', '20');
el('settings-form').dispatchEvent(new w.Event('submit', { cancelable: true }));
const saved = JSON.parse(w.localStorage.getItem('amr01.visionSetup.v1'));
assert.equal(saved.settings.cameraHeightCm, null);
assert.equal(saved.plan, undefined);
assert.equal(saved.decision, undefined);
assert.equal(saved.images, undefined);
el('camera-start').click();
assert.match(el('camera-detail').textContent, /unavailable.*still frame/);

let request,
  stops = 0;
Object.defineProperty(w.navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia(options) {
      assert.equal(options.audio, false);
      return new Promise((resolve) => {
        request = resolve;
      });
    },
  },
});
el('camera-start').click();
el('camera-stop').click();
request({
  getTracks: () => [
    {
      stop() {
        stops++;
      },
    },
  ],
});
await Promise.resolve();
await Promise.resolve();
assert.equal(stops, 1, 'Late permission resolution after stop must release the camera');
Object.defineProperty(w.navigator, 'mediaDevices', {
  configurable: true,
  value: {
    async getUserMedia() {
      throw Object.assign(Error('denied'), { name: 'NotAllowedError' });
    },
  },
});
el('camera-start').click();
await Promise.resolve();
await Promise.resolve();
assert.match(el('camera-detail').textContent, /denied or blocked/);

d.body.dataset.view = 'vision';
const cameraTrack = new w.EventTarget();
cameraTrack.stop = () => stops++;
w.HTMLVideoElement.prototype.play = async () => {};
Object.defineProperty(w.navigator, 'mediaDevices', {
  configurable: true,
  value: {
    async getUserMedia() {
      return { getTracks: () => [cameraTrack], getVideoTracks: () => [cameraTrack] };
    },
  },
});
el('camera-start').click();
await Promise.resolve();
await Promise.resolve();
assert.equal(el('camera-status').textContent, 'In-browser preview');
d.body.dataset.view = 'hardware';
await Promise.resolve();
assert.equal(stops, 2, 'Leaving the view releases every active camera track');
assert.equal(el('video').srcObject, null);
assert.match(el('camera-detail').textContent, /left Vision routing/);

let exported;
w.URL.createObjectURL = (blob) => {
  exported = blob;
  return 'blob:test';
};
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = () => {};
el('export').click();
const reader = new w.FileReader();
const exportText = new Promise((resolve) => {
  reader.onload = () => resolve(reader.result);
});
reader.readAsText(exported);
const result = JSON.parse(await exportText);
assert.equal(result.executionEnabled, false);
assert.equal(result.source, 'manual-rehearsal');
assert.equal(result.automaticDetection, 'not-connected');
assert.equal(result.cameraCalibration, 'pending');
assert.equal(result.images, undefined);
assert.equal(commands, 0);
workspace.destroy();
// Injected persisted approvals/execution flags are never restored.
saved.executionEnabled = true;
saved.decision = { action: 'approve' };
saved.plan = { points: [1] };
w.localStorage.setItem('amr01.visionSetup.v1', JSON.stringify(saved));
const restored = createVisionWorkspace(w);
assert.equal(restored.snapshot().executionEnabled, false);
assert.equal(restored.snapshot().decision, null);
assert.equal(restored.snapshot().plan, null);
assert.equal(restored.snapshot().settings.robotLengthMm, 180);
restored.destroy();
w.close();
console.log(
  'PASS: manual review invalidation, safe text rendering, local setup/export, camera denial and permission-race cleanup.',
);
