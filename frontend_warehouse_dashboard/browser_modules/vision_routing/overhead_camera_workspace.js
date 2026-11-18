import {
  ARENA,
  clearanceRadius,
  expandedObstacles,
  normalizeObstacles,
  normalizePoint,
  normalizeSettings,
  planRoute,
} from './a0_route_preview.js';

// This workspace deliberately has no MQTT, fetch, command or production-review bridge.
export function createVisionWorkspace(scope) {
  const d = scope.document;
  const root = d.getElementById('vision-workspace');
  if (!root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const el = (id) => d.getElementById(`vision-${id}`);
  const storageKey = 'amr01.visionSetup.v2';
  // Operator-reported dimensions are planning defaults, never execution authorization.
  const reportedMeasurements = {
    robotLengthMm: 180,
    robotWidthMm: 150,
    robotHeightMm: 150,
    markerHeightMm: 150,
    markerSizeMm: 40,
    cameraHeightCm: 92,
  };
  const reportedMarkerOffset = {
    reference: 'wheel-axle-midpoint',
    forwardMm: 100,
    leftMm: 0,
    source: 'operator-reported',
  };
  const settingsFields = {
    robotLengthMm: 'robot-length',
    robotWidthMm: 'robot-width',
    robotHeightMm: 'robot-height',
    markerHeightMm: 'marker-height',
    cameraHeightCm: 'camera-height',
    clearanceMm: 'clearance',
    markerSizeMm: 'marker-size',
    markerId: 'marker-id',
  };
  const state = {
    settings: normalizeSettings(reportedMeasurements),
    start: null,
    goal: null,
    obstacles: [],
    revision: 0,
    plan: null,
    decision: null,
    trail: [],
  };
  let settingsError = '',
    pointError = '',
    tool = 'start',
    drag = null;
  let stream = null,
    cameraGeneration = 0,
    stillUrl = null,
    destroyed = false;
  const listeners = [];
  const on = (target, name, callback) => {
    target.addEventListener(name, callback);
    listeners.push(() => target.removeEventListener(name, callback));
  };
  const feedback = (text) => {
    el('feedback').textContent = text;
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  try {
    const raw = JSON.parse(scope.localStorage.getItem(storageKey) || 'null');
    if (
      raw?.version === 2 &&
      raw.arena?.widthMm === ARENA.widthMm &&
      raw.arena?.heightMm === ARENA.heightMm
    ) {
      const savedSettings = normalizeSettings(raw.settings);
      for (const [key, value] of Object.entries(reportedMeasurements))
        if (savedSettings[key] === null) savedSettings[key] = value;
      const saved = {
        settings: savedSettings,
        start: normalizePoint(raw.start),
        goal: normalizePoint(raw.goal),
        obstacles: normalizeObstacles(raw.obstacles),
      };
      Object.assign(state, saved);
      el('save-status').textContent =
        'Saved browser setup restored. Every route needs a new rehearsal and review.';
    }
  } catch {
    el('save-status').textContent = 'Saved setup could not be read. Enter your measurements again.';
  }

  function svg(tag, attributes) {
    const node = d.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }
  function render() {
    let radius = null;
    try {
      if (!settingsError) radius = clearanceRadius(state.settings);
    } catch {
      /* Missing measurements. */
    }
    el('footprint-status').textContent = settingsError
      ? 'Check measurements'
      : radius === null
        ? 'Measurements required'
        : `${state.settings.robotLengthMm} × ${state.settings.robotWidthMm} mm · entered`;
    el('height-status').textContent =
      state.settings.cameraHeightCm === null
        ? 'Measurement required'
        : `${state.settings.cameraHeightCm} cm · entered`;
    const buffers = el('buffers'),
      obstacles = el('obstacles'),
      path = el('path'),
      points = el('points');
    [buffers, obstacles, path, points].forEach((group) => group.replaceChildren());
    if (radius !== null) {
      buffers.append(
        svg('rect', {
          x: radius,
          y: radius,
          width: Math.max(0, ARENA.widthMm - radius * 2),
          height: Math.max(0, ARENA.heightMm - radius * 2),
          class: 'vision-buffer',
        }),
      );
      expandedObstacles(state.obstacles, radius).forEach((r) =>
        buffers.append(svg('rect', { ...r, class: 'vision-buffer' })),
      );
    }
    state.obstacles.forEach((r) =>
      obstacles.append(svg('rect', { ...r, class: 'vision-obstacle' })),
    );
    if (state.plan?.points.length)
      path.append(
        svg('polyline', {
          points: state.plan.points.map((p) => `${p.x},${p.y}`).join(' '),
          class: 'vision-path',
        }),
      );
    for (const kind of ['start', 'goal']) {
      const p = state[kind];
      if (!p) continue;
      if (kind === 'start' && radius !== null)
        points.append(svg('circle', { cx: p.x, cy: p.y, r: radius, class: 'vision-footprint' }));
      points.append(svg('circle', { cx: p.x, cy: p.y, r: 13, class: `vision-${kind}` }));
    }
    el('route-length').textContent =
      state.plan?.lengthMm === null || !state.plan
        ? 'Unavailable'
        : `${(state.plan.lengthMm / 1000).toFixed(3)} m`;
    el('route-clearance').textContent =
      radius === null ? 'Footprint required' : `${radius.toFixed(1)} mm radius`;
    const canReview = Boolean(
      state.plan?.points.length && !state.decision && !settingsError && !pointError,
    );
    for (const action of ['approve', 'reject', 'hold']) el(action).disabled = !canReview;
    el('review-state').textContent = state.decision
      ? `${state.decision.label} · rehearsal`
      : state.plan?.points.length
        ? 'Awaiting review'
        : state.plan
          ? 'No route found'
          : 'No proposal';
    el('review-detail').textContent = state.decision
      ? `${state.decision.label} for this manual scene. This browser decision does not authorize or move the physical AMR.`
      : state.plan?.points.length
        ? 'Shortest route on the 10 mm grid for your drawn scene and conservative footprint. Check the route before recording a rehearsal decision.'
        : state.plan
          ? 'No grid route fits the entered robot and clearance. Change the drawn scene or choose another destination.'
          : 'Calculate a preview to compare the route with your drawn scene. Camera validation and robot execution are not enabled.';
    const trail = el('review-trail');
    trail.replaceChildren();
    for (const item of state.trail.slice(-8).reverse()) {
      const li = d.createElement('li');
      li.textContent = `${item.at} · ${item.label} · scene ${item.revision}${item.note ? ` · ${item.note}` : ''}`;
      trail.append(li);
    }
    if (!state.trail.length) {
      const li = d.createElement('li');
      li.textContent = 'No decisions recorded in this tab.';
      trail.append(li);
    }
  }
  function invalidate(message) {
    const hadProposal = Boolean(state.plan);
    if (state.decision)
      state.trail.push({
        at: now(),
        label: 'Previous decision invalidated',
        revision: state.revision,
        note: '',
      });
    state.revision += 1;
    state.plan = null;
    state.decision = null;
    el('review-note').value = '';
    feedback(
      message ||
        (hadProposal
          ? 'Scene changed. Calculate a new route and review it again.'
          : 'Set a start, destination and drawn obstacles, then calculate a preview.'),
    );
    render();
    d.dispatchEvent(new scope.CustomEvent('vision:measurements'));
  }
  function writeFields() {
    for (const [key, id] of Object.entries(settingsFields))
      el(id).value = state.settings[key] ?? '';
    for (const kind of ['start', 'goal'])
      for (const axis of ['x', 'y']) el(`${kind}-${axis}`).value = state[kind]?.[axis] ?? '';
  }
  function readSettings() {
    try {
      const input = {};
      for (const [key, id] of Object.entries(settingsFields))
        input[key] = el(id).value === '' ? null : Number(el(id).value);
      // A deliberately blank margin/ID is invalid, rather than a silent default.
      if (input.clearanceMm === null || input.markerId === null)
        throw Error('Enter planning clearance and a planned marker ID.');
      const next = normalizeSettings(input);
      const changed = settingsError || JSON.stringify(next) !== JSON.stringify(state.settings);
      settingsError = '';
      state.settings = next;
      if (changed) invalidate();
      return true;
    } catch (error) {
      settingsError = error.message;
      invalidate(error.message);
      return false;
    }
  }
  for (const id of Object.values(settingsFields)) on(el(id), 'input', readSettings);
  for (const kind of ['start', 'goal'])
    for (const axis of ['x', 'y']) {
      on(el(`${kind}-${axis}`), 'input', () => {
        pointError = '';
        for (const pointKind of ['start', 'goal']) {
          try {
            const x = el(`${pointKind}-x`).value,
              y = el(`${pointKind}-y`).value;
            state[pointKind] =
              x === '' || y === '' ? null : normalizePoint({ x: Number(x), y: Number(y) });
          } catch (error) {
            state[pointKind] = null;
            pointError = error.message;
          }
        }
        invalidate(pointError || undefined);
      });
      on(el(`${kind}-${axis}`), 'change', () => {
        if (state[kind])
          for (const coordinate of ['x', 'y'])
            el(`${kind}-${coordinate}`).value = state[kind][coordinate];
      });
    }
  for (const kind of ['start', 'goal', 'obstacle'])
    on(el(`tool-${kind}`), 'click', () => {
      tool = kind;
      for (const candidate of ['start', 'goal', 'obstacle'])
        el(`tool-${candidate}`).setAttribute('aria-pressed', String(candidate === tool));
      feedback(
        kind === 'obstacle'
          ? 'Drag a rectangle to mark an obstacle in the manual scene.'
          : `Click the floor to set the ${kind === 'start' ? 'robot start' : 'destination'}.`,
      );
    });
  function mapPoint(event) {
    const box = el('map').getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      x: Math.max(
        0,
        Math.min(ARENA.widthMm, ((event.clientX - box.left) / box.width) * ARENA.widthMm),
      ),
      y: Math.max(
        0,
        Math.min(
          ARENA.heightMm,
          ARENA.heightMm - ((event.clientY - box.top) / box.height) * ARENA.heightMm,
        ),
      ),
    };
  }
  on(el('map'), 'pointerdown', (event) => {
    if (event.button !== 0) return;
    const p = mapPoint(event);
    if (!p) return;
    event.preventDefault();
    if (tool === 'obstacle') {
      drag = { from: p, pointerId: event.pointerId };
      el('map').setPointerCapture?.(event.pointerId);
    } else {
      state[tool] = normalizePoint(p);
      for (const axis of ['x', 'y']) el(`${tool}-${axis}`).value = state[tool][axis];
      el(`${tool}-x`).dispatchEvent(new scope.Event('input'));
    }
  });
  function dragRect(p) {
    return {
      x: Math.min(p.x, drag.from.x),
      y: Math.min(p.y, drag.from.y),
      width: Math.abs(p.x - drag.from.x),
      height: Math.abs(p.y - drag.from.y),
    };
  }
  on(el('map'), 'pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const p = mapPoint(event);
    if (p) el('drag').replaceChildren(svg('rect', { ...dragRect(p), class: 'vision-drag' }));
  });
  on(el('map'), 'pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const p = mapPoint(event),
      rectangle = p ? dragRect(p) : null;
    drag = null;
    el('drag').replaceChildren();
    el('map').releasePointerCapture?.(event.pointerId);
    if (!rectangle || rectangle.width < 10 || rectangle.height < 10) {
      feedback('Draw an obstacle at least 10 × 10 mm.');
      return;
    }
    try {
      state.obstacles = normalizeObstacles([...state.obstacles, rectangle]);
      invalidate();
    } catch (error) {
      feedback(error.message);
    }
  });
  on(el('map'), 'pointercancel', () => {
    drag = null;
    el('drag').replaceChildren();
  });
  on(el('clear-obstacles'), 'click', () => {
    state.obstacles = [];
    invalidate('Drawn obstacles cleared. Calculate a new proposal before reviewing.');
  });
  on(el('add-obstacle'), 'click', () => {
    try {
      const rectangle = {};
      for (const key of ['x', 'y', 'width', 'height']) {
        if (el(`obstacle-${key}`).value === '')
          throw Error('Enter the obstacle X, Y, width and height.');
        rectangle[key] = Number(el(`obstacle-${key}`).value);
      }
      state.obstacles = normalizeObstacles([...state.obstacles, rectangle]);
      invalidate('Obstacle added to the manual scene. Calculate a new proposal.');
    } catch (error) {
      feedback(error.message);
    }
  });
  on(el('undo-obstacle'), 'click', () => {
    if (!state.obstacles.length) {
      feedback('There are no drawn obstacles to remove.');
      return;
    }
    state.obstacles.pop();
    invalidate('Last obstacle removed. Calculate a new proposal.');
  });
  on(el('plan'), 'click', () => {
    if (!readSettings() || pointError) {
      feedback(settingsError || pointError);
      return;
    }
    if (state.decision)
      state.trail.push({
        at: now(),
        label: 'Previous decision invalidated',
        revision: state.revision,
        note: 'New calculation',
      });
    state.decision = null;
    state.plan = null;
    try {
      state.plan = { ...planRoute(state), revision: state.revision };
      feedback(
        state.plan.points.length
          ? 'Manual route preview ready. Review the route below; no command will be sent.'
          : 'No route fits the drawn scene with the entered footprint and clearance.',
      );
    } catch (error) {
      feedback(error.message);
    }
    render();
  });
  for (const [action, label] of [
    ['approve', 'Approved'],
    ['reject', 'Rejected'],
    ['hold', 'Held'],
  ])
    on(el(action), 'click', () => {
      if (
        !state.plan?.points.length ||
        state.decision ||
        state.plan.revision !== state.revision ||
        settingsError ||
        pointError
      )
        return;
      state.decision = {
        action,
        label,
        revision: state.revision,
        at: now(),
        note: el('review-note').value.trim().slice(0, 240),
        source: 'manual-rehearsal',
        executionEnabled: false,
      };
      state.trail.push(clone(state.decision));
      feedback(`${label} as a rehearsal only. The physical AMR has not been commanded.`);
      render();
    });
  const setup = () => ({
    version: 2,
    arena: ARENA,
    settings: state.settings,
    reportedMarkerOffset,
    start: state.start,
    goal: state.goal,
    obstacles: state.obstacles,
  });
  const snapshot = () =>
    clone({
      ...setup(),
      source: 'manual-rehearsal',
      revision: state.revision,
      plan: state.plan,
      decision: state.decision,
      trail: state.trail,
      cameraCalibration: 'pending',
      automaticDetection: 'not-connected',
      executionEnabled: false,
    });
  on(el('settings-form'), 'submit', (event) => {
    event.preventDefault();
    if (!readSettings() || pointError) {
      el('save-status').textContent = settingsError || pointError;
      return;
    }
    try {
      scope.localStorage.setItem(storageKey, JSON.stringify(setup()));
      el('save-status').textContent =
        'Setup saved in this browser. Unknown measurements remain blank; no images or approvals are saved.';
    } catch {
      el('save-status').textContent =
        'Browser storage is unavailable. Export the setup to keep a copy.';
    }
  });
  on(el('export'), 'click', () => {
    if (!readSettings() || pointError) {
      el('save-status').textContent = settingsError || pointError;
      return;
    }
    const file = new scope.Blob([JSON.stringify(snapshot(), null, 2)], {
      type: 'application/json',
    });
    const url = scope.URL.createObjectURL(file),
      a = d.createElement('a');
    a.href = url;
    a.download = 'AMR01_425x630_Camera_Setup_and_Rehearsal.json';
    d.body.append(a);
    a.click();
    a.remove();
    scope.setTimeout(() => scope.URL.revokeObjectURL(url), 1000);
    el('save-status').textContent =
      'Setup and rehearsal exported. No camera images or physical execution authorization included.';
  });

  function clearStill() {
    if (stillUrl) scope.URL.revokeObjectURL(stillUrl);
    stillUrl = null;
    el('still').removeAttribute('src');
    el('still').hidden = true;
  }
  function stopCamera(message = 'Preview stopped. Camera processing is not connected.') {
    cameraGeneration += 1;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    el('video').srcObject = null;
    el('video').hidden = true;
    el('camera-stop').disabled = true;
    el('camera-start').disabled = false;
    el('camera-empty').hidden = Boolean(stillUrl);
    el('camera-status').textContent = stillUrl ? 'Local still preview' : 'Not connected';
    el('camera-detail').textContent = message;
  }
  on(el('camera-start'), 'click', async () => {
    if (!scope.navigator.mediaDevices?.getUserMedia) {
      el('camera-detail').textContent =
        'Camera access is unavailable in this browser or embedded page. Preview a still frame instead.';
      return;
    }
    clearStill();
    stopCamera();
    const generation = cameraGeneration;
    el('camera-start').disabled = true;
    el('camera-stop').disabled = false;
    el('camera-status').textContent = 'Requesting camera';
    el('camera-detail').textContent =
      'Choose your USB camera in the browser permission dialog. Audio is not requested.';
    try {
      const received = await scope.navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      if (destroyed || generation !== cameraGeneration) {
        received.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = received;
      el('video').srcObject = stream;
      el('video').hidden = false;
      el('camera-empty').hidden = true;
      await el('video').play();
      if (generation !== cameraGeneration) return;
      el('camera-status').textContent = 'In-browser preview';
      el('camera-detail').textContent =
        'Local preview only. Frames are not uploaded, recorded or used for obstacle detection or route planning.';
      stream
        .getVideoTracks()
        .forEach((track) =>
          on(track, 'ended', () =>
            stopCamera('The camera stream ended. Restart the preview or select a still frame.'),
          ),
        );
    } catch (error) {
      if (generation !== cameraGeneration) return;
      stopCamera(
        error.name === 'NotAllowedError' || error.name === 'SecurityError'
          ? 'Camera permission was denied or blocked by the embedded page. Allow it in browser settings or preview a still frame.'
          : 'The camera could not start. Check that the USB camera is connected and not in use, or preview a still frame.',
      );
    }
  });
  on(el('camera-stop'), 'click', () => stopCamera());
  on(el('frame-file'), 'change', () => {
    const file = el('frame-file').files?.[0];
    if (!file) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      el('camera-detail').textContent = 'Choose a PNG, JPEG or WebP image no larger than 8 MB.';
      el('frame-file').value = '';
      return;
    }
    stopCamera();
    clearStill();
    stillUrl = scope.URL.createObjectURL(file);
    el('still').src = stillUrl;
    el('still').hidden = false;
    el('camera-empty').hidden = true;
    el('camera-status').textContent = 'Local still preview';
    el('camera-detail').textContent =
      'This image stays in your browser. It is not a calibrated scene or automatic obstacle detection.';
    el('frame-file').value = '';
  });
  on(el('still'), 'error', () => {
    clearStill();
    el('camera-empty').hidden = false;
    el('camera-status').textContent = 'Not connected';
    el('camera-detail').textContent =
      'This image could not be displayed. Choose another PNG, JPEG or WebP file.';
  });
  const observer = new scope.MutationObserver(() => {
    if (d.body.dataset.view !== 'vision' && (stream || el('camera-start').disabled))
      stopCamera('Preview stopped when you left Vision routing.');
  });
  observer.observe(d.body, { attributes: true, attributeFilter: ['data-view'] });
  on(d, 'vision-routing:mode', (event) => {
    if (event.detail?.mode !== 'practice' && (stream || el('camera-start').disabled))
      stopCamera('Preview stopped when you left Practice.');
  });
  on(scope, 'pagehide', () => {
    stopCamera();
    clearStill();
  });
  writeFields();
  render();
  return {
    snapshot,
    destroy() {
      destroyed = true;
      stopCamera();
      clearStill();
      observer.disconnect();
      listeners.forEach((remove) => remove());
      delete root.dataset.initialized;
    },
  };
}

if (typeof window !== 'undefined' && !document.getElementById('vision-routing-shell')) {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => createVisionWorkspace(window), {
      once: true,
    });
  else createVisionWorkspace(window);
}
