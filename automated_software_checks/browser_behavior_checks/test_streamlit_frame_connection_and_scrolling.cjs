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
  let monotonic = 0,
    nextTimer = 0;
  const timers = new Map();
  Object.defineProperty(w.performance, 'now', { value: () => monotonic });
  w.setInterval = (fn) => {
    const id = ++nextTimer;
    timers.set(id, fn);
    return id;
  };
  w.clearInterval = (id) => timers.delete(id);
  const tick = (milliseconds) => {
    monotonic += milliseconds;
    for (const fn of timers.values()) fn();
  };
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
  const heldInput = {
    action: 'manual_control',
    command: 'hold',
    hold_id: 'a'.repeat(32),
    input_seq: 7,
    issued_at_ms: 123456,
    direction: 'L',
    pwm: 255,
  };
  doc.dispatchEvent(new w.CustomEvent('python-twin:action', { detail: heldInput }));
  const forwarded = messages.at(-1).message.value;
  for (const name of ['command', 'hold_id', 'input_seq', 'issued_at_ms', 'direction', 'pwm'])
    assert.equal(
      forwarded[name],
      heldInput[name],
      'Held control field survives the Streamlit bridge: ' + name,
    );
  assert.equal(forwarded.control_mode, 'manual');
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

  // Load the real display and decision listeners to verify expiry reaches every
  // visible consumer, rather than merely testing a helper's return value.
  for (const filename of [
    'python_sensor_twin_readouts.js',
    'amr_connection_panel.js',
    'human_review_panel.js',
  ])
    vm.runInContext(
      fs.readFileSync(
        path.join(app, 'browser_modules/streamlit_frame_connection', filename),
        'utf8',
      ),
      dom.getInternalVMContext(),
    );
  doc.dispatchEvent(new w.Event('DOMContentLoaded'));
  const rendered = [];
  doc.addEventListener('python-twin:render', (e) => rendered.push(e.detail));
  const receive = (payload) =>
    w.dispatchEvent(
      new w.MessageEvent('message', {
        source: parent,
        origin,
        data: { type: 'streamlit:render', args: { python_twin: payload } },
      }),
    );
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const insight = {
    scope: 'physical_observation',
    ready: true,
    source: 'Live physical observations',
    metrics: [],
    recommendations: [
      { code: 'monitor', title: 'Continue attended monitoring', detail: 'Watch the robot.' },
    ],
  };
  const raw = {
    robot_id: 'amr01',
    boot_id: 'boot-a',
    seq: 1,
    sample_time_s: 10,
    battery_voltage_v: 7.2,
    battery_current_a: 0.1,
    gyro_z_rad_s: 0,
    left_pulse_hz: 0,
    right_pulse_hz: 0,
  };
  const physical = {
    fresh: true,
    state: 'receiving',
    label: 'Receiving physical telemetry',
    age_s: 0.2,
    received_at: '2026-11-22T00:00:00Z',
    boot_id: 'boot-a',
    seq: 1,
    measurements: raw,
    history: [raw],
    wheel_estimates: {},
    gyro_estimates: {},
    energy_observation: { state: 'ready', net_wh: 0.4 },
    recommendations: ['Watch the robot.'],
  };
  const review = {
    eligible: true,
    observation_only: true,
    authorized: true,
    owns_review: true,
    can_review: true,
    can_unlock: true,
    commands_enabled: false,
    missing: [],
    review: {
      review_id: 'a'.repeat(32),
      state: 'pending',
      expires_at: Date.now() / 1000 + 30,
      evidence: {
        source: 'live',
        scope: 'physical_observation',
        seq: 1,
        recommendations: insight.recommendations,
      },
      events: [],
    },
  };
  const link = {
    configured: true,
    state: 'subscribed',
    subscribed: true,
    running: true,
    authorized: true,
    sample_source: 'physical_observation',
    sample_fresh: true,
    sample_age_s: 0.2,
    sample_identity: ['physical_observation', 'boot-a', 1],
    insights: insight,
    stages: [
      {
        id: 'telemetry',
        label: 'ESP32 telemetry',
        state: 'ready',
        detail: 'Current packet stored',
      },
      { id: 'broker', label: 'EMQX recorder', state: 'ready', detail: 'Subscription verified' },
      { id: 'insights', label: 'Live guidance', state: 'ready', detail: 'Observation checks' },
    ],
  };
  const live = freeze({
    mode: 'live',
    robots: {},
    physical_telemetry: physical,
    insights: insight,
    human_review: review,
    amr_connection: link,
    manual_control: { transport: 'direct_wifi' },
  });
  const saved = JSON.stringify(live);
  receive(live);
  doc.getElementById('human-review-reason').value = 'Attended monitoring';
  doc.getElementById('human-review-reason').dispatchEvent(new w.Event('input'));
  const approve = doc.querySelector('#human-review-form button[value="approve"]');
  assert.equal(approve.disabled, false);
  assert.equal(doc.getElementById('physical-voltage').textContent, '7.200 V');
  assert.match(doc.getElementById('amr-model-recommendations').textContent, /Continue attended/);
  const nativeFrame = doc.createElement('iframe');
  nativeFrame.id = 'mc-controller-frame';
  doc.body.append(nativeFrame);
  tick(5100);
  assert.equal(rendered.at(-1).physical_telemetry.fresh, false);
  assert.equal(rendered.at(-1).physical_telemetry.seq, 1);
  assert.equal(rendered.at(-1).physical_telemetry.received_at, physical.received_at);
  assert.equal(doc.getElementById('physical-voltage').textContent, '—');
  assert.match(doc.getElementById('python-amr01-battery-input').textContent, /Unavailable/);
  assert.match(doc.getElementById('amr-model-recommendations').textContent, /Readings out of date/);
  assert.match(doc.getElementById('amr-live-recommendations').textContent, /Readings out of date/);
  assert.equal(approve.disabled, true, 'Frozen host disables decisions after evidence expires');
  assert.equal(
    rendered.at(-1).human_review.review,
    review.review,
    'Captured audit evidence is unchanged',
  );
  assert.equal(rendered.at(-1).amr_connection.stages[0].state, 'waiting');
  assert.equal(
    rendered.at(-1).display_freshness.dashboard_stalled,
    false,
    'The 5s sensor deadline is not a host connection timeout',
  );
  assert.equal(rendered.at(-1).display_freshness.timeout_s, 30);
  // Real host updates may finish several seconds apart due to synchronous SQL
  // reads. They must not flap the dashboard warning or revive the old packet.
  for (const delay of [6000, 8000, 10000]) {
    receive(live);
    tick(delay);
    assert.equal(rendered.at(-1).display_freshness.dashboard_stalled, false);
    assert.equal(rendered.at(-1).amr_connection.subscribed, true);
    assert.equal(rendered.at(-1).physical_telemetry.fresh, false);
    assert.equal(approve.disabled, true);
  }
  tick(20001);
  assert.equal(
    rendered.at(-1).display_freshness.dashboard_stalled,
    true,
    'Only prolonged host silence marks the connection unknown',
  );
  const pausedLink = rendered.at(-1).amr_connection;
  assert.equal(pausedLink.state, 'unknown');
  assert.equal(
    pausedLink.subscribed,
    false,
    'Frozen subscription display cannot retain a ready badge',
  );
  assert.equal(
    pausedLink.running,
    true,
    'Keep the last running state so explicit disconnect is available',
  );
  assert.equal(pausedLink.authorized, true);
  assert.equal(pausedLink.stages.find((stage) => stage.id === 'broker').state, 'waiting');
  assert.match(pausedLink.detail, /Last known subscription.*updates paused/);
  assert.equal(doc.getElementById('amr-link-disconnect').disabled, false);
  assert.equal(doc.getElementById('amr-link-state').textContent, 'Status unavailable');
  assert.equal(doc.getElementById('amr-link-state').dataset.state, 'waiting');

  assert.equal(nativeFrame.isConnected, true, 'Data expiry must not remove direct local controls');
  assert.equal(
    JSON.stringify(live),
    saved,
    'The source snapshot and historical samples are never mutated',
  );
  doc.dispatchEvent(new w.CustomEvent('python-twin:ready'));
  assert.equal(
    rendered.at(-1).physical_telemetry.fresh,
    false,
    'Late listener replay cannot refresh old data',
  );
  receive(live);
  assert.equal(
    rendered.at(-1).physical_telemetry.fresh,
    false,
    'Repeated cached host arguments cannot make a sample younger',
  );
  const updated = JSON.parse(saved);
  updated.physical_telemetry.seq = 2;
  updated.physical_telemetry.measurements.seq = 2;
  updated.physical_telemetry.received_at = '2026-11-22T00:00:01Z';
  updated.amr_connection.sample_identity[2] = 2;
  receive(updated);
  assert.equal(
    rendered.at(-1).display_freshness.dashboard_stalled,
    false,
    'A new host response clears the communication warning',
  );
  assert.equal(
    rendered.at(-1).physical_telemetry.fresh,
    true,
    'A genuinely new sample restores current values',
  );
  assert.equal(doc.getElementById('physical-voltage').textContent, '7.200 V');

  const routeReport = freeze({
    ...updated,
    vision_execution: {
      ready: true,
      physical_mode: true,
      authorized: true,
      available: true,
      scene: {
        valid: true,
        seq: 1,
        captured_at_ms: Date.now(),
        hardware: { ready: true, age_ms: 50 },
      },
      transport: {
        connected: true,
        receiver: {
          protocol: 'H1',
          boot_id: 'route-boot',
          epoch_id: 'epoch',
          seq: 1,
          issued_at_ms: Date.now(),
          fresh: true,
          ready: true,
          age_ms: 50,
          battery_voltage_v: 7.2,
        },
      },
    },
  });
  const originalRoute = JSON.stringify(routeReport.vision_execution);
  receive(routeReport);
  assert.equal(rendered.at(-1).vision_execution.ready, true);
  const actionCount = messages.filter(
    (x) => x.message.type === 'streamlit:setComponentValue',
  ).length;
  tick(600);
  assert.equal(rendered.at(-1).vision_execution.ready, false);
  assert.equal(rendered.at(-1).vision_execution.scene.valid, false);
  assert.equal(rendered.at(-1).vision_execution.scene.hardware.ready, false);
  assert.equal(
    rendered.at(-1).vision_execution.transport.receiver.fresh,
    false,
    'Frozen receiver heartbeat cannot retain a ready badge',
  );
  assert.equal(rendered.at(-1).vision_execution.transport.receiver.ready, false);
  assert.equal(
    messages.filter((x) => x.message.type === 'streamlit:setComponentValue').length,
    actionCount,
    'Display expiry does not issue route or motor commands',
  );
  receive(routeReport);
  assert.equal(
    rendered.at(-1).vision_execution.transport.receiver.fresh,
    false,
    'Cached signed heartbeat identity cannot refresh the display age',
  );
  const newRoute = JSON.parse(JSON.stringify(routeReport));
  newRoute.vision_execution.scene.seq = 2;
  newRoute.vision_execution.scene.captured_at_ms = Date.now();
  newRoute.vision_execution.transport.receiver.seq = 2;
  newRoute.vision_execution.transport.receiver.issued_at_ms = Date.now();
  receive(newRoute);
  assert.equal(
    rendered.at(-1).vision_execution.ready,
    true,
    'New camera and receiver evidence restore the displayed state',
  );
  assert.equal(
    JSON.stringify(routeReport.vision_execution),
    originalRoute,
    'Route reports remain immutable',
  );

  const model = {
    quality: 'OK',
    quality_label: 'Current readings',
    age_s: 0.1,
    stale: false,
    continuity_lost: false,
    soc: 0.8,
    raw: { ...raw, seq: 8 },
    derived: { residual_valid: true },
    pose: [0, 0, 0],
    forecast_pose: [1, 0, 0],
    runtime_hours: 2,
  };
  receive({
    mode: 'live',
    robots: { amr01: model },
    physical_telemetry: { ...physical, fresh: false, age_s: 99 },
    insights: { ready: true, recommendations: [{ title: 'Model guidance' }] },
    human_review: { ...review, observation_only: false },
  });
  assert.equal(
    rendered.at(-1).robots.amr01.stale,
    false,
    'Stale commissioning data cannot invalidate a fresh calibrated source',
  );
  assert.equal(rendered.at(-1).human_review.eligible, true);
  tick(2000);
  assert.equal(
    rendered.at(-1).robots.amr01.stale,
    true,
    'Calibrated evidence expires at two seconds',
  );
  assert.equal(rendered.at(-1).robots.amr01.forecast_pose, null);
  assert.equal(rendered.at(-1).human_review.eligible, false);
  const demo = {
    mode: 'demo',
    robots: { amr01: model },
    insights: { ready: true, recommendations: [{ title: 'Demo guidance' }] },
    human_review: { demo: true },
    amr_connection: { ...link, sample_identity: ['physical_observation', 'boot-a', 99] },
  };
  receive(demo);
  tick(10000);
  assert.equal(rendered.at(-1).mode, 'demo');
  assert.equal(
    rendered.at(-1).robots.amr01,
    model,
    'Fixed demo results do not age into a physical source',
  );
  assert.equal(rendered.at(-1).insights.recommendations[0].title, 'Demo guidance');
  assert.equal(
    rendered.at(-1).amr_connection.sample_fresh,
    false,
    'The separate live connection drawer still expires while viewing demo data',
  );

  w.dispatchEvent(new w.PageTransitionEvent('pagehide', { persisted: false }));
  assert.equal(parentEvents.size, 0);
  assert.equal(timers.size, 0, 'Page teardown releases freshness and decision timers');
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
