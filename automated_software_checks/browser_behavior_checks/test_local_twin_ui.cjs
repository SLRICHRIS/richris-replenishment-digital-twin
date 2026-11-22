const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

// All requests terminate in this in-memory mock. No camera or robot is contacted.
const html = fs.readFileSync(
  'backend_streamlit_and_telemetry/vision_control/local_twin.html',
  'utf8',
);
const dom = new JSDOM(html.replace('__AMR_SESSION_TOKEN__', 'inert-test-token'), {
  url: 'http://127.0.0.1:18765/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const w = dom.window,
  d = w.document,
  el = (id) => d.getElementById(id);
let now = 0,
  hidden = false,
  sample = 1,
  reviewNumber = 0,
  serveFrame = true;
const intervals = new Map(),
  requests = [];
Object.defineProperty(w.performance, 'now', { value: () => now });
Object.defineProperty(d, 'hidden', { get: () => hidden });
w.Date.now = () => 1800000000000 + now;
w.setInterval = (fn, delay) => {
  intervals.set(delay, fn);
  return delay;
};
w.clearInterval = (id) => intervals.delete(id);
w.URL.createObjectURL = () => 'blob:inert-camera-frame';
w.URL.revokeObjectURL = () => {};
let state = {
  connected: false,
  issued_at_ms: w.Date.now(),
  calibration_ready: false,
  ready: false,
  freshness: { camera_ms: 500, hardware_ms: 500 },
  camera: { seq: 0, captured_at_ms: 0, age_ms: w.Date.now(), connected: false, valid: false },
  scene: null,
  hardware: null,
  review: null,
  battery: null,
  stations: {
    verified: true,
    stations: {
      A: { x: 140, y: 140 },
      B: { x: 401, y: 402 },
      E: { x: 300, y: 300 },
    },
    config_id: 'measured',
  },
  mission: null,
  agent: { state: 'idle', reason: '' },
};
function refresh({ camera = true, scene = true, hardware = true } = {}) {
  sample++;
  state.issued_at_ms = w.Date.now();
  if (camera)
    state.camera = {
      seq: sample,
      captured_at_ms: w.Date.now(),
      age_ms: 0,
      connected: true,
      valid: true,
      ids: [0, 1, 2, 3, 4],
      checkerboard_views: 20,
      background_saved: true,
    };
  if (scene)
    state.scene = {
      agent_boot_id: 'camera-boot',
      seq: sample * 3,
      age_ms: 0,
      valid: true,
      pose: { x: 140, y: 140, heading: 0.3 },
      obstacles: [{ x: 350, y: 300, width: 30, height: 40 }],
      geometry: { robot_length_mm: 170, robot_width_mm: 155 },
    };
  if (hardware)
    state.hardware = {
      boot_id: 'esp32-boot',
      epoch_id: 'epoch',
      seq: sample,
      age_ms: 0,
      ready: true,
      battery_voltage_v: 7.4,
      left_duty: 0,
      right_duty: 0,
    };
  state.calibration_ready = true;
  state.ready = true;
  state.battery = { voltage_v: 7.4, action: 'normal' };
}
w.fetch = async (path, options = {}) => {
  const body = options.body === undefined ? undefined : JSON.parse(options.body);
  requests.push({ path, body, options });
  if (path.startsWith('/api/frame.jpg')) {
    if (!serveFrame) return { ok: true, status: 204 };
    serveFrame = false;
    return { ok: true, status: 200, blob: async () => new w.Blob(['inert frame']) };
  }
  if (path === '/api/connect') {
    state.connected = true;
    refresh();
  }
  if (path === '/api/mission') {
    const goal = state.stations.stations[body.destination];
    state.review = {
      review_id: 'review-' + ++reviewNumber,
      state: 'pending',
      expires_at_ms: w.Date.now() + 60000,
      route: {
        goal: [Math.round(goal.x / 10) * 10, Math.round(goal.y / 10) * 10],
        points: [
          [140, 140],
          [200, 400],
          [400, 400],
        ],
        length_mm: 480,
      },
    };
  }
  if (path === '/api/mission')
    state.mission = {
      mission_id: 'mission-' + reviewNumber,
      review_id: state.review.review_id,
      state: 'review',
      start_station: body.start,
      destination_station: body.destination,
      original_start: { ...state.stations.stations[body.start], heading: 0 },
      original_destination: {
        ...state.stations.stations[body.destination],
        label: body.destination,
      },
      active_goal: { ...state.stations.stations[body.destination], label: body.destination },
      intent: 'destination',
      proposal_kind: 'initial',
    };
  if (path === '/api/decision') {
    state.review.state = body.decision === 'approve' ? 'sent' : body.decision;
    state.agent.state = body.decision === 'approve' ? 'arming' : 'idle';
  }
  if (path === '/api/stop' || (path === '/api/presence' && body?.active === false)) {
    if (state.review) state.review.state = 'cancelled';
    state.agent.state = 'idle';
  }
  return { ok: true, status: 200, json: async () => structuredClone(state) };
};
const flush = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};
const tick = async (delay) => {
  await intervals.get(delay)?.();
  await flush();
};
const set = (id, value) => {
  el(id).value = value;
  el(id).dispatchEvent(new w.Event('input'));
};
const submit = (form, button) =>
  el(form).dispatchEvent(
    new w.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: el(button) }),
  );
const count = (path) => requests.filter((r) => r.path === path).length;

async function main() {
  w.eval(d.querySelector('script').textContent);
  await flush();
  assert.equal(
    requests.filter((r) => r.options.method === 'POST').length,
    0,
    'Opening the UI does not connect or command a device',
  );
  assert.equal(el('plan').disabled, true);
  assert.equal(
    el('camera-age').textContent,
    'No current sample',
    'A never-captured timestamp zero is not a decades-old frame',
  );
  for (const captured_at_ms of [null, undefined, 0]) {
    state.camera = { seq: 0, captured_at_ms, age_ms: 0, connected: true, valid: true };
    await tick(250);
    assert.equal(
      el('camera-age').textContent,
      'No current sample',
      'Null, missing or zero capture time cannot claim a current frame',
    );
    assert.notEqual(el('camera-value').textContent, 'Pose tracked');
  }
  assert.equal(el('manual').href, 'http://10.55.54.112/');
  assert.equal(el('hardware-address').textContent, 'Target: 10.55.54.112');
  state.controller_ip = '192.168.4.112';
  await tick(250);
  assert.equal(el('manual').href, 'http://192.168.4.112/');
  assert.equal(el('hardware-address').textContent, 'Target: 192.168.4.112');
  state.controller_ip = '10.55.54.112@elsewhere';
  await tick(250);
  assert.equal(el('manual').hasAttribute('href'), false);
  state.controller_ip = '10.55.54.112';
  await tick(250);
  el('connect').click();
  await flush();
  assert.deepEqual(
    requests.find((r) => r.path === '/api/connect').body,
    {},
    'CLI camera selection must not be overwritten',
  );
  assert.equal(
    requests.find((r) => r.path === '/api/connect').options.headers['X-AMR-Session'],
    'inert-test-token',
  );
  assert.equal(el('camera-value').textContent, 'Pose tracked');
  assert.match(
    el('camera-age').textContent,
    /^0\.00 s old · sample /,
    'A subsequent real capture has a fresh sample age',
  );
  state.hardware.seq = 0;
  await tick(250);
  assert.equal(
    el('hardware-age').textContent,
    '0.00 s old · sample 0',
    'Authenticated H1 sequence zero remains a valid sample',
  );
  assert.equal(el('hardware-value').textContent, 'Authenticated · ready');
  assert.equal(el('battery-value').textContent, '7.40 V');
  assert.ok(el('map-pose').children.length > 0);
  assert.equal(el('camera-media').dataset.fresh, 'true');
  el('mission-start').value = 'A';
  el('mission-destination').value = 'B';
  el('mission-destination').dispatchEvent(new w.Event('change'));
  assert.equal(el('plan').disabled, false);
  submit('plan-form', 'plan');
  await flush();
  assert.equal(el('goal-x').value, '400', 'Review uses the captured planner goal');
  assert.equal(el('goal-y').value, '400');
  assert.equal(el('approve').disabled, true, 'Decision reason is mandatory');
  set('reason', 'Measured floor clear and target reviewed');
  assert.equal(el('approve').disabled, false);
  set('goal-x', '450');
  assert.equal(el('approve').disabled, true, 'Changing a target cannot approve the previous route');
  submit('decision-form', 'approve');
  await flush();
  assert.equal(count('/api/decision'), 0);
  assert.match(el('review-detail').textContent, /Destination changed/);
  set('goal-x', '400');

  now += 501;
  await tick(100);
  assert.equal(el('map-pose').children.length, 0, 'A stale camera pose is removed');
  assert.equal(el('battery-value').textContent, '—');
  assert.equal(el('outputs-value').textContent, '—');
  assert.equal(el('approve').disabled, true);
  await tick(250); // Backend mock repeats identical IDs with age zero.
  assert.equal(
    el('map-pose').children.length,
    0,
    'Polling identical snapshots cannot reset their age',
  );
  assert.equal(el('battery-value').textContent, '—');
  refresh({ scene: false, hardware: false });
  await tick(250);
  assert.equal(
    el('map-pose').children.length,
    0,
    'New camera frames cannot freshen an old scene pose',
  );
  assert.equal(el('approve').disabled, true);
  assert.equal(
    el('camera-media').dataset.fresh,
    'false',
    'Fresh camera status cannot freshen a previously displayed JPEG',
  );
  refresh();
  await tick(250);
  assert.equal(el('approve').disabled, false);
  submit('decision-form', 'approve');
  await flush();
  assert.equal(count('/api/decision'), 1);
  assert.equal(el('goal-x').disabled, true, 'Active route target is fixed');
  await tick(250);
  await tick(500);
  await tick(100);
  assert.equal(count('/api/decision'), 1, 'Polls and presence never replay an approval');
  assert.equal(el('arrival-state').textContent, 'Not verified');

  state.review.state = 'battery_review';
  state.agent.state = 'battery_review';
  state.battery.action = 'critical_stop';
  await tick(250);
  assert.equal(el('reason').value, '', 'Battery review requires a new decision reason');
  set('reason', 'Inspecting the reported voltage');
  assert.equal(el('battery-continue').disabled, true);
  assert.equal(el('battery-divert').disabled, true);
  el('battery-continue').dispatchEvent(new w.Event('click'));
  await flush();
  assert.equal(count('/api/battery-decision'), 0, 'Critical battery cannot be overridden in UI');
  const stops = count('/api/stop');
  el('stop').click();
  await flush();
  assert.equal(count('/api/stop'), stops + 1, 'Explicit Stop sends one stop request');
  assert.ok(requests.some((r) => r.path === '/api/presence' && r.body.active === false));
  const presenceCount = count('/api/presence');
  await tick(500);
  assert.equal(count('/api/presence'), presenceCount, 'Stop ends attended renewal');
  assert.equal(el('plan').disabled, true);
  state.controller_feedback = {
    ready: false,
    reason: 'ESP32 request timed out (250 ms socket limit). Check Wi-Fi.',
  };
  await tick(250);
  assert.equal(el('status-title').textContent, 'Attended control ended');
  assert.match(
    el('hardware-detail').textContent,
    /timed out.*250 ms/,
    'Ending attended control must not hide the current connection fault',
  );
  state.controller_feedback.reason = '<img src=x onerror="alert(1)">';
  await tick(250);
  assert.equal(el('hardware-detail').querySelector('img'), null);
  delete state.controller_feedback;

  el('connect').click();
  await flush();
  hidden = true;
  d.dispatchEvent(new w.Event('visibilitychange'));
  await flush();
  const hiddenPresence = count('/api/presence');
  hidden = false;
  d.dispatchEvent(new w.Event('visibilitychange'));
  await flush();
  await tick(500);
  assert.equal(
    count('/api/presence'),
    hiddenPresence,
    'Returning to the page cannot resume presence',
  );
  assert.equal(el('plan').disabled, true);
  state.reason = '<img src=x onerror="alert(1)">';
  await tick(250);
  assert.equal(el('status-detail').querySelector('img'), null, 'Service strings render as text');
  w.dispatchEvent(new w.Event('pagehide'));
  await flush();
  assert.equal(intervals.size, 0, 'Page teardown clears poll and presence timers');
  dom.window.close();
  console.log(
    'Local ArUco UI: explicit connection, captured decisions, independent freshness, presence and Stop checks passed (mock only).',
  );
}
main().catch((error) => {
  dom.window.close();
  console.error(error);
  process.exitCode = 1;
});
