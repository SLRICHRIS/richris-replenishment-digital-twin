// Only the authenticated server can dispatch motor packets. Browser requests are proposals.
export function createManualMotorPanel(scope) {
  const d = scope.document,
    root = d.getElementById('manual-motor-control');
  if (!root) return null;
  root.innerHTML = `
    <section class="panel pr-action-card">
      <div class="pr-topline"><div><span class="twin-card-kicker">ATTENDED MOTOR CONTROL</span><h2>One approval. One short move.</h2></div><button id="mc-stop" type="button" class="pr-stop" disabled>Stop</button></div>
      <p>Use your working AMR-01 through Wi-Fi. Choose a direction, review one 250 ms motor burst, then approve it. The ESP32 expires the command locally.</p>
      <p>Inspect the space around the vehicle before each move. PWM is motor power, not a distance or speed setting.</p>
      <div class="pr-metrics"><div><strong>1 · Connect</strong><p id="mc-connection">Private connection setup required</p></div><div><strong>2 · Review</strong><p>Choose direction and motor power</p></div><div><strong>3 · Approve</strong><p>One burst, then automatic expiry</p></div></div>
      <details id="mc-diagnostics" hidden><summary>Connection details</summary><p id="mc-transport"></p><p id="mc-packets"></p><p id="mc-clock"></p><p id="mc-hint"></p></details>
      <p id="mc-feedback" role="status" aria-live="polite"></p>
      <ul id="mc-missing"></ul>
      <button id="mc-source" type="button">Use physical AMR source</button>
      <form id="mc-login"><label>Operator alias<input id="mc-operator" maxlength="40" autocomplete="username" required></label><label>Operator access code<input id="mc-code" type="password" maxlength="256" autocomplete="current-password" required></label><button id="mc-unlock" type="submit" disabled>Enable manual control</button></form>
      <div id="mc-controls" hidden>
        <button id="mc-logout" type="button">End operator session</button>
        <form id="mc-proposal"><div class="vision-fields"><label>Direction<select id="mc-direction"><option value="F">Forward</option><option value="B">Backward</option><option value="L">Turn left</option><option value="R">Turn right</option></select></label><label>Motor PWM · 20–160<input id="mc-pwm" type="number" min="20" max="160" step="1" value="160" required></label></div><p>Duration: 250 ms maximum. Each move needs a fresh approval.</p><button id="mc-prepare" type="submit" disabled>Prepare move for review</button></form>
        <div id="mc-review" hidden><h3>Human approval</h3><p id="mc-summary"></p><label>Approval reason<textarea id="mc-reason" maxlength="240" placeholder="Space checked; approve one short move"></textarea></label><button id="mc-approve" type="button" class="primary" disabled>Approve & move once</button></div>
      </div>
      <p id="mc-outcome" role="status">No motor request has been sent.</p>
      <p>Controller feedback confirms its output state. Actual travel and arrival require observation. Camera-guided routes use the separate Physical AMR workflow.</p>
      <a href="https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/manual_motor_control_setup.md" target="_blank" rel="noopener noreferrer">Open the connection steps</a>
    </section>`;
  const el = (id) => d.getElementById('mc-' + id),
    listeners = [];
  let current = {},
    pending = false,
    active = false;
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
  function render(value = {}) {
    current = value;
    pending = false;
    const r = value.review,
      reviewing = r?.state === 'manual_review';
    el('connection').textContent = value.ready
      ? 'ESP32 ready · zero outputs reported'
      : value.hardware
        ? 'ESP32 connected · waiting for ready zero outputs'
        : 'Waiting for authenticated ESP32 feedback';
    const diagnostics = value.diagnostics || {},
      transport = value.transport || {};
    const transportLabels = {
      connecting: 'Connecting to EMQX',
      disconnected: 'Disconnected from EMQX',
      subscribing: 'Connected; requesting feedback subscription',
      subscribed: 'Connected; feedback subscription accepted',
      login_rejected: 'EMQX rejected the website login',
      subscription_rejected: 'EMQX rejected the feedback subscription',
    };
    const issueLabels = {
      authentication_failed:
        'Receiver packets arrived, but authentication failed. Check that the ESP32 and website use the same control key.',
      invalid_packet: 'Receiver packets arrived but failed the expected format checks.',
      retained_packet: 'Retained feedback was ignored. Live receiver packets are required.',
      old_connection:
        'An old receiver connection was ignored. Re-enable the operator session to establish a fresh connection.',
      old_sequence: 'Duplicate or older receiver feedback was ignored.',
      clock_ahead:
        'The authenticated ESP32 clock is ahead of the server. Check Internet time synchronisation on the ESP32.',
      packet_too_old: 'Authenticated receiver packets arrived outside the 500 ms freshness window.',
    };
    el('diagnostics').hidden = !value.authorized;
    el('transport').textContent =
      `Website MQTT: ${transportLabels[transport.state] || 'Waiting for the active manual page'}${transport.reason ? ' · ' + transport.reason : ''}`;
    el('packets').textContent =
      `Receiver packets: ${diagnostics.packet_count || 0} received · ${diagnostics.accepted_count || 0} accepted · ${diagnostics.rejected_count || 0} ignored`;
    el('clock').textContent = Number.isFinite(diagnostics.clock_age_ms)
      ? `Last authenticated packet clock difference (server minus ESP32): ${Math.round(diagnostics.clock_age_ms)} ms`
      : 'No authenticated packet clock sample';
    el('hint').textContent =
      issueLabels[diagnostics.last_issue] ||
      (diagnostics.packet_count
        ? 'Keep this page open while fresh, ready zero-output feedback is collected.'
        : 'The ESP32 receiver must publish live feedback on robot/amr01/vision/hardware. Its command receiver is a separate MQTT connection from sensor telemetry.');
    if (!value.ready && value.authorized) {
      if (value.physical_mode === false)
        el('connection').textContent = 'Select the physical AMR source';
      else if (transport.state && transport.state !== 'subscribed')
        el('connection').textContent = 'Website MQTT · ' + transportLabels[transport.state];
      else if (!value.hardware && diagnostics.last_issue === 'authentication_failed')
        el('connection').textContent =
          'Receiver feedback authentication failed · open Connection details';
      else if (
        !value.hardware &&
        ['clock_ahead', 'packet_too_old'].includes(diagnostics.last_issue)
      )
        el('connection').textContent =
          'Receiver feedback rejected by clock/freshness check · open Connection details';
      else if (!value.hardware && Number.isFinite(diagnostics.last_accepted_age_ms))
        el('connection').textContent =
          `Fresh receiver feedback missing · last accepted ${(diagnostics.last_accepted_age_ms / 1000).toFixed(1)} s ago`;
      else if (!value.hardware && transport.connected)
        el('connection').textContent = 'Website MQTT connected · no valid ESP32 receiver feedback';
    }
    if (value.hardware && value.hardware.battery_voltage_v < 6.6)
      el('connection').textContent =
        `Battery ${value.hardware.battery_voltage_v.toFixed(2)} V · charge above 6.6 V for remote control`;
    el('feedback').textContent = value.feedback || '';
    el('missing').replaceChildren(
      ...(value.missing || []).map((text) => {
        const li = d.createElement('li');
        li.textContent = text;
        return li;
      }),
    );
    el('source').hidden = !!value.physical_mode;
    el('login').hidden = !!value.authorized;
    el('unlock').disabled = !value.can_unlock || !value.physical_mode;
    el('controls').hidden = !value.authorized;
    el('prepare').disabled =
      !value.authorized ||
      !value.ready ||
      value.busy ||
      ['manual_arming', 'manual_sent', 'manual_acknowledged', 'manual_stopping'].includes(r?.state);
    el('review').hidden = !reviewing;
    el('summary').textContent = r
      ? `${{ F: 'Forward', B: 'Backward', L: 'Turn left', R: 'Turn right' }[r.direction]} · PWM ${r.pwm}/255 · maximum ${r.duration_ms} ms. Approval expires 10 seconds after preparation.`
      : '';
    el('approve').disabled = !reviewing || !value.ready || !el('reason').value.trim();
    el('stop').disabled =
      !value.authorized || !r || ['manual_stopped', 'manual_cancelled'].includes(r.state);
    el('outcome').textContent =
      r?.reason ||
      (value.busy ? 'Another operator is controlling AMR-01.' : 'No motor request has been sent.');
  }
  on(el('source'), 'click', () =>
    d.dispatchEvent(
      new scope.CustomEvent('python-twin:action', {
        detail: { action: 'sensor_source', mode: 'live' },
      }),
    ),
  );
  on(el('login'), 'submit', (e) => {
    e.preventDefault();
    emit('login', { operator: el('operator').value, access_code: el('code').value });
    el('code').value = '';
  });
  on(el('proposal'), 'submit', (e) => {
    e.preventDefault();
    if (!el('prepare').disabled) {
      el('prepare').disabled = true;
      emit('prepare', { direction: el('direction').value, pwm: Number(el('pwm').value) });
    }
  });
  on(el('reason'), 'input', () => {
    el('approve').disabled =
      pending ||
      current.review?.state !== 'manual_review' ||
      !current.ready ||
      !el('reason').value.trim();
  });
  on(el('approve'), 'click', () => {
    if (el('approve').disabled || pending) return;
    pending = true;
    el('approve').disabled = true;
    emit('approve', { review_id: current.review.review_id, reason: el('reason').value });
    el('reason').value = '';
  });
  on(el('stop'), 'click', () => emit('stop'));
  on(el('logout'), 'click', () => emit('logout'));
  on(d, 'python-twin:render', (e) => render(e.detail?.manual_control));
  const presence = () => {
    const next =
      d.body.dataset.view === 'vision' &&
      d.getElementById('vision-routing-shell').dataset.mode === 'manual' &&
      !d.hidden;
    if (next !== active) {
      active = next;
      emit('view', { active });
    }
  };
  on(d, 'vision-routing:mode', presence);
  on(d, 'visibilitychange', presence);
  const observer = new scope.MutationObserver(presence);
  observer.observe(d.body, { attributes: true, attributeFilter: ['data-view'] });
  on(scope, 'pagehide', () => {
    active = false;
    emit('view', { active: false });
  });
  render();
  return {
    render,
    destroy() {
      observer.disconnect();
      listeners.forEach((remove) => remove());
      root.replaceChildren();
    },
  };
}
