export const LOCAL_TWIN_URL = 'http://127.0.0.1:8765/';

// The laptop owns camera capture and short motor leases. No LAN motor commands
// or approvals pass through the cloud Streamlit component.
export function createLocalArUcoPanel(scope) {
  const d = scope.document,
    root = d.getElementById('local-aruco-control');
  if (!root) return null;
  root.innerHTML = `
    <section class="panel pr-action-card">
      <div class="pr-topline"><div><span class="twin-card-kicker">AMR-01 · ARUCO + DIRECT WI-FI</span><h2>See, plan, approve, verify.</h2></div><span>ESP32 · 10.15.213.112</span></div>
      <p>Your laptop tracks the robot with the Logitech camera and sends approved routes directly to the ESP32. EMQX carries sensor telemetry.</p>
      <div class="manual-direct-actions">
        <button id="lc-open" class="primary" type="button">Open camera workspace here</button>
        <button id="lc-close" type="button" disabled>Close workspace</button>
        <a id="lc-separate" href="${LOCAL_TWIN_URL}" target="_blank" rel="noopener noreferrer">Open on laptop ↗</a>
      </div>
      <p id="lc-status" role="status">Start AMR01_LocalTwin on this laptop, then open the workspace. Camera connection and route approval are separate steps.</p>
      <div id="lc-frame-host" hidden></div>
      <details class="manual-direct-help"><summary>First-time setup or workspace not loading</summary><p>Upload AMR01_Local_Routes once and start AMR01_LocalTwin on the laptop connected to the same hotspot. If the browser blocks embedding, use Open on laptop. The workspace contains camera calibration, route preview, human approval, Stop and camera-verified arrival.</p><a href="https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/direct_wifi_aruco_routes.md" target="_blank" rel="noopener noreferrer">Camera and ESP32 setup guide ↗</a></details>
    </section>`;
  const el = (id) => d.getElementById('lc-' + id),
    listeners = [];
  let frame = null,
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
    el('frame-host').hidden = true;
    frame = null;
    d.dispatchEvent(new scope.CustomEvent('local-controller:view'));
    el('close').disabled = true;
    el('open').textContent = 'Open camera workspace here';
    el('status').textContent = message;
  }
  on(el('open'), 'click', () => {
    if (!active()) return;
    close();
    frame = d.createElement('iframe');
    frame.id = 'lc-frame';
    frame.title = 'AMR-01 local ArUco route controller';
    frame.src = LOCAL_TWIN_URL;
    frame.referrerPolicy = 'no-referrer';
    frame.className = 'local-aruco-frame';
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox',
    );
    frame.setAttribute('allow', 'local-network; local-network-access');
    el('frame-host').hidden = false;
    el('frame-host').append(frame);
    d.dispatchEvent(new scope.CustomEvent('local-controller:view'));
    el('close').disabled = false;
    el('open').textContent = 'Reload workspace';
    el('status').textContent =
      'Check the live camera and readiness inside the workspace. A loaded frame alone does not confirm a connected robot.';
  });
  on(el('close'), 'click', () => close());
  on(el('separate'), 'click', () =>
    close('Embedded workspace closed. Continue in the separate laptop tab.'),
  );
  const changed = () => {
    if (frame && !active())
      close('Workspace closed because you left the camera view. Reopen it to continue.');
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
