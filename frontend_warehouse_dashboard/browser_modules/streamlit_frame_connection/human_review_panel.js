/* Website decisions go through the authenticated Python service. No browser MQTT. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let current, lastEvents;
  const text = (id, value) => {
    if ($(id) && $(id).textContent !== String(value || '')) $(id).textContent = String(value || '');
  };
  function send(detail) {
    document.dispatchEvent(
      new CustomEvent('python-twin:action', {
        detail: { action: 'human_review', ...detail },
      }),
    );
  }
  function render(payload) {
    if (!$('human-review') || !payload.human_review) return;
    const previousId = current?.review?.review_id;
    current = payload.human_review;
    if (previousId !== current.review?.review_id) $('human-review-reason').value = '';
    const row = current.review;
    $('human-review').hidden = false;
    text('human-review-source', current.source);
    text('human-review-detail', current.detail);
    text('human-review-state', (current.demo && row ? 'Demo · ' : '') + current.state_label);
    text('human-review-feedback', current.feedback);
    $('human-review-feedback').hidden = !current.feedback;
    $('human-review-controls').hidden = !current.demo && !current.authorized;
    $('human-review-auth').hidden = current.demo || current.authorized || !current.can_unlock;
    $('human-review-demo-note').hidden = !current.demo;
    $('human-review-lock').hidden = current.demo || !current.authorized;
    $('human-review-login').querySelector('button').disabled = !current.can_unlock;
    text(
      'human-review-availability',
      current.missing?.length
        ? 'Physical review needs: ' + current.missing.join(' · ')
        : current.commands_enabled
          ? 'Physical delivery is enabled. Every approval still requires fresh evidence, a matching device response and new sensor readings.'
          : 'Physical command delivery is disabled until the ESP32 receiver is commissioned. You can record a review; an approval cannot queue a future command.',
    );
    $('human-review-physical').hidden = current.demo;
    const active =
      row &&
      !['reviewed', 'rejected', 'deferred', 'expired', 'blocked', 'verified', 'uncertain'].includes(
        row.state,
      );
    $('human-review-create').disabled =
      (!current.demo && (!current.authorized || !current.can_review)) ||
      !current.eligible ||
      Boolean(active);
    $('human-review-form').hidden =
      (!current.demo && (!current.authorized || !current.owns_review || !current.can_review)) ||
      row?.state !== 'pending';
    $('human-review-response').hidden =
      !current.demo || !['sent', 'acknowledged'].includes(row?.state);
    text(
      'human-review-response',
      row?.state === 'acknowledged'
        ? 'Simulate new sensor readings'
        : 'Simulate controller acknowledgement',
    );
    text(
      'human-review-evidence',
      row
        ? `Review ${row.review_id.slice(0, 8)} · source sample ${row.evidence.seq} · ${row.evidence.source === 'demo' ? 'generated evidence' : 'physical evidence'}`
        : 'A review captures the recommendation and its exact sensor context.',
    );
    text(
      'human-review-recommendations',
      (row?.evidence.recommendations || current.recommendations || [])
        .map((r) => r.title)
        .join(' · '),
    );
    const events = JSON.stringify(row?.events || []);
    if (lastEvents !== events) {
      lastEvents = events;
      const list = $('human-review-events');
      list.replaceChildren();
      for (const event of row?.events || []) {
        const li = document.createElement('li');
        const label = document.createElement('strong');
        label.textContent = event.state.replaceAll('_', ' ');
        const detail = document.createElement('span');
        detail.textContent = event.detail;
        li.append(label, detail);
        list.append(li);
      }
    }
    $('human-review-log').hidden = !row;
  }
  function bind() {
    $('human-review-login')?.addEventListener('submit', (event) => {
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
    $('human-review-lock')?.addEventListener('click', () => send({ command: 'logout' }));
    $('human-review-create')?.addEventListener('click', () => {
      if (current?.eligible && (current.demo || (current.authorized && current.can_review)))
        send({ command: 'create' });
    });
    $('human-review-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (
        !current ||
        current.review?.state !== 'pending' ||
        (!current.demo && (!current.authorized || !current.owns_review || !current.can_review))
      )
        return;
      const decision = event.submitter?.value || 'approve';
      send({
        command: 'decide',
        review_id: current.review.review_id,
        decision,
        intervention: $('human-review-action').value,
        reason: $('human-review-reason').value,
      });
    });
    $('human-review-response')?.addEventListener('click', () => {
      if (current?.demo && ['sent', 'acknowledged'].includes(current.review?.state))
        send({ command: 'response', review_id: current.review.review_id });
    });
    document.addEventListener('python-twin:render', (event) => render(event.detail));
    document.dispatchEvent(new CustomEvent('python-twin:ready'));
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
