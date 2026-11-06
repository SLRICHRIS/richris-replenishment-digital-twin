// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
import {
  TwinEngine,
  defaultProfile,
  checkedProfile,
  fitCalibration,
  referenceRecording,
  parseRecording,
  replayRecording,
  percentile,
  NOTICE,
} from './robot_state_estimation_calibration_and_replay.js';
import { SLOT_IDS } from '../esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness.js';
import { patchContent } from '../dashboard_navigation_and_appearance/dashboard_animation_and_element_updates.js';
import {
  referenceFacility,
  checkedFacility,
} from '../shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';

export function observedDemand(engine) {
  return ['A', 'B', 'C', 'D'].map((id) => {
    const current = engine.inventory.get(id);
    const points = engine.events
      .filter(
        (e) =>
          e.kind === 'inventory' &&
          e.packet.frame_id === engine.facility.frameId &&
          e.packet.source_id === current?.source,
      )
      .flatMap((e) =>
        e.packet.bins
          .filter((b) => b.id === id)
          .map((b) => ({
            t: e.packet.sent_at_ms,
            n: b.count,
            boot: e.packet.boot_id,
            source: e.packet.source_id,
          })),
      );
    let duration = 0,
      decline = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dt = (b.t - a.t) / 1000;
      if (dt <= 0 || dt > 5 || a.boot !== b.boot || a.source !== b.source || b.n > a.n) continue;
      duration += dt;
      decline += a.n - b.n;
    }
    return {
      id,
      rate: duration >= 20 && decline > 0 ? decline / duration : null,
      duration,
      decline,
    };
  });
}

export function createEngineeringWorkspace({ getSimulation, connected, onChange } = {}) {
  const $ = (id) => document.getElementById(id),
    esc = (v) =>
      String(v).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
  let savedProfiles, savedFacility;
  try {
    const saved = JSON.parse(localStorage.getItem('replenish.twin.live-profiles.v2'));
    if (saved?.length === SLOT_IDS.length)
      savedProfiles = SLOT_IDS.map((id, i) => checkedProfile(saved[i], id));
  } catch {}
  try {
    savedFacility = checkedFacility(
      JSON.parse(localStorage.getItem('replenish.twin.live-facility.v2')),
    );
  } catch {}
  let live = new TwinEngine({ profiles: savedProfiles, facility: savedFacility }),
    recording = null,
    recorded = null,
    source = 'live',
    cursor = 0,
    playing = false;
  let panel = 'state',
    selected = 0,
    calibration = null,
    result = null,
    experimentMode = 'twin',
    requestId = 0,
    busy = false,
    timeout = null;
  let worker = null;
  try {
    worker = new Worker(
      './browser_modules/background_calculation_workers/dispatch_policy_experiment_worker.js',
      { type: 'module' },
    );
  } catch {}
  const html = (id, content) => patchContent($(id), content);
  const message = (text, error = false) => {
    $('lab-message').textContent = text;
    $('lab-message').dataset.error = String(error);
  };
  const engine = () => (source === 'live' ? live : recorded);
  const time = () =>
    source === 'live'
      ? Date.now()
      : recording
        ? recording.events[0].received_at_ms + cursor * 1000
        : Date.now();
  const snapshots = () =>
    engine()?.snapshot(
      time(),
      source !== 'live' || connected?.(),
      source === 'live' ? performance.now() : time(),
    ) || [];
  const inventories = () =>
    engine()?.inventorySnapshot(
      time(),
      source !== 'live' || connected?.(),
      source === 'live' ? performance.now() : time(),
    ) || [];
  const saveProfiles = () => {
    if (source === 'live')
      try {
        localStorage.setItem('replenish.twin.live-profiles.v2', JSON.stringify(live.profiles));
      } catch {}
  };
  const saveFacility = () => {
    if (source === 'live')
      try {
        localStorage.setItem('replenish.twin.live-facility.v2', JSON.stringify(live.facility));
      } catch {}
  };
  function loadFacility() {
    const f = engine()?.facility || referenceFacility();
    $('lab-facility-json').value = JSON.stringify(f, null, 2);
    $('lab-facility-confirmed').checked = f.verified;
    $('lab-facility-status').textContent = f.verified
      ? 'Source geometry confirmed'
      : 'Reference geometry · unverified';
  }
  function exportJSON(value, filename) {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function switchPanel(name) {
    panel = name;
    document
      .querySelectorAll('[data-lab-panel]')
      .forEach((p) => (p.hidden = p.dataset.labPanel !== name));
    document
      .querySelectorAll('[data-lab-tab]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.labTab === name)));
    refresh();
  }
  function loadProfile() {
    const p = engine()?.profiles[selected] || defaultProfile(SLOT_IDS[selected]);
    $('lab-profile-title').textContent = SLOT_IDS[selected].toUpperCase() + ' model';
    $('lab-profile-revision').textContent = 'Revision ' + p.revision;
    for (const [id, key] of Object.entries({
      'lab-frame': 'frameId',
      'lab-noise': 'poseSigmaM',
      'lab-tolerance': 'residualLimitM',
      'lab-budget': 'maxGapS',
      'lab-cruise': 'cruiseMps',
      'lab-max-speed': 'maxSpeedMps',
    }))
      $(id).value = String(p[key]);
    $('lab-frame-confirmed').checked = p.frameConfirmed;
    calibration = null;
    $('lab-apply-fit').disabled = true;
    html('lab-calibration-result', 'Collect measured motion, or load the labeled reference run.');
  }
  function selectSource(value) {
    resetExperiment();
    source =
      value === 'recording' || document.documentElement.dataset.pythonTwin === 'true'
        ? 'recording'
        : 'live';
    playing = false;
    experimentMode = 'twin';
    calibration = null;
    result = null;
    $('lab-source').value = source;
    $('lab-replay').hidden = source === 'live' || !recording;
    $('lab-export-experiment').disabled = true;
    $('lab-experiment-source').textContent =
      'Source: ' +
      (source === 'live'
        ? 'legacy v1 state. AMR-01 must be idle; four independent bin counts are required.'
        : 'recorded twin state at the replay cursor.');
    $('lab-experiment-result').innerHTML = '';
    loadProfile();
    loadFacility();
    refresh();
    onChange?.();
  }
  function installRecording(r) {
    recording = r;
    cursor = (r.events.at(-1).received_at_ms - r.events[0].received_at_ms) / 1000;
    $('lab-cursor').max = String(cursor);
    $('lab-cursor').value = String(cursor);
    recorded = replayRecording(r);
    selectSource('recording');
  }
  function seek(seconds) {
    if (!recording) return;
    cursor = Math.max(0, Math.min(+$('lab-cursor').max, seconds));
    $('lab-cursor').value = String(cursor);
    recorded = replayRecording(recording, time(), recorded?.profiles || recording.profiles);
    refresh();
    onChange?.();
  }
  function drawMap(s) {
    if (!s?.packet?.pose) {
      html(
        'lab-map',
        '<text x="300" y="165" text-anchor="middle" fill="var(--muted)" font-size="14">Waiting for measured position</text>',
      );
      $('lab-map-note').textContent =
        'Wi-Fi availability does not establish a position measurement.';
      return;
    }
    const f = engine().facility,
      X = (x) => 32 + (x / f.widthM) * 536,
      Y = (y) => 32 + (y / f.heightM) * 269;
    let grid = '';
    for (let i = 0; i <= 6; i++) {
      const x = (i * f.widthM) / 6;
      grid += /* HTML */ `
        <path d="M${X(x)} 32V301" stroke="var(--chart-grid)" />
        <text x="${X(x)}" y="321" text-anchor="middle" fill="var(--muted)" font-size="11">
          ${x.toFixed(1)}m
        </text>
      `;
    }
    for (let i = 0; i <= 3; i++) {
      const y = (i * f.heightM) / 3;
      grid += /* HTML */ `
        <path d="M32 ${Y(y)}H568" stroke="var(--chart-grid)" />
        <text x="23" y="${Y(y) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">
          ${y.toFixed(1)}
        </text>
      `;
    }
    for (const edge of f.edges) {
      const a = f.nodes.find((n) => n.id === edge.from),
        b = f.nodes.find((n) => n.id === edge.to);
      grid += /* HTML */ `
        <path
          d="M${X(a.x_m)} ${Y(a.y_m)}L${X(b.x_m)} ${Y(b.y_m)}"
          stroke="var(--line-strong)"
          stroke-width="3"
        />
      `;
    }
    for (const node of f.nodes.filter((n) => n.role !== 'junction'))
      grid += /* HTML */ `
        <rect
          x="${X(node.x_m) - 4}"
          y="${Y(node.y_m) - 4}"
          width="8"
          height="8"
          fill="var(--dim)"
        />
        <text x="${X(node.x_m) + 9}" y="${Y(node.y_m) - 7}" fill="var(--muted)" font-size="10">
          ${esc(node.binId || node.assetId)}
        </text>
      `;
    const positions = engine()
      .events.filter((e) => e.kind === 'telemetry' && e.packet.device_id === s.id && e.packet.pose)
      .slice(-160)
      .map((e) => e.packet.pose);
    const measured = s.packet.pose,
      estimate = s.estimatedPose;
    const path = positions.map((p) => `${X(p.x_m)},${Y(p.y_m)}`).join(' ');
    let marks = /* HTML */ `
      <polyline points="${path}" fill="none" stroke="var(--blue)" stroke-width="1.5" opacity=".6" />
      <circle cx="${X(measured.x_m)}" cy="${Y(measured.y_m)}" r="5" fill="var(--blue)" />
    `;
    if (estimate)
      marks += /* HTML */ `
        <circle
          cx="${X(estimate.x_m)}"
          cy="${Y(estimate.y_m)}"
          r="8"
          fill="none"
          stroke="var(--text)"
          stroke-width="2"
        />
      `;
    if (s.predictions.length) {
      const p = s.predictions.at(-1);
      marks += /* HTML */ `
        <polyline
          points="${s.predictions.map((q) => `${X(q.x_m)},${Y(q.y_m)}`).join(' ')}"
          fill="none"
          stroke="var(--amber)"
          stroke-width="2"
          stroke-dasharray="4 4"
        />
        <ellipse
          cx="${X(p.x_m)}"
          cy="${Y(p.y_m)}"
          rx="${Math.max(3, (p.bound_m / f.widthM) * 536)}"
          ry="${Math.max(3, (p.bound_m / f.heightM) * 269)}"
          fill="none"
          stroke="var(--amber)"
          opacity=".6"
        />
        <circle cx="${X(p.x_m)}" cy="${Y(p.y_m)}" r="4" fill="var(--amber)" />
      `;
    }
    html('lab-map', grid + marks);
    $('lab-map-note').textContent =
      'Map ' +
      s.profile.frameId +
      ' · +X right / +Y down. ' +
      (s.eligible
        ? 'Dashed path is a local motion prediction; mission routes are shown in Route map.'
        : 'Local prediction withheld: ' + s.reasons.join(' '));
  }
  function drawResidual(s) {
    const data = s?.comparisons || [],
      tol = s?.profile.residualLimitM || 0.25,
      max = Math.max(tol * 1.5, ...data.map((x) => x.residual)),
      Y = (v) => 218 - (v / max) * 182;
    let markup = /* HTML */ `
      <path d="M42 ${Y(tol)}H534" stroke="var(--amber)" stroke-dasharray="4 4" />
      <text x="50" y="${Y(tol) - 8}" fill="var(--amber)" font-size="11">
        Tolerance ${tol.toFixed(2)} m
      </text>
      <path d="M42 26V218H534" stroke="var(--chart-grid)" />
    `;
    [0, max / 2, max].forEach(
      (v) =>
        (markup += /* HTML */ `
          <text x="34" y="${Y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">
            ${v.toFixed(2)}
          </text>
        `),
    );
    if (data.length)
      markup += /* HTML */ `
        <polyline
          points="${data
            .map((d, i) => `${42 + (i / Math.max(1, data.length - 1)) * 492},${Y(d.residual)}`)
            .join(' ')}"
          fill="none"
          stroke="var(--blue)"
          stroke-width="2"
        />
        <text x="42" y="246" fill="var(--muted)" font-size="11">
          ${data.length} comparisons · chronological order
        </text>
      `;
    else
      markup +=
        '<text x="290" y="125" text-anchor="middle" fill="var(--muted)" font-size="13">Need consecutive measured motion samples</text>';
    html('lab-residual-chart', markup);
  }
  function refresh() {
    const e = engine(),
      states = snapshots(),
      inventory = inventories(),
      s = states[selected],
      synthetic = e?.provenance === 'synthetic';
    $('lab-provenance').textContent =
      source === 'live'
        ? 'Legacy v1 telemetry · ' + (connected?.() ? 'receiving' : 'awaiting devices')
        : !e
          ? 'No recording loaded'
          : synthetic
            ? 'Synthetic reference · not physical evidence'
            : 'Imported recording · user supplied';
    $('lab-provenance').dataset.tone = synthetic ? 'synthetic' : 'normal';
    html('lab-eligible', states.filter((a) => a.eligible).length + ' <small>/ 1</small>');
    $('lab-comparisons').textContent = String(
      states.reduce((sum, a) => sum + a.comparisons.length, 0),
    );
    const offsets =
      e?.events
        .filter((x) => x.kind === 'telemetry')
        .slice(-240)
        .map((x) => x.received_at_ms - x.packet.sent_at_ms) || [];
    const offset = percentile(offsets);
    $('lab-offset').textContent = offset === null ? '—' : Math.round(offset) + ' ms';
    html('lab-inventory-count', inventory.filter((b) => b.fresh).length + ' <small>/ 4</small>');
    $('lab-cursor-label').textContent = cursor.toFixed(1) + ' s';
    $('lab-play').setAttribute('aria-pressed', String(playing));
    $('lab-play').textContent = playing ? 'Pause replay' : 'Replay';
    $('lab-play').disabled =
      source !== 'recording' || !recording || document.documentElement.dataset.motion === 'reduced';
    if (panel === 'state') {
      drawMap(s);
      drawResidual(s);
      const pairs = [
        [
          'Last measured speed',
          s?.packet?.speed_mps == null ? 'Not measured' : s.packet.speed_mps.toFixed(3) + ' m/s',
        ],
        [
          'Latest position error',
          s?.residual == null ? 'No comparison' : s.residual.toFixed(3) + ' m',
        ],
        ['Rolling error · RMSE', s?.rmseM == null ? 'Collecting' : s.rmseM.toFixed(3) + ' m'],
        [
          'Battery residual',
          s?.batteryResidual == null ? 'No comparison' : s.batteryResidual.toFixed(3) + ' pp',
        ],
        [
          'Model revision',
          s ? 'r' + s.profile.revision + ' · ' + s.profile.provenance : 'Unconfigured',
        ],
        ['Prediction age budget', s ? s.profile.maxGapS.toFixed(1) + ' s' : '—'],
      ];
      html(
        'lab-selected-facts',
        pairs
          .map(
            ([label, value]) => /* HTML */ `
              <div>
                <span>${esc(label)}</span>
                <b>${esc(value)}</b>
              </div>
            `,
          )
          .join(''),
      );
      html(
        'lab-assets',
        SLOT_IDS.map((id, i) => {
          const a = states[i];
          return /* HTML */ `
            <tr>
              <td>
                ${id.toUpperCase()}
                <small>${a ? esc(a.status) : 'waiting'}</small>
              </td>
              <td>
                ${a?.packet?.pose ? 'Pose' : 'No pose'} ·
                ${a?.packet?.battery_pct == null ? 'No battery' : 'Battery'}
                <small>
                  ${a?.packet?.pose_source ? esc(a.packet.pose_source) : 'Pose source unspecified'}
                </small>
              </td>
              <td>
                ${a?.rmseM == null ? '—' : a.rmseM.toFixed(3) + ' m'}
                <small>${a?.comparisons.length || 0} rolling comparisons</small>
              </td>
              <td>
                ${a?.boundM == null ? '—' : a.boundM.toFixed(3) + ' m'}
                <small>Configured 3σ engineering envelope</small>
              </td>
              <td>
                <span class="lab-status" data-ready="${!!a?.eligible}">
                  ${a?.eligible ? 'Local prediction eligible' : 'Prediction withheld'}
                </span>
                <small>
                  ${esc(
                    a?.eligible
                      ? 'Frame and data gates passed; physical validation remains separate.'
                      : a?.reasons.slice(0, 2).join(' ') || 'No recording loaded.',
                  )}
                </small>
              </td>
            </tr>
          `;
        }).join(''),
      );
      $('lab-reanchor').disabled = source !== 'live' || !s?.packet;
    }
    if (panel === 'evidence') {
      const rates = e ? observedDemand(e) : [];
      const gates = [
        ['Facility coordinates and route graph confirmed', !!e?.facility.verified],
        [
          'Fresh mapped pose / speed for AMR-01',
          states.length === SLOT_IDS.length && states.every((a) => a.eligible),
        ],
        [
          'All four bin observations fresh',
          inventory.length === 4 && inventory.every((b) => b.fresh),
        ],
        [
          'Recorded net consumption for all four bins',
          rates.length === 4 && rates.every((r) => r.rate !== null),
        ],
        [
          'Motion holdout accepted for AMR-01',
          states.length === SLOT_IDS.length &&
            states.every(
              (a) =>
                a.profile.validation?.passes && a.profile.validation.provenance !== 'synthetic',
            ),
        ],
        [
          'Measured discharge models for all assets',
          states.length === SLOT_IDS.length &&
            states.every((a) => a.profile.energyProvenance === 'measured'),
        ],
        ['Independent localization ground truth', false],
        ['Physical command / acknowledgment integration', false],
        ['Override latency measured under prediction load', false],
      ];
      html(
        'lab-commissioning',
        gates
          .map(
            ([label, pass]) => /* HTML */ `
              <div>
                <span>${label}</span>
                <b data-pass="${pass}">
                  ${pass ? (synthetic ? 'Reference only' : 'Evidence available') : 'Pending'}
                </b>
              </div>
            `,
          )
          .join(''),
      );
      $('lab-evidence-label').textContent = synthetic
        ? 'Software reference demonstration only'
        : 'Physical validation pending';
    }
    if (source === 'live' && e?.inventoryIssue) message(e.inventoryIssue, true);
  }
  function experimentSnapshot() {
    if (experimentMode === 'simulation') {
      const c = getSimulation();
      return {
        provenance: 'simulation',
        facility: referenceFacility(),
        routing: JSON.parse(
          JSON.stringify(c.routing || { objective: 'distance', blockedEdges: [] }),
        ),
        map: 'reference-warehouse',
        units: c.robots.map((r, i) => ({
          id: SLOT_IDS[i],
          x_m: r.x / 75,
          y_m: r.y / 75,
          battery_pct: r.battery,
          state: { Idle: 'idle', Queued: 'queued' }[r.state] || 'moving',
          profile: {
            ...defaultProfile(SLOT_IDS[i]),
            frameConfirmed: true,
            cruiseMps: 38 / 75,
            batteryIdlePctS: 0,
            provenance: 'simulation-assumed',
          },
        })),
        bins: c.bins.map((b) => ({
          id: b.id,
          count: b.stock,
          rate: b.rate * c.demand,
          x_m: b.x / 75,
          y_m: b.y / 75,
        })),
      };
    }
    const e = engine(),
      states = snapshots(),
      inventory = inventories();
    if (e && e.provenance !== 'synthetic' && !e.facility.verified)
      throw Error(
        'Confirm the actual facility route graph before a physical experiment. Open Calibration → Facility route graph.',
      );
    if (
      e &&
      e.provenance !== 'synthetic' &&
      states.some(
        (s) =>
          !s.profile.validation?.passes ||
          s.profile.validation.provenance === 'synthetic' ||
          s.profile.energyProvenance !== 'measured',
      )
    )
      throw Error(
        'Physical reserve experiments require measured discharge and accepted motion holdouts for AMR-01. Use calibration first, or select the simulator for an assumption-based study.',
      );
    if (
      !e ||
      states.length !== SLOT_IDS.length ||
      states.some((s) => !s.eligible || s.packet.battery_pct === null)
    )
      throw Error(
        'Need one fresh, mapped pose/speed/battery stream with valid model gates. Load the reference run, or complete Hardware and asset configuration.',
      );
    if (
      inventory.length !== 4 ||
      inventory.some((b) => !b.fresh || b.frame !== states[0].profile.frameId) ||
      states.some((s) => s.profile.frameId !== states[0].profile.frameId)
    )
      throw Error('Need all four fresh stock observations in the same confirmed map frame.');
    const rates = observedDemand(e);
    if (rates.some((r) => r.rate === null))
      throw Error(
        'Need at least 20 s of observed net stock decline for each bin. Upward jumps are excluded; accuracy still requires independent validation.',
      );
    return {
      provenance: e.provenance,
      facility: e.facility,
      map: e.facility.frameId,
      units: states.map((s) => ({
        id: s.id,
        x_m: s.packet.pose.x_m,
        y_m: s.packet.pose.y_m,
        battery_pct: s.packet.battery_pct,
        state: s.packet.state,
        profile: s.profile,
      })),
      bins: inventory.map((b, i) => {
        const node = e.facility.nodes.find((n) => n.binId === b.id);
        return { id: b.id, count: b.count, rate: rates[i].rate, x_m: node.x_m, y_m: node.y_m };
      }),
    };
  }
  function finishExperiment(data) {
    if (data.requestId !== requestId) return;
    clearTimeout(timeout);
    busy = false;
    $('lab-run-experiment').disabled = !worker;
    if (data.error) {
      $('lab-experiment-message').textContent = data.error;
      return;
    }
    result = { ...data.result, notice: NOTICE, generated_at: new Date().toISOString() };
    $('lab-export-experiment').disabled = false;
    const a = result.baseline,
      b = result.proposal;
    const rows = [
      ['Deliveries within horizon', a.completions, b.completions, ''],
      ['Unmet demand', a.unmetUnits, b.unmetUnits, ' units'],
      ['Total bin stockout duration', a.stockoutSeconds, b.stockoutSeconds, ' bin·s'],
      ['Predicted fleet discharge', a.energyPctPoints, b.energyPctPoints, ' pp'],
      ['Travel distance', a.distanceM, b.distanceM, ' m'],
      ['Reserve-blocked requests', a.blocked, b.blocked, ''],
    ];
    const format = (n, u) => (Number.isInteger(n) ? n + u : n.toFixed(2) + u);
    const schedules = [a, b]
      .map(
        (branch) => /* HTML */ `
          <div>
            <b>
              ${branch.policy === 'fifo'
                ? 'FIFO baseline'
                : branch.policy === 'urgency'
                  ? 'Earliest-stockout proposal'
                  : 'AMR-01 unavailable'}
            </b>
            <br />
            ${branch.schedule
              .map((s) =>
                s.blocked
                  ? `Bin ${s.bin}: blocked`
                  : `${s.unit.toUpperCase()} → ${s.bin}: ${s.start.toFixed(1)}–${s.release.toFixed(1)} s; arrival ${s.arrival.toFixed(1)} s; ${s.outboundM.toFixed(2)} m out + ${s.returnM.toFixed(2)} m return`,
              )
              .join('<br>')}
          </div>
        `,
      )
      .join('');
    const max = Math.max(1, a.unmetUnits, b.unmetUnits),
      bar = (n) => Math.max(0, (n / max) * 360);
    const effect = (before, after, moreIsBetter = false) =>
      Math.abs(after - before) < 1e-8
        ? 'same'
        : after < before !== moreIsBetter
          ? 'lower'
          : 'higher';
    const outcomes = [
      ['Unmet demand', a.unmetUnits, b.unmetUnits, ' units', false],
      ['Deliveries in horizon', a.completions, b.completions, '', true],
      ['Fleet discharge', a.energyPctPoints, b.energyPctPoints, ' pp', false],
    ];
    const cards = outcomes
      .map(
        ([label, before, after, unit, moreIsBetter]) => /* HTML */ `
          <article class="lab-outcome" data-effect="${effect(before, after, moreIsBetter)}">
            <span>${label} · proposal</span>
            <strong>
              ${format(after, '')}
              <small>${unit}</small>
            </strong>
            <small>
              FIFO ${format(before, unit)} ·
              ${Math.abs(before - after) < 1e-8
                ? 'same outcome'
                : format(Math.abs(before - after), unit) + (after < before ? ' less' : ' more')}
            </small>
          </article>
        `,
      )
      .join('');
    const branches = [a, b],
      lastReservation = Math.max(
        result.options.horizonS,
        ...branches.flatMap((branch) =>
          branch.schedule.filter((s) => !s.blocked).map((s) => s.release),
        ),
      ),
      end = Math.ceil(lastReservation / 30) * 30;
    const left = 172,
      right = 766,
      top = 51,
      rowHeight = 31,
      branchGap = 40,
      heights = branches.map((branch) => branch.schedule.length * rowHeight),
      chartHeight = top + heights[0] + heights[1] + branchGap + 46;
    const X = (t) => left + (t / end) * (right - left),
      label = (branch) =>
        branch.policy === 'fifo'
          ? 'FIFO baseline'
          : branch.policy === 'urgency'
            ? 'Earliest-stockout proposal'
            : 'AMR-01 unavailable';
    const horizonX = X(result.options.horizonS);
    let timeline = /* HTML */ `
      <rect
        x="${horizonX}"
        y="29"
        width="${right - horizonX}"
        height="${chartHeight - 68}"
        fill="var(--panel)"
      />
      <path
        d="M${horizonX} 29V${chartHeight - 39}"
        stroke="var(--line-strong)"
        stroke-dasharray="4 4"
      />
      <text x="${Math.min(horizonX + 6, right - 74)}" y="20" fill="var(--dim)" font-size="10">
        Horizon ${result.options.horizonS}s
      </text>
    `;
    for (let i = 0; i <= 4; i++) {
      const t = (end * i) / 4,
        x = X(t);
      timeline += /* HTML */ `
        <path d="M${x} 29V${chartHeight - 39}" stroke="var(--line)" />
        <text
          x="${x}"
          y="${chartHeight - 21}"
          text-anchor="middle"
          fill="var(--muted)"
          font-size="11"
        >
          ${t.toFixed(0)}s
        </text>
      `;
    }
    branches.forEach((branch, index) => {
      const offset = index ? top + heights[0] + branchGap : top,
        color = index ? 'var(--green)' : 'var(--blue)';
      timeline += /* HTML */ `
        <text
          x="18"
          y="${offset - 11}"
          fill="var(--text-secondary)"
          font-size="11"
          font-weight="600"
        >
          ${label(branch)}
        </text>
      `;
      branch.schedule.forEach((reservation, row) => {
        const y = offset + row * rowHeight;
        timeline += /* HTML */ `
          <text x="18" y="${y + 12}" fill="var(--muted)" font-size="11">
            ${reservation.blocked ? 'Request' : reservation.unit.toUpperCase()} → Bin
            ${reservation.bin}
          </text>
        `;
        if (reservation.blocked) {
          timeline += /* HTML */ `
            <text x="${left}" y="${y + 12}" fill="var(--warning-text)" font-size="11">Blocked</text>
          `;
          return;
        }
        const x = X(reservation.start),
          arrival = X(reservation.arrival),
          release = X(reservation.release);
        timeline += /* HTML */ `
          <rect
            x="${x}"
            y="${y}"
            width="${Math.max(0, release - x)}"
            height="16"
            rx="3"
            fill="${color}"
            opacity=".23"
          />
          <rect
            x="${x}"
            y="${y}"
            width="${Math.max(0, arrival - x)}"
            height="16"
            rx="3"
            fill="${color}"
            opacity=".85"
          />
          <path d="M${arrival} ${y - 2}v20" stroke="${color}" stroke-width="2" />
        `;
      });
    });
    html(
      'lab-experiment-result',
      /* HTML */ `
        <div class="lab-outcomes">${cards}</div>
        <div class="lab-table-scroll">
          <table class="lab-table">
            <thead>
              <tr>
                <th>Outcome</th>
                <th>FIFO baseline</th>
                <th>Proposal</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  ([label, x, y, u]) => /* HTML */ `
                    <tr>
                      <td>${label}</td>
                      <td>${format(x, u)}</td>
                      <td>${format(y, u)}</td>
                    </tr>
                  `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
        <svg
          class="lab-chart lab-experiment-chart"
          viewBox="0 0 560 132"
          role="img"
          aria-label="Predicted unmet demand in the two policies"
        >
          <text x="20" y="31" fill="var(--muted)" font-size="12">FIFO</text>
          <rect x="148" y="16" width="${bar(a.unmetUnits)}" height="24" fill="var(--blue)" />
          <text x="20" y="87" fill="var(--muted)" font-size="12">Proposal</text>
          <rect x="148" y="72" width="${bar(b.unmetUnits)}" height="24" fill="var(--amber)" />
          <text x="148" y="120" fill="var(--muted)" font-size="11">
            Predicted unmet demand · units
          </text>
        </svg>
        <div class="lab-schedule-heading">
          <b>Aisle reservation timeline</b>
          <span>Solid: before delivery · faint: return</span>
        </div>
        <div class="lab-timeline-scroll">
          <svg
            class="lab-schedule-timeline"
            viewBox="0 0 800 ${chartHeight}"
            role="img"
            aria-label="Predicted aisle reservation times for both policies; numerical start, arrival and release times appear below."
          >
            ${timeline}
          </svg>
        </div>
        <div class="lab-schedule">${schedules}</div>
      `,
    );
    $('lab-experiment-message').textContent =
      'Completed from one frozen ' +
      result.snapshot.provenance +
      ' snapshot. Shared disturbances: ' +
      result.options.demandMultiplier +
      '× demand and ' +
      Math.round(result.options.speedFactor * 100) +
      '% restricted-zone speed. Route objective: ' +
      (result.options.routeObjective === 'distance' ? 'shortest distance' : 'fastest travel time') +
      '. Predictions use the source’s route graph and configured models; no decision was dispatched.';
  }
  function resetExperiment() {
    requestId++;
    busy = false;
    clearTimeout(timeout);
    timeout = null;
    result = null;
    $('lab-run-experiment').disabled = !worker;
    $('lab-export-experiment').disabled = true;
    html('lab-experiment-result', '');
  }
  function bindWorker() {
    if (worker) {
      worker.onmessage = ({ data }) => finishExperiment(data);
      worker.onerror = worker.onmessageerror = () => {
        worker?.terminate?.();
        worker = null;
        resetExperiment();
        $('lab-experiment-message').textContent =
          'Experiment service unavailable. Hardware telemetry and fleet controls remain independent.';
      };
    }
  }
  bindWorker();
  $('lab-run-experiment').disabled = !worker;
  $('lab-run-experiment').onclick = () => {
    if (busy || !worker) return;
    try {
      const snapshot = experimentSnapshot(),
        options = {
          policy: $('lab-policy').value,
          horizonS: +$('lab-horizon').value,
          demandMultiplier: +$('lab-demand').value,
          speedFactor: +$('lab-zone-speed').value,
          routeObjective: $('lab-route-objective').value,
        };
      busy = true;
      requestId++;
      result = null;
      html('lab-experiment-result', '');
      $('lab-export-experiment').disabled = true;
      $('lab-run-experiment').disabled = true;
      $('lab-experiment-message').textContent =
        'Frozen state captured. Running both isolated branches…';
      worker.postMessage({ requestId, snapshot: JSON.parse(JSON.stringify(snapshot)), options });
      timeout = setTimeout(() => {
        if (busy) {
          requestId++;
          busy = false;
          worker?.terminate?.();
          worker = null;
          $('lab-run-experiment').disabled = true;
          $('lab-experiment-message').textContent =
            'Experiment exceeded the computation budget. Reload to retry; live telemetry and controls remain available.';
        }
      }, 10000);
    } catch (error) {
      resetExperiment();
      $('lab-experiment-message').textContent = error.message;
    }
  };
  $('lab-sim-source').onclick = () => {
    resetExperiment();
    experimentMode = 'simulation';
    $('lab-experiment-source').textContent =
      'Source: simulator positions, batteries, stock, current demand and lane closures, frozen on Run. The selected route objective and speed below apply to both branches. This study uses new requests and no charging.';
    $('lab-experiment-message').textContent =
      'Ready to compare four new bin requests. Existing approved missions are not continued in this study. The demand multiplier applies on top of the simulator’s current demand.';
    message('Experiment switched to the simulator. The live observer is unchanged.');
  };
  $('lab-export-experiment').onclick = () => {
    if (result) exportJSON(result, 'replenish-paired-experiment.json');
  };
  $('lab-profile-form').onsubmit = (event) => {
    event.preventDefault();
    const e = engine();
    if (!e) {
      message('Load a recording first.', true);
      return;
    }
    try {
      e.setProfile(selected, {
        frameId: $('lab-frame').value.trim(),
        poseSigmaM: +$('lab-noise').value,
        residualLimitM: +$('lab-tolerance').value,
        maxGapS: +$('lab-budget').value,
        cruiseMps: +$('lab-cruise').value,
        maxSpeedMps: +$('lab-max-speed').value,
        frameConfirmed: !!$('lab-frame-confirmed').checked,
        validation: null,
      });
      if (source !== 'live') recording.profiles = e.profiles;
      saveProfiles();
      loadProfile();
      refresh();
      onChange?.();
      message(
        'Asset configuration saved. Previous holdout approval is cleared; revalidate after a model change.',
      );
    } catch (error) {
      message(error.message, true);
    }
  };
  $('lab-facility-form').onsubmit = (event) => {
    event.preventDefault();
    const e = engine();
    if (!e) {
      message('Load a recording first.', true);
      return;
    }
    try {
      const input = JSON.parse($('lab-facility-json').value);
      input.verified = !!$('lab-facility-confirmed').checked;
      e.setFacility(checkedFacility(input));
      if (source !== 'live') {
        recording.facility = e.facility;
        recording.profiles = e.profiles;
      }
      saveFacility();
      saveProfiles();
      loadFacility();
      loadProfile();
      refresh();
      onChange?.();
      message(
        'Facility graph saved. Confirm each asset frame and repeat model validation after a map change.',
      );
    } catch (error) {
      message(error.message, true);
    }
  };
  $('lab-fit').onclick = () => {
    const e = engine();
    if (!e) {
      message('Load a recording first.', true);
      return;
    }
    calibration = {
      ...fitCalibration(e.events, SLOT_IDS[selected], e.profiles[selected]),
      asset: selected,
      source,
      revision: e.profiles[selected].revision,
    };
    if (!calibration.ready) {
      html(
        'lab-calibration-result',
        esc(calibration.reason) +
          '<br>' +
          calibration.intervals +
          ' eligible intervals; ' +
          calibration.excluded +
          ' excluded.',
      );
      $('lab-apply-fit').disabled = true;
      return;
    }
    const c = calibration;
    html(
      'lab-calibration-result',
      /* HTML */ `
        <strong>
          ${e.provenance === 'synthetic'
            ? 'Synthetic fit · demonstration only'
            : 'Measured recording fit · inspect holdout'}
        </strong>
        <div class="lab-facts">
          <div>
            <span>Fitted speed gain</span>
            <b>${c.speedGain.toFixed(4)}</b>
          </div>
          <div>
            <span>Training / holdout intervals</span>
            <b>${c.trainN} / ${c.heldOutN}</b>
          </div>
          <div>
            <span>Current holdout error</span>
            <b>${c.beforeM.toFixed(4)} m</b>
          </div>
          <div>
            <span>Fitted holdout error</span>
            <b>${c.afterM.toFixed(4)} m</b>
          </div>
          <div>
            <span>Fitted moving discharge</span>
            <b>
              ${c.energyRate === null
                ? 'Insufficient discharge'
                : c.energyRate.toFixed(4) + ' pp/s'}
            </b>
          </div>
          <div>
            <span>Excluded intervals</span>
            <b>${c.excluded}</b>
          </div>
        </div>
        ${esc(c.reason)}
      `,
    );
    $('lab-apply-fit').disabled = !c.passes;
  };
  $('lab-apply-fit').onclick = () => {
    const e = engine(),
      c = calibration;
    if (
      !e ||
      !c?.passes ||
      c.asset !== selected ||
      c.source !== source ||
      c.revision !== e.profiles[selected].revision
    )
      return;
    try {
      e.setProfile(selected, {
        speedGain: c.speedGain,
        cruiseMps: c.cruiseMps,
        provenance: e.provenance === 'synthetic' ? 'synthetic-fit' : 'measured-fit',
        ...(c.energyRate === null
          ? {}
          : {
              batteryMovePctS: c.energyRate,
              energyProvenance: e.provenance === 'synthetic' ? 'synthetic' : 'measured',
            }),
        validation: {
          passes: c.passes,
          heldOutN: c.heldOutN,
          trainN: c.trainN,
          beforeM: c.beforeM,
          afterM: c.afterM,
          baselineGain: c.baselineGain,
          trainThroughMs: c.trainThroughMs,
          holdoutStartMs: c.holdoutStartMs,
          holdoutThroughMs: c.holdoutThroughMs,
          provenance: e.provenance,
          recorded_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      $('lab-apply-fit').disabled = true;
      calibration = null;
      message(error.message, true);
      return;
    }
    if (source !== 'live') recording.profiles = e.profiles;
    saveProfiles();
    $('lab-profile-revision').textContent = 'Revision ' + e.profiles[selected].revision;
    calibration = null;
    $('lab-apply-fit').disabled = true;
    refresh();
    onChange?.();
    message(
      'Validated fit applied only to ' +
        SLOT_IDS[selected].toUpperCase() +
        ' in the ' +
        source +
        ' source.',
    );
  };
  $('lab-reference').onclick = () => {
    installRecording(referenceRecording($('lab-fault').value || 'nominal'));
    message(
      'Synthetic observations loaded. They deliberately differ from the nominal model and do not establish physical accuracy.',
    );
  };
  $('lab-import').onchange = async () => {
    const file = $('lab-import').files?.[0];
    if (!file) return;
    try {
      if (file.size > 6 * 1024 * 1024) throw Error('Recording exceeds 6 MB.');
      installRecording(parseRecording(await file.text()));
      message(
        'Recording imported. Provenance is supplied by the file and has not been independently verified.',
      );
    } catch (error) {
      message(error.message, true);
    } finally {
      $('lab-import').value = '';
    }
  };
  $('lab-source').onchange = () => {
    selectSource($('lab-source').value);
    message(
      source === 'live'
        ? 'Viewing live asset models. Configure Hardware to receive measurements.'
        : 'Viewing the selected recording. Load or import one if empty.',
    );
  };
  $('lab-asset').onchange = () => {
    selected = +$('lab-asset').value;
    loadProfile();
    refresh();
  };
  $('lab-export').onclick = () => {
    const e = engine();
    if (!e || !e.events.length) {
      message('No observations to export.', true);
      return;
    }
    exportJSON(e.evidence(), 'replenish-twin-evidence.json');
    message('Evidence exported with raw observations, model revisions and provenance.');
  };
  $('lab-reanchor').onclick = () => {
    if (source !== 'live') return;
    live.reanchorAsset(SLOT_IDS[selected]);
    refresh();
    onChange?.();
    message(
      'Observer re-anchor recorded. Waiting for the next device measurement after your localization check.',
    );
  };
  $('lab-play').onclick = () => {
    if (
      !recording ||
      source !== 'recording' ||
      document.documentElement.dataset.motion === 'reduced'
    )
      return;
    if (cursor >= +$('lab-cursor').max) seek(0);
    playing = !playing;
    refresh();
  };
  $('lab-cursor').oninput = () => {
    playing = false;
    seek(+$('lab-cursor').value);
  };
  document
    .querySelectorAll('[data-lab-tab]')
    .forEach((b) => b.addEventListener('click', () => switchPanel(b.dataset.labTab)));
  function tickReplay() {
    const visible = document.body.dataset.view === 'engineering' && !document.hidden;
    if (!visible || document.documentElement.dataset.motion === 'reduced') playing = false;
    if (playing) {
      seek(cursor + 0.5);
      if (cursor >= +$('lab-cursor').max) playing = false;
    }
    if (visible) refresh();
  }
  let timer = setInterval(tickReplay, 500);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) playing = false;
  });
  window.addEventListener('pagehide', () => {
    playing = false;
    clearInterval(timer);
    timer = null;
    worker?.terminate?.();
    worker = null;
    resetExperiment();
  });
  window.addEventListener('pageshow', () => {
    if (timer === null) {
      timer = setInterval(tickReplay, 500);
      try {
        worker = new Worker(
          './browser_modules/background_calculation_workers/dispatch_policy_experiment_worker.js',
          { type: 'module' },
        );
        bindWorker();
      } catch {}
      $('lab-run-experiment').disabled = !worker;
      refresh();
    }
  });
  // The hosted v2 sensor path has no connection to this legacy v1 observer.
  // Keep recording studies available without offering an inactive hardware source.
  function applyPythonSensorScope() {
    if (document.documentElement.dataset.pythonTwin !== 'true') return;
    const legacyOption = $('lab-source').querySelector('option[value="live"]');
    legacyOption.disabled = true;
    legacyOption.hidden = true;
    if (source === 'live') selectSource('recording');
  }
  document.addEventListener('python-twin:render', applyPythonSensorScope);
  $('lab-source').value = 'live';
  $('lab-asset').value = '0';
  $('lab-fault').value = 'nominal';
  $('lab-policy').value = 'urgency';
  $('lab-route-objective').value = 'distance';
  $('lab-demand').value = '5';
  $('lab-zone-speed').value = '1';
  $('lab-horizon').value = '120';
  loadProfile();
  loadFacility();
  refresh();
  applyPythonSensorScope();
  return {
    refresh,
    setVisible(visible) {
      if (!visible) playing = false;
    },
    ingest(packet, receivedAt, tick) {
      live.ingest(packet, receivedAt, tick);
      if (source === 'live' && document.body.dataset.view === 'engineering') refresh();
    },
    ingestInventory(packet, receivedAt, tick = performance.now()) {
      live.ingestInventory(packet, receivedAt, tick);
      onChange?.();
    },
    inventoryError(reason) {
      live.inventoryIssue = reason;
    },
    newLiveSession() {
      live = new TwinEngine({ profiles: live.profiles, facility: live.facility });
      if (source === 'live') {
        loadProfile();
        loadFacility();
        refresh();
      }
    },
    liveSnapshot() {
      return live.snapshot(Date.now(), connected?.(), performance.now());
    },
    liveInventory() {
      return live.inventorySnapshot(Date.now(), connected?.(), performance.now());
    },
    get source() {
      return source;
    },
    get liveEngine() {
      return live;
    },
  };
}
