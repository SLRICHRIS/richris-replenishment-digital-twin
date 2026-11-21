// Human-held input renews a bounded server/ESP32 lease. Rendering never drives.
function wirelessReadinessHint(value, physical) {
  const hardware = value.hardware;
  if (hardware?.protocol !== 'H1' || value.max_pwm !== 60 || hardware.ready) return '';
  const notes = [];
  if (hardware.battery_voltage_v === 0) {
    notes.push('The receiver has no valid battery reading. Check the battery monitor.');
  } else if (Number.isFinite(hardware.battery_voltage_v) && hardware.battery_voltage_v <= 6.6) {
    notes.push('Battery at or below the 6.60 V cutoff. Switch the AMR off and use a charged pack.');
  }
  const sample = physical.measurements;
  if (
    physical.fresh &&
    physical.h1_pwm_limit === 60 &&
    sample?.gyro_available === true &&
    sample.gyro_bias_estimate_rad_s === null
  ) {
    notes.push(
      'Startup gyro calibration is missing. Keep the wheels still, press ESP32 EN/RESET once and leave the robot untouched for 10 seconds. Wait here for Controller ready.',
    );
  }
  return notes.join(' ');
}

function waitingStatus(hardware, cap) {
  if (!hardware) return 'Waiting for authenticated ESP32 feedback';
  if (hardware.protocol === 'H1' && cap === 60 && !hardware.ready) {
    if (hardware.battery_voltage_v === 0) return 'Battery reading unavailable';
    if (hardware.battery_voltage_v <= 6.6) return 'Battery at or below 6.60 V';
  }
  if (hardware.battery_voltage_v < 6.6) return 'Battery below 6.6 V';
  if (!hardware.ready) return 'Controller not ready';
  if (hardware.left_duty || hardware.right_duty) return 'Wait for zero motor outputs';
  return 'Waiting for controller readiness';
}

export function createManualMotorPanel(scope) {
  const d = scope.document,
    root = d.getElementById('manual-motor-control');
  if (!root) return null;
  root.innerHTML = `
    <section class="panel pr-action-card manual-drive-panel">
      <div class="pr-topline"><div><span class="twin-card-kicker">AMR-01 · WI-FI DRIVE</span><h2>Hold to drive. Release to stop.</h2></div><span id="mc-connection" role="status">Connect the controller</span></div>
      <p>Drive here using the buttons or arrow keys / W A S D inside the drive pad. PWM controls motor power.</p>
      <p id="mc-feedback" role="status"></p><ul id="mc-missing"></ul>
      <button id="mc-source" type="button">Use physical AMR source</button>
      <form id="mc-login"><div class="vision-fields"><label>Operator alias<input id="mc-operator" maxlength="40" autocomplete="username" required></label><label>Access code<input id="mc-code" type="password" maxlength="256" autocomplete="current-password" required></label></div><button id="mc-unlock" type="submit">Connect controller</button></form>
      <div id="mc-controls" hidden><div class="manual-drive-layout">
        <div><div id="mc-pad" class="manual-drive-pad" tabindex="0" aria-label="Drive pad: hold arrow keys or W A S D; release to stop">
          <span></span><button id="mc-forward" data-direction="F" type="button" aria-label="Hold to drive forward">▲<small>Forward</small></button><span></span>
          <button id="mc-left" data-direction="L" type="button" aria-label="Hold to turn left">◀<small>Left</small></button><button id="mc-center-stop" type="button" class="manual-stop">■<small>Stop</small></button><button id="mc-right" data-direction="R" type="button" aria-label="Hold to turn right">▶<small>Right</small></button>
          <span></span><button id="mc-backward" data-direction="B" type="button" aria-label="Hold to drive backward">▼<small>Backward</small></button><span></span>
        </div><button id="mc-stop" type="button" class="manual-stop manual-stop-wide">STOP</button></div>
        <div class="manual-drive-settings"><label for="mc-pwm">Motor power <output id="mc-speed-text">160 / 160</output></label><input id="mc-pwm" type="range" min="0" max="160" step="1" value="160"><p id="mc-receiver-note"></p><p id="mc-outcome" role="status">No direction is held.</p><p>Release, Stop, Escape, leaving this page or losing the connection ends the hold. The ESP32 also expires commands locally.</p><button id="mc-logout" type="button">Disconnect controller</button></div>
      </div></div>
      <div class="pr-metrics manual-drive-metrics"><div><strong>Battery</strong><p id="mc-voltage">—</p></div><div><strong>Current</strong><p id="mc-current">—</p></div><div><strong>Motor outputs</strong><p id="mc-outputs">—</p></div><div><strong>Encoder pulses</strong><p id="mc-pulses">—</p></div></div>
      <details id="mc-diagnostics"><summary>Connection details</summary><p id="mc-transport"></p><p id="mc-hint"></p></details>
      <p>Keep the vehicle in view. Controller output feedback does not verify travel or arrival.</p>
      <a href="https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/manual_motor_control_setup.md" target="_blank" rel="noopener noreferrer">Controller setup and receiver upload</a>
    </section>`;
  const el = (id) => d.getElementById('mc-' + id),
    listeners = [],
    keys = new Set();
  let current = {},
    held = null,
    timer = null,
    active = false,
    leaving = false,
    destroyed = false;
  let offset = null,
    renderedAt = -Infinity,
    lastPresenceRepair = -Infinity;
  const on = (target, type, fn) => {
    target.addEventListener(type, fn);
    listeners.push(() => target.removeEventListener(type, fn));
  };
  const emit = (command, fields = {}) =>
    d.dispatchEvent(
      new scope.CustomEvent('python-twin:action', {
        detail: { action: 'manual_control', command, ...fields },
      }),
    );
  const visible = () =>
    !leaving &&
    !destroyed &&
    !d.hidden &&
    d.body.dataset.view === 'vision' &&
    d.getElementById('vision-routing-shell')?.dataset.mode === 'manual';
  const usable = () =>
    visible() &&
    current.authorized &&
    current.physical_mode &&
    current.ready &&
    !current.busy &&
    Number.isFinite(offset);
  function finish(stop = false) {
    if (timer !== null) {
      scope.clearInterval(timer);
      timer = null;
    }
    const previous = held;
    held = null;
    root
      .querySelectorAll('[data-direction]')
      .forEach((button) => button.setAttribute('aria-pressed', 'false'));
    if (previous) emit('release', { hold_id: previous.id, input_seq: ++previous.seq });
    if (stop) emit('stop');
  }
  function pulse() {
    if (!held) return;
    if (!usable() || scope.performance.now() - renderedAt > 1500) {
      finish(true);
      return;
    }
    emit('hold', {
      hold_id: held.id,
      input_seq: ++held.seq,
      issued_at_ms: Math.round(Date.now() + offset),
      direction: held.direction,
      pwm: Number(el('pwm').value),
    });
  }
  function start(direction, input) {
    if (held || !usable() || Number(el('pwm').value) === 0) return;
    const bytes = new Uint8Array(16);
    scope.crypto.getRandomValues(bytes);
    held = {
      id: Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join(''),
      seq: 0,
      direction,
      input,
    };
    root
      .querySelectorAll('[data-direction]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.direction === direction)),
      );
    pulse();
    if (held) timer = scope.setInterval(pulse, 200);
  }
  function render(value = {}, physical = {}) {
    current = value;
    renderedAt = scope.performance.now();
    if (Number.isFinite(value.server_time_ms)) offset = value.server_time_ms - Date.now();
    const h = value.hardware,
      r = value.review,
      t = value.transport || {};
    if (
      held &&
      (!usable() ||
        (r?.review_id === held.id && !['hold_arming', 'hold_driving'].includes(r.state)))
    )
      finish(true);
    el('login').hidden = !!value.authorized;
    el('controls').hidden = false;
    el('logout').hidden = !value.authorized;
    el('unlock').disabled = !value.can_unlock || !value.physical_mode;
    el('source').hidden = !!value.physical_mode;
    const cap = Number.isInteger(value.max_pwm) ? value.max_pwm : 255;
    const selected = Number(el('pwm').value);
    if (held && selected > cap) finish(true);
    el('pwm').max = String(cap);
    if (selected > cap) el('pwm').value = String(cap === 60 ? 40 : cap);
    el('speed-text').textContent = el('pwm').value + ' / ' + cap;
    el('pwm').disabled = !value.authorized || value.busy;
    root.querySelectorAll('[data-direction]').forEach((button) => {
      button.disabled = !usable();
    });
    el('stop').disabled = !value.authorized;
    el('center-stop').disabled = !value.authorized;
    el('connection').textContent = !value.physical_mode
      ? 'Select the physical AMR source'
      : value.busy
        ? 'Another operator is driving'
        : value.holding
          ? 'Controller connected · direction held'
          : value.ready
            ? 'Controller ready · hold a direction'
            : waitingStatus(h, cap);
    const receiverHint = wirelessReadinessHint(value, physical);
    el('receiver-note').textContent =
      receiverHint ||
      (value.receiver_updated
        ? 'Receiver supports PWM 0–255. Left and right use one wheel, matching your sketch.'
        : cap === 60
          ? 'AMR-01 Wireless H1 r3 supports PWM 0–60.'
          : h
            ? 'Existing receiver: PWM up to 160. Upload the updated receiver for the full 0–255 range and IMU-independent manual driving.'
            : 'Connect the controller to read its PWM capability. The updated receiver supports 0–255 PWM.');
    el('outcome').textContent = r?.reason || 'No direction is held.';
    el('feedback').textContent = value.feedback || '';
    el('transport').textContent =
      'Website MQTT: ' + (t.state || 'waiting') + (t.reason ? ' · ' + t.reason : '');
    el('hint').textContent =
      value.diagnostics?.last_issue ||
      'Motor commands and authenticated feedback use a separate MQTT connection from the sensor feed.';
    el('missing').replaceChildren(
      ...(value.missing || []).map((text) => {
        const li = d.createElement('li');
        li.textContent = text;
        return li;
      }),
    );
    const raw = physical.fresh ? physical.measurements || {} : {};
    const number = (v, places, unit = '') => (Number.isFinite(v) ? v.toFixed(places) + unit : '—');
    el('voltage').textContent = number(h?.battery_voltage_v ?? raw.battery_voltage_v, 2, ' V');
    el('current').textContent = number(raw.battery_current_a, 4, ' A');
    el('outputs').textContent = h ? `L ${h.left_duty} · R ${h.right_duty}` : '—';
    el('pulses').textContent =
      Number.isFinite(raw.left_pulses_total) && Number.isFinite(raw.right_pulses_total)
        ? `L ${raw.left_pulses_total} · R ${raw.right_pulses_total}`
        : '—';
    const now = scope.performance.now();
    if (
      value.authorized &&
      value.physical_mode &&
      value.view_active === false &&
      visible() &&
      now - lastPresenceRepair >= 2000
    ) {
      lastPresenceRepair = now;
      active = true;
      emit('view', { active: true });
    }
  }
  on(el('login'), 'submit', (e) => {
    e.preventDefault();
    emit('login', { operator: el('operator').value, access_code: el('code').value });
    el('code').value = '';
  });
  on(el('source'), 'click', () =>
    d.dispatchEvent(
      new scope.CustomEvent('python-twin:action', {
        detail: { action: 'sensor_source', mode: 'live' },
      }),
    ),
  );
  on(el('logout'), 'click', () => {
    finish(true);
    emit('logout');
  });
  for (const button of root.querySelectorAll('[data-direction]')) {
    on(button, 'pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      button.setPointerCapture?.(e.pointerId);
      start(button.dataset.direction, 'pointer');
    });
    for (const event of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'])
      on(button, event, () => {
        if (held?.input === 'pointer' && held.direction === button.dataset.direction) finish();
      });
  }
  on(scope, 'pointerup', () => {
    if (held?.input === 'pointer') finish();
  });
  on(el('stop'), 'click', () => finish(true));
  on(el('center-stop'), 'click', () => finish(true));
  on(el('pwm'), 'input', () => {
    el('speed-text').textContent = el('pwm').value + ' / ' + el('pwm').max;
    if (Number(el('pwm').value) === 0) finish(true);
    else if (held) pulse();
  });
  const mapping = {
    ArrowUp: 'F',
    ArrowDown: 'B',
    ArrowLeft: 'L',
    ArrowRight: 'R',
    w: 'F',
    s: 'B',
    a: 'L',
    d: 'R',
  };
  on(scope, 'keydown', (e) => {
    if (!visible()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(true);
      return;
    }
    if (
      !root.contains(e.target) ||
      e.target.closest('input,textarea,select,a,[contenteditable="true"]')
    )
      return;
    if (e.key === ' ') {
      e.preventDefault();
      finish(true);
      return;
    }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const direction = mapping[key];
    if (!direction) return;
    e.preventDefault();
    if (keys.has(key) || e.repeat) return;
    keys.add(key);
    start(direction, key);
  });
  on(scope, 'keyup', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.delete(key);
    if (held?.input === key) finish();
  });
  const presence = () => {
    const next = visible();
    if (!next) finish();
    if (next !== active) {
      active = next;
      emit('view', { active });
    }
  };
  on(d, 'vision-routing:mode', presence);
  on(d, 'visibilitychange', presence);
  on(scope, 'blur', () => {
    keys.clear();
    finish();
  });
  on(scope, 'pagehide', () => {
    leaving = true;
    finish();
    active = false;
    emit('view', { active: false });
  });
  on(scope, 'pageshow', () => {
    leaving = false;
    presence();
  });
  const observer = new scope.MutationObserver(presence);
  observer.observe(d.body, { attributes: true, attributeFilter: ['data-view'] });
  on(d, 'python-twin:render', (e) =>
    render(e.detail?.manual_control, e.detail?.physical_telemetry),
  );
  render();
  presence();
  return {
    render,
    destroy() {
      finish();
      destroyed = true;
      observer.disconnect();
      listeners.forEach((remove) => remove());
      root.replaceChildren();
    },
  };
}
