// The browser opens the ESP32's own LAN page. This panel sends no motor commands.
const ADDRESS_KEY = 'amr01.direct_wifi_address';

export function directControllerUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(?:http:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})\/?$/);
  if (!match) return null;
  const parts = match[1].split('.').map(Number);
  if (parts.some((part) => part > 255)) return null;
  const [a, b] = parts;
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) return null;
  return `http://${parts.join('.')}/`;
}

export function createManualMotorPanel(scope) {
  const d = scope.document,
    root = d.getElementById('manual-motor-control');
  if (!root) return null;
  root.innerHTML = `
    <section class="panel pr-action-card manual-drive-panel">
      <div class="pr-topline"><div><span class="twin-card-kicker">AMR-01 · DIRECT WI-FI</span><h2>Drive from the ESP32's own page.</h2></div><span>Local Wi-Fi control</span></div>
      <p>Movement commands go directly from your device to the ESP32. Sensor readings continue through EMQX.</p>
      <p>Connect this device to the same Wi-Fi or hotspot as the robot. Enter the ESP32 IP address shown under your hotspot's connected devices.</p>
      <form id="mc-direct-form" class="manual-direct-form">
        <label for="mc-address">ESP32 IP address</label>
        <input id="mc-address" type="text" inputmode="decimal" placeholder="For example, 192.168.43.120" autocomplete="off" spellcheck="false" aria-describedby="mc-address-status">
        <a id="mc-open-direct" class="primary manual-direct-open" target="_blank" rel="noopener noreferrer" aria-disabled="true">Open ESP32 controller ↗</a>
      </form>
      <p id="mc-address-status" role="status"></p>
      <p>The controller opens in a separate tab. Check its live battery reading and motor-power setting before driving. Support the robot with its wheels clear for the first test.</p>
      <details><summary>If the controller page does not open</summary><p>Check that both devices are on the same hotspot and that the ESP32 IP has not changed. The address uses HTTP. Some hotspots prevent connected devices from reaching each other.</p></details>
      <p id="mc-sensor-feed" role="status"></p>
      <a href="https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/manual_motor_control_setup.md" target="_blank" rel="noopener noreferrer">Direct Wi-Fi setup</a>
    </section>`;
  const address = d.getElementById('mc-address'),
    open = d.getElementById('mc-open-direct'),
    status = d.getElementById('mc-address-status'),
    form = d.getElementById('mc-direct-form');
  try {
    address.value = scope.localStorage.getItem(ADDRESS_KEY) || '';
  } catch {}
  function update() {
    const url = directControllerUrl(address.value);
    open.setAttribute('aria-disabled', String(!url));
    if (url) {
      open.href = url;
      status.textContent = `Open ${url} on this device. The ESP32 page will show its local connection status.`;
    } else {
      open.removeAttribute('href');
      status.textContent = address.value.trim()
        ? 'Enter a local IPv4 address starting with 10., 192.168., or 172.16–31.'
        : 'Enter the robot’s IP address to open its direct controller.';
    }
    return url;
  }
  function openController(event) {
    const url = update();
    if (!url) {
      event.preventDefault();
      address.focus();
      return;
    }
    try {
      scope.localStorage.setItem(ADDRESS_KEY, new URL(url).hostname);
    } catch {}
  }
  function submit(event) {
    event.preventDefault();
    if (update()) open.click();
  }
  function render(_value = {}, physical = {}) {
    const voltage = physical.fresh ? physical.measurements?.battery_voltage_v : null;
    d.getElementById('mc-sensor-feed').textContent = Number.isFinite(voltage)
      ? `Sensor feed: battery ${voltage.toFixed(2)} V. Read the direct controller for local drive status.`
      : 'Sensor feed: no fresh battery reading on this page. Check the direct controller before driving.';
  }
  const receive = (event) => render({}, event.detail?.physical_telemetry);
  address.addEventListener('input', update);
  open.addEventListener('click', openController);
  form.addEventListener('submit', submit);
  d.addEventListener('python-twin:render', receive);
  update();
  render();
  return {
    render,
    destroy() {
      address.removeEventListener('input', update);
      open.removeEventListener('click', openController);
      form.removeEventListener('submit', submit);
      d.removeEventListener('python-twin:render', receive);
      root.replaceChildren();
    },
  };
}
