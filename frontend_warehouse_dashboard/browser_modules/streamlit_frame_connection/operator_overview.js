/* One operator workflow; display state never grants control or sends commands. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let latest;
  document.documentElement.dataset.standalone = String(window.parent === window);
  const ageText = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < -1) return 'Age unavailable';
    seconds = Math.max(0, seconds);
    if (seconds < 60) return `${Math.floor(seconds)} s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400)
      return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  };
  function card(id, title, detail, state) {
    $('operator-' + id).dataset.state = state;
    $('operator-' + id + '-title').textContent = title;
    $('operator-' + id + '-detail').textContent = detail;
  }
  function render(payload) {
    if (payload) latest = payload;
    if (!$('operator-overview')) return;
    const p = latest,
      raw = p?.physical_telemetry,
      model = p?.robots?.amr01;
    const rawFresh =
      raw?.fresh === true && Number.isFinite(raw.age_s) && raw.age_s >= -1 && raw.age_s <= 5;
    const modelFresh =
      model?.stale === false &&
      model.quality === 'OK' &&
      !model.continuity_lost &&
      Number.isFinite(model.age_s) &&
      model.age_s >= 0 &&
      model.age_s <= 2;
    const current = rawFresh || modelFresh;
    $('operator-source').textContent = !p
      ? 'Waiting for the dashboard service'
      : p.mode === 'demo'
        ? 'Practice data selected'
        : 'Physical AMR workspace';
    if (!p)
      card(
        'feed',
        'Waiting for data',
        window.parent === window
          ? 'Open the full dashboard for sensor readings and protected reviews.'
          : 'Waiting for the server. Camera routes use the separate local laptop connection.',
        'waiting',
      );
    else if (p.mode === 'demo')
      card(
        'feed',
        'Generated example',
        'Switch to stored sensor data to inspect the physical robot.',
        'demo',
      );
    else if (current)
      card(
        'feed',
        'Fresh sensor data',
        `Latest packet ${ageText(rawFresh ? raw.age_s : model.age_s)}. EMQX carries sensor readings.`,
        'live',
      );
    else
      card(
        'feed',
        raw?.received_at ? 'Sensor feed out of date' : 'No current sensor packet',
        raw?.received_at
          ? `Last received ${ageText(raw.age_s)}. Check ESP32 power, Wi-Fi and forwarding.`
          : 'Check ESP32 power, Wi-Fi and sensor forwarding.',
        'stale',
      );
    if (p?.display_freshness?.dashboard_stalled)
      $('operator-source').textContent = 'Dashboard updates paused · reload this page';
    const review = p?.human_review;
    if (p?.mode === 'demo')
      card('review', 'Practice review', 'Generated evidence; no physical command is sent.', 'demo');
    else if (!p || !current || !review?.eligible || review?.can_review === false)
      card(
        'review',
        'Fresh evidence needed',
        'Sensor recommendations need new telemetry. Route approval uses the local camera workspace and ESP32 feedback.',
        'waiting',
      );
    else if (!review.authorized)
      card(
        'review',
        'Enable operator review',
        'Read the recommendation, then unlock your session to record a decision.',
        'waiting',
      );
    else
      card(
        'review',
        'Review available',
        review.observation_only
          ? 'Record your response, apply it locally, then check new readings.'
          : 'Review the captured evidence and permitted action before approval.',
        'live',
      );
    const open = !!$('lc-frame');
    card(
      'control',
      open ? 'Camera workspace open' : 'ArUco camera routes',
      open
        ? 'Check camera, receiver and approval readiness inside the workspace. Opening it does not authorize motion.'
        : 'Start AMR01_LocalTwin on the laptop. Preview a route, approve it, then verify arrival.',
      'neutral',
    );
  }
  function bind() {
    if (!$('operator-overview')) return;
    $('operator-readings').addEventListener('click', () => $('tab-hardware')?.click());
    $('operator-decide').addEventListener('click', () =>
      document.dispatchEvent(new CustomEvent('human-review:open', { detail: {} })),
    );
    $('operator-drive').addEventListener('click', () => {
      $('tab-vision')?.click();
      $('vision-mode-local')?.click();
    });
    $('operator-connect').addEventListener('click', () => {
      $('tab-vision')?.click();
      const settings = $('amr-connection-workspace');
      if (settings) {
        settings.open = true;
        // Navigation resets the host scroll in a MutationObserver. Wait for
        // the next frame so the requested section stays visible afterward.
        window.requestAnimationFrame(() => {
          if (document.body.dataset.view === 'vision' && settings.open)
            settings.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        });
      }
    });
    document.addEventListener('python-twin:render', (e) => render(e.detail));
    document.addEventListener('local-controller:view', () => render());
    render();
    document.dispatchEvent(new CustomEvent('python-twin:ready'));
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
