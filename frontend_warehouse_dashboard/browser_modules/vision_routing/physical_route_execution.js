// Physical approval is a server-owned workflow. Browser maps never drive motors.
export function createPhysicalRoutePanel(scope) {
  const d = scope.document,
    root = d.getElementById('physical-route-execution');
  if (!root) return null;
  root.innerHTML = `<section class="panel physical-route-panel" aria-labelledby="physical-route-title">
    <header><div><span class="eyebrow">AMR-01 · HUMAN IN THE LOOP</span><h2 id="physical-route-title">Review. Approve. Move.</h2><p>The approved route runs through the USB-camera controller and the ESP32 motor receiver.</p></div><span id="pr-state" class="vision-chip">Setup required</span></header>
    <div class="physical-route-body"><div class="physical-route-floor"><svg id="pr-map" viewBox="0 0 425 630" role="img" aria-label="Trusted live camera map and server-approved route"><rect x="0" y="0" width="425" height="630" class="vision-floor"/><g id="pr-map-content" transform="translate(0 630) scale(1 -1)"></g></svg><p id="pr-scene">Waiting for authenticated camera and ESP32 feedback</p></div>
    <div class="physical-route-controls"><div class="physical-route-steps"><span>1 Camera evidence</span><span>2 Human approval</span><span>3 Verified arrival</span></div>
    <form id="pr-login"><label>Operator alias<input id="pr-operator" maxlength="40" autocomplete="username" placeholder="Your operator alias" required></label><label>Private operator code<input id="pr-code" type="password" maxlength="256" autocomplete="current-password" required></label><button type="submit" id="pr-unlock">Unlock physical control</button></form>
    <div id="pr-session" hidden><p>Operator session unlocked</p><button id="pr-lock" type="button">Lock & stop</button></div>
    <div class="vision-fields"><label>Destination X · mm<input id="pr-goal-x" type="number" min="0" max="425" step="10" value="210"></label><label>Destination Y · mm<input id="pr-goal-y" type="number" min="0" max="630" step="10" value="450"></label></div>
    <button id="pr-capture" type="button" disabled>Capture physical route</button><p id="pr-route">The server plans from measured robot pose and obstacles.</p>
    <label>Decision reason<textarea id="pr-reason" maxlength="240" rows="2" placeholder="Why is this route suitable?" disabled></textarea></label>
    <div class="vision-tools"><button id="pr-approve" type="button" class="primary" disabled>Approve & run</button><button id="pr-reject" type="button" disabled>Reject</button><button id="pr-hold" type="button" disabled>Hold</button></div>
    <button id="pr-stop" class="physical-stop" type="button" disabled>Stop route</button>
    <p id="pr-outcome" role="status" aria-live="polite">No physical route has been approved.</p><p id="pr-feedback" role="status" aria-live="polite"></p><ul id="pr-missing"></ul>
    <p class="vision-small">Keep this page and the Windows camera controller running. Leaving or locking ends the execution grant. The local ESP32 deadline stops motor output if commands expire. Keep access to the robot's power switch.</p></div></div></section>`;
  const el = (n) => d.getElementById('pr-' + n);
  let payload = null,
    view = null;
  const send = (command, more = {}) =>
    d.dispatchEvent(
      new scope.CustomEvent('python-twin:action', {
        detail: { action: 'vision_execution', command, ...more },
      }),
    );
  const active = () => d.body.dataset.view === 'vision' && !d.hidden;
  function viewChanged() {
    const next = active();
    if (view !== next) {
      view = next;
      send('view', { active: next });
    }
  }
  const observer = new scope.MutationObserver(viewChanged);
  observer.observe(d.body, { attributes: true, attributeFilter: ['data-view'] });
  d.addEventListener('visibilitychange', viewChanged);
  scope.addEventListener('pagehide', () => send('view', { active: false }));
  el('login').addEventListener('submit', (e) => {
    e.preventDefault();
    send('login', { operator: el('operator').value, access_code: el('code').value });
    el('code').value = '';
  });
  el('lock').onclick = () => send('logout');
  el('stop').onclick = () => send('stop');
  el('capture').onclick = () =>
    send('capture', { goal_x: Number(el('goal-x').value), goal_y: Number(el('goal-y').value) });
  ['approve', 'reject', 'hold'].forEach(
    (decision) =>
      (el(decision).onclick = () =>
        send('decide', {
          review_id: payload?.review?.review_id,
          decision,
          reason: el('reason').value,
        })),
  );
  const svg = (tag, attrs) => {
    const n = d.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
    return n;
  };
  function render(p) {
    payload = p;
    const r = p.review,
      s = p.scene,
      auth = !!p.authorized,
      live = !!p.physical_mode;
    const fresh =
      s?.valid &&
      s.floor_width_mm === 425 &&
      s.floor_length_mm === 630 &&
      Date.now() - s.captured_at_ms < 1500 &&
      Date.now() >= s.captured_at_ms - 100;
    const running = ['sent', 'arming', 'running', 'stopping'].includes(r?.state),
      pending = r?.state === 'pending' && Date.now() < r.expires_at_ms;
    el('login').hidden = auth;
    el('session').hidden = !auth;
    el('unlock').disabled = !p.can_unlock || !live;
    el('capture').disabled = !(auth && live && p.ready && fresh && !running);
    el('reason').disabled = !(auth && pending);
    ['approve', 'reject', 'hold'].forEach(
      (n) =>
        (el(n).disabled = !(auth && live && pending && (n !== 'approve' || (p.ready && fresh)))),
    );
    el('stop').disabled = !(auth && running);
    el('state').textContent =
      r?.state?.replaceAll('_', ' ') || (fresh ? 'Camera ready' : 'Setup required');
    el('route').textContent = r
      ? `${Math.round(r.route.length_mm)} mm route · ${Math.ceil(r.route.clearance_radius_mm)} mm protected radius · review ${r.review_id.slice(0, 8)}`
      : 'The server plans from measured robot pose and obstacles.';
    el('outcome').textContent = r?.reason || 'No physical route has been approved.';
    el('feedback').textContent =
      p.feedback || (!live ? 'Select Physical sensor mode to use the real AMR.' : '');
    el('missing').replaceChildren(
      ...(p.missing || []).map((text) => {
        const n = d.createElement('li');
        n.textContent = text;
        return n;
      }),
    );
    el('scene').textContent = s
      ? fresh
        ? `Camera frame ${s.seq} · ESP32 ${s.hardware.ready ? 'ready' : 'unavailable'} · ${s.hardware.battery_voltage_v.toFixed(2)} V motor branch`
        : `Camera unavailable: ${s.reason || 'fresh feedback required'}`
      : 'Waiting for authenticated camera and ESP32 feedback';
    const map = el('map-content');
    map.replaceChildren();
    if (s && fresh) {
      (s.obstacles || []).forEach((q) =>
        map.append(svg('rect', { ...q, class: 'vision-obstacle' })),
      );
      if (r)
        map.append(
          svg('polyline', {
            points: r.route.points.map((p) => p.join(',')).join(' '),
            fill: 'none',
            stroke: '#2478ef',
            'stroke-width': 6,
          }),
        );
      if (s.pose) {
        map.append(svg('circle', { cx: s.pose.x, cy: s.pose.y, r: 18, fill: '#19a47d' }));
        map.append(
          svg('line', {
            x1: s.pose.x,
            y1: s.pose.y,
            x2: s.pose.x + 45 * Math.cos(s.pose.heading),
            y2: s.pose.y + 45 * Math.sin(s.pose.heading),
            stroke: '#19a47d',
            'stroke-width': 7,
          }),
        );
      }
    }
  }
  const listener = (e) => {
    if (e.detail?.vision_execution) render(e.detail.vision_execution);
  };
  d.addEventListener('python-twin:render', listener);
  d.dispatchEvent(new scope.CustomEvent('python-twin:ready'));
  viewChanged();
  // Freshness controls must also expire if Streamlit stops delivering payloads.
  const timer = scope.setInterval(() => {
    if (payload) render(payload);
  }, 500);
  return {
    render,
    destroy() {
      observer.disconnect();
      scope.clearInterval(timer);
      d.removeEventListener('python-twin:render', listener);
    },
  };
}
if (typeof window !== 'undefined') createPhysicalRoutePanel(window);
