import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createManualMotorPanel,
  directControllerUrl,
} from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/manual_motor_control.js';

for (const address of ['10.20.30.40', '192.168.43.120', '172.16.0.2', '172.31.255.254']) {
  assert.equal(directControllerUrl(address), `http://${address}/`);
}
assert.equal(directControllerUrl(' http://192.168.1.40/ '), 'http://192.168.1.40/');
for (const address of [
  '',
  null,
  '8.8.8.8',
  '127.0.0.1',
  '169.254.1.1',
  '172.15.0.2',
  '172.32.0.2',
  '10.0.0.256',
  'https://10.0.0.2',
  '10.0.0.2/cmd?c=F',
  '10.0.0.2:80',
  'user@10.0.0.2',
  '10.0.0.2#move',
  'javascript:alert(1)',
  '<img src=x>',
])
  assert.equal(directControllerUrl(address), null, String(address));

const dom = new JSDOM('<div id="manual-motor-control"></div>', {
  url: 'https://example.test',
  pretendToBeVisual: true,
});
const w = dom.window,
  d = w.document,
  actions = [],
  opened = [];
w.fetch = () => {
  throw Error('The cloud page must not fetch the LAN controller');
};
w.setInterval = () => {
  throw Error('The cloud page must not renew motor commands');
};
d.addEventListener('python-twin:action', (e) => actions.push(e.detail));
let panel = createManualMotorPanel(w);
const el = (id) => d.getElementById('mc-' + id);
assert.equal(el('forward'), null);
assert.equal(el('login'), null);
assert.equal(el('open-direct').hasAttribute('href'), false);
assert.equal(el('open-direct').getAttribute('aria-disabled'), 'true');
const capture = (e) => {
  const a = e.target.closest('a');
  if (a?.id === 'mc-open-direct') {
    if (!e.defaultPrevented) opened.push(a.href);
    e.preventDefault();
  }
};
d.addEventListener('click', capture);
const setAddress = (value) => {
  el('address').value = value;
  el('address').dispatchEvent(new w.Event('input'));
};
setAddress('<img src=x onerror=alert(1)>');
el('open-direct').click();
assert.equal(opened.length, 0);
assert.equal(el('address-status').querySelector('img'), null);
setAddress('10.20.30.40');
assert.equal(el('open-direct').href, 'http://10.20.30.40/');
assert.equal(el('open-direct').target, '_blank');
assert.match(el('open-direct').rel, /noopener/);
el('direct-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
assert.deepEqual(opened, ['http://10.20.30.40/']);
assert.equal(w.localStorage.getItem('amr01.direct_wifi_address'), '10.20.30.40');
assert.doesNotMatch(el('address-status').textContent, /controller ready|connected/i);
panel.render(
  { ready: true, authorized: true },
  {
    fresh: true,
    measurements: { battery_voltage_v: 7.12 },
  },
);
assert.match(el('sensor-feed').textContent, /7.12 V/);
panel.render({}, { fresh: false, measurements: { battery_voltage_v: 7.12 } });
assert.doesNotMatch(el('sensor-feed').textContent, /7.12/);
assert.equal(actions.length, 0, 'Opening the LAN page cannot emit a cloud command or login');
panel.destroy();
panel = createManualMotorPanel(w);
assert.equal(el('address').value, '10.20.30.40');
assert.equal(el('open-direct').href, 'http://10.20.30.40/');
panel.destroy();
w.close();
console.log(
  'PASS: direct LAN navigation, private IPv4 validation, local address persistence, no cloud motor commands, and independent telemetry display.',
);
