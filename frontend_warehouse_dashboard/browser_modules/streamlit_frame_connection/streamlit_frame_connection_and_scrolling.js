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
  let payloadReceivedAt = 0;
  const sampleClocks = new Map();
  const monotonic = () => window.performance.now();
  const ageOf = (name) => {
    const sample = sampleClocks.get(name);
    return sample && Number.isFinite(sample.age)
      ? sample.age + Math.max(0, monotonic() - sample.at) / 1000
      : null;
  };
  function rememberAge(name, identity, age) {
    const previous = sampleClocks.get(name),
      key = JSON.stringify(identity);
    // A replay of the same sample cannot make it younger, even if the host
    // repeats cached arguments or a late listener requests the last payload.
    const priorAge = previous?.key === key ? ageOf(name) : null;
    sampleClocks.set(name, {
      key,
      at: monotonic(),
      age: Number.isFinite(age) ? Math.max(age, Number.isFinite(priorAge) ? priorAge : age) : null,
    });
  }
  function rememberPayload(payload) {
    payloadReceivedAt = monotonic();
    if (payload.mode === 'live') {
      const physical = payload.physical_telemetry;
      if (physical)
        rememberAge(
          'physical',
          [
            physical.boot_id,
            physical.seq,
            physical.received_at,
            physical.measurements?.boot_id,
            physical.measurements?.seq,
          ],
          physical.age_s,
        );
      for (const [id, robot] of Object.entries(payload.robots || {}))
        rememberAge(
          id,
          [robot.raw?.boot_id, robot.raw?.seq, robot.raw?.sample_time_s],
          robot.age_s,
        );
    }
    const scene = payload.vision_execution?.scene;
    if (scene) {
      rememberAge(
        'camera',
        [scene.seq, scene.captured_at_ms],
        Number.isFinite(scene.captured_at_ms) ? (Date.now() - scene.captured_at_ms) / 1000 : null,
      );
      if (scene.hardware)
        rememberAge(
          'camera_hardware',
          [scene.seq, scene.captured_at_ms],
          Number.isFinite(scene.hardware.age_ms) ? scene.hardware.age_ms / 1000 : null,
        );
    }
    const receiver = payload.vision_execution?.transport?.receiver;
    if (receiver)
      rememberAge(
        'route_receiver',
        [receiver.boot_id, receiver.epoch_id, receiver.seq, receiver.issued_at_ms],
        Number.isFinite(receiver.age_ms) ? receiver.age_ms / 1000 : null,
      );
    const link = payload.amr_connection;
    if (link)
      rememberAge(
        'connection',
        link.sample_identity || [link.sample_source, link.insights?.observed_at],
        link.sample_age_s,
      );
    latestPayload = payload;
  }
  const within = (age, limit, tolerance = 0) =>
    Number.isFinite(age) && age >= tolerance && age <= limit;
  const staleNotice = {
    label: 'Readings out of date',
    tone: 'warning',
    detail:
      'Current readings and recommendations are paused. Check ESP32 power, Wi-Fi and sensor forwarding; reconnect the dashboard if its updates have stopped.',
  };
  function expireGuidance(guidance, fresh) {
    if (!guidance || fresh) return guidance;
    return {
      ...guidance,
      ready: false,
      metrics: [],
      recommendations: guidance.ready
        ? [
            {
              code: 'feed_unavailable',
              title: staleNotice.label,
              detail: staleNotice.detail,
              tone: 'warning',
              priority: 'check',
              category: 'Connection',
              action: 'check_feed',
            },
          ]
        : guidance.recommendations || [],
    };
  }
  function projectPayload() {
    if (!latestPayload) return null;
    const original = latestPayload,
      result = { ...original };
    let physicalFresh = false,
      modelFresh = false;
    if (original.mode === 'live') {
      const physical = original.physical_telemetry;
      if (physical) {
        const age = ageOf('physical');
        physicalFresh = physical.fresh === true && within(age, 5, -1);
        result.physical_telemetry = { ...physical, age_s: age, fresh: physicalFresh };
        if (!physicalFresh) {
          Object.assign(result.physical_telemetry, {
            measurements: {},
            wheel_estimates: {},
            gyro_estimates: {},
            motion_observation: {},
            runtime_scenario: {},
            energy_observation: { ...physical.energy_observation, fresh: false },
            ...(physical.fresh
              ? {
                  state: 'stale',
                  label: 'Telemetry out of date',
                  recommendations: [staleNotice.detail],
                }
              : {}),
          });
        }
      }
      result.robots = Object.fromEntries(
        Object.entries(original.robots || {}).map(([id, robot]) => {
          const age = ageOf(id),
            fresh = !robot.stale && within(age, 2);
          if (id === 'amr01')
            modelFresh = fresh && !robot.continuity_lost && robot.quality === 'OK';
          return [
            id,
            {
              ...robot,
              age_s: age,
              stale: !fresh,
              ...(!fresh ? { derived: {}, forecast_pose: null, runtime_hours: null } : {}),
              ...(!fresh && !robot.stale
                ? {
                    quality: 'STALE',
                    quality_label: staleNotice.label,
                    quality_detail: staleNotice.detail,
                    quality_tone: 'warning',
                  }
                : {}),
            },
          ];
        }),
      );
      const observation = original.insights?.scope === 'physical_observation';
      result.insights = expireGuidance(original.insights, observation ? physicalFresh : modelFresh);
      if (result.insights?.sensor_checks)
        result.insights = {
          ...result.insights,
          sensor_checks: expireGuidance(result.insights.sensor_checks, physicalFresh),
        };
      if (original.human_review)
        result.human_review = {
          ...original.human_review,
          eligible:
            original.human_review.eligible &&
            (original.human_review.observation_only ? physicalFresh : modelFresh),
        };
      if (
        !physicalFresh &&
        !modelFresh &&
        (original.physical_telemetry?.fresh ||
          Object.values(original.robots || {}).some((r) => !r.stale))
      ) {
        result.status = staleNotice.detail;
        result.notice = staleNotice;
      }
    }
    const link = original.amr_connection;
    if (link) {
      const age = ageOf('connection'),
        limit = link.sample_source === 'physical_observation' ? 5 : 2;
      const fresh = link.sample_fresh === true && within(age, limit, limit === 5 ? -1 : 0);
      const subscriptionUnknown = monotonic() - payloadReceivedAt > 5000;
      const subscriptionDetail =
        'Last known subscription; dashboard updates paused. Reconnect or refresh the dashboard to check the current recorder status.';
      result.amr_connection = {
        ...link,
        ...(subscriptionUnknown
          ? { state: 'unknown', subscribed: false, detail: subscriptionDetail }
          : {}),
        sample_age_s: age,
        sample_fresh: fresh,
        insights: expireGuidance(link.insights, fresh),
        stages: (link.stages || []).map((stage) =>
          subscriptionUnknown && stage.id === 'broker'
            ? { ...stage, state: 'waiting', detail: subscriptionDetail }
            : !fresh && ['telemetry', 'insights'].includes(stage.id)
              ? { ...stage, state: 'waiting', detail: staleNotice.detail }
              : stage,
        ),
      };
    }
    const route = original.vision_execution;
    if (route) {
      const scene = route.scene,
        cameraAge = ageOf('camera'),
        hardwareAge = ageOf('camera_hardware');
      const cameraFresh = scene?.valid === true && within(cameraAge, 0.5, -0.1);
      const hardwareFresh = scene?.hardware?.ready === true && within(hardwareAge, 0.5);
      result.vision_execution = {
        ...route,
        ready: original.mode === 'live' && route.ready === true && cameraFresh && hardwareFresh,
        ...(scene
          ? {
              scene: {
                ...scene,
                valid: cameraFresh,
                ...(scene.hardware
                  ? {
                      hardware: {
                        ...scene.hardware,
                        ready: hardwareFresh,
                        age_ms: Number.isFinite(hardwareAge) ? hardwareAge * 1000 : null,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      };
      const receiver = route.transport?.receiver;
      if (receiver) {
        const age = ageOf('route_receiver'),
          fresh = receiver.fresh === true && within(age, 0.5);
        result.vision_execution.transport = {
          ...route.transport,
          receiver: {
            ...receiver,
            age_ms: Number.isFinite(age) ? age * 1000 : null,
            fresh,
            ready: receiver.ready === true && fresh,
          },
        };
      }
    }
    result.display_freshness = {
      update_age_s: Math.max(0, monotonic() - payloadReceivedAt) / 1000,
      dashboard_stalled: monotonic() - payloadReceivedAt > 5000,
    };
    return result;
  }
  function renderLatest() {
    const payload = projectPayload();
    if (payload) document.dispatchEvent(new CustomEvent('python-twin:render', { detail: payload }));
  }
  // This clock is independent of Streamlit's reruns. It expires display values
  // and review eligibility without issuing commands or touching the LAN frame.
  const freshnessTimer = window.setInterval(renderLatest, 500);
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) window.clearInterval(freshnessTimer);
  });
  window.addEventListener('pageshow', renderLatest);
  document.addEventListener('visibilitychange', renderLatest);
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
        rememberPayload(payload);
        renderLatest();
      }
      scheduleFit();
    }
  });
  // The bridge runs in <head>, before the sensor readout listener exists.
  // Retain an early render so a late listener can request the current payload.
  document.addEventListener('python-twin:ready', () => {
    renderLatest();
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
  const selectedVisionMode = () => document.getElementById('vision-routing-shell')?.dataset.mode;
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
        'camera_panel',
      ].includes(action.action)
    )
      return;
    if (action.action === 'sensor_source' && !['demo', 'live'].includes(action.mode)) return;
    if (
      action.action === 'demo_trial' &&
      !['baseline', 'turning', 'disagreement', 'low_charge', 'interruption'].includes(action.trial)
    )
      return;
    if (
      action.action === 'camera_panel' &&
      (typeof action.open !== 'boolean' ||
        document.body.dataset.view !== 'vision' ||
        selectedVisionMode() !== 'physical')
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
        ...(action.action === 'camera_panel' ? { open: action.open } : {}),
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
