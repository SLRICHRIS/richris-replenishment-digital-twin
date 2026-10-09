/* © 2026 S L RICHRIS. All rights reserved. Educational use only.
 * Minimal Streamlit component handshake; the digital twin owns its UI/state.
 */
(() => {
  'use strict';
  if (window.parent === window) return;

  // Streamlit serves this component on its own origin. Do not accept arbitrary
  // window messages, reflect parent arguments into HTML, or send telemetry to
  // Python. MQTT credentials remain in the existing browser-only connection UI.
  const origin = window.location.origin;
  const send = (type, detail = {}) => window.parent.postMessage({
    isStreamlitMessage: true,
    type,
    ...detail,
  }, origin);

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
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== origin) return;
    if (event.data?.type === 'streamlit:render') scheduleFit();
  });
  window.addEventListener('resize', scheduleFit);
  try {
    window.parent.addEventListener('resize', scheduleFit);
    window.parent.visualViewport?.addEventListener('resize', scheduleFit);
    window.addEventListener('pagehide', () => {
      window.parent.removeEventListener('resize', scheduleFit);
      window.parent.visualViewport?.removeEventListener('resize', scheduleFit);
    }, { once: true });
  } catch {}
  send('streamlit:componentReady', { apiVersion: 1 });
  scheduleFit();
})();
