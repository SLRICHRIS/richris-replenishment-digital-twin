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
        document.dispatchEvent(new CustomEvent('python-twin:render', { detail: payload }));
      }
      scheduleFit();
    }
  });
  let actionSequence = 0;
  document.addEventListener('python-twin:action', (event) => {
    const action = event.detail;
    if (!action || !['sensor_source', 'model_inspection'].includes(action.action)) return;
    if (action.action === 'sensor_source' && !['demo', 'live'].includes(action.mode)) return;
    send('streamlit:setComponentValue', {
      value: {
        action: action.action,
        ...(action.action === 'sensor_source' ? { mode: action.mode } : {}),
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
  send('streamlit:componentReady', { apiVersion: 1 });
  scheduleFit();
})();
