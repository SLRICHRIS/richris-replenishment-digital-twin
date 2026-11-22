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
const timers = new Map();
let timerId = 0;
w.setTimeout = (fn) => {
  timers.set(++timerId, fn);
  return timerId;
};
w.clearTimeout = (id) => timers.delete(id);
const panel = createLocalArUcoPanel(w);
assert.equal(el('lc-frame'), null, 'Loading dashboard never starts the controller');
assert.match(el('local-aruco-control').textContent, /AMR01_PresetRoutes.exe/);
el('lc-open').click();
assert.equal(el('lc-frame').src, 'http://127.0.0.1:8765/');
assert.match(el('lc-status').textContent, /does not confirm/);
assert.match(el('lc-frame').getAttribute('allow'), /loopback-network/);
const loading = el('lc-status').textContent;
const ready = { type: 'amr-preset:ready', version: 1 };
w.dispatchEvent(
  new w.MessageEvent('message', {
    source: el('lc-frame').contentWindow,
    origin: 'https://attacker.example',
    data: ready,
  }),
);
w.dispatchEvent(
  new w.MessageEvent('message', { source: w, origin: 'http://127.0.0.1:8765', data: ready }),
);
assert.equal(
  el('lc-status').textContent,
  loading,
  'Wrong origin/window cannot claim the local controller loaded',
);
timers.get(timerId)();
assert.match(el('lc-status').textContent, /has not confirmed loading/);
assert.match(el('lc-status').textContent, /updated AMR01_PresetRoutes.exe/);
w.dispatchEvent(
  new w.MessageEvent('message', {
    source: el('lc-frame').contentWindow,
    origin: 'http://127.0.0.1:8765',
    data: ready,
  }),
);
assert.match(el('lc-status').textContent, /Preset controller loaded inside/);
assert.match(el('lc-status').textContent, /does not authorize motion/);
assert.equal(timers.size, 0, 'Trusted loading confirmation cancels fallback timer');
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
assert.equal(timers.size, 0, 'Navigation cancels pending loading timers');
panel.destroy();
w.close();
console.log(
  'PASS: preset embed uses explicit gesture, fixed address, verified loading status and ends presence on navigation/visibility.',
);
