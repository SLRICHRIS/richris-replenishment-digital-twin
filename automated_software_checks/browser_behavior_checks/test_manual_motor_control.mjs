import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createManualMotorPanel } from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/manual_motor_control.js';
const dom = new JSDOM(
  '<body data-view="vision"><button id="outside">Outside</button><div id="vision-routing-shell" data-mode="manual"></div><div id="manual-motor-control"></div></body>',
  { pretendToBeVisual: true },
);
const w = dom.window,
  d = w.document,
  actions = [],
  intervals = new Map();
let mono = 0,
  id = 0;
w.setInterval = (fn) => {
  intervals.set(++id, fn);
  return id;
};
w.clearInterval = (value) => intervals.delete(value);
Object.defineProperty(w.performance, 'now', { value: () => mono });
d.addEventListener('python-twin:action', (e) => actions.push(e.detail));
const panel = createManualMotorPanel(w),
  el = (id) => d.getElementById('mc-' + id);
const ready = {
  authorized: true,
  can_unlock: true,
  physical_mode: true,
  view_active: true,
  ready: true,
  max_pwm: 255,
  receiver_updated: true,
  server_time_ms: Date.now(),
  hardware: { ready: true, state: 'idle', left_duty: 0, right_duty: 0, battery_voltage_v: 7.4 },
};
const render = (value) => panel.render({ ...ready, server_time_ms: Date.now(), ...value });
const press = (name) =>
  el(name).dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
const release = (name) => el(name).dispatchEvent(new w.Event('pointerup', { bubbles: true }));
const holds = () => actions.filter((a) => a.command === 'hold');
assert.equal(el('forward').disabled, true);
assert.equal(el('code').disabled, false);
assert.equal(el('prepare'), null);
assert.equal(el('approve'), null);
render({ feedback: '<img src=x>' });
assert.equal(el('feedback').querySelector('img'), null);
assert.equal(holds().length, 0, 'Rendering readiness cannot drive');
press('forward');
assert.equal(holds().length, 1);
const hold = holds()[0];
assert.match(hold.hold_id, /^[0-9a-f]{32}$/);
assert.equal(hold.direction, 'F');
assert.equal(hold.pwm, 160);
mono += 200;
for (const fn of intervals.values()) fn();
assert.equal(holds().length, 2);
assert.equal(holds()[1].hold_id, hold.hold_id);
assert.equal(holds()[1].input_seq, 2);
release('forward');
assert.equal(actions.at(-1).command, 'release');
assert.equal(intervals.size, 0);
const count = holds().length;
render({});
assert.equal(holds().length, count, 'No restart after release');
el('pwm').value = '255';
el('pwm').dispatchEvent(new w.Event('input'));
press('left');
assert.equal(holds().at(-1).direction, 'L');
assert.equal(holds().at(-1).pwm, 255);
el('pwm').value = '0';
el('pwm').dispatchEvent(new w.Event('input'));
assert.equal(actions.at(-1).command, 'stop');
el('pwm').value = '160';
el('pwm').dispatchEvent(new w.Event('input'));
assert.equal(intervals.size, 0);
press('right');
assert.equal(holds().at(-1).direction, 'R');
render({ ready: false });
assert.equal(actions.at(-1).command, 'stop');
assert.equal(intervals.size, 0);
const ended = holds().length;
render({});
assert.equal(holds().length, ended);
const key = (target, type, value, repeat = false) =>
  target.dispatchEvent(new w.KeyboardEvent(type, { key: value, repeat, bubbles: true }));
key(el('code'), 'keydown', 'w');
key(d.getElementById('outside'), 'keydown', 'ArrowUp');
assert.equal(holds().length, ended);
key(el('pad'), 'keydown', 'ArrowDown');
assert.equal(holds().at(-1).direction, 'B');
const keyed = holds().length;
key(el('pad'), 'keydown', 'ArrowDown', true);
assert.equal(holds().length, keyed);
render({ ready: false });
render({});
key(el('pad'), 'keydown', 'ArrowDown', true);
assert.equal(holds().length, keyed, 'Auto-repeat cannot resume a cancelled hold');
key(el('pad'), 'keyup', 'ArrowDown');
key(el('pad'), 'keydown', 'W');
assert.equal(holds().at(-1).direction, 'F');
key(el('pad'), 'keyup', 'w');
assert.equal(intervals.size, 0);
press('forward');
w.dispatchEvent(new w.Event('blur'));
assert.equal(intervals.size, 0);
assert.equal(actions.at(-1).command, 'release');
press('backward');
d.getElementById('vision-routing-shell').dataset.mode = 'practice';
d.dispatchEvent(new w.CustomEvent('vision-routing:mode'));
assert.equal(intervals.size, 0);
assert.equal(actions.at(-1).active, false);
d.getElementById('vision-routing-shell').dataset.mode = 'manual';
d.dispatchEvent(new w.CustomEvent('vision-routing:mode'));
render({ max_pwm: 160, receiver_updated: false });
assert.equal(el('pwm').max, '160');
assert.match(el('receiver-note').textContent, /Existing receiver/);
el('pwm').value = '160';
render({ max_pwm: 60, receiver_updated: false });
assert.equal(el('pwm').max, '60');
assert.equal(el('pwm').value, '40');
assert.match(el('receiver-note').textContent, /Wireless H1 r3/);
press('forward');
assert.equal(holds().at(-1).pwm, 40);
release('forward');
render({});
press('forward');
mono += 1501;
for (const fn of [...intervals.values()]) fn();
assert.equal(actions.at(-1).command, 'stop');
assert.equal(intervals.size, 0);
const beforePresence = actions.length;
render({ view_active: false });
assert.equal(actions.length, beforePresence + 1);
assert.equal(actions.at(-1).command, 'view');
render({ view_active: false });
assert.equal(actions.length, beforePresence + 1);
press('left');
w.dispatchEvent(new w.PageTransitionEvent('pagehide'));
assert.equal(intervals.size, 0);
assert.equal(actions.at(-1).active, false);
panel.destroy();
assert.equal(intervals.size, 0);
w.close();
console.log(
  'PASS: held pointer/keyboard intent, bounded renewal, release/Stop/page-loss cancellation, no automatic restart, receiver caps, editable authentication and safe diagnostics.',
);
