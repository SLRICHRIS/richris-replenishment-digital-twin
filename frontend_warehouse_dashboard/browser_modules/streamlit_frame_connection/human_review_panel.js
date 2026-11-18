/* Operator choices stay on the protected Python path. No browser motor transport. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TERMINAL = [
    'reviewed',
    'rejected',
    'deferred',
    'expired',
    'blocked',
    'verified',
    'uncertain',
  ];
  const labels = {
    pending: 'Your decision is needed',
    dispatching: 'Sending your approved request',
    sent: 'Waiting for the AMR to reply',
    acknowledged: 'AMR replied; checking fresh readings',
    reviewed: 'Review saved; no change requested',
    rejected: 'Request rejected',
    deferred: 'Decision saved for later',
    expired: 'Review timed out',
    blocked: 'Approval saved; request not delivered',
    verified: 'Sensor effect confirmed',
    uncertain: 'Result not confirmed',
  };
  const text = (id, value) => {
    if ($(id) && $(id).textContent !== String(value ?? '')) $(id).textContent = String(value ?? '');
  };
  let current = null,
    payload = null,
    lastEvents = null,
    lastReviewId = null,
    lastDemo = null,
    timer;
  const emit = (detail) =>
    document.dispatchEvent(new CustomEvent('python-twin:action', { detail }));
  const send = (detail) => emit({ action: 'human_review', ...detail });
  const expired = () =>
    current?.review?.state === 'pending' &&
    Number.isFinite(current.review.expires_at) &&
    Date.now() >= current.review.expires_at * 1000;
  const access = () => !!(current && (current.demo || (current.authorized && current.can_review)));
  const owns = () => !!(current && (current.demo || current.owns_review));
  const active = () =>
    !!(current?.review && !TERMINAL.includes(current.review.state) && !expired());
  const mayDecide = () => access() && owns() && current.review?.state === 'pending' && !expired();
  function actionHelp() {
    const action = $('human-review-action').value;
    const description =
      action === 'no_action'
        ? 'Save your review without changing robot operation.'
        : !current?.demo && !current?.commands_enabled
          ? 'Motor delivery is unavailable. This approval is recorded only; it cannot run later.'
          : action === 'pause'
            ? 'Request a controlled pause. Check the AMR reply and new readings afterward.'
            : 'Request half of the current controller speed limit. Check the observed response afterward.';
    text('human-review-action-help', description);
    const button = $('human-review-form').querySelector('button[value="approve"]');
    button.textContent =
      action === 'no_action'
        ? 'Save review'
        : !current?.demo && !current?.commands_enabled
          ? 'Record approval only'
          : action === 'pause'
            ? 'Approve pause request'
            : 'Approve speed reduction';
  }
  function updateDecision() {
    if (!current) return;
    const row = current.review,
      allow = mayDecide(),
      reason = $('human-review-reason').value.trim().length > 0;
    $('human-review-create').disabled = !access() || !current.eligible || active();
    $('human-review-create').hidden = active();
    $('human-review-form').hidden = !(access() && owns() && row?.state === 'pending' && !expired());
    for (const button of $('human-review-form').querySelectorAll('button[type="submit"]'))
      button.disabled = !allow || !reason || (button.value === 'approve' && !current.eligible);
    const clock = $('human-review-review-clock');
    clock.hidden = row?.state !== 'pending';
    text(
      'human-review-review-clock',
      expired()
        ? 'This review timed out. Start a new review.'
        : Number.isFinite(row?.expires_at)
          ? 'Decide within ' +
            Math.max(0, Math.ceil(row.expires_at - Date.now() / 1000)) +
            ' seconds.'
          : 'The server checks the review deadline.',
    );
    actionHelp();
    if (expired()) {
      text('human-review-state', 'Review timed out');
      text(
        'human-review-summary-detail',
        'Capture the latest recommendation before making another decision.',
      );
      text('human-review-action-title', 'Start a new review');
      text(
        'human-review-next-action',
        'The previous proposal expired. Your next review will capture current readings.',
      );
    }
  }
  function missingSteps() {
    const missing = current.missing || [],
      steps = [];
    if (missing.some((s) => /calibration/i.test(s)))
      steps.push([
        'Confirm measured sensor calibration',
        'Use measured wheel, IMU and battery settings. Open the checklist below for what to measure.',
      ]);
    if (
      missing.some((s) => /EMQX|subscriber|connection enabled|writer|database connection/i.test(s))
    )
      steps.push([
        'Check the sensor connection',
        'Power the ESP32 and check that fresh physical readings reach the database.',
      ]);
    if (missing.some((s) => /operator access code/i.test(s)))
      steps.push([
        'Finish private operator access setup',
        'The configured operator code protects physical decisions. Use it here once setup is ready.',
      ]);
    if (
      missing.some((s) => /audit|permission|service availability/i.test(s)) ||
      (!current.can_review && current.authorized)
    )
      steps.push([
        'Restore the review service',
        'The private decision log and review service must be available before a review can be recorded.',
      ]);
    if (!current.eligible && !steps.length) {
      const notice = payload?.notice,
        robot = payload?.robots?.amr01;
      steps.push([
        notice?.label || robot?.quality_label || 'Restore fresh, valid sensor readings',
        notice?.detail ||
          robot?.quality_detail ||
          'Check power, Wi-Fi and sensor continuity. A valid calibrated model sample is needed.',
      ]);
    }
    if (!current.demo && !current.authorized && current.can_unlock)
      steps.push([
        'Enable your operator session',
        'Enter your alias and private operator code in the decision card.',
      ]);
    return steps;
  }
  function summary() {
    const r = current.review;
    if (r && !expired()) {
      const descriptions = {
        pending: owns()
          ? 'Read the captured recommendation, choose a response and enter a reason.'
          : 'Another operator owns this review. You can follow its outcome here.',
        dispatching: 'The approved request is being sent. Wait for the AMR response.',
        sent: 'Delivery alone does not confirm that the AMR changed its operation.',
        acknowledged:
          'The controller reports the action applied. Fresh sensor readings must now confirm its effect.',
        reviewed: 'Your decision was recorded without sending a motor request.',
        rejected:
          r.ack?.status === 'rejected'
            ? 'The AMR rejected the request. Inspect the recorded response before another review.'
            : 'The decision was recorded without requesting an intervention.',
        deferred: 'No motor request was sent. Capture a new recommendation when you are ready.',
        expired: 'Capture current evidence before deciding again.',
        blocked:
          'The decision was recorded, but motor delivery was unavailable. Nothing is queued for later.',
        verified:
          'Three new sensor observations met the requested limit after the matching AMR response.',
        uncertain:
          'The requested effect has not been confirmed. Inspect the AMR and the recorded evidence before another decision.',
      };
      return [
        labels[r.state] || current.state_label,
        descriptions[r.state] || 'Check the recorded outcome below.',
      ];
    }
    if ((current.missing || []).some((s) => /calibration/i.test(s)))
      return [
        'Finish sensor calibration first',
        'Physical recommendations need measured wheel, IMU and battery settings. Follow the setup checklist or try a practice review.',
      ];
    if (!current.eligible)
      return [
        'Waiting for usable sensor readings',
        payload?.notice?.detail ||
          payload?.robots?.amr01?.quality_detail ||
          'Fresh, continuous and calibrated readings are required. Check the preparation steps below.',
      ];
    if (!current.demo && !current.can_unlock)
      return [
        'Complete the private review setup',
        'The connection and operator access setup must be ready before a physical decision can be recorded.',
      ];
    if (!current.demo && !current.authorized)
      return [
        'Enable your operator session',
        'The recommendation is ready. Enter your operator alias and private code to review it.',
      ];
    if (!current.demo && !current.can_review)
      return [
        'Review service unavailable',
        'Check the decision log and private review connection before trying again.',
      ];
    return [
      current.demo ? 'Ready for a practice review' : 'Ready for your review',
      'Start a review to capture this recommendation. You will choose the response in the next step.',
    ];
  }
  function nextAction() {
    const r = current.review;
    if (r?.state === 'pending' && owns() && access() && !expired())
      return [
        'Choose your response',
        current.eligible
          ? 'Keep operation unchanged, request a speed reduction or request a controlled pause.'
          : 'Fresh readings are unavailable. You can reject or defer; approval waits for valid evidence.',
      ];
    if (r && active())
      return [
        owns() ? 'Follow the result' : 'View this operator’s review',
        current.demo
          ? 'Use the practice button below to simulate each response stage.'
          : 'Wait for the AMR reply and follow-up sensor check.',
      ];
    if (!current.demo && !current.authorized && current.can_unlock)
      return [
        'Enable operator review',
        'Your alias labels this decision. The private code protects physical control.',
      ];
    if (!current.demo && !current.can_unlock)
      return [
        'Prepare the physical AMR',
        'Complete the steps on the left. To learn the decision flow now, use a practice review.',
      ];
    if (!current.eligible || (!current.demo && !current.can_review))
      return [
        'Restore review readiness',
        'Complete the preparation steps. The review button becomes available when the required evidence and service are ready.',
      ];
    return [
      r ? 'Start a new review' : 'Start your review',
      r
        ? 'Capture the latest recommendation; previous approvals are never reused.'
        : 'Capture this recommendation first, then choose and confirm your response.',
    ];
  }
  function recommendations() {
    const row = current.review,
      items = row?.evidence?.recommendations || current.recommendations || [];
    $('human-review-recommendation-card').hidden = !items.length;
    const signature = JSON.stringify(items),
      list = $('human-review-recommendations');
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      list.replaceChildren(
        ...items.map((item) => {
          const card = document.createElement('div'),
            title = document.createElement('strong'),
            detail = document.createElement('p');
          title.textContent = item.title;
          detail.textContent = item.detail || '';
          card.append(title, detail);
          return card;
        }),
      );
    }
    text(
      'human-review-captured-note',
      row
        ? 'Captured recommendation for this review. New readings do not silently replace it.'
        : 'This is the current guidance. Starting a review captures its sensor context.',
    );
  }
  function resultChecks() {
    const r = current.review;
    $('human-review-result').hidden = !r || r.state === 'pending';
    if (!r) return;
    const noRequest = !r.command,
      verified = r.state === 'verified';
    text(
      'human-review-result-title',
      verified ? 'Observed effect confirmed' : 'Request and observed response',
    );
    const values = [
      [
        'Request',
        noRequest
          ? r.state === 'blocked'
            ? 'Not delivered'
            : 'No command sent'
          : r.state === 'dispatching'
            ? 'Sending'
            : r.state === 'uncertain' && r.ack?.status !== 'applied'
              ? 'Delivery unconfirmed'
              : 'Sent',
      ],
      [
        'AMR response',
        r.ack?.status === 'applied'
          ? 'Reported applied'
          : r.ack?.status === 'rejected'
            ? 'Rejected by AMR'
            : noRequest
              ? 'Not required'
              : 'Waiting for reply',
      ],
      [
        'Sensor check',
        noRequest ? 'Not started' : String(r.verified_samples || 0) + ' of 3 qualifying readings',
      ],
    ];
    $('human-review-result-checks').replaceChildren(
      ...values.flatMap(([label, value]) => {
        const dt = document.createElement('dt'),
          dd = document.createElement('dd');
        dt.textContent = label;
        dd.textContent = value;
        return [dt, dd];
      }),
    );
    text(
      'human-review-result-note',
      current.demo
        ? 'Practice result only. No device was contacted.'
        : verified
          ? 'The sensors confirmed the requested limit. This does not identify the cause of any fault.'
          : 'An AMR reply and fresh sensor confirmation are separate checks.',
    );
  }
  function render(value) {
    if (!$('human-review') || !value?.human_review) return;
    payload = value;
    current = value.human_review;
    if (lastReviewId !== current.review?.review_id || lastDemo !== current.demo) {
      $('human-review-reason').value = '';
      $('human-review-action').value = 'no_action';
    }
    lastReviewId = current.review?.review_id;
    lastDemo = current.demo;
    const row = current.review;
    $('human-review').hidden = false;
    text('human-review-source', current.demo ? 'Practice · demo data' : 'Physical AMR');
    $('human-review-source').dataset.demo = String(!!current.demo);
    text('human-review-feedback', current.feedback);
    $('human-review-feedback').hidden = !current.feedback;
    $('human-review-controls').hidden = !access();
    $('human-review-auth').hidden = !!(current.demo || current.authorized || !current.can_unlock);
    $('human-review-demo-note').hidden = !current.demo;
    $('human-review-lock').hidden = !!(current.demo || !current.authorized);
    $('human-review-login').querySelector('button').disabled = !current.can_unlock;
    $('human-review-physical').hidden = !!current.demo;
    text(
      'human-review-delivery-note',
      current.commands_enabled
        ? 'Motor requests are enabled. Each request still needs current evidence and a separate result check.'
        : 'Motor requests are unavailable. A saved decision cannot queue a command for later.',
    );
    $('human-review-delivery-note').hidden = !access();
    const [title, description] = summary();
    text('human-review-state', title);
    text('human-review-summary-detail', description);
    $('human-review-summary').dataset.kind =
      row?.state === 'verified'
        ? 'success'
        : ['uncertain', 'blocked', 'expired'].includes(row?.state) || !current.eligible
          ? 'warning'
          : 'neutral';
    const [actionTitle, actionDetail] = nextAction();
    text('human-review-action-title', actionTitle);
    text('human-review-next-action', actionDetail);
    const steps = current.demo ? [] : missingSteps();
    $('human-review-preparation').hidden = !steps.length;
    const signature = JSON.stringify(steps),
      checklist = $('human-review-checklist');
    if (checklist.dataset.signature !== signature) {
      checklist.dataset.signature = signature;
      checklist.replaceChildren(
        ...steps.map(([heading, body]) => {
          const li = document.createElement('li'),
            h = document.createElement('strong'),
            p = document.createElement('p');
          h.textContent = heading;
          p.textContent = body;
          li.append(h, p);
          return li;
        }),
      );
    }
    $('human-review-calibration-help').hidden = !(current.missing || []).some((s) =>
      /calibration/i.test(s),
    );
    const stage = row
      ? row.state === 'pending' && !expired()
        ? 2
        : 3
      : current.demo || (current.authorized && current.eligible && current.can_review)
        ? 2
        : 1;
    for (let i = 1; i <= 3; i++) {
      const item = $('human-review-step-' + i);
      item.dataset.state = i < stage ? 'done' : i === stage ? 'current' : 'waiting';
      if (i === stage) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
    text('human-review-create', row ? 'Start a new review' : 'Review this recommendation');
    $('human-review-response').hidden =
      !current.demo || !['sent', 'acknowledged'].includes(row?.state);
    text(
      'human-review-response',
      row?.state === 'acknowledged' ? 'Simulate 3 fresh readings' : 'Simulate AMR reply',
    );
    $('human-review-practice').hidden = !!current.demo;
    $('human-review-live').hidden = !current.demo;
    $('human-review-connection').hidden = !!current.demo || (current.eligible && access());
    recommendations();
    resultChecks();
    updateDecision();
    text(
      'human-review-evidence',
      row
        ? 'Review ' +
            row.review_id.slice(0, 8) +
            ' · source sample ' +
            row.evidence.seq +
            ' · ' +
            (row.evidence.source === 'demo' ? 'generated evidence' : 'physical evidence')
        : 'No recommendation has been captured for a review.',
    );
    text(
      'human-review-availability',
      current.missing?.length
        ? 'Physical setup needs: ' + current.missing.join(' · ')
        : current.commands_enabled
          ? 'Physical command delivery enabled; evidence and response checks still apply.'
          : 'Physical command delivery disabled.',
    );
    text('human-review-server-detail', current.detail);
    const events = JSON.stringify(row?.events || []);
    if (lastEvents !== events) {
      lastEvents = events;
      $('human-review-events').replaceChildren(
        ...(row?.events || []).map((event) => {
          const li = document.createElement('li'),
            label = document.createElement('strong'),
            detail = document.createElement('span');
          label.textContent = event.state.replaceAll('_', ' ');
          detail.textContent = event.detail;
          li.append(label, detail);
          return li;
        }),
      );
    }
    $('human-review-log').hidden = !row;
  }
  function bind() {
    const root = $('human-review');
    if (!root || root.dataset.initialized === 'true') return;
    root.dataset.initialized = 'true';
    $('human-review-login').addEventListener('submit', (event) => {
      event.preventDefault();
      if (current?.demo || !current?.can_unlock) return;
      const code = $('human-review-code');
      send({
        command: 'login',
        access_code: code.value,
        operator: $('human-review-operator').value,
      });
      code.value = '';
    });
    $('human-review-lock').addEventListener('click', () => {
      if (current?.authorized && !current.demo) send({ command: 'logout' });
    });
    $('human-review-create').addEventListener('click', () => {
      if (access() && current.eligible && !active()) send({ command: 'create' });
    });
    $('human-review-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const decision = event.submitter?.value || 'approve';
      if (
        !mayDecide() ||
        !['approve', 'reject', 'defer'].includes(decision) ||
        !$('human-review-reason').value.trim() ||
        (decision === 'approve' && !current.eligible)
      )
        return;
      send({
        command: 'decide',
        review_id: current.review.review_id,
        decision,
        intervention: $('human-review-action').value,
        reason: $('human-review-reason').value,
      });
    });
    $('human-review-action').addEventListener('change', updateDecision);
    $('human-review-reason').addEventListener('input', updateDecision);
    $('human-review-response').addEventListener('click', () => {
      if (current?.demo && ['sent', 'acknowledged'].includes(current.review?.state))
        send({ command: 'response', review_id: current.review.review_id });
    });
    $('human-review-connection').addEventListener('click', () => $('tab-connection')?.click());
    $('human-review-practice').addEventListener('click', () =>
      emit({ action: 'sensor_source', mode: 'demo' }),
    );
    $('human-review-live').addEventListener('click', () =>
      emit({ action: 'sensor_source', mode: 'live' }),
    );
    document.addEventListener('python-twin:render', (event) => render(event.detail));
    timer = window.setInterval(updateDecision, 500);
    window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
    document.dispatchEvent(new CustomEvent('python-twin:ready'));
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
