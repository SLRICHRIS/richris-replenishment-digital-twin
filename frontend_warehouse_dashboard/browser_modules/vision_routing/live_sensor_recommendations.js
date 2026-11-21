// Display server-computed recommendations. Choosing a response opens review;
// it never approves a decision or emits a motor command.
export function createLiveSensorRecommendations(scope, root) {
  if (!root) return null;
  const d = scope.document;
  root.innerHTML = `
    <section class="live-guidance" aria-labelledby="mc-guidance-title">
      <div class="pr-topline"><div><span class="twin-card-kicker">SENSOR EVIDENCE → YOUR DECISION</span><h3 id="mc-guidance-title">Live recommendations</h3></div><span id="mc-guidance-status" role="status">Waiting for live readings</span></div>
      <p id="mc-guidance-detail">Recommendations update from the stored ESP32 sensor stream.</p>
      <div id="mc-guidance-coverage" class="live-guidance-coverage"></div>
      <div id="mc-guidance-list" class="live-guidance-list"></div>
      <details><summary>Available responses and how they are applied</summary><div id="mc-guidance-actions" class="live-guidance-actions"></div><p>Record your decision in Review &amp; decide. Apply movement and power changes using the direct controller; inspection, charging and calibration are physical tasks. Fresh readings support follow-up, but do not prove a physical task was completed.</p></details>
    </section>`;
  const el = (id) => d.getElementById('mc-guidance-' + id);
  let payload = null,
    receivedAt = 0,
    signature = '',
    destroyed = false;
  const clock = () => scope.performance.now();
  function openReview(action) {
    if (!live()) return;
    d.dispatchEvent(new scope.CustomEvent('human-review:open', { detail: { action } }));
  }
  function live() {
    const physical = payload?.physical_telemetry;
    return (
      payload?.mode === 'live' &&
      physical?.fresh === true &&
      Number.isFinite(physical.age_s) &&
      physical.age_s >= -1 &&
      physical.age_s + Math.max(0, clock() - receivedAt) / 1000 <= 5
    );
  }
  function render(value) {
    if (value) {
      payload = value;
      receivedAt = clock();
    }
    if (destroyed) return;
    const current = live();
    const source = payload?.insights?.sensor_checks || payload?.insights;
    const insight = current && source?.scope === 'physical_observation' ? source : null;
    const age = payload?.physical_telemetry?.age_s;
    el('status').textContent = current
      ? `Packet age ${Math.max(0, age + (clock() - receivedAt) / 1000).toFixed(1)} s`
      : payload?.mode === 'demo'
        ? 'Physical readings required'
        : 'Live feed unavailable';
    const catalog = payload?.mode === 'live' ? source?.actions || [] : [];
    const nextSignature = JSON.stringify([
      current,
      payload?.mode,
      insight,
      catalog,
      payload?.human_review?.observation_only,
    ]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    el('coverage').replaceChildren();
    el('list').replaceChildren();
    el('actions').replaceChildren();
    const actions = new Map(catalog.map((item) => [item.id, item]));
    for (const action of actions.values()) {
      const card = d.createElement('div'),
        title = d.createElement('strong'),
        detail = d.createElement('p');
      title.textContent = action.label;
      detail.textContent = action.detail;
      card.append(title, detail);
      el('actions').append(card);
    }
    if (!insight) {
      el('detail').textContent =
        payload?.mode === 'demo'
          ? 'Select physical sensor data for live AMR recommendations. Practice readings do not describe the robot.'
          : 'Fresh live evidence is unavailable. Check ESP32 power, Wi-Fi and sensor forwarding before reviewing a recommendation.';
      return;
    }
    const summary = insight.summary || {};
    el('detail').textContent =
      `${summary.stop || 0} stop-and-check · ${summary.check || 0} other checks · ${summary.covered || 0} of ${summary.total || 6} sensor areas available. Checks use the current sample and up to 30 seconds of history.`;
    for (const item of insight.coverage || []) {
      const card = d.createElement('div'),
        title = d.createElement('strong'),
        detail = d.createElement('span');
      card.dataset.state = item.state === 'available' ? 'available' : 'unavailable';
      title.textContent = item.category;
      detail.textContent = item.detail;
      card.append(title, detail);
      el('coverage').append(card);
    }
    for (const item of insight.recommendations || []) {
      const card = d.createElement('article'),
        category = d.createElement('span'),
        title = d.createElement('h4'),
        detail = d.createElement('p'),
        evidence = d.createElement('p'),
        button = d.createElement('button');
      card.dataset.priority = ['stop', 'check', 'info'].includes(item.priority)
        ? item.priority
        : 'info';
      category.className = 'live-guidance-category';
      category.textContent = `${item.category || 'Sensor check'} · ${item.priority === 'stop' ? 'Stop and check' : item.priority === 'check' ? 'Check' : 'Monitor'}`;
      title.textContent = item.title;
      detail.textContent = item.detail;
      evidence.className = 'live-guidance-evidence';
      evidence.textContent = [item.basis, ...(item.evidence || [])].filter(Boolean).join(' · ');
      button.type = 'button';
      button.textContent =
        payload?.human_review?.observation_only === false
          ? 'Open operator review'
          : 'Review: ' + (actions.get(item.action)?.label || 'Inspect the AMR');
      button.addEventListener('click', () => openReview(item.action || 'inspect'));
      card.append(category, title, detail, evidence, button);
      el('list').append(card);
    }
  }
  const receive = (event) => render(event.detail);
  d.addEventListener('python-twin:render', receive);
  const timer = scope.setInterval(() => render(), 500);
  render();
  return {
    render,
    destroy() {
      destroyed = true;
      scope.clearInterval(timer);
      d.removeEventListener('python-twin:render', receive);
      root.replaceChildren();
    },
  };
}
