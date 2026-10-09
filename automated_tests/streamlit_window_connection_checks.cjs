// Exercise the component boundary without claiming browser/WebGL coverage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const events = new Map(), parentEvents = new Map(), messages = [], frames = [];
const origin = 'https://example.streamlit.app';
const parent = {
  innerHeight: 900,
  postMessage: (message, target) => messages.push({ message, target }),
  addEventListener: (type, fn) => parentEvents.set(type, fn),
  removeEventListener: (type, fn) => {
    if (parentEvents.get(type) === fn) parentEvents.delete(type);
  },
};
const window = {
  parent,
  location: { origin },
  addEventListener: (type, fn) => events.set(type, fn),
  requestAnimationFrame: fn => frames.push(fn),
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../digital_twin_application/streamlit_window_connection.js'), 'utf8'), { window });
const flush = () => { while (frames.length) frames.shift()(); };
assert.equal(messages[0].message.type, 'streamlit:componentReady');
assert.equal(messages[0].message.apiVersion, 1);
assert.equal(messages[0].target, origin);
flush();
assert.equal(messages.at(-1).message.height, 900);
const count = messages.length;
events.get('message')({ source: parent, origin: 'https://unrelated.example', data: { type: 'streamlit:render' } });
events.get('message')({ source: {}, origin, data: { type: 'streamlit:render' } });
flush();
assert.equal(messages.length, count);
parent.innerHeight = 740;
events.get('message')({ source: parent, origin, data: { type: 'streamlit:render' } });
flush();
assert.equal(messages.at(-1).message.height, 740);
events.get('resize')();
flush();
assert.equal(messages.length, count + 1, 'unchanged height must not create a resize loop');
parent.innerHeight = 200;
parentEvents.get('resize')();
flush();
assert.equal(messages.at(-1).message.height, 360);
events.get('pagehide')();
assert.equal(parentEvents.size, 0);
console.log('PASS: Streamlit handshake, origin/source validation, viewport resize, resize-loop prevention, and listener cleanup.');
