// Component protocol and workspace scroll regressions; no browser/GPU claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const app = path.join(__dirname, '../../frontend_warehouse_dashboard');
const source = fs.readFileSync(
  path.join(
    app,
    'browser_modules/streamlit_frame_connection/streamlit_frame_connection_and_scrolling.js',
  ),
  'utf8',
);
const html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
const scrollCSS = fs.readFileSync(
  path.join(app, 'dashboard_stylesheets/streamlit_dashboard_scroll_container.css'),
  'utf8',
);

async function check() {
  const dom = new JSDOM(html, {
    url: 'https://example.streamlit.app/component/streamlit_app.replenish_workspace/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window,
    doc = w.document;
  const parentEvents = new Map(),
    messages = [],
    frames = [];
  const origin = w.location.origin;
  const parent = {
    innerHeight: 900,
    postMessage: (message, target) => messages.push({ message, target }),
    addEventListener: (type, fn) => parentEvents.set(type, fn),
    removeEventListener: (type, fn) => {
      if (parentEvents.get(type) === fn) parentEvents.delete(type);
    },
  };
  Object.defineProperty(w, 'parent', { value: parent });
  w.requestAnimationFrame = (fn) => frames.push(fn);
  const style = doc.createElement('style');
  style.textContent = scrollCSS;
  doc.head.append(style);
  vm.runInContext(source, dom.getInternalVMContext());
  doc.dispatchEvent(new w.Event('DOMContentLoaded'));
  const flush = () => {
    while (frames.length) frames.shift()();
  };
  const message = (from, fromOrigin) =>
    w.dispatchEvent(
      new w.MessageEvent('message', {
        source: from,
        origin: fromOrigin,
        data: { type: 'streamlit:render' },
      }),
    );

  assert.equal(messages[0].message.type, 'streamlit:componentReady');
  assert.equal(messages[0].message.apiVersion, 1);
  assert.equal(messages[0].target, origin);
  flush();
  assert.equal(messages.at(-1).message.height, 900);
  const count = messages.length;
  message(parent, 'https://unrelated.example');
  message({}, origin);
  flush();
  assert.equal(messages.length, count);
  parent.innerHeight = 740;
  message(parent, origin);
  flush();
  assert.equal(messages.at(-1).message.height, 740);
  w.dispatchEvent(new w.Event('resize'));
  flush();
  assert.equal(messages.length, count + 1, 'unchanged height must not create a resize loop');
  parent.innerHeight = 200;
  parentEvents.get('resize')();
  flush();
  assert.equal(messages.at(-1).message.height, 360);

  // Reproduce the two mode messages whose last component value wins in Streamlit.
  doc.body.dataset.view = 'vision';
  doc.getElementById('vision-routing-shell').dataset.mode = 'manual';
  for (const detail of [
    { action: 'manual_control', command: 'view', active: true },
    { action: 'vision_execution', command: 'view', active: false },
  ])
    doc.dispatchEvent(new w.CustomEvent('python-twin:action', { detail }));
  const controlMessages = messages
    .filter((x) => x.message.type === 'streamlit:setComponentValue')
    .slice(-2);
  assert.equal(controlMessages.length, 2);
  assert.ok(
    controlMessages.every((x) => x.message.value.control_mode === 'manual'),
    'Either coalesced message must preserve the selected manual mode',
  );
  doc.getElementById('vision-routing-shell').dataset.mode = 'practice';
  doc.dispatchEvent(
    new w.CustomEvent('python-twin:action', {
      detail: { action: 'manual_control', command: 'view', active: false },
    }),
  );
  assert.equal(
    messages.at(-1).message.value.control_mode,
    null,
    'Practice clears both physical views',
  );
  doc.body.dataset.view = 'environment';

  const main = doc.getElementById('main-content');
  assert.equal(doc.documentElement.dataset.host, 'streamlit');
  assert.equal(
    w.getComputedStyle(main).overflowY,
    'auto',
    'overflow must belong to the workspace inside the non-scrolling iframe',
  );
  assert.equal(
    w.getComputedStyle(main).minHeight,
    '0',
    'the flex region must shrink to the available frame height',
  );
  assert.equal(
    w.getComputedStyle(doc.querySelector('.masthead')).flexShrink,
    '0',
    'header stays outside workspace scrolling',
  );
  assert.equal(
    w.getComputedStyle(doc.querySelector('.screens')).flexShrink,
    '0',
    'long view content must overflow rather than collapse',
  );
  assert.equal(
    main.getAttribute('tabindex'),
    '0',
    'keyboard users can enter and scroll the main region',
  );
  const tab = doc.getElementById('tab-environment');
  tab.focus();
  for (const view of [
    'routes',
    'hardware',
    'vision',
    'missions',
    'telemetry',
    'engineering',
    'activity',
    'environment',
  ]) {
    main.scrollTop = 800;
    doc.body.dataset.view = view;
    await Promise.resolve();
    assert.equal(main.scrollTop, 0, view + ' must open at the top of its actual scroll region');
    assert.equal(doc.activeElement, tab, 'view reset must preserve control focus');
  }
  main.scrollTop = 640;
  doc.body.dataset.view = 'environment';
  doc.body.dataset.theme = 'bright';
  await Promise.resolve();
  assert.equal(
    main.scrollTop,
    640,
    'ordinary refreshes and appearance updates must preserve scroll position',
  );

  w.dispatchEvent(new w.PageTransitionEvent('pagehide', { persisted: false }));
  assert.equal(parentEvents.size, 0);
  doc.body.dataset.view = 'activity';
  await Promise.resolve();
  assert.equal(main.scrollTop, 640, 'unloaded workspace must release its observer');
  doc.body.dataset.view = 'vision';
  doc.getElementById('vision-routing-shell').dataset.mode = 'manual';
  for (const action of ['manual_control', 'vision_execution'])
    doc.dispatchEvent(
      new w.CustomEvent('python-twin:action', {
        detail: { action, command: 'view', active: false },
      }),
    );
  assert.ok(
    messages
      .filter((x) => x.message.type === 'streamlit:setComponentValue')
      .slice(-2)
      .every((x) => x.message.value.control_mode === null),
    'The second pagehide event cannot restore a leaving control page',
  );
  dom.window.close();

  const standalone = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  vm.runInContext(source, standalone.getInternalVMContext());
  assert.equal(
    standalone.window.document.documentElement.dataset.host,
    undefined,
    'standalone Site layout remains unchanged',
  );
  assert.equal(
    standalone.window.document.getElementById('main-content').hasAttribute('tabindex'),
    false,
  );
  standalone.window.close();
  console.log(
    'PASS: Streamlit handshake and trusted messages, viewport sizing/cleanup, real DOM scroll-container styles, keyboard access, workspace scroll reset, focus preservation, stable in-view scrolling and standalone isolation.',
  );
}
check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
