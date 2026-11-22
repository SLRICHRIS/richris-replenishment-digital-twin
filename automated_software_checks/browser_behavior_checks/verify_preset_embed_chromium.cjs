const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
// Run only against an isolated synthetic local controller; never connect a robot.
const repo = path.resolve(__dirname, '../..');
const origin = 'https://richris-replenishment-digital-twin-s99b4letmnfusbbh6sjab9.streamlit.app';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'amr-embed-browser-'));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('AMR_')),
);
environment.AMR_DRIVE_KEY = '0'.repeat(64);
let service;
let output = '';
let browser;
(async () => {
  // Refuse to reuse an existing operator's loopback service.
  const probe = require('node:net').createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(8765, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
  service = spawn(
    process.env.PYTHON || 'python',
    [repo + '/amr01_preset_routes.py', '--no-browser', '--state-dir', scratch],
    { env: environment, cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  service.stdout.on('data', (data) => (output += data));
  service.stderr.on('data', (data) => (output += data));
  for (let n = 0; ; n++) {
    try {
      const r = await fetch('http://127.0.0.1:8765/api/status');
      assert.equal(r.status, 200);
      break;
    } catch (error) {
      if (n >= 100 || service.exitCode !== null)
        throw new Error('Service startup failed: ' + output);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Simulate the operator granting Chrome's local-app permission.
  // Browser security, origin checks and frame-ancestor enforcement stay enabled.
  await context.grantPermissions(['local-network-access'], { origin });
  await context.grantPermissions(['local-network-access'], { origin: 'https://untrusted.example' });
  const page = await context.newPage();
  const events = [];
  page.on('console', (message) => events.push(message.type() + ': ' + message.text()));
  page.on('pageerror', (error) => events.push('pageerror: ' + error.message));
  page.on('requestfailed', (request) =>
    events.push('failed ' + request.url() + ': ' + request.failure()?.errorText),
  );
  await page.route(origin + '/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><iframe id="component" src="/component" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups" style="width:100%;height:950px;border:0"></iframe></body></html>',
      });
    if (pathname === '/component')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body data-view="vision"><div id="vision-routing-shell" data-mode="local"></div><div id="local-aruco-control"></div><style>iframe{width:100%;height:760px;border:0}body{font:16px system-ui;background:#0b1220;color:white}button,a{padding:10px;color:#8dbbff}button{color:black}</style><script type="module">import {createLocalArUcoPanel} from "/browser_modules/vision_routing/local_aruco_control.js";createLocalArUcoPanel(window);</script></body></html>',
      });
    const file = path.resolve(repo + '/frontend_warehouse_dashboard', '.' + pathname);
    assert(file.startsWith(repo + '/frontend_warehouse_dashboard/'));
    return route.fulfill({
      contentType: pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
      body: fs.readFileSync(file),
    });
  });
  await page.goto(origin + '/');
  const parent = page.frameLocator('#component');
  assert.equal(await parent.locator('#lc-frame').count(), 0);
  await parent.locator('#lc-open').click();
  try {
    await parent
      .locator('#lc-status')
      .filter({ hasText: 'Preset controller loaded inside' })
      .waitFor({ timeout: 15000 });
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          version: browser.version(),
          events,
          status: await parent.locator('#lc-status').innerText(),
        },
        null,
        2,
      ),
    );
    throw error;
  }
  const child = parent.frameLocator('#lc-frame');
  await child.getByRole('button', { name: 'Connect ESP32', exact: true }).waitFor();
  assert.equal(await child.locator('#pwm').inputValue(), '200');
  const initial = await (await fetch('http://127.0.0.1:8765/api/status')).json();
  assert.equal(initial.connected, false);
  assert.equal(initial.hardware, null);
  assert.equal(initial.job, null);
  await parent.locator('#lc-close').click();
  assert.equal(await parent.locator('#lc-frame').count(), 0);
  const after = await (await fetch('http://127.0.0.1:8765/api/status')).json();
  assert.equal(after.connected, false);
  assert.equal(after.job, null);
  const attacker = await context.newPage();
  const denied = [];
  attacker.on('console', (message) => denied.push(message.text()));
  await attacker.route('https://untrusted.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<iframe id="test" src="http://127.0.0.1:8765/"></iframe>',
    }),
  );
  await attacker.goto('https://untrusted.example/');
  await attacker.waitForTimeout(500);
  assert(
    denied.some((message) => message.includes('frame-ancestors')),
    JSON.stringify(denied),
  );
  assert.equal(
    await attacker
      .frameLocator('#test')
      .getByRole('button', { name: 'Connect ESP32', exact: true })
      .count(),
    0,
  );
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        chromium: browser.version(),
        checks: [
          'trusted HTTPS nested iframe loads actual loopback controller',
          'verified loading handshake',
          'default PWM 200',
          'loading leaves robot disconnected',
          'closing removes controller context',
          'untrusted framing blocked by CSP',
        ],
        browserMessages: events,
      },
      null,
      2,
    ),
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (service && service.exitCode === null) {
      service.kill('SIGINT');
      await new Promise((resolve) => service.once('close', resolve));
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  });
