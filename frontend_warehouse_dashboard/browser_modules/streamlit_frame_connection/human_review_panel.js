/* Human review display. Physical approval is only through the LabVIEW gateway. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let current, lastEvents;
  const text = (id, value) => {
    if ($(id)) $(id).textContent = String(value || '');
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
    $('human-review-demo').hidden = !current.demo;
    $('human-review-physical').hidden = current.demo;
    const active =
      row &&
      !['reviewed', 'rejected', 'deferred', 'expired', 'blocked', 'verified', 'uncertain'].includes(
        row.state,
      );
    $('human-review-create').disabled = !current.demo || !current.eligible || Boolean(active);
    $('human-review-form').hidden = !current.demo || row?.state !== 'pending';
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
    $('human-review-create')?.addEventListener('click', () => send({ command: 'create' }));
    $('human-review-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!current?.demo || current.review?.state !== 'pending') return;
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
