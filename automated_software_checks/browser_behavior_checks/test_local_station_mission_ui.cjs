const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

// In-memory responses only: this test never opens a camera or contacts an AMR.
const html = fs.readFileSync(
  'backend_streamlit_and_telemetry/vision_control/local_twin.html',
  'utf8',
);
const STATIONS = {
  A: { x: 140, y: 140 },
  B: { x: 450, y: 430 },
  E: { x: 300, y: 140 },
};
const clone = (value) => structuredClone(value);
const flush = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};

function harness() {
  const dom = new JSDOM(html.replace('__AMR_SESSION_TOKEN__', 'station-test-token'), {
    url: 'http://127.0.0.1:18765/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window,
    d = w.document,
    requests = [],
    timers = new Map();
  const el = (id) => {
    const node = d.getElementById(id);
    assert.ok(node, `Expected #${id}`);
    return node;
  };
  let now = 0,
    seq = 0,
    reviewNumber = 0,
    missionNumber = 0,
    hidden = false;
  Object.defineProperty(w.performance, 'now', { value: () => now });
  Object.defineProperty(d, 'hidden', { get: () => hidden });
  w.Date.now = () => 1800000000000 + now;
  w.setInterval = (fn, ms) => {
    timers.set(ms, fn);
    return ms;
  };
  w.clearInterval = (id) => timers.delete(id);
  w.URL.createObjectURL = () => 'blob:inert-frame';
  w.URL.revokeObjectURL = () => {};
  const state = {
    connected: false,
    issued_at_ms: w.Date.now(),
    calibration_ready: false,
    ready: false,
    camera: null,
    scene: null,
    hardware: null,
    review: null,
    mission: null,
    stations: {
      verified: false,
      stations: {},
      config_id: null,
      reason: 'Measure stations A, B and E before planning.',
    },
    battery: null,
    agent: { state: 'idle', reason: '' },
    freshness: { camera_ms: 500, hardware_ms: 500 },
    recommendations: [],
  };
  function fresh({
    camera = true,
    scene = true,
    hardware = true,
    voltage = state.hardware?.battery_voltage_v ?? 7.4,
  } = {}) {
    seq++;
    state.issued_at_ms = w.Date.now();
    state.ready = true;
    state.calibration_ready = true;
    if (camera)
      state.camera = {
        seq,
        captured_at_ms: w.Date.now(),
        age_ms: 0,
        valid: true,
        connected: true,
        ids: [0, 1, 2, 3, 4],
        checkerboard_views: 20,
        background_saved: true,
      };
    if (scene)
      state.scene = {
        agent_boot_id: 'camera-boot',
        seq: seq * 3,
        age_ms: 0,
        valid: true,
        pose: { x: 140, y: 140, heading: 0.3 },
        obstacles: [],
        geometry: { robot_length_mm: 170, robot_width_mm: 155 },
      };
    if (hardware)
      state.hardware = {
        boot_id: 'amr-boot',
        epoch_id: 'epoch',
        seq,
        age_ms: 0,
        ready: true,
        battery_voltage_v: voltage,
        left_duty: 0,
        right_duty: 0,
      };
    state.battery = {
      voltage_v: voltage,
      critical_v: 6.7,
      advisory_v: 7.0,
      action: voltage < 6.7 ? 'critical_stop' : voltage <= 7.0 ? 'ask_human' : 'normal',
    };
  }
  function preview(kind, goal, intent = state.mission?.intent || 'destination') {
    state.review = {
      review_id: 'review-' + ++reviewNumber,
      state: 'pending',
      reason: 'Inspect this newly proposed route before approval.',
      expires_at_ms: w.Date.now() + 60000,
      route: {
        goal: [goal.x, goal.y],
        points: [
          [state.scene.pose.x, state.scene.pose.y],
          [140, 450],
          [goal.x, goal.y],
        ],
        length_mm: 610,
      },
    };
    if (state.mission)
      Object.assign(state.mission, {
        state: 'review',
        proposal_kind: kind,
        active_goal: clone(goal),
        intent,
        review_id: state.review.review_id,
      });
    state.agent = { state: 'idle', reason: 'Stopped; new route awaits human approval.' };
  }
  function newMission(start = 'A', destination = 'B') {
    state.mission = {
      mission_id: 'mission-' + ++missionNumber,
      state: 'review',
      start_station: start,
      original_start: { ...STATIONS[start], heading: 0.3 },
      destination_station: destination,
      original_destination: { ...STATIONS[destination], label: destination },
      active_goal: { ...STATIONS[destination], label: destination },
      intent: 'destination',
      proposal_kind: 'initial',
      review_id: null,
      reason: 'Camera start checked.',
      auto_replan: false,
    };
    preview('initial', state.mission.original_destination);
  }
  function stop() {
    if (state.review) state.review.state = 'cancelled';
    if (state.mission) state.mission.state = 'stopped';
    state.agent = { state: 'idle', reason: 'Stopped by operator.' };
  }
  w.fetch = async (path, options = {}) => {
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    requests.push({ path, body, options });
    if (path.startsWith('/api/frame.jpg')) return { ok: true, status: 204 };
    let error = null;
    if (path === '/api/connect') {
      state.connected = true;
      fresh();
    }
    if (path === '/api/stations') {
      if (body)
        state.stations = {
          verified: body.verified,
          stations: clone(body.stations),
          config_id: 'measured-profile',
          reason: 'Measured station coordinates saved.',
        };
      else return { ok: true, status: 200, json: async () => clone(state.stations) };
    }
    if (path === '/api/mission') {
      const selected = state.stations.stations[body.start];
      if (
        !selected ||
        Math.hypot(state.scene.pose.x - selected.x, state.scene.pose.y - selected.y) > 15
      )
        error = 'ArUco pose is not at selected start station; move manually and recheck.';
      else newMission(body.start, body.destination);
    }
    if (path === '/api/decision') {
      state.review.state = body.decision === 'approve' ? 'sent' : body.decision;
      state.agent.state = body.decision === 'approve' ? 'arming' : 'idle';
      if (state.mission) state.mission.state = body.decision === 'approve' ? 'running' : 'stopped';
    }
    if (path === '/api/return-start') {
      state.review.state = 'cancelled';
      state.agent.state = 'blocked';
      Object.assign(state.mission, {
        state: 'waiting_stop',
        proposal_kind: 'return_start',
        active_goal: { ...state.mission.original_start, label: state.mission.start_station },
        intent: 'return_start',
      });
    }
    if (path === '/api/battery-decision') {
      if (body.choice === 'divert') {
        state.review.state = 'cancelled';
        state.agent.state = 'blocked';
        Object.assign(state.mission, {
          state: 'waiting_stop',
          proposal_kind: 'battery_diversion',
          active_goal: { ...STATIONS.E, label: 'E' },
          intent: 'battery_station',
        });
      }
      if (body.choice === 'continue') {
        state.review.state = 'running';
        state.agent.state = 'running';
        state.mission.state = 'running';
      }
    }
    if (path === '/api/stop' || (path === '/api/presence' && body?.active === false)) stop();
    return {
      ok: !error,
      status: error ? 409 : 200,
      json: async () => (error ? { error } : clone(state)),
    };
  };
  const set = (id, value) => {
    el(id).value = value;
    el(id).dispatchEvent(new w.Event('input', { bubbles: true }));
    el(id).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const click = async (id) => {
    el(id).click();
    await flush();
  };
  const submit = async (form, button) => {
    el(form).dispatchEvent(
      new w.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: el(button) }),
    );
    await flush();
  };
  const tick = async (delay) => {
    await timers.get(delay)?.();
    await flush();
  };
  const count = (path) => requests.filter((r) => r.path === path).length;
  async function start() {
    w.eval(d.querySelector('script').textContent);
    await flush();
  }
  async function close() {
    w.dispatchEvent(new w.Event('pagehide'));
    await flush();
    w.close();
  }
  return {
    w,
    d,
    el,
    state,
    requests,
    set,
    click,
    submit,
    tick,
    count,
    fresh,
    preview,
    newMission,
    start,
    close,
    advance: (ms) => {
      now += ms;
    },
    hide: (value) => {
      hidden = value;
      d.dispatchEvent(new w.Event('visibilitychange'));
    },
  };
}

async function main() {
  const h = harness();
  try {
    await h.start();
    assert.equal(h.requests.filter((r) => r.options.method === 'POST').length, 0);
    for (const field of ['mission-start', 'mission-destination']) {
      assert.deepEqual(
        Array.from(h.el(field).options, (option) => option.value),
        ['', 'A', 'B', 'E'],
      );
    }
    assert.equal(h.w.document.getElementById('station-C-x'), null);
    assert.equal(h.w.document.getElementById('station-D-x'), null);
    for (const name of Object.keys(STATIONS)) {
      assert.equal(h.el(`station-${name}-x`).value, '', `${name} X must start unmeasured`);
      assert.equal(h.el(`station-${name}-y`).value, '', `${name} Y must start unmeasured`);
    }
    assert.equal(h.el('station-verified').checked, false);
    assert.equal(h.el('plan').disabled, true);
    await h.click('connect');
    Object.assign(h.state.stations, {
      required_clearance_mm: 125.5,
      usable_bounds: { x_min: 125.5, x_max: 634.5, y_min: 125.5, y_max: 434.5 },
    });
    await h.tick(250);
    assert.equal(h.state.stations.verified, false);
    assert.match(h.el('station-detail').textContent, /Required edge clearance: 125\.5 mm/);
    assert.match(h.el('station-detail').textContent, /X 125\.5–634\.5 mm, Y 125\.5–434\.5 mm/);
    assert.equal(
      h.el('station-A-x').value,
      '',
      'Clearance guidance cannot invent station positions',
    );
    for (const [name, coordinates] of Object.entries(STATIONS)) {
      h.set(`station-${name}-x`, coordinates.x);
      h.set(`station-${name}-y`, coordinates.y);
    }
    assert.equal(
      h.el('station-save').disabled,
      true,
      'Coordinates alone cannot claim measured verification',
    );
    h.el('station-verified').checked = true;
    h.el('station-verified').dispatchEvent(new h.w.Event('change', { bubbles: true }));
    await h.click('station-save');
    assert.deepEqual(h.requests.find((r) => r.path === '/api/stations' && r.body).body, {
      stations: STATIONS,
      verified: true,
    });

    const cameraPose = h.el('map-pose').innerHTML;
    h.set('mission-start', 'E');
    h.set('mission-destination', 'B');
    assert.equal(
      h.el('map-pose').innerHTML,
      cameraPose,
      'Selecting a start cannot relocate the camera-derived robot pose',
    );
    await h.click('plan');
    assert.equal(h.state.mission, null);
    assert.match(h.el('action-error').textContent, /ArUco pose is not at selected start/);
    h.set('mission-start', 'A');
    await h.click('plan');
    const mission = clone(h.state.mission);
    assert.deepEqual(h.requests.filter((r) => r.path === '/api/mission').at(-1).body, {
      start: 'A',
      destination: 'B',
    });
    assert.match(h.el('mission-original-start').textContent, /A/);
    assert.match(h.el('mission-original-destination').textContent, /B/);
    const originalStart = h.el('mission-original-start').textContent;
    const originalDestination = h.el('mission-original-destination').textContent;
    const originalUnchanged = () => {
      assert.equal(h.el('mission-original-start').textContent, originalStart);
      assert.equal(h.el('mission-original-destination').textContent, originalDestination);
      assert.deepEqual(h.state.mission.original_start, mission.original_start);
      assert.deepEqual(h.state.mission.original_destination, mission.original_destination);
    };
    assert.equal(h.count('/api/decision'), 0, 'Initial planning creates no execution request');
    h.set('reason', 'Reviewed A to B against the measured floor');

    // A previously pending review must not authorize a mission that has since blocked.
    h.state.mission.state = 'blocked';
    h.state.mission.reason = 'No safe path to the original destination.';
    await h.tick(250);
    assert.equal(h.state.review.state, 'pending');
    assert.equal(h.el('approve').disabled, true, 'Blocked mission cannot reuse a pending review');
    await h.submit('decision-form', 'approve');
    assert.equal(h.count('/api/decision'), 0, 'Approval handler also rejects a blocked mission');
    assert.match(h.el('route-map-label').textContent, /Previous path.*not active/i);
    assert.ok(
      +h.el('map-route').querySelector('polyline').getAttribute('opacity') < 1,
      'Historical path is visually muted',
    );
    originalUnchanged();
    h.state.mission.state = 'review';

    // A review needs a complete, finite, bounded path, not only a destination.
    const capturedRoute = clone(h.state.review.route);
    for (const points of [
      undefined,
      [],
      [[140, 140]],
      [
        [140, 140],
        [450, NaN],
      ],
      [[140, 140], [450]],
      [
        [140, 140],
        [761, 430],
      ],
      [
        [140, 140],
        [450, 561],
      ],
    ]) {
      h.state.review.route.points = points;
      await h.tick(250);
      assert.equal(h.el('approve').disabled, true, 'Incomplete or invalid path cannot be approved');
      await h.submit('decision-form', 'approve');
      assert.equal(h.count('/api/decision'), 0, 'Invalid path cannot bypass the disabled control');
    }
    h.state.review.route = clone(capturedRoute);
    h.state.mission.review_id = 'superseded-review';
    await h.tick(250);
    assert.equal(
      h.el('approve').disabled,
      true,
      'Mission and pending review identities must agree',
    );
    await h.submit('decision-form', 'approve');
    assert.equal(h.count('/api/decision'), 0);
    h.state.mission.review_id = h.state.review.review_id;
    h.state.review.route.goal = null;
    await h.tick(250);
    assert.equal(h.el('approve').disabled, true, 'A valid path still requires a captured goal');
    await h.submit('decision-form', 'approve');
    assert.equal(h.count('/api/decision'), 0);
    h.state.review.route = capturedRoute;
    await h.tick(250);
    assert.equal(h.el('approve').disabled, false, 'Valid current proposal recovers normal review');
    await h.click('approve');
    assert.equal(h.count('/api/decision'), 1);

    // Hardware has stopped after an obstacle; the server proposes a replacement.
    h.fresh();
    h.state.scene.pose = { x: 140, y: 250, heading: 1.57 };
    h.state.scene.obstacles = [{ x: 200, y: 300, width: 40, height: 40 }];
    h.state.mission.state = 'waiting_stop';
    h.state.agent.state = 'blocked';
    h.state.review.state = 'blocked';
    await h.tick(250);
    assert.equal(
      h.el('approve').disabled,
      true,
      'No route can be approved while the obstacle stop is unverified',
    );
    h.preview('obstacle_replan', { ...STATIONS.B, label: 'B' });
    h.state.mission.reason =
      'Obstacle blocks the approved route. A detour to the same destination is ready for review.';
    await h.tick(250);
    originalUnchanged();
    assert.equal(h.count('/api/decision'), 1, 'Obstacle replanning is only a proposal');
    assert.equal(h.el('reason').value, '');
    assert.equal(h.el('approve').disabled, true);
    assert.match(h.el('approve').textContent, /detour/i);
    assert.match(h.el('reject').textContent, /stop/i);
    assert.match(h.el('mission-active-goal').textContent, /B/);
    h.set('reason', 'The alternate path has not been cleared');
    await h.click('reject');
    assert.equal(
      h.requests.filter((r) => r.path === '/api/decision').at(-1).body.decision,
      'reject',
    );
    assert.equal(h.state.mission.state, 'stopped');
    originalUnchanged();

    h.set('reason', 'Return to the original measured start');
    await h.click('return-start');
    assert.equal(h.count('/api/return-start'), 1);
    assert.equal(h.state.mission.intent, 'return_start');
    assert.equal(h.state.mission.state, 'waiting_stop');
    assert.equal(h.el('approve').disabled, true, 'Return waits for acknowledged stable stop');
    h.fresh();
    h.preview('return_start', { ...h.state.mission.original_start, label: 'A' }, 'return_start');
    await h.tick(250);
    assert.match(h.el('mission-active-goal').textContent, /A/);
    originalUnchanged();
    assert.equal(h.el('reason').value, '');
    assert.equal(h.el('approve').disabled, true, 'Return is a new preview, not automatic motion');
    assert.equal(h.count('/api/decision'), 2);
    h.set('reason', 'Reviewed the return path to A');
    await h.click('approve');
    assert.equal(h.count('/api/decision'), 3);

    // A separate fresh A→B review supplies the battery interruption scenario.
    h.fresh();
    h.newMission('A', 'B');
    await h.tick(250);
    h.set('reason', 'Reviewed A to B for the next mission');
    await h.click('approve');
    h.fresh({ voltage: 6.85 });
    h.state.mission.state = 'battery_review';
    h.state.review.state = 'battery_review';
    h.state.review.battery_review_seq = 1;
    h.state.review.battery_prompt = 'Battery 6.85 V is within the 6.7–7.0 V decision band.';
    h.state.agent.state = 'battery_review';
    await h.tick(250);
    assert.equal(h.el('battery-choice').hidden, false);
    assert.match(h.el('battery-continue').textContent, /Continue to B/i);
    assert.match(h.el('battery-divert').textContent, /E/);
    assert.match(h.el('return-start').textContent, /start/i);
    assert.equal(h.el('battery-value').textContent, '6.85 V');
    for (const batteryPrompt of [true, false]) {
      h.state.review.battery_prompt = batteryPrompt;
      await h.tick(250);
      assert.doesNotMatch(h.el('battery-prompt').textContent, /\b(?:true|false)\b/);
      assert.match(h.el('battery-prompt').textContent, /6\.85 V measured/);
      assert.match(h.el('battery-prompt').textContent, /Current route goal: B/);
    }
    assert.equal(h.count('/api/battery-decision'), 0);
    const batteryRoute = h.state.review.review_id;
    h.set('reason', 'Continue to B with the measured supply warning acknowledged');
    h.advance(501);
    await h.tick(100);
    assert.equal(h.el('battery-continue').disabled, true);
    assert.equal(h.el('battery-divert').disabled, true);
    assert.equal(h.el('return-start').disabled, true);
    assert.equal(h.el('stop').disabled, false, 'Stop stays available without fresh evidence');
    h.fresh({ voltage: 6.85 });
    await h.tick(250);
    await h.click('battery-continue');
    const continuation = h.requests.filter((r) => r.path === '/api/battery-decision').at(-1).body;
    assert.equal(continuation.choice, 'continue');
    assert.equal(continuation.review_id, batteryRoute);
    assert.equal(
      continuation.battery_review_seq,
      1,
      'Battery choice is bound to the specific warning',
    );
    assert.equal(
      h.state.review.review_id,
      batteryRoute,
      'Continue resumes the same approved route',
    );
    assert.equal(h.state.mission.active_goal.label, 'B');

    h.state.review.state = 'battery_review';
    h.state.mission.state = 'battery_review';
    h.state.agent.state = 'battery_review';
    h.state.review.battery_review_seq = 2;
    await h.tick(250);
    h.set('reason', 'Reviewing another battery warning');
    h.state.review.battery_review_seq = 3;
    await h.tick(250);
    assert.equal(h.el('reason').value, '', 'A newer battery warning cannot reuse the prior reason');
    h.set('reason', 'Divert to measured battery station E');
    const decisionsBeforeDiversion = h.count('/api/decision');
    await h.click('battery-divert');
    const diversion = h.requests.filter((r) => r.path === '/api/battery-decision').at(-1).body;
    assert.equal(diversion.choice, 'divert');
    assert.equal(diversion.battery_review_seq, 3);
    assert.equal(h.state.mission.intent, 'battery_station');
    assert.equal(h.state.mission.state, 'waiting_stop');
    assert.equal(
      h.el('approve').disabled,
      true,
      'Battery diversion waits for acknowledged stable stop',
    );
    h.fresh({ voltage: 6.85 });
    h.preview('battery_diversion', { ...STATIONS.E, label: 'E' }, 'battery_station');
    await h.tick(250);
    assert.equal(h.state.mission.active_goal.label, 'E');
    assert.match(h.el('mission-active-goal').textContent, /E/);
    assert.match(h.el('mission-original-destination').textContent, /B/);
    assert.match(h.el('mission-original-start').textContent, /A/);
    assert.equal(h.el('approve').disabled, true);
    assert.equal(
      h.count('/api/decision'),
      decisionsBeforeDiversion,
      'Go to E creates a preview and cannot execute it',
    );
    h.set('reason', 'Approved the newly reviewed route to E');
    await h.click('approve');
    assert.equal(h.count('/api/decision'), decisionsBeforeDiversion + 1);
    await h.tick(250);
    await h.tick(500);
    assert.equal(
      h.count('/api/decision'),
      decisionsBeforeDiversion + 1,
      'Refresh and presence do not replay approval',
    );
    const stops = h.count('/api/stop');
    await h.click('battery-stop');
    assert.equal(h.count('/api/stop'), stops + 1);
    assert.equal(h.el('plan').disabled, true);
    console.log(
      'Station mission UI checks passed: measured A/B/E, observed start, immutable mission, reviewed detour/return/E and fresh battery choices (mock only).',
    );
  } finally {
    await h.close();
  }
}

async function movingReturn() {
  const h = harness();
  try {
    await h.start();
    await h.click('connect');
    h.state.stations = {
      verified: true,
      stations: clone(STATIONS),
      config_id: 'measured-profile',
      reason: 'Measured station coordinates restored.',
    };
    h.newMission('A', 'B');
    await h.tick(250);
    h.set('reason', 'Review the route before starting');
    await h.click('approve');
    assert.equal(h.count('/api/decision'), 1);
    h.state.mission.state = 'running';
    h.state.review.state = 'running';
    h.state.agent.state = 'running';
    h.state.ready = false; // The moving AMR is not ready to approve another route.
    h.state.hardware.left_duty = 30;
    h.state.hardware.right_duty = 30;
    await h.tick(250);
    h.set('reason', 'Stop this route and preview a return to the original start');
    assert.equal(
      h.el('return-start').disabled,
      false,
      'Fresh attended Return remains available during motion',
    );
    assert.equal(h.el('approve').disabled, true);
    const requestStart = h.requests.length;
    await h.click('return-start');
    assert.deepEqual(
      h.requests
        .slice(requestStart)
        .filter((r) => r.options.method === 'POST')
        .map((r) => r.path),
      ['/api/return-start'],
      'Return asks the backend to stop and prepare a preview; it sends no movement or approval',
    );
    assert.equal(h.state.mission.state, 'waiting_stop');
    assert.equal(h.count('/api/decision'), 1);
    h.preview('return_start', { ...h.state.mission.original_start, label: 'A' }, 'return_start');
    await h.tick(250);
    h.set('reason', 'Review the proposed return after stopping');
    assert.equal(
      h.el('approve').disabled,
      true,
      'Fresh evidence alone cannot approve before ready stationary status',
    );
    h.state.ready = true;
    h.state.hardware.left_duty = 0;
    h.state.hardware.right_duty = 0;
    await h.tick(250);
    assert.equal(h.el('approve').disabled, false);
    assert.equal(
      h.count('/api/decision'),
      1,
      'Becoming ready does not automatically approve the return',
    );
    console.log(
      'Station mission audit checks passed: measured bounds, boolean battery prompts and attended return during motion (mock only).',
    );
  } finally {
    await h.close();
  }
}
async function singlePointReturn() {
  const h = harness();
  try {
    await h.start();
    await h.click('connect');
    h.state.stations = { verified: true, stations: clone(STATIONS), config_id: 'measured' };
    h.newMission('A', 'B');
    await h.tick(250);
    h.set('reason', 'Reject travel and verify the current original start');
    await h.click('reject');
    h.set('reason', 'Return to original start A');
    await h.click('return-start');
    h.preview('return_start', { ...h.state.mission.original_start, label: 'A' }, 'return_start');
    const goal = h.state.review.route.goal;
    h.state.review.route.points = [[...goal]];
    h.state.review.route.length_mm = 0;
    h.state.review.route.goal_tolerance_mm = 15;
    await h.tick(250);
    assert.equal(
      h.el('approve').disabled,
      true,
      'Single-point verification still requires a reason',
    );
    h.set('reason', 'Already at A; verify stationary arrival');
    assert.equal(
      h.el('approve').disabled,
      false,
      'A matching one-point target is a valid reviewed verification',
    );
    assert.match(
      h.el('review-detail').textContent,
      /Already at target.*stopped-position verification/i,
    );
    assert.match(h.el('approve').textContent, /stopped-position verification/i);
    h.state.review.route.points = [];
    await h.tick(250);
    assert.equal(h.el('approve').disabled, true, 'Empty paths remain invalid');
    h.state.review.route.points = [[goal[0] + 1, goal[1]]];
    await h.tick(250);
    assert.equal(h.el('approve').disabled, true, 'Single point must exactly match captured goal');
    h.state.review.route.points = [[...goal]];
    await h.tick(250);
    const decisions = h.count('/api/decision');
    await h.click('approve');
    assert.equal(
      h.count('/api/decision'),
      decisions + 1,
      'Verification requires one explicit approval',
    );
    assert.equal(
      h.requests.filter((r) => r.path === '/api/decision').at(-1).body.review_id,
      h.state.review.review_id,
    );
    assert.match(
      h.el('arrival-state').textContent,
      /Not verified/,
      'Approval is not arrival evidence',
    );
    console.log('Single-point return verification UI passed (mock only).');
  } finally {
    await h.close();
  }
}

async function frontReferenceStops() {
  const h = harness();
  try {
    await h.start();
    await h.click('connect');
    h.state.stations.front_offset_mm = 85;
    await h.tick(250);
    const decisions = h.count('/api/decision');
    const saves = h.requests.filter((r) => r.path === '/api/stations' && r.body).length;
    await h.click('station-reported');
    assert.equal(h.el('station-reference').value, 'front');
    assert.equal(h.el('station-B-x').value, '205');
    assert.equal(h.el('station-B-y').value, '430');
    assert.equal(h.el('station-verified').checked, false);
    assert.equal(h.el('station-save').disabled, true);
    assert.equal(h.requests.filter((r) => r.path === '/api/stations' && r.body).length, saves);
    assert.match(h.el('station-draft-detail').textContent, /85\.0 mm/);
    assert.match(
      h.el('station-draft-detail').textContent,
      /A \(545\.0, 350\.0\).*B \(205\.0, 345\.0\).*E \(290\.0, 160\.0\)/,
    );
    h.set('station-B-heading', '');
    h.el('station-verified').checked = true;
    h.el('station-verified').dispatchEvent(new h.w.Event('change'));
    assert.equal(h.el('station-save').disabled, true, 'Missing heading cannot save a front target');
    h.set('station-B-heading', 90);
    h.el('station-verified').checked = true;
    h.el('station-verified').dispatchEvent(new h.w.Event('change'));
    await h.click('station-save');
    const body = h.requests.filter((r) => r.path === '/api/stations' && r.body).at(-1).body;
    assert.deepEqual(body, {
      verified: true,
      reference: 'front',
      headings_deg: { A: 0, B: 90, E: -90 },
      stations: { A: { x: 630, y: 350 }, B: { x: 205, y: 430 }, E: { x: 290, y: 75 } },
    });
    // A synthetic server response distinguishes the raw edge from the computed centre.
    const centres = { A: { x: 545, y: 350 }, B: { x: 205, y: 345 }, E: { x: 290, y: 160 } };
    h.state.stations = {
      verified: true,
      reference: 'front',
      measured_points: body.stations,
      headings_deg: body.headings_deg,
      front_offset_mm: 85,
      stations: {},
    };
    for (const name of ['A', 'B', 'E'])
      h.state.stations.stations[name] = {
        ...centres[name],
        front_target: {
          ...body.stations[name],
          heading: (body.headings_deg[name] * Math.PI) / 180,
        },
      };
    await h.click('station-reload');
    assert.equal(h.el('station-A-x').value, '630', 'Reload keeps measured edge coordinates');
    assert.equal(h.el('station-E-y').value, '75');
    assert.match(h.el('map-stations').textContent, /A · centre/);
    assert.match(h.el('map-stations').textContent, /A · front/);
    h.set('mission-start', 'E');
    h.set('mission-destination', 'A');
    h.newMission('E', 'A');
    const route = h.state.review.route;
    Object.assign(route, {
      goal: [545, 350],
      points: [[545, 350]],
      length_mm: 0,
      goal_tolerance_mm: 10,
      front_target: { x: 630, y: 350, heading: 0 },
      front_offset_mm: 85,
      front_tolerance_mm: 15,
      goal_heading_tolerance_rad: 0.05,
    });
    h.state.scene.pose = { x: 545, y: 350, heading: Math.PI / 2 };
    await h.tick(250);
    h.set('reason', 'Review final front alignment');
    assert.equal(h.el('approve').disabled, false);
    assert.match(h.el('approve').textContent, /final alignment/);
    assert.match(h.el('review-detail').textContent, /turning to the selected arrival direction/);
    assert.equal(h.count('/api/decision'), decisions, 'Alignment must never approve itself');
    h.state.scene.pose.heading = 0;
    await h.tick(250);
    assert.match(h.el('approve').textContent, /stopped-position verification/);
    assert.match(
      h.el('review-goal').textContent,
      /front 630\.0, 350\.0 mm; centre 545\.0, 350\.0 mm/,
    );
    console.log(
      'Front-edge UI: raw measurements, corrected B, centre conversion, explicit heading and alignment review passed (mock only).',
    );
  } finally {
    await h.close();
  }
}

main()
  .then(frontReferenceStops)
  .then(movingReturn)
  .then(singlePointReturn)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
