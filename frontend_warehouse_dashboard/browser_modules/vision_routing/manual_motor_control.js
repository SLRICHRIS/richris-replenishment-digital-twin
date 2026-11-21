import { createLiveSensorRecommendations } from './live_sensor_recommendations.js?v=live-guidance-20261122';
// Embed the installed ESP32 page; its own code remains the only LAN command sender.
export const DIRECT_CONTROLLER_URL = 'http://10.15.213.112/';

export function createManualMotorPanel(scope) {
  const d = scope.document,
    root = d.getElementById('manual-motor-control');
  if (!root) return null;
  root.innerHTML = `
    <section class="panel pr-action-card manual-drive-panel">
      <div class="pr-topline"><div><span class="twin-card-kicker">AMR-01 · DIRECT WI-FI</span><h2>Drive AMR-01 here.</h2></div><span>10.15.213.112</span></div>
      <p>Connect this device to the robot's Wi-Fi or hotspot. The ESP32 controller appears below; sensor readings continue through EMQX.</p>
      <div class="manual-direct-actions">
        <button id="mc-connect" class="primary" type="button">Connect controller</button>
        <button id="mc-disconnect" type="button" disabled>Close controller</button>
        <a id="mc-open-direct" href="${DIRECT_CONTROLLER_URL}" target="_blank" rel="noopener noreferrer">Open separately ↗</a>
      </div>
      <p id="mc-connection-status" role="status">Address saved. Select Connect controller, then allow local-network access if Chrome asks.</p>
      <div id="mc-reviewed-response" class="manual-reviewed-response" hidden><strong id="mc-reviewed-title"></strong><p id="mc-reviewed-detail"></p><p>Apply the response using the controls below or complete the physical check. Opening this page does not execute the saved decision.</p></div>
      <div id="mc-controller-frame-host" class="manual-controller-frame-host" hidden></div>
      <div id="mc-live-guidance"></div>
      <details class="manual-direct-help"><summary>If the controller does not appear</summary><p>Allow local-network access for this dashboard in Chrome, then select Connect controller again. If your browser cannot embed the page, use Open separately. The laptop and ESP32 must be on the same hotspot, and the robot must still have address 10.15.213.112.</p></details>
      <p id="mc-sensor-feed" role="status"></p>
      <a href="https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/manual_motor_control_setup.md" target="_blank" rel="noopener noreferrer">Direct Wi-Fi setup</a>
    </section>`;

  const connect = d.getElementById('mc-connect'),
    disconnect = d.getElementById('mc-disconnect'),
    open = d.getElementById('mc-open-direct'),
    status = d.getElementById('mc-connection-status'),
    host = d.getElementById('mc-controller-frame-host'),
    listeners = [];
  const guidance = createLiveSensorRecommendations(scope, d.getElementById('mc-live-guidance'));
  let frame = null,
    destroyed = false;
  const on = (target, type, listener) => {
    target.addEventListener(type, listener);
    listeners.push(() => target.removeEventListener(type, listener));
  };
  function active() {
    return (
      !destroyed &&
      !d.hidden &&
      d.body.dataset.view === 'vision' &&
      d.getElementById('vision-routing-shell')?.dataset.mode === 'manual'
    );
  }
  function closeController(
    message = 'Controller closed. Select Connect controller to open it again.',
  ) {
    // Removing the browsing context stops its hold-renewal timers. The ESP32
    // still expires motion 700 ms after the last command it actually accepts.
    host.replaceChildren();
    host.hidden = true;
    frame = null;
    connect.textContent = 'Connect controller';
    disconnect.disabled = true;
    status.textContent = message;
  }
  function showController() {
    if (!active()) return;
    closeController();
    const next = d.createElement('iframe');
    next.id = 'mc-controller-frame';
    next.title = 'AMR-01 direct Wi-Fi controller';
    next.className = 'manual-controller-frame';
    next.referrerPolicy = 'no-referrer';
    // Keep device scripts and same-origin /status and /cmd requests working,
    // without giving the device page top-level navigation or popup privileges.
    next.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    next.setAttribute('allow', 'local-network; local-network-access');
    next.src = DIRECT_CONTROLLER_URL;
    frame = next;
    host.hidden = false;
    host.append(next);
    connect.textContent = 'Reload controller';
    disconnect.disabled = false;
    // Cross-origin load events also fire on some browser error pages. Never
    // turn one into a fabricated "connected" or "controller ready" status.
    status.textContent =
      'Check for “Wi-Fi connected” inside the controller below. Allow local-network access if Chrome asks.';
  }
  function viewChanged() {
    if (frame && !active())
      closeController(
        'Controller closed when you left the drive view. Select Connect controller to resume.',
      );
  }
  function render(_value = {}, physical = {}) {
    const voltage = physical.fresh ? physical.measurements?.battery_voltage_v : null;
    d.getElementById('mc-sensor-feed').textContent = Number.isFinite(voltage)
      ? `Sensor feed: battery ${voltage.toFixed(2)} V. Check the controller's live readings and motor speed before driving.`
      : 'Check the live readings and motor speed inside the ESP32 controller before driving.';
  }
  on(connect, 'click', showController);
  on(disconnect, 'click', () => closeController());
  on(open, 'click', () =>
    closeController('Embedded controller closed. Use the separate ESP32 tab.'),
  );
  on(d, 'python-twin:render', (event) => render({}, event.detail?.physical_telemetry));
  on(d, 'human-review:drive', (event) => {
    const response = event.detail;
    d.getElementById('mc-reviewed-response').hidden = !response?.label;
    d.getElementById('mc-reviewed-title').textContent = response?.label
      ? 'Saved response: ' + response.label
      : '';
    d.getElementById('mc-reviewed-detail').textContent = response?.detail || '';
  });
  on(d, 'vision-routing:mode', viewChanged);
  on(d, 'visibilitychange', viewChanged);
  on(scope, 'pagehide', () => closeController());
  const observer = new scope.MutationObserver(viewChanged);
  observer.observe(d.body, { attributes: true, attributeFilter: ['data-view'] });
  render();
  return {
    render,
    destroy() {
      destroyed = true;
      closeController();
      observer.disconnect();
      guidance?.destroy();
      listeners.forEach((remove) => remove());
      root.replaceChildren();
    },
  };
}
