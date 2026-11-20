// Physical approval remains server-owned. Browser drafts never authorize motors.
const GUIDE =
  'https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/human_approved_physical_route_execution.md';
const ACTIVE = ['sent', 'arming', 'running', 'stopping'];
const STAGES = ['Setup', 'Connect', 'Plan', 'Approve', 'Run'];
const stateLabels = {
  pending: 'Awaiting your decision',
  sent: 'Approval sent',
  arming: 'Arming receiver',
  running: 'Following route',
  stopping: 'Verifying stopped arrival',
  verified: 'Arrival verified',
  blocked: 'Journey blocked',
  cancelled: 'Stop requested',
  uncertain: 'Outcome uncertain',
  reject: 'Route rejected',
  hold: 'Route on hold',
};

export function createPhysicalRoutePanel(scope) {
  const d = scope.document,
    root = d.getElementById('physical-route-execution');
  if (!root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const setup = d.getElementById('vision-shared-setup'),
    setupParent = setup?.parentNode,
    setupNext = setup?.nextSibling;
  const listeners = [],
    on = (target, event, fn) => {
      target.addEventListener(event, fn);
      listeners.push(() => target.removeEventListener(event, fn));
    };
  root.innerHTML = [
    '<div class="pr-workflow">',
    '<div class="pr-topline"><p>One approved route. Continuous camera feedback. A verified outcome.</p><div class="pr-top-actions"><span id="pr-state" class="vision-chip">Setup required</span><button id="pr-stop" class="pr-stop" type="button" disabled>Stop route</button></div></div>',
    '<nav class="pr-stepper" role="tablist" aria-label="Physical route workflow">',
    ...STAGES.map(
      (name, i) =>
        '<button type="button" role="tab" id="pr-step-' +
        (i + 1) +
        '" aria-controls="pr-step-panel-' +
        (i + 1) +
        '" aria-selected="' +
        (i === 0) +
        '" tabindex="' +
        (i === 0 ? '0' : '-1') +
        '"><span class="pr-step-number">' +
        (i + 1) +
        '</span><span>' +
        name +
        '<small id="pr-step-note-' +
        (i + 1) +
        '">' +
        (i === 0 ? 'Start here' : 'Waiting') +
        '</small></span></button>',
    ),
    '</nav>',
    '<div class="pr-next-action"><span class="pr-next-dot"></span><div><strong id="pr-next-title">Start with the robot measurements</strong><p id="pr-next-copy">Record the full body size, then commission the camera and receiver.</p></div></div>',
    '<div id="pr-body" class="pr-body">',
    '<section id="pr-map-card" class="panel pr-map-card" aria-labelledby="pr-map-title" hidden>',
    '<div class="pr-card-heading"><div><span class="twin-card-kicker">TRUSTED CAMERA SCENE</span><h2 id="pr-map-title">Working floor</h2></div><span class="vision-chip">425 × 630 mm</span></div>',
    '<div class="pr-map-wrap"><svg id="pr-map" viewBox="0 0 425 630" role="img" aria-label="Trusted live camera map and server-approved route"><defs><pattern id="pr-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="currentColor" stroke-width=".6"/></pattern></defs><rect x="0" y="0" width="425" height="630" class="vision-floor"/><rect width="425" height="630" fill="url(#pr-grid)" class="vision-grid"/><g id="pr-map-content" transform="translate(0 630) scale(1 -1)"></g></svg><div id="pr-map-empty" class="pr-map-empty"><span class="pr-camera-symbol" aria-hidden="true">⌖</span><strong>Waiting for the camera controller</strong><span>A live, calibrated scene is required before a physical route can be captured.</span></div></div>',
    '<div class="pr-map-legend"><span><i class="pr-key-robot"></i>AMR position</span><span><i class="pr-key-goal"></i>Destination</span><span><i class="pr-key-obstacle"></i>Obstacle</span><span><i class="pr-key-route"></i>Reviewed route</span></div>',
    '<p id="pr-scene" class="pr-scene-status">No trusted camera frame received</p></section>',
    '<div class="pr-stage-content">',
    '<section id="pr-step-panel-1" role="tabpanel" aria-labelledby="pr-step-1"><div class="pr-setup-layout"><div id="pr-setup-slot"></div><aside class="panel pr-guide-card"><span class="twin-card-kicker">BEFORE THE FIRST JOURNEY</span><h2>Make the physical setup ready</h2><ol class="pr-checklist"><li><strong>Measure the whole robot</strong><p>Include wheels, protrusions and the mounted marker. Wheel spacing alone is not the footprint.</p></li><li><strong>Calibrate the overhead camera</strong><p>Verify lens calibration, paper references, marker height and a clear-floor background.</p></li><li><strong>Commission the motor receiver</strong><p>Verify wheel directions, low-speed PWM and stopping distance before enabling physical control.</p></li></ol><a class="pr-guide-link" href="' +
      GUIDE +
      '" target="_blank" rel="noopener">Open the setup and upload guide ↗</a><div class="pr-setup-note">Saving measurements creates a planning draft. The laptop controller supplies the trusted calibration.</div><button id="pr-to-connect" type="button" class="primary">Continue to connection →</button></aside></div></section>',
    '<section id="pr-step-panel-2" role="tabpanel" aria-labelledby="pr-step-2" hidden><div class="pr-connect-layout"><section class="panel pr-action-card"><span class="twin-card-kicker">CONNECT THE REAL AMR</span><h2>Check the camera and robot</h2><p class="pr-description">Power the ESP32 and run the USB-camera controller on the Windows laptop. Keep both connected while the route runs.</p><ul id="pr-readiness" class="pr-readiness"></ul><button id="pr-source" type="button">Use physical sensor source</button><details class="pr-technical"><summary>Connection setup details</summary><ul id="pr-missing"></ul><a href="' +
      GUIDE +
      '" target="_blank" rel="noopener">Controller and broker setup ↗</a></details><button id="pr-to-plan" type="button" class="primary" disabled>Continue to route planning →</button></section>',
    '<section class="panel pr-action-card"><span class="twin-card-kicker">OPERATOR SESSION</span><h2>Enable physical review</h2><p class="pr-description">The operator code protects motor control. Approval records are saved automatically in the background.</p><p id="pr-access-wait" class="pr-inline-note">Operator access becomes available after the private connection and commissioning are configured.</p><form id="pr-login" hidden><label>Operator alias<input id="pr-operator" maxlength="40" autocomplete="username" placeholder="Your operator alias" required></label><label>Private operator code<input id="pr-code" type="password" maxlength="256" autocomplete="current-password" required></label><button type="submit" id="pr-unlock" class="primary" disabled>Enable this operator session</button></form><div id="pr-session" hidden><span class="pr-session-check">Operator session enabled</span><button id="pr-lock" type="button">End session & stop</button></div><div class="pr-setup-note">Use the physical source, then enable your session. Stay on this page during movement.</div></section></div></section>',
    '<section id="pr-step-panel-3" role="tabpanel" aria-labelledby="pr-step-3" hidden class="panel pr-action-card"><span class="twin-card-kicker">PLAN A JOURNEY</span><h2>Choose the destination</h2><p class="pr-description">The start comes from the camera. Select the destination on the live floor or enter its coordinates.</p><div class="vision-fields"><label>Starting rack<select id="pr-rack-start"><option value="">Choose start</option><option>A</option><option>B</option><option>C</option><option>D</option></select></label><label>Destination rack<select id="pr-rack-destination"><option value="">Choose destination</option><option>A</option><option>B</option><option>C</option><option>D</option></select></label></div><p id="pr-rack-status" class="pr-inline-note">Rack coordinates must be measured in the camera floor frame. Configure them below before selecting a rack.</p><details><summary>Measured rack stopping coordinates (mm)</summary><div id="pr-rack-coordinates" class="vision-fields"></div></details><div class="vision-fields"><label>Destination X · mm<input id="pr-goal-x" type="number" min="0" max="425" step="10" value="210"></label><label>Destination Y · mm<input id="pr-goal-y" type="number" min="0" max="630" step="10" value="450"></label></div><div class="pr-coordinate-note">Origin: bottom-left. X increases right; Y increases upward. The route uses a 10 mm grid.</div><button id="pr-capture" type="button" class="primary" disabled>Calculate physical route</button><p id="pr-plan-help" class="pr-inline-note">Complete the connection step before calculating a physical route.</p><button id="pr-back-connect" type="button" class="pr-text-button">← Check connection</button></section>',
    '<section id="pr-step-panel-4" role="tabpanel" aria-labelledby="pr-step-4" hidden class="panel pr-action-card"><span class="twin-card-kicker">HUMAN DECISION</span><h2>Review before movement</h2><p id="pr-route" class="pr-description">Calculate a physical route to review it here.</p><div id="pr-review-metrics" class="pr-metrics"></div><p id="pr-review-clock" class="pr-inline-note">No current proposal</p><label>Decision reason<textarea id="pr-reason" maxlength="240" rows="3" placeholder="Record why you approve, reject or hold this route." disabled></textarea></label><div class="pr-decision-actions"><button id="pr-approve" type="button" class="primary" disabled>Approve & run</button><button id="pr-reject" type="button" disabled>Reject</button><button id="pr-hold" type="button" disabled>Hold</button></div><p class="pr-coordinate-note">Approval applies to this route and this scene. A changed scene needs a new proposal.</p><button id="pr-replan" type="button" class="pr-text-button">← Change destination or calculate again</button></section>',
    '<section id="pr-step-panel-5" role="tabpanel" aria-labelledby="pr-step-5" hidden class="panel pr-action-card"><span class="twin-card-kicker">EXECUTION & EVIDENCE</span><h2 id="pr-run-title">Watch the approved journey</h2><p id="pr-outcome" role="status" aria-live="polite">No physical route has been approved.</p><div id="pr-run-observations" class="pr-run-observations"></div><div class="pr-setup-note">An accepted command is not a verified arrival. Fresh camera frames and zero reported motor output confirm the stopped destination.</div><p class="pr-coordinate-note">Route limit: 60 seconds. Camera, controller or approval loss ends the journey. Keep access to the robot power switch.</p><button id="pr-new-route" type="button">Plan another route</button></section>',
    '</div></div><p id="pr-feedback" class="pr-feedback" role="status" aria-live="polite"></p></div>',
  ].join('');
  const el = (n) => d.getElementById('pr-' + n);
  if (setup) el('setup-slot').append(setup);
  else
    el('setup-slot').innerHTML =
      '<section class="panel pr-action-card"><h2>Planning measurements</h2><p>Measure the robot footprint and camera geometry before commissioning.</p></section>';
  let payload = null,
    view = null,
    stage = 1,
    userStage = false,
    reviewId = null,
    lastState = null;
  const send = (command, more = {}) =>
    d.dispatchEvent(
      new scope.CustomEvent('python-twin:action', {
        detail: { action: 'vision_execution', command, ...more },
      }),
    );
  const modeIsPhysical = () =>
    !d.getElementById('vision-routing-shell') ||
    d.getElementById('vision-routing-shell').dataset.mode === 'physical';
  const active = () => d.body.dataset.view === 'vision' && !d.hidden && modeIsPhysical();
  function viewChanged() {
    const next = active();
    if (next !== view) {
      view = next;
      send('view', { active: next });
    }
  }
  const observer = new scope.MutationObserver(viewChanged);
  observer.observe(d.body, { attributes: true, attributeFilter: ['data-view'] });
  on(d, 'visibilitychange', viewChanged);
  on(d, 'vision-routing:mode', viewChanged);
  on(scope, 'pagehide', () => send('view', { active: false }));
  function showStage(value, manual = false) {
    const running = ACTIVE.includes(payload?.review?.state);
    if (running && value !== 5) return;
    stage = value;
    if (manual) userStage = true;
    for (let i = 1; i <= 5; i++) {
      el('step-' + i).setAttribute('aria-selected', String(i === stage));
      el('step-' + i).tabIndex = i === stage ? 0 : -1;
      el('step-panel-' + i).hidden = i !== stage;
    }
    el('map-card').hidden = stage < 3;
    el('body').classList.toggle('pr-with-scene', stage >= 3);
    renderNext();
  }
  function chooseStage(value) {
    showStage(value, true);
  }
  for (let i = 1; i <= 5; i++) {
    on(el('step-' + i), 'click', () => chooseStage(i));
    on(el('step-' + i), 'keydown', (e) => {
      let next = i;
      if (e.key === 'ArrowRight') next = Math.min(5, i + 1);
      else if (e.key === 'ArrowLeft') next = Math.max(1, i - 1);
      else if (e.key === 'Home') next = 1;
      else if (e.key === 'End') next = 5;
      else return;
      e.preventDefault();
      chooseStage(next);
      el('step-' + stage).focus();
    });
  }
  [
    ['to-connect', 2],
    ['to-plan', 3],
    ['back-connect', 2],
    ['replan', 3],
    ['new-route', 3],
  ].forEach(([id, value]) => on(el(id), 'click', () => chooseStage(value)));
  on(el('source'), 'click', () =>
    d.dispatchEvent(
      new scope.CustomEvent('python-twin:action', {
        detail: { action: 'sensor_source', mode: 'live' },
      }),
    ),
  );
  on(el('login'), 'submit', (e) => {
    e.preventDefault();
    send('login', { operator: el('operator').value, access_code: el('code').value });
    el('code').value = '';
  });
  on(el('lock'), 'click', () => send('logout'));
  on(el('stop'), 'click', () => send('stop'));
  // Station positions are operator-entered stopping coordinates, not invented rack centres.
  const rackCoordinates = el('rack-coordinates');
  const stationInputs = {};
  for (const rack of ['A', 'B', 'C', 'D', 'E']) {
    const label = d.createElement('label');
    label.textContent = rack === 'E' ? 'Battery station E (x, y)' : 'Rack ' + rack + ' (x, y)';
    const x = d.createElement('input'), y = d.createElement('input');
    for (const input of [x, y]) {
      input.type = 'number';
      input.min = '0';
      input.max = input === x ? '425' : '630';
      input.step = '1';
      input.placeholder = input === x ? 'X mm' : 'Y mm';
      label.append(input);
    }
    rackCoordinates.append(label);
    stationInputs[rack] = [x, y];
  }
  const rackStart = el('rack-start'), rackDestination = el('rack-destination');
  function stationPoint(rack) {
    const inputs = stationInputs[rack];
    if (!inputs || inputs.some((input) => input.value.trim() === '')) return null;
    const point = inputs.map((input) => Number(input.value));
    if (!point.every(Number.isFinite) || point[0] < 0 || point[0] > 425 || point[1] < 0 || point[1] > 630) return null;
    return point;
  }
  function rackSelectionChanged() {
    const start = rackStart.value, destination = rackDestination.value;
    const point = stationPoint(destination);
    const valid = start && destination && start !== destination && stationPoint(start) && point;
    el('rack-status').textContent = !start || !destination
      ? 'Choose start and destination racks, then enter measured stopping coordinates.'
      : start === destination
        ? 'Starting rack and destination must differ.'
        : !valid
          ? 'Enter valid measured stopping coordinates for both selected racks.'
          : 'Route ' + start + ' to ' + destination + '. Confirm the camera shows the robot at rack ' + start + '.';
    if (valid) {
      el('goal-x').value = String(point[0]);
      el('goal-y').value = String(point[1]);
    }
    if (payload) render(payload, false);
  }
  on(rackStart, 'change', rackSelectionChanged);
  on(rackDestination, 'change', rackSelectionChanged);
  for (const inputs of Object.values(stationInputs))
    for (const input of inputs) on(input, 'input', rackSelectionChanged);
  function startRackMatchesCamera() {
    const expected = stationPoint(rackStart.value);
    const pose = payload?.scene?.pose;
    if (!expected || !freshCamera(payload?.scene) || !pose) return false;
    // Camera pose and station coordinates use the same millimetre floor frame.
    return Math.hypot(pose.x - expected[0], pose.y - expected[1]) <= 25;
  }
  on(el('capture'), 'click', () => {
    if (!startRackMatchesCamera()) {
      el('rack-status').textContent =
        'Robot not verified at the selected start rack (within 25 mm). Check live camera pose and measured rack coordinates.';
      return;
    }
    if (!rackStart.value || !rackDestination.value || rackStart.value === rackDestination.value || !stationPoint(rackStart.value) || !stationPoint(rackDestination.value)) {
      el('rack-status').textContent = 'Select two different racks with measured coordinates before planning.';
      return;
    }
    send('capture', { goal_x: Number(el('goal-x').value), goal_y: Number(el('goal-y').value) });
  });
  ['approve', 'reject', 'hold'].forEach((decision) =>
    on(el(decision), 'click', () =>
      send('decide', {
        review_id: payload?.review?.review_id,
        decision,
        reason: el('reason').value,
      }),
    ),
  );
  function selectedGoal() {
    const x = el('goal-x').value,
      y = el('goal-y').value;
    if (x === '' || y === '' || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y)))
      return null;
    if (Number(x) < 0 || Number(x) > 425 || Number(y) < 0 || Number(y) > 630) return null;
    return [
      Math.min(420, Math.round(Number(x) / 10) * 10),
      Math.min(630, Math.round(Number(y) / 10) * 10),
    ];
  }
  function goalChanged() {
    if (!payload?.review || payload.review.state !== 'pending') return false;
    const goal = selectedGoal(),
      reviewed = payload.review.route?.goal;
    return !goal || !Array.isArray(reviewed) || goal.some((v, i) => v !== reviewed[i]);
  }
  for (const id of ['goal-x', 'goal-y', 'reason'])
    on(el(id), 'input', () => {
      if (payload) render(payload, false);
    });
  on(d, 'vision:measurements', () => renderNext());
  on(el('map'), 'click', (e) => {
    if (stage !== 3 || !freshCamera(payload?.scene)) return;
    const map = el('map'),
      matrix = map.getScreenCTM?.();
    if (!matrix) return;
    const point = map.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const local = point.matrixTransform(matrix.inverse());
    el('goal-x').value = String(Math.max(0, Math.min(420, Math.round(local.x / 10) * 10)));
    el('goal-y').value = String(Math.max(0, Math.min(630, Math.round((630 - local.y) / 10) * 10)));
    if (payload) render(payload, false);
  });
  function freshCamera(s) {
    return !!(
      s?.valid &&
      s.floor_width_mm === 425 &&
      s.floor_length_mm === 630 &&
      typeof s.captured_at_ms === 'number' &&
      Date.now() - s.captured_at_ms <= 500 &&
      Date.now() >= s.captured_at_ms - 100
    );
  }
  function receiverReady(s) {
    return !!(
      s?.hardware?.ready &&
      typeof s.hardware.age_ms === 'number' &&
      s.hardware.age_ms <= 500
    );
  }
  function canPlan(p) {
    return !!(
      p?.authorized &&
      p.available &&
      p.physical_mode &&
      p.ready &&
      freshCamera(p.scene) &&
      receiverReady(p.scene)
    );
  }
  function renderNext() {
    const p = payload || {},
      r = p.review;
    let title, copy;
    if (stage === 1) {
      const length = d.getElementById('vision-robot-length')?.value,
        width = d.getElementById('vision-robot-width')?.value;
      title =
        length && width ? 'Commission the camera and motor setup' : 'Enter the full AMR dimensions';
      copy =
        length && width
          ? 'Your measurements are a draft. Follow the setup guide, then open Connect to check the trusted controller.'
          : 'Measure the body, including wheels and protrusions. The paper size and reported camera height are already recorded.';
    } else if (stage === 2) {
      title = !p.physical_mode
        ? 'Select the physical sensor source'
        : !p.can_unlock
          ? 'Complete the controller connection setup'
          : !p.authorized
            ? 'Enable your operator session'
            : !freshCamera(p.scene)
              ? 'Start the calibrated USB-camera controller'
              : !receiverReady(p.scene)
                ? 'Bring the ESP32 receiver online'
                : 'Connection ready for a stationary route capture';
      copy = !p.can_unlock
        ? 'Use the setup guide to configure the camera controller, protected broker connection and private approval log.'
        : !p.authorized
          ? 'Enter the operator alias and code here. This access protects physical movement.'
          : 'Keep the robot stationary and all floor markers visible. A fresh scene and receiver heartbeat are required.';
    } else if (stage === 3) {
      title = canPlan(p)
        ? 'Choose a destination and calculate the route'
        : 'A trusted stationary scene is required';
      copy = canPlan(p)
        ? 'The server uses the observed start, obstacles and protected footprint. Review the resulting proposal before anything moves.'
        : 'Check Connect for the missing source, access, camera or receiver requirement. Draft maps from Practice cannot authorize a journey.';
    } else if (stage === 4) {
      title = !r
        ? 'Calculate a proposal first'
        : goalChanged()
          ? 'Destination changed: calculate a new proposal'
          : r.state === 'pending'
            ? 'Inspect the route and record your decision'
            : stateLabels[r.state] || 'Review outcome';
      copy = !r
        ? 'Open Plan to choose a destination.'
        : r.state === 'pending'
          ? 'Keep the AMR stationary while reviewing. Approve & run starts this specific route; reject or hold sends no movement request.'
          : r.reason;
    } else {
      title = r ? stateLabels[r.state] || 'Journey status' : 'No journey has started';
      copy =
        r?.state === 'verified'
          ? 'Fresh camera observations verified the destination and stopped position.'
          : 'Monitor the controller status and camera evidence. Stop ends the current authorization; another journey requires a new review.';
    }
    el('next-title').textContent = title;
    el('next-copy').textContent = copy;
  }
  const svg = (tag, attrs) => {
    const n = d.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
    return n;
  };
  function detailList(target, items) {
    el(target).replaceChildren(
      ...items.map(([label, value]) => {
        const row = d.createElement('div'),
          a = d.createElement('span'),
          b = d.createElement('strong');
        a.textContent = label;
        b.textContent = value;
        row.append(a, b);
        return row;
      }),
    );
  }
  function render(p, auto = true) {
    payload = p || {};
    p = payload;
    const r = p.review,
      s = p.scene,
      auth = !!p.authorized,
      live = !!p.physical_mode;
    const fresh = freshCamera(s),
      hardware = receiverReady(s),
      running = ACTIVE.includes(r?.state);
    const pending = r?.state === 'pending' && Date.now() < r.expires_at_ms;
    if (auto) {
      const isNew = !!(r && r.review_id !== reviewId);
      if (isNew) {
        reviewId = r.review_id;
        el('reason').value = '';
        if (r.route?.goal) {
          el('goal-x').value = String(r.route.goal[0]);
          el('goal-y').value = String(r.route.goal[1]);
        }
      }
      if (
        running ||
        (r &&
          r.state !== lastState &&
          ['verified', 'blocked', 'cancelled', 'uncertain'].includes(r.state))
      )
        showStage(5);
      else if (isNew && r.state === 'pending') showStage(4);
      else if (!userStage && !r && auth && live) showStage(3);
      else if (!userStage && !r && p.can_unlock) showStage(2);
      lastState = r?.state || null;
    }
    for (let i = 1; i <= 5; i++) el('step-' + i).disabled = running && i !== 5;
    const notes = [
      fresh && s?.geometry ? 'Controller verified' : 'Measurements',
      auth && fresh && hardware ? 'Connected' : 'Connection checks',
      r ? 'Proposal captured' : 'Choose destination',
      r && r.state !== 'pending' ? 'Decision recorded' : 'Your decision',
      r?.state === 'verified' ? 'Arrival verified' : running ? 'In progress' : 'Observe outcome',
    ];
    notes.forEach((v, i) => (el('step-note-' + (i + 1)).textContent = v));
    el('login').hidden = auth || !p.can_unlock || !live;
    el('session').hidden = !auth;
    el('access-wait').hidden = auth || !!(p.can_unlock && live);
    el('unlock').disabled = !p.can_unlock || !live;
    el('source').hidden = live;
    el('to-plan').disabled = !canPlan(p);
    el('capture').disabled = !(canPlan(p) && selectedGoal() && !running && rackStart.value && rackDestination.value && rackStart.value !== rackDestination.value && stationPoint(rackStart.value) && stationPoint(rackDestination.value) && startRackMatchesCamera());
    el('capture').textContent = r ? 'Calculate a new route' : 'Calculate physical route';
    el('plan-help').textContent = canPlan(p)
      ? 'Only a proposal is calculated. Movement starts after your separate approval.'
      : 'Complete Connect and keep the robot stationary before calculating a route.';
    el('reason').disabled = !(auth && pending && !running);
    const dirty = goalChanged();
    const reasonReady = el('reason').value.trim().length > 0;
    ['approve', 'reject', 'hold'].forEach(
      (n) =>
        (el(n).disabled = !(
          auth &&
          live &&
          pending &&
          !dirty &&
          reasonReady &&
          (n !== 'approve' || (p.ready && fresh && hardware && p.available))
        )),
    );
    el('stop').disabled = !(auth && running);
    el('stop').hidden = !running;
    el('new-route').disabled = running;
    el('state').textContent = r
      ? stateLabels[r.state] || r.state
      : canPlan(p)
        ? 'Ready to plan'
        : 'Setup required';
    el('state').dataset.kind =
      r?.state === 'verified'
        ? 'success'
        : running
          ? 'active'
          : ['blocked', 'uncertain', 'cancelled'].includes(r?.state)
            ? 'warning'
            : 'neutral';
    el('route').textContent = r
      ? 'Review the server-generated path and its protected clearance on the live floor.'
      : 'Calculate a physical route to review it here.';
    detailList(
      'review-metrics',
      r
        ? [
            ['Route distance', Math.round(r.route.length_mm) + ' mm'],
            ['Protected radius', Math.ceil(r.route.clearance_radius_mm) + ' mm'],
            [
              'Destination',
              Array.isArray(r.route.goal) ? r.route.goal.join(', ') + ' mm' : 'Unavailable',
            ],
            ['Review', r.review_id.slice(0, 8)],
          ]
        : [],
    );
    el('review-clock').textContent = dirty
      ? 'The destination draft differs from this proposal. Calculate again.'
      : r?.state === 'pending'
        ? pending
          ? 'Decision window: ' +
            Math.ceil((r.expires_at_ms - Date.now()) / 1000) +
            ' seconds remaining'
          : 'This proposal expired. Calculate a new route.'
        : 'No pending proposal';
    el('outcome').textContent = r?.reason || 'No physical route has been approved.';
    el('run-title').textContent =
      r?.state === 'verified' ? 'Arrival verified' : 'Watch the approved journey';
    const motorReport =
      fresh &&
      hardware &&
      Number.isFinite(s.hardware.left_duty) &&
      Number.isFinite(s.hardware.right_duty);
    const zero = motorReport && s.hardware.left_duty === 0 && s.hardware.right_duty === 0;
    detailList('run-observations', [
      ['Controller', r ? stateLabels[r.state] || r.state : 'No request'],
      ['Camera evidence', fresh ? 'Fresh frame ' + s.seq : 'Unavailable or stale'],
      [
        'Motor output',
        motorReport ? (zero ? 'Reported zero' : 'Reported active') : 'No fresh receiver report',
      ],
      ['Arrival', r?.state === 'verified' ? 'Verified from camera feedback' : 'Not yet verified'],
    ]);
    el('feedback').textContent = p.feedback || '';
    el('feedback').hidden = !p.feedback;
    const readiness = [
      ['Physical source', live ? 'Selected' : 'Select physical source', live],
      [
        'Operator session',
        auth ? 'Enabled' : p.can_unlock ? 'Access code required' : 'Connection setup required',
        auth,
      ],
      [
        'Camera scene',
        fresh ? 'Fresh calibrated observations' : 'Waiting for laptop controller',
        fresh,
      ],
      [
        'ESP32 receiver',
        hardware && fresh ? 'Fresh heartbeat' : 'Waiting for receiver feedback',
        hardware && fresh,
      ],
    ];
    el('readiness').replaceChildren(
      ...readiness.map(([label, value, ok]) => {
        const row = d.createElement('li'),
          dot = d.createElement('span'),
          text = d.createElement('div'),
          strong = d.createElement('strong'),
          small = d.createElement('span');
        dot.className = 'pr-readiness-dot';
        dot.dataset.ready = String(ok);
        strong.textContent = label;
        small.textContent = value;
        text.append(strong, small);
        row.append(dot, text);
        return row;
      }),
    );
    el('missing').replaceChildren(
      ...(p.missing || []).map((text) => {
        const n = d.createElement('li');
        n.textContent = text;
        return n;
      }),
    );
    el('scene').textContent = fresh
      ? 'Camera frame ' +
        s.seq +
        ' · ' +
        (hardware ? 'ESP32 receiver ready' : 'Receiver unavailable')
      : 'No fresh trusted camera frame';
    el('map-empty').hidden = fresh;
    const map = el('map-content');
    map.replaceChildren();
    if (fresh) {
      (s.obstacles || []).forEach((q) =>
        map.append(svg('rect', { ...q, class: 'vision-obstacle' })),
      );
      if (r?.route?.points)
        map.append(
          svg('polyline', {
            points: r.route.points.map((point) => point.join(',')).join(' '),
            class: 'vision-path',
          }),
        );
      const goal = selectedGoal();
      if (goal)
        map.append(svg('circle', { cx: goal[0], cy: goal[1], r: 11, class: 'vision-goal' }));
      if (s.pose) {
        map.append(svg('circle', { cx: s.pose.x, cy: s.pose.y, r: 13, class: 'vision-start' }));
        map.append(
          svg('line', {
            x1: s.pose.x,
            y1: s.pose.y,
            x2: s.pose.x + 30 * Math.cos(s.pose.heading),
            y2: s.pose.y + 30 * Math.sin(s.pose.heading),
            stroke: 'var(--green)',
            'stroke-width': 5,
          }),
        );
      }
    }
    renderNext();
  }
  on(d, 'python-twin:render', (e) => {
    if (e.detail?.vision_execution) render(e.detail.vision_execution);
  });
  const timer = scope.setInterval(() => {
    if (payload) render(payload, false);
  }, 250);
  showStage(1);
  render({ physical_mode: false, missing: [] }, false);
  viewChanged();
  d.dispatchEvent(new scope.CustomEvent('python-twin:ready'));
  return {
    render,
    showStage: chooseStage,
    getStage: () => stage,
    destroy() {
      observer.disconnect();
      scope.clearInterval(timer);
      listeners.forEach((remove) => remove());
      if (setup && setupParent)
        setupParent.insertBefore(setup, setupNext?.parentNode === setupParent ? setupNext : null);
      delete root.dataset.initialized;
      root.replaceChildren();
    },
  };
}
if (typeof window !== 'undefined' && !document.getElementById('vision-routing-shell'))
  createPhysicalRoutePanel(window);
