/* Connection controls and Python-computed guidance; no credentials are persisted in the browser. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let latest,
    connectionOpen = false,
    authorized = false;
  const text = (id, value) => {
    if ($(id)) $(id).textContent = value;
  };
  const action = (detail) =>
    document.dispatchEvent(new CustomEvent('python-twin:action', { detail }));
  function list(id, entries, tag, build) {
    const root = $(id);
    if (!root) return;
    const signature = JSON.stringify(entries);
    if (root.dataset.signature === signature) return;
    root.dataset.signature = signature;
    root.replaceChildren(
      ...entries.map((entry) => {
        const node = document.createElement(tag);
        build(node, entry);
        return node;
      }),
    );
  }
  function guidance(data, prefix) {
    if (!data) return;
    list(prefix + '-recommendations', data.recommendations || [], 'article', (node, item) => {
      node.dataset.tone = ['info', 'warning', 'success'].includes(item.tone) ? item.tone : 'info';
      const title = document.createElement('h4'),
        detail = document.createElement('p');
      title.textContent = item.title;
      detail.textContent = item.detail;
      node.append(title, detail);
    });
    if (prefix === 'amr-live') {
      $('amr-insights-empty').hidden = Boolean(data.ready);
      list('amr-live-metrics', data.metrics || [], 'article', (node, item) => {
        const label = document.createElement('span'),
          value = document.createElement('strong'),
          detail = document.createElement('p');
        label.textContent = item.label;
        value.textContent = item.value;
        detail.textContent = item.detail;
        node.append(label, value, detail);
      });
    } else text('amr-model-source', data.source || 'Source unavailable');
  }
  function render(payload) {
    if (!$('amr-link-form')) {
      latest = payload;
      return;
    }
    guidance(payload.insights, 'amr-model');
    const link = payload.amr_connection;
    if (!link) return;
    authorized = link.authorized === true;
    const busy =
      link.running === true || ['connecting', 'subscribed', 'disconnecting'].includes(link.state);
    const labels = {
      disconnected: 'Disconnected',
      connecting: 'Connecting',
      subscribed: 'EMQX subscribed',
      disconnecting: 'Disconnecting',
      error: 'Connection needs attention',
    };
    text(
      'amr-link-state',
      !link.configured
        ? 'Optional recorder unavailable'
        : labels[link.state] || 'Status unavailable',
    );
    $('amr-link-state').dataset.state = link.subscribed ? 'ready' : 'waiting';
    text(
      'amr-link-detail',
      !link.configured
        ? (link.missing || []).some((item) => /calibration/i.test(item))
          ? 'This optional recorder requires measured calibration. Existing commissioning telemetry and direct Wi-Fi control work independently.'
          : 'Complete the private setup only if this optional recorder is needed. Existing forwarding is separate.'
        : link.detail || 'Waiting for connection status.',
    );
    text('amr-link-feedback', link.feedback || '');
    $('amr-link-feedback').hidden = !link.feedback;
    $('amr-link-form').setAttribute('aria-busy', 'false');
    $('amr-link-connect').disabled = !link.configured || busy;
    $('amr-link-connect').textContent =
      link.state === 'connecting'
        ? 'Connecting…'
        : link.state === 'subscribed'
          ? 'Connected to EMQX'
          : 'Start optional recorder';
    $('amr-link-disconnect').disabled = !authorized || !busy || link.state === 'disconnecting';
    // Code entry does not authorize a connection; the protected submit path still checks readiness.
    $('amr-access-code').disabled = busy;
    $('amr-code-field').hidden = authorized;
    list('amr-setup-missing', link.missing || [], 'li', (node, value) => {
      node.textContent = value;
    });
    list('amr-pipeline', link.stages || [], 'li', (node, stage) => {
      node.dataset.state = ['ready', 'blocked', 'waiting'].includes(stage.state)
        ? stage.state
        : 'waiting';
      const label = document.createElement('strong'),
        detail = document.createElement('span');
      label.textContent = stage.label;
      detail.textContent = stage.detail;
      node.append(label, detail);
    });
    guidance(link.insights, 'amr-live');
  }
  document.addEventListener('python-twin:render', (event) => render(event.detail));
  function bind() {
    document.addEventListener('python-twin:connection-open', () => {
      if (connectionOpen) return;
      connectionOpen = true;
      action({ action: 'connection_view', active: true });
    });
    document.addEventListener('python-twin:connection-close', () => {
      if (!connectionOpen) return;
      connectionOpen = false;
      action({ action: 'connection_view', active: false });
    });
    $('amr-link-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      if ($('amr-link-connect').disabled) return;
      const access_code = authorized ? '' : $('amr-access-code').value;
      $('amr-access-code').value = '';
      $('amr-link-form').setAttribute('aria-busy', 'true');
      action({ action: 'connection_control', command: 'connect', access_code });
    });
    $('amr-link-disconnect')?.addEventListener('click', () => {
      if (!$('amr-link-disconnect').disabled)
        action({ action: 'connection_control', command: 'disconnect', access_code: '' });
    });
    if (latest) {
      render(latest);
      latest = null;
    }
    document.dispatchEvent(new CustomEvent('python-twin:ready'));
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
