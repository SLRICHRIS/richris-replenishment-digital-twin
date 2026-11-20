/* © 2026 S L RICHRIS. All rights reserved. Educational use only.
 * Minimal Streamlit component handshake; the digital twin owns its UI/state.
 */
(() => {
  'use strict';
  if (window.parent === window) return;
  document.documentElement.dataset.host = 'streamlit';

  // The component iframe does not supply a document scrollbar. Its main
  // region scrolls instead; changing tabs must reset that region, not window.
  let viewObserver;
  function bindWorkspaceScroll() {
    const main = document.getElementById('main-content');
    if (!main || !document.body) return;
    main.setAttribute('tabindex', '0');
    if (!main.hasAttribute('aria-label')) main.setAttribute('aria-label', 'Warehouse workspace');
    let view = document.body.dataset.view;
    viewObserver = new MutationObserver(() => {
      const next = document.body.dataset.view;
      if (next !== view) {
        view = next;
        main.scrollTop = 0;
      }
    });
    viewObserver.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindWorkspaceScroll, { once: true });
  } else {
    bindWorkspaceScroll();
  }
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) viewObserver?.disconnect();
  });

  // Streamlit serves this component on its own origin. Do not accept arbitrary
  // window messages or reflect parent arguments into HTML. Python sends derived
  // sensor display data; browser actions send only an allowlisted source choice.
  const origin = window.location.origin;
  const send = (type, detail = {}) =>
    window.parent.postMessage(
      {
        isStreamlitMessage: true,
        type,
        ...detail,
      },
      origin,
    );

  let lastHeight = -1;
  let queued = false;
  let latestPayload;
  function fitViewport() {
    queued = false;
    let available = 900;
    try {
      available = window.parent.visualViewport?.height || window.parent.innerHeight;
    } catch {
      // The packaged component uses same-origin serving. This fallback keeps
      // the workspace usable if a different host applies stricter isolation.
    }
    const height = Math.max(360, Math.round(Number.isFinite(available) ? available : 900));
    if (height !== lastHeight) {
      lastHeight = height;
      send('streamlit:setFrameHeight', { height });
    }
  }
  function scheduleFit() {
    if (!queued) {
      queued = true;
      window.requestAnimationFrame(fitViewport);
    }
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== origin) return;
    if (event.data?.type === 'streamlit:render') {
      const payload = event.data.args?.python_twin;
      if (payload && ['demo', 'live'].includes(payload.mode)) {
        latestPayload = payload;
        document.dispatchEvent(new CustomEvent('python-twin:render', { detail: payload }));
      }
      scheduleFit();
    }
  });
  // The bridge runs in <head>, before the sensor readout listener exists.
  // Retain an early render so a late listener can request the current payload.
  document.addEventListener('python-twin:ready', () => {
    if (latestPayload)
      document.dispatchEvent(new CustomEvent('python-twin:render', { detail: latestPayload }));
  });
  let actionSequence = 0,
    controlPageLeaving = false;
  window.addEventListener(
    'pagehide',
    () => {
      controlPageLeaving = true;
    },
    { capture: true },
  );
  window.addEventListener(
    'pageshow',
    () => {
      controlPageLeaving = false;
    },
    { capture: true },
  );
  document.addEventListener('python-twin:action', (event) => {
    const action = event.detail;
    if (
      !action ||
      ![
        'sensor_source',
        'demo_trial',
        'model_inspection',
        'database_inspection',
        'database_browse',
        'connection_view',
        'connection_control',
        'human_review',
        'vision_execution',
        'manual_control',
      ].includes(action.action)
    )
      return;
    if (action.action === 'sensor_source' && !['demo', 'live'].includes(action.mode)) return;
    if (
      action.action === 'demo_trial' &&
      !['baseline', 'turning', 'disagreement', 'low_charge', 'interruption'].includes(action.trial)
    )
      return;
    if (action.action === 'connection_view' && typeof action.active !== 'boolean') return;
    if (
      action.action === 'connection_control' &&
      (!['connect', 'disconnect'].includes(action.command) ||
        typeof action.access_code !== 'string' ||
        action.access_code.length > 256)
    )
      return;
    if (
      action.action === 'database_browse' &&
      (![
        'amr_commissioning_samples',
        'amr_sensor_samples',
        'amr_encoder_readings',
        'amr_imu_readings',
        'amr_ina219_readings',
        'amr_twin_states',
        'amr_pipeline_events',
        'amr_calibrations',
      ].includes(action.dataset) ||
        typeof action.active !== 'boolean')
    )
      return;
    // Streamlit may retain only the last of the manual/vision view messages.
    // Both carry the same complete selected mode, so either message restores it.
    const selectedControl = document.getElementById('vision-routing-shell')?.dataset.mode;
    let controlMode =
      document.body.dataset.view === 'vision' && !document.hidden && !controlPageLeaving
        ? selectedControl === 'manual'
          ? 'manual'
          : selectedControl === 'physical'
            ? 'vision'
            : null
        : null;
    const ownMode = action.action === 'manual_control' ? 'manual' : 'vision';
    if (action.command === 'view' && action.active === false && controlMode === ownMode)
      controlMode = null;
    send('streamlit:setComponentValue', {
      value: {
        action: action.action,
        ...(['manual_control', 'vision_execution'].includes(action.action)
          ? { control_mode: controlMode }
          : {}),
        ...(action.action === 'sensor_source' ? { mode: action.mode } : {}),
        ...(action.action === 'demo_trial' ? { trial: action.trial } : {}),
        ...(action.action === 'human_review'
          ? {
              command: action.command,
              review_id: action.review_id,
              decision: action.decision,
              intervention: action.intervention,
              reason: action.reason,
              access_code:
                typeof action.access_code === 'string'
                  ? action.access_code.slice(0, 256)
                  : undefined,
              operator:
                typeof action.operator === 'string' ? action.operator.slice(0, 40) : undefined,
            }
          : {}),
        ...(action.action === 'manual_control'
          ? {
              command: action.command,
              active: action.active,
              review_id: action.review_id,
              direction: action.direction,
              pwm: action.pwm,
              hold_id: action.hold_id,
              input_seq: action.input_seq,
              issued_at_ms: action.issued_at_ms,
              reason: typeof action.reason === 'string' ? action.reason.slice(0, 240) : '',
              access_code:
                typeof action.access_code === 'string' ? action.access_code.slice(0, 256) : '',
              operator: typeof action.operator === 'string' ? action.operator.slice(0, 40) : '',
            }
          : {}),
        ...(action.action === 'vision_execution'
          ? {
              command: action.command,
              active: action.active,
              review_id: action.review_id,
              decision: action.decision,
              choice: ['continue', 'divert'].includes(action.choice) ? action.choice : undefined,
              reason: typeof action.reason === 'string' ? action.reason.slice(0, 240) : '',
              access_code:
                typeof action.access_code === 'string' ? action.access_code.slice(0, 256) : '',
              operator: typeof action.operator === 'string' ? action.operator.slice(0, 40) : '',
              goal_x: Number.isFinite(action.goal_x) ? action.goal_x : null,
              goal_y: Number.isFinite(action.goal_y) ? action.goal_y : null,
            }
          : {}),
        ...(action.action === 'connection_view' ? { active: action.active } : {}),
        ...(action.action === 'connection_control'
          ? { command: action.command, access_code: action.access_code }
          : {}),
        ...(action.action === 'database_browse'
          ? { dataset: action.dataset, active: action.active }
          : {}),
        nonce: `${Date.now()}-${++actionSequence}`,
      },
      dataType: 'json',
    });
  });
  window.addEventListener('resize', scheduleFit);
  try {
    window.parent.addEventListener('resize', scheduleFit);
    window.parent.visualViewport?.addEventListener('resize', scheduleFit);
    window.addEventListener(
      'pagehide',
      () => {
        window.parent.removeEventListener('resize', scheduleFit);
        window.parent.visualViewport?.removeEventListener('resize', scheduleFit);
      },
      { once: true },
    );
  } catch {}
  // Do not invite Streamlit's first (possibly only) render until the body and
  // readout scripts are ready. Identical later fragment args may be memoized.
  let readySent = false;
  function ready() {
    if (readySent) return;
    readySent = true;
    send('streamlit:componentReady', { apiVersion: 1 });
    scheduleFit();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();
