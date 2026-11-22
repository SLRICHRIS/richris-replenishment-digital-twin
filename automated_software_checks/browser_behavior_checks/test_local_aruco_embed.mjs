import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLocalArUcoPanel } from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/local_aruco_control.js';
const dom = new JSDOM(
  '<body data-view="vision"><div id="vision-routing-shell" data-mode="local"></div><div id="local-aruco-control"></div></body>',
  { url: 'https://dashboard.example', pretendToBeVisual: true },
);
const w = dom.window,
  d = w.document,
  el = (id) => d.getElementById(id);
const panel = createLocalArUcoPanel(w);
assert.equal(el('lc-frame'), null, 'Loading dashboard never starts the camera/controller');
el('lc-open').click();
assert.equal(el('lc-frame').src, 'http://127.0.0.1:8765/');
assert.match(el('lc-status').textContent, /does not confirm/);
el('vision-routing-shell').dataset.mode = 'manual';
d.dispatchEvent(new w.CustomEvent('vision-routing:mode'));
assert.equal(el('lc-frame'), null, 'Leaving routes removes the child presence-renewal context');
el('lc-open').click();
assert.equal(el('lc-frame'), null, 'Hidden route pane cannot reconnect');
el('vision-routing-shell').dataset.mode = 'local';
el('lc-open').click();
Object.defineProperty(d, 'hidden', { value: true, configurable: true });
d.dispatchEvent(new w.Event('visibilitychange'));
assert.equal(el('lc-frame'), null, 'Backgrounding dashboard ends route presence');
Object.defineProperty(d, 'hidden', { value: false, configurable: true });
d.dispatchEvent(new w.Event('visibilitychange'));
assert.equal(el('lc-frame'), null, 'Returning never resumes previous approval');
el('lc-open').click();
d.body.dataset.view = 'hardware';
await Promise.resolve();
assert.equal(el('lc-frame'), null, 'Dashboard navigation ends route presence');
panel.destroy();
w.close();
console.log(
  'PASS: local ArUco embed uses explicit gesture, fixed address, truthful status and stops presence on navigation/visibility.',
);
