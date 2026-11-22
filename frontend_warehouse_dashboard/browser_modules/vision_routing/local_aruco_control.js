export const LOCAL_TWIN_URL = 'http://127.0.0.1:8765/';

// The laptop owns measured preset timing and short motor leases. No LAN motor commands
// or approvals pass through the cloud Streamlit component.
export function createLocalArUcoPanel(scope) {
  const d = scope.document,
    root = d.getElementById('local-aruco-control');
  if (!root) return null;
  root.innerHTML = `
    <section class="panel pr-action-card">
      <div class="pr-topline"><div><span class="twin-card-kicker">AMR-01 · PRESET ROUTES</span><h2>Choose a route. Watch it move. Check arrival.</h2></div><span>A → B · E → A · B → E</span></div>
      <p>Use your three measured routes here inside the digital twin. The laptop sends timed commands directly to the ESP32. Complete the movement measurements, align the robot at its start point and select a route. You watch the floor and confirm arrival.</p>
      <div class="manual-direct-actions">
        <button id="lc-open" class="primary" type="button">Open preset routes here</button>
        <button id="lc-close" type="button" disabled>Close workspace</button>
        <a id="lc-separate" href="${LOCAL_TWIN_URL}" target="_blank" rel="noopener noreferrer">Open on laptop ↗</a>
      </div>
      <p id="lc-status" role="status">Keep AMR01_PresetRoutes.exe open on this laptop, close its separate controller tab, then open the panel here. Opening the panel does not start the robot.</p>
      <div id="lc-frame-host" hidden></div>
      <details class="manual-direct-help"><summary>Setup or panel not loading</summary><p>Use the updated AMR01_PresetRoutes.exe with your existing route key. Allow access to apps on this device or the local network if your browser asks. The panel includes Connect, 200 PWM trials, all three routes and Stop; the cutoff remains 6.00 V. Camera tracking and automatic obstacle detection are not used. If embedding is blocked, Open on laptop uses the same controller in a separate tab.</p><a href="https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/preset_station_routes.md" target="_blank" rel="noopener noreferrer">Preset route setup guide ↗</a></details>
    </section>`;
  const el = (id) => d.getElementById('lc-' + id),
    listeners = [];
  let frame = null,
    loadTimer = null,
    destroyed = false;
  const on = (target, event, fn) => {
    target.addEventListener(event, fn);
    listeners.push(() => target.removeEventListener(event, fn));
  };
  const active = () =>
    !destroyed &&
    !d.hidden &&
    d.body.dataset.view === 'vision' &&
    d.getElementById('vision-routing-shell')?.dataset.mode === 'local';
  function close(message = 'Workspace closed. Reopen it to begin a new operator session.') {
    // Child presence ceases when its browsing context is removed. Its local
    // watchdog stops the route; a later open never replays an approval.
    el('frame-host').replaceChildren();
    if (loadTimer !== null) scope.clearTimeout(loadTimer);
    loadTimer = null;
    el('frame-host').hidden = true;
    frame = null;
    d.dispatchEvent(new scope.CustomEvent('local-controller:view'));
    el('close').disabled = true;
    el('open').textContent = 'Open preset routes here';
    el('status').textContent = message;
  }
  on(el('open'), 'click', () => {
    if (!active()) return;
    close();
    frame = d.createElement('iframe');
    frame.id = 'lc-frame';
    frame.title = 'AMR-01 preset route controller';
    frame.src = LOCAL_TWIN_URL;
    frame.referrerPolicy = 'no-referrer';
    frame.className = 'local-aruco-frame';
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox',
    );
    frame.setAttribute('allow', 'local-network; loopback-network; local-network-access');
    el('frame-host').hidden = false;
    el('frame-host').append(frame);
    d.dispatchEvent(new scope.CustomEvent('local-controller:view'));
    el('close').disabled = false;
    el('open').textContent = 'Reload workspace';
    el('status').textContent =
      'Opening the laptop controller. This does not confirm a connected robot; check readiness inside the panel.';
    loadTimer = scope.setTimeout(() => {
      if (frame && active())
        el('status').textContent =
          'The preset controller has not confirmed loading. Keep the updated AMR01_PresetRoutes.exe open and allow browser access to apps on this device. You can also use Open on laptop.';
    }, 10000);
  });
  on(scope, 'message', (event) => {
    if (
      !frame ||
      !active() ||
      event.source !== frame.contentWindow ||
      event.origin !== new URL(LOCAL_TWIN_URL).origin ||
      event.data?.type !== 'amr-preset:ready' ||
      event.data?.version !== 1
    )
      return;
    if (loadTimer !== null) scope.clearTimeout(loadTimer);
    loadTimer = null;
    el('status').textContent =
      'Preset controller loaded inside the digital twin. Connect the ESP32 and check readiness below. Opening this panel does not authorize motion.';
  });
  on(el('close'), 'click', () => close());
  on(el('separate'), 'click', () =>
    close('Embedded workspace closed. Continue in the separate laptop tab.'),
  );
  const changed = () => {
    if (frame && !active())
      close('Workspace closed because you left preset routes. Reopen it to continue.');
  };
  on(d, 'vision-routing:mode', changed);
  on(d, 'visibilitychange', changed);
  on(scope, 'pagehide', () => close());
  const observer = new scope.MutationObserver(changed);
  observer.observe(d.body, { attributes: true, attributeFilter: ['data-view'] });
  return {
    destroy() {
      destroyed = true;
      close();
      observer.disconnect();
      listeners.forEach((fn) => fn());
      root.replaceChildren();
    },
  };
}
