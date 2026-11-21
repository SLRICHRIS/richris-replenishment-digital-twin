import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createManualMotorPanel,
  DIRECT_CONTROLLER_URL,
} from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/manual_motor_control.js';

assert.equal(DIRECT_CONTROLLER_URL, 'http://10.15.213.112/');
const dom = new JSDOM(
  '<body data-view="vision"><div id="vision-routing-shell" data-mode="manual"><div id="manual-motor-control"></div></div></body>',
  { url: 'https://example.test', pretendToBeVisual: true },
);
const w = dom.window,
  d = w.document,
  actions = [];
w.fetch = () => {
  throw Error('The parent must not fetch LAN commands');
};

w.localStorage.setItem('amr01.direct_wifi_address', '8.8.8.8/cmd?c=F');
d.addEventListener('python-twin:action', (e) => actions.push(e.detail));
let panel = createManualMotorPanel(w);
const el = (id) => d.getElementById('mc-' + id),
  shell = d.getElementById('vision-routing-shell');
assert.equal(el('address'), null, 'No IP typing is required');
assert.equal(el('login'), null);
assert.equal(el('controller-frame'), null, 'No LAN request on passive page load');
assert.equal(
  el('open-direct').href,
  DIRECT_CONTROLLER_URL,
  'The fixed IP ignores earlier browser values',
);
assert.equal(el('open-direct').target, '_blank');
assert.match(el('open-direct').rel, /noopener/);
assert.equal(el('disconnect').disabled, true);
d.dispatchEvent(
  new w.CustomEvent('human-review:drive', {
    detail: { label: 'Review lower power', detail: 'Stop first.' },
  }),
);
assert.equal(el('reviewed-response').hidden, false);
assert.match(el('reviewed-title').textContent, /Review lower power/);
assert.equal(
  el('controller-frame'),
  null,
  'A response handoff cannot connect or actuate by itself',
);
d.dispatchEvent(new w.CustomEvent('human-review:drive', { detail: null }));
assert.equal(el('reviewed-response').hidden, true);

el('connect').click();
let frame = el('controller-frame');
assert.ok(frame);
assert.equal(
  frame.src,
  DIRECT_CONTROLLER_URL,
  'Loading the root page does not issue a movement command',
);
assert.equal(frame.title, 'AMR-01 direct Wi-Fi controller');
assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
assert.equal(frame.getAttribute('allow'), 'local-network; local-network-access');
assert.equal(frame.referrerPolicy, 'no-referrer');
assert.equal(el('controller-frame-host').hidden, false);
const openingStatus = el('connection-status').textContent;
frame.dispatchEvent(new w.Event('load'));
assert.equal(
  el('connection-status').textContent,
  openingStatus,
  'A cross-origin load event cannot certify connection',
);
frame.dispatchEvent(new w.Event('error'));
assert.equal(
  el('connection-status').textContent,
  openingStatus,
  'The fallback remains available without an optimistic connection state',
);
w.dispatchEvent(new w.Event('blur'));
assert.ok(el('controller-frame'), 'Moving focus into the iframe must not close it');

panel.render(
  { ready: true, authorized: true },
  { fresh: true, measurements: { battery_voltage_v: 7.12 } },
);
assert.match(el('sensor-feed').textContent, /7.12 V/);
assert.equal(el('controller-frame'), frame, 'Sensor renders do not reset an active controller');
panel.render({}, { fresh: false, measurements: { battery_voltage_v: 7.12 } });
assert.doesNotMatch(el('sensor-feed').textContent, /7.12/);
el('connect').click();
assert.equal(frame.isConnected, false, 'Reload removes the old controller and its timers');
assert.equal(d.querySelectorAll('#mc-controller-frame').length, 1);

shell.dataset.mode = 'physical';
d.dispatchEvent(new w.CustomEvent('vision-routing:mode', { detail: { mode: 'physical' } }));
assert.equal(el('controller-frame'), null, 'Leaving manual mode destroys the browsing context');
el('connect').click();
assert.equal(el('controller-frame'), null, 'A hidden mode cannot reconnect');
shell.dataset.mode = 'manual';
d.dispatchEvent(new w.CustomEvent('vision-routing:mode', { detail: { mode: 'manual' } }));
assert.equal(
  el('controller-frame'),
  null,
  'Returning never resumes a hold or reconnects automatically',
);
el('connect').click();
d.body.dataset.view = 'hardware';
await Promise.resolve();
assert.equal(el('controller-frame'), null, 'Switching dashboard pages also closes the controller');
d.body.dataset.view = 'vision';
await Promise.resolve();
el('connect').click();
Object.defineProperty(d, 'hidden', { configurable: true, value: true });
d.dispatchEvent(new w.Event('visibilitychange'));
assert.equal(
  el('controller-frame'),
  null,
  'A hidden browser tab cannot retain hold-renewal timers',
);
Object.defineProperty(d, 'hidden', { configurable: true, value: false });
d.dispatchEvent(new w.Event('visibilitychange'));
assert.equal(el('controller-frame'), null);
el('connect').click();
w.dispatchEvent(new w.Event('pagehide'));
assert.equal(el('controller-frame'), null);
el('connect').click();
el('disconnect').click();
assert.equal(el('controller-frame'), null);
el('connect').click();
el('open-direct').addEventListener('click', (event) => event.preventDefault());
el('open-direct').click();
assert.equal(
  el('controller-frame'),
  null,
  'The separate tab fallback closes the embedded controller first',
);
assert.equal(actions.length, 0, 'The parent emits no cloud login or motor commands');
el('connect').click();
frame = el('controller-frame');
const staleConnect = el('connect');
panel.destroy();
assert.equal(frame.isConnected, false);
staleConnect.click();
assert.equal(d.querySelector('iframe'), null);
panel = createManualMotorPanel(w);
assert.equal(el('controller-frame'), null);
assert.equal(el('open-direct').href, DIRECT_CONTROLLER_URL);
panel.destroy();
w.close();
console.log(
  'PASS: fixed LAN address, embedded controller, gesture-only navigation, connection-state honesty, and timer-context teardown on exit.',
);
