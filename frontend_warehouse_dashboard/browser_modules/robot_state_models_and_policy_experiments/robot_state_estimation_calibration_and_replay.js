// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Advisory state/model service. This module has no command or motor interface.
import {
  SLOT_IDS,
  FRESH_MS,
  OFFLINE_MS,
  decodeTelemetry,
} from '../esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness.js';
import {
  checkedFacility,
  referenceFacility,
} from '../shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';

export const TWIN_VERSION = '2.1.0';
export const NOTICE = '© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.';
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const rms = (xs) => (xs.length ? Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length) : null);
const median = (xs) => {
  const a = xs.slice().sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};
export const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const radians = (d) => (d * Math.PI) / 180;
const identity = (p) => `${p.boot_id}:${p.seq}`;
export const defaultProfile = (id) => ({
  assetId: id,
  revision: 1,
  frameId: 'warehouse-01',
  frameConfirmed: false,
  speedGain: 1,
  cruiseMps: 0.5,
  maxSpeedMps: 1.5,
  poseSigmaM: 0.03,
  processSigmaMps: 0.08,
  residualLimitM: 0.25,
  maxGapS: 2.5,
  batteryMovePctS: 0.06,
  batteryIdlePctS: 0.005,
  reservePct: 15,
  provenance: 'assumed',
  energyProvenance: 'assumed',
  validation: null,
});

export function checkedProfile(input, id = input.assetId) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Asset profile must be an object.');
  const p = { ...defaultProfile(id), ...input, assetId: id };
  if (
    !SLOT_IDS.includes(id) ||
    typeof p.frameId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,48}$/.test(p.frameId) ||
    typeof p.frameConfirmed !== 'boolean'
  )
    throw new Error('Invalid asset or frame configuration.');
  const ranges = {
    speedGain: [0.5, 1.5],
    cruiseMps: [0.05, 1.5],
    maxSpeedMps: [0.05, 3],
    poseSigmaM: [0.001, 1],
    processSigmaMps: [0.001, 1],
    residualLimitM: [0.01, 2],
    maxGapS: [0.1, 5],
    batteryMovePctS: [0, 1],
    batteryIdlePctS: [0, 0.1],
    reservePct: [5, 50],
  };
  for (const [k, [lo, hi]] of Object.entries(ranges))
    if (!Number.isFinite(p[k]) || p[k] < lo || p[k] > hi)
      throw new Error(`${k} is outside ${lo}–${hi}.`);
  if (p.maxSpeedMps < p.cruiseMps * p.speedGain)
    throw new Error('Maximum physical speed must cover calibrated cruise speed.');
  return p;
}

// Constant-twist motion in metres. Positive heading rotates from map +X toward +Y.
// The reference plan has +Y down, so +90 degrees appears clockwise on screen.
export function propagatePose(pose, speed, omega, seconds, gain = 1) {
  const h = radians(pose.heading_deg),
    v = (speed ?? 0) * gain,
    w = omega ?? 0,
    dt = Math.max(0, seconds);
  const dx =
    Math.abs(w) < 1e-6 ? v * dt * Math.cos(h) : (v / w) * (Math.sin(h + w * dt) - Math.sin(h));
  const dy =
    Math.abs(w) < 1e-6 ? v * dt * Math.sin(h) : (v / w) * (Math.cos(h) - Math.cos(h + w * dt));
  return {
    x_m: pose.x_m + dx,
    y_m: pose.y_m + dy,
    heading_deg: (angleDelta(h + w * dt, 0) * 180) / Math.PI,
  };
}

export function decodeInventory(payload, now = Date.now()) {
  if (typeof payload !== 'string' || new TextEncoder().encode(payload).length > 4096)
    throw new Error('Inventory packet exceeds 4 KB.');
  let p;
  try {
    p = JSON.parse(payload);
  } catch {
    throw new Error('Inventory packet is not JSON.');
  }
  if (
    !p ||
    p.v !== 1 ||
    typeof p.source_id !== 'string' ||
    typeof p.frame_id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,48}$/.test(p.source_id) ||
    !/^[a-zA-Z0-9_-]{1,48}$/.test(p.frame_id) ||
    typeof p.boot_id !== 'string' ||
    !/^[a-fA-F0-9]{8,32}$/.test(p.boot_id) ||
    !Number.isSafeInteger(p.seq) ||
    p.seq < 0 ||
    !Number.isSafeInteger(p.sent_at_ms) ||
    p.sent_at_ms < now - OFFLINE_MS ||
    p.sent_at_ms > now + FRESH_MS ||
    !Array.isArray(p.bins) ||
    p.bins.length < 1 ||
    p.bins.length > 4
  )
    throw new Error('Inventory identity, timestamp or schema is invalid.');
  const ids = new Set();
  const bins = p.bins.map((b) => {
    if (
      !b ||
      !['A', 'B', 'C', 'D'].includes(b.id) ||
      ids.has(b.id) ||
      !Number.isSafeInteger(b.count) ||
      b.count < 0 ||
      b.count > 100
    )
      throw new Error('Inventory requires unique A–D bins and integer counts in 0–100.');
    ids.add(b.id);
    return { id: b.id, count: b.count };
  });
  return {
    v: 1,
    source_id: p.source_id,
    frame_id: p.frame_id,
    boot_id: p.boot_id,
    seq: p.seq,
    sent_at_ms: p.sent_at_ms,
    bins,
  };
}

function freshAsset(id) {
  return {
    id,
    packet: null,
    receivedAt: null,
    receivedTick: null,
    posterior: null,
    variance: null,
    omega: 0,
    residual: null,
    batteryResidual: null,
    comparisons: [],
    excluded: 0,
    consecutiveDivergence: 0,
    quarantine: '',
    retiredBoots: [],
    discontinuities: 0,
    accepted: 0,
  };
}

export class TwinEngine {
  constructor({ provenance = 'live-telemetry', profiles, facility } = {}) {
    this.provenance = provenance;
    this.profiles = SLOT_IDS.map((id, i) =>
      checkedProfile(profiles?.[i] || defaultProfile(id), id),
    );
    this.facility = checkedFacility(facility || referenceFacility());
    this.events = [];
    this.anchorResets = [];
    this.droppedEvents = 0;
    this.resetState();
  }
  resetState() {
    this.assets = SLOT_IDS.map(freshAsset);
    this.inventory = new Map();
    this.inventoryBoots = new Map();
    this.inventoryRetired = new Map();
    this.inventoryIssue = '';
  }
  record(event) {
    this.events.push(event);
    if (this.events.length > 6000) {
      this.events.shift();
      this.droppedEvents++;
    }
  }
  ingest(packet, receivedAt = packet.sent_at_ms, tick = receivedAt, record = true) {
    const index = SLOT_IDS.indexOf(packet.device_id);
    if (index < 0) return false;
    const a = this.assets[index],
      profile = this.profiles[index],
      prev = a.packet;
    if (
      prev &&
      (packet.sent_at_ms <= prev.sent_at_ms ||
        a.retiredBoots.includes(packet.boot_id) ||
        (packet.boot_id === prev.boot_id && packet.seq <= prev.seq))
    )
      return false;
    const reboot = prev && prev.boot_id !== packet.boot_id,
      dt = prev ? (packet.sent_at_ms - prev.sent_at_ms) / 1000 : 0;
    const sigma = packet.pose_sigma_m ?? profile.poseSigmaM;
    let residual = null,
      batteryResidual = null,
      status = 'anchor',
      predicted = null;
    const frameMismatch =
      packet.frame_id !== null &&
      packet.frame_id !== undefined &&
      packet.frame_id !== profile.frameId;
    const outOfBounds =
      packet.pose &&
      (packet.pose.x_m > this.facility.widthM || packet.pose.y_m > this.facility.heightM);
    if (reboot) {
      a.retiredBoots.push(prev.boot_id);
      a.retiredBoots = a.retiredBoots.slice(-32);
    }
    if (frameMismatch || outOfBounds) {
      status = 'frame-mismatch';
      a.quarantine = outOfBounds
        ? 'Measured pose exceeds the configured facility extents.'
        : 'Reported map frame differs from the configured asset frame.';
      a.posterior = null;
      a.consecutiveDivergence = 0;
    } else if (a.quarantine && !reboot && dt <= profile.maxGapS) {
      status = 'quarantined';
    } else if (packet.pose && prev?.pose && !reboot && dt <= profile.maxGapS) {
      const measuredDistance = Math.hypot(
        packet.pose.x_m - prev.pose.x_m,
        packet.pose.y_m - prev.pose.y_m,
      );
      if (measuredDistance > profile.maxSpeedMps * dt + 6 * sigma) {
        status = 'quarantined';
        a.quarantine = 'Pose displacement exceeds the configured physical speed envelope.';
      } else {
        predicted = propagatePose(
          a.posterior || prev.pose,
          prev.speed_mps,
          a.omega,
          dt,
          profile.speedGain,
        );
        // Compare before correction. Never score a measurement against its own corrected state.
        const openLoop = propagatePose(
          prev.pose,
          prev.speed_mps,
          prev.angular_speed_rps ?? a.omega,
          dt,
          profile.speedGain,
        );
        if (prev.speed_mps !== null && prev.speed_mps !== undefined)
          residual = Math.hypot(openLoop.x_m - packet.pose.x_m, openLoop.y_m - packet.pose.y_m);
        const variance = (a.variance ?? sigma * sigma) + Math.pow(profile.processSigmaMps * dt, 2);
        const gain = variance / (variance + sigma * sigma);
        a.posterior = {
          x_m: predicted.x_m + gain * (packet.pose.x_m - predicted.x_m),
          y_m: predicted.y_m + gain * (packet.pose.y_m - predicted.y_m),
          heading_deg: packet.pose.heading_deg,
        };
        a.variance = (1 - gain) * variance;
        a.omega =
          packet.angular_speed_rps ??
          clamp(
            angleDelta(radians(packet.pose.heading_deg), radians(prev.pose.heading_deg)) / dt,
            -3,
            3,
          );
        a.quarantine = '';
        status = 'corrected';
        a.consecutiveDivergence =
          residual !== null && residual > profile.residualLimitM ? a.consecutiveDivergence + 1 : 0;
      }
    } else if (!frameMismatch) {
      a.posterior = packet.pose ? { ...packet.pose } : null;
      a.variance = packet.pose ? sigma * sigma : null;
      a.omega = packet.angular_speed_rps ?? 0;
      a.quarantine = '';
      a.consecutiveDivergence = 0;
      if (prev) {
        a.discontinuities++;
        a.excluded++;
        status = reboot ? 'reboot-anchor' : dt > profile.maxGapS ? 'gap-anchor' : 'missing-pose';
      }
    }
    if (
      prev &&
      !reboot &&
      dt > 0 &&
      dt <= profile.maxGapS &&
      prev.battery_pct !== null &&
      packet.battery_pct !== null &&
      prev.state !== 'charging' &&
      packet.state !== 'charging'
    ) {
      const drain = prev.state === 'moving' ? profile.batteryMovePctS : profile.batteryIdlePctS;
      batteryResidual = packet.battery_pct - Math.max(0, prev.battery_pct - drain * dt);
    }
    if (status === 'quarantined' || status === 'frame-mismatch') a.excluded++;
    if (residual !== null) {
      a.comparisons.push({ t: packet.sent_at_ms, residual, batteryResidual, dt });
      a.comparisons = a.comparisons.slice(-240);
    }
    a.packet = packet;
    a.receivedAt = receivedAt;
    a.receivedTick = tick;
    a.accepted++;
    a.residual = residual;
    a.batteryResidual = batteryResidual;
    // A hard-invalid pose cannot be a new motion anchor. Resume only after a new valid anchor following a gap/reboot.
    if (status === 'quarantined') {
      a.posterior = null;
      a.variance = null;
    }
    if (record)
      this.record({
        kind: 'telemetry',
        received_at_ms: receivedAt,
        received_tick_ms: tick,
        packet: { ...packet },
        model_revision: profile.revision,
        observer: { status, residual_m: residual, battery_residual_pct: batteryResidual },
      });
    return true;
  }
  ingestInventory(packet, receivedAt = packet.sent_at_ms, tick = receivedAt, record = true) {
    const previous = this.inventoryBoots.get(packet.source_id);
    const retired = this.inventoryRetired.get(packet.source_id) || [];
    if (
      previous &&
      (packet.sent_at_ms < previous.sent_at_ms ||
        retired.includes(packet.boot_id) ||
        (packet.boot_id === previous.boot_id && packet.seq <= previous.seq))
    )
      return false;
    if (previous && previous.boot_id !== packet.boot_id)
      this.inventoryRetired.set(packet.source_id, [...retired, previous.boot_id].slice(-32));
    this.inventoryBoots.set(packet.source_id, packet);
    packet.bins.forEach((b) => {
      const current = this.inventory.get(b.id);
      if (!current || packet.sent_at_ms >= current.capturedAt)
        this.inventory.set(b.id, {
          ...b,
          capturedAt: packet.sent_at_ms,
          receivedAt,
          receivedTick:
            current?.capturedAt === packet.sent_at_ms ? Math.min(current.receivedTick, tick) : tick,
          source: packet.source_id,
          frame: packet.frame_id,
        });
    });
    this.inventoryIssue = '';
    if (record)
      this.record({
        kind: 'inventory',
        received_at_ms: receivedAt,
        received_tick_ms: tick,
        packet,
      });
    return true;
  }
  snapshot(now = Date.now(), connected = true, tick = now) {
    return this.assets.map((a, i) => {
      const p = a.packet,
        profile = this.profiles[i];
      const ageMs = p ? Math.max(0, now - p.sent_at_ms, tick - a.receivedTick) : null;
      const age = ageMs === null ? 0 : ageMs / 1000;
      const status = !connected
        ? 'offline'
        : !p
          ? 'waiting'
          : ageMs > OFFLINE_MS
            ? 'offline'
            : ageMs > FRESH_MS
              ? 'stale'
              : 'fresh';
      const reasons = [];
      if (status !== 'fresh')
        reasons.push(p ? 'Telemetry is not fresh.' : 'No measured telemetry.');
      if (!p?.pose) reasons.push('Position is not measured.');
      if (p?.speed_mps == null) reasons.push('Speed is not measured.');
      if (!profile.frameConfirmed) reasons.push('Map alignment has not been confirmed.');
      if (profile.frameId !== this.facility.frameId)
        reasons.push('Asset and facility map frames do not match.');
      if (a.quarantine) reasons.push(a.quarantine);
      if (a.consecutiveDivergence >= 3)
        reasons.push('Three consecutive model errors exceed the position tolerance.');
      if (age > profile.maxGapS) reasons.push('Capture age exceeds the prediction budget.');
      if (p?.state === 'unknown' || p?.state === 'fault')
        reasons.push('Operating state is unknown or faulted.');
      let eligible = reasons.length === 0;
      const pose =
        eligible && a.posterior
          ? propagatePose(
              a.posterior,
              p.speed_mps,
              p.angular_speed_rps ?? a.omega,
              age,
              profile.speedGain,
            )
          : a.posterior;
      const boundM =
        a.variance === null
          ? null
          : 3 * Math.sqrt(a.variance + Math.pow(profile.processSigmaMps * Math.max(age, 0), 2));
      let predictions =
        eligible && pose
          ? [0, 0.5, 1, 2].map((dt) => ({
              seconds: dt,
              ...propagatePose(
                pose,
                p.speed_mps,
                p.angular_speed_rps ?? a.omega,
                dt,
                profile.speedGain,
              ),
              bound_m:
                3 *
                Math.sqrt((a.variance ?? 0) + Math.pow(profile.processSigmaMps * (age + dt), 2)),
            }))
          : [];
      if (
        predictions.some(
          (q) =>
            q.x_m < 0 || q.x_m > this.facility.widthM || q.y_m < 0 || q.y_m > this.facility.heightM,
        )
      ) {
        eligible = false;
        predictions = [];
        reasons.push('Short-horizon motion would leave the configured map.');
      }
      return {
        ...a,
        profile,
        status,
        ageMs,
        eligible,
        reasons,
        estimatedPose: pose,
        boundM,
        predictions,
        rmseM: rms(a.comparisons.map((x) => x.residual)),
        p95M: percentile(
          a.comparisons.map((x) => x.residual),
          0.95,
        ),
        offsetMs: p ? a.receivedAt - p.sent_at_ms : null,
        physicalEvidence:
          this.provenance === 'live-telemetry' || this.provenance === 'physical-recording',
      };
    });
  }
  inventorySnapshot(now = Date.now(), connected = true, tick = now) {
    return ['A', 'B', 'C', 'D'].map((id) => {
      const b = this.inventory.get(id),
        ageMs = b ? Math.max(0, now - b.capturedAt, tick - b.receivedTick) : null,
        frameMatch = !!b && b.frame === this.facility.frameId;
      return {
        id,
        ...b,
        frameMatch,
        fresh:
          !!b && connected && frameMatch && ageMs <= FRESH_MS && now >= b.capturedAt - FRESH_MS,
        ageMs,
      };
    });
  }
  setProfile(index, changes) {
    const profile = checkedProfile(
      { ...this.profiles[index], ...changes, revision: this.profiles[index].revision + 1 },
      SLOT_IDS[index],
    );
    this.profiles[index] = profile;
    this.rebuildState();
    return profile;
  }
  setFacility(input) {
    this.facility = checkedFacility(input);
    this.profiles = this.profiles.map((p) => ({
      ...p,
      revision: p.revision + 1,
      frameConfirmed: false,
      validation: null,
    }));
    this.rebuildState();
  }
  reanchorAsset(id, at = Date.now(), record = true) {
    const i = SLOT_IDS.indexOf(id);
    if (i < 0) return;
    this.assets[i] = freshAsset(id);
    if (record)
      this.anchorResets.push({
        assetId: id,
        at_ms: at,
        reason: 'Operator re-anchored after checking localization.',
      });
  }
  rebuildState() {
    const events = this.events.slice();
    this.resetState();
    let next = 0;
    for (const e of events) {
      while (this.anchorResets[next] && this.anchorResets[next].at_ms <= e.received_at_ms) {
        const r = this.anchorResets[next++];
        this.reanchorAsset(r.assetId, r.at_ms, false);
      }
      e.kind === 'telemetry'
        ? this.ingest(e.packet, e.received_at_ms, e.received_tick_ms ?? e.received_at_ms, false)
        : this.ingestInventory(
            e.packet,
            e.received_at_ms,
            e.received_tick_ms ?? e.received_at_ms,
            false,
          );
    }
    while (this.anchorResets[next]) {
      const r = this.anchorResets[next++];
      this.reanchorAsset(r.assetId, r.at_ms, false);
    }
  }
  evidence() {
    return {
      schema: 'replenish-twin-recording/v1',
      version: TWIN_VERSION,
      notice: NOTICE,
      provenance: this.provenance,
      exported_at: new Date().toISOString(),
      profiles: this.profiles,
      facility: this.facility,
      anchorResets: this.anchorResets,
      buffer_truncated: this.droppedEvents > 0,
      timing_note:
        'Receive minus capture includes device/browser clock error; it is not a measured one-way network latency.',
      events: this.events,
    };
  }
}

export function percentile(values, q = 0.95) {
  const s = values.slice().sort((a, b) => a - b);
  return s.length ? s[Math.ceil(s.length * q) - 1] : null;
}

export function parseRecording(text) {
  if (new TextEncoder().encode(text).length > 6 * 1024 * 1024)
    throw new Error('Recording must be smaller than 6 MB.');
  const r = JSON.parse(text);
  if (
    r?.schema !== 'replenish-twin-recording/v1' ||
    !['synthetic', 'physical-recording', 'live-telemetry'].includes(r.provenance) ||
    !Array.isArray(r.events) ||
    r.events.length < 1 ||
    r.events.length > 6000
  )
    throw new Error('Use an exported twin recording with 1–6000 events.');
  let last = -Infinity;
  const events = r.events.map((e) => {
    if (
      !e ||
      !Number.isSafeInteger(e.received_at_ms) ||
      e.received_at_ms < last ||
      e.packet?.sent_at_ms > e.received_at_ms + FRESH_MS
    )
      throw new Error(
        'Recording receive times must be ordered and within the allowed capture clock skew.',
      );
    last = e.received_at_ms;
    const packet =
      e.kind === 'telemetry'
        ? decodeTelemetry(JSON.stringify(e.packet), e.packet.device_id, e.received_at_ms)
        : e.kind === 'inventory'
          ? decodeInventory(JSON.stringify(e.packet), e.received_at_ms)
          : null;
    if (!packet || (e.kind === 'telemetry' && !SLOT_IDS.includes(packet.device_id)))
      throw new Error('Recording contains an unknown event or asset.');
    return { kind: e.kind, received_at_ms: e.received_at_ms, packet };
  });
  // Imported provenance is a user declaration, not a certification of authenticity.
  if (r.profiles !== undefined && (!Array.isArray(r.profiles) || r.profiles.length !== 3))
    throw Error('A recording model registry must contain exactly three asset profiles.');
  const profiles = SLOT_IDS.map((id, i) =>
    checkedProfile(r.profiles?.[i] || defaultProfile(id), id),
  );
  if (
    r.anchorResets !== undefined &&
    (!Array.isArray(r.anchorResets) ||
      r.anchorResets.length > 6000 ||
      r.anchorResets.some(
        (a, i) =>
          !SLOT_IDS.includes(a.assetId) ||
          !Number.isSafeInteger(a.at_ms) ||
          (i > 0 && a.at_ms < r.anchorResets[i - 1].at_ms),
      ))
  )
    throw Error('Observer re-anchor history is invalid.');
  return {
    ...r,
    events,
    profiles,
    ...(r.facility ? { facility: checkedFacility(r.facility) } : {}),
    provenance: r.provenance === 'synthetic' ? 'synthetic' : 'physical-recording',
  };
}

export function replayRecording(recording, until = Infinity, profiles = recording.profiles) {
  const engine = new TwinEngine({
    provenance: recording.provenance,
    profiles,
    facility: recording.facility,
  });
  const resets = recording.anchorResets || [];
  let next = 0;
  for (const e of recording.events) {
    if (e.received_at_ms > until) break;
    while (resets[next] && resets[next].at_ms <= e.received_at_ms) {
      const r = resets[next++];
      engine.reanchorAsset(r.assetId, r.at_ms);
    }
    e.kind === 'telemetry'
      ? engine.ingest(e.packet, e.received_at_ms, e.received_at_ms)
      : engine.ingestInventory(e.packet, e.received_at_ms);
  }
  while (resets[next] && resets[next].at_ms <= until) {
    const r = resets[next++];
    engine.reanchorAsset(r.assetId, r.at_ms);
  }
  return engine;
}

export function fitCalibration(events, assetId, profile) {
  const packets = events
    .filter((e) => e.kind === 'telemetry' && e.packet.device_id === assetId)
    .map((e) => e.packet);
  const segments = [];
  let excluded = 0;
  for (let i = 1; i < packets.length; i++) {
    const p = packets[i - 1],
      n = packets[i],
      dt = (n.sent_at_ms - p.sent_at_ms) / 1000;
    if (
      p.boot_id !== n.boot_id ||
      !p.pose ||
      !n.pose ||
      p.state !== 'moving' ||
      n.state !== 'moving' ||
      p.speed_mps == null ||
      p.speed_mps < 0.05 ||
      dt < 0.05 ||
      dt > profile.maxGapS ||
      (p.frame_id && p.frame_id !== profile.frameId) ||
      (n.frame_id && n.frame_id !== profile.frameId) ||
      Math.abs(angleDelta(radians(n.pose.heading_deg), radians(p.pose.heading_deg))) > 0.15
    ) {
      excluded++;
      continue;
    }
    const h = radians(p.pose.heading_deg),
      dx = n.pose.x_m - p.pose.x_m,
      dy = n.pose.y_m - p.pose.y_m;
    const s = p.speed_mps * dt,
      actual = dx * Math.cos(h) + dy * Math.sin(h),
      cross = Math.abs(-dx * Math.sin(h) + dy * Math.cos(h));
    if (
      actual < 0 ||
      Math.hypot(dx, dy) > profile.maxSpeedMps * dt + 6 * profile.poseSigmaM ||
      cross > 6 * profile.poseSigmaM
    ) {
      excluded++;
      continue;
    }
    segments.push({
      s,
      actual,
      dt,
      from: p.sent_at_ms,
      to: n.sent_at_ms,
      speed: p.speed_mps,
      drop: p.battery_pct !== null && n.battery_pct !== null ? p.battery_pct - n.battery_pct : null,
    });
  }
  if (segments.length < 12)
    return {
      ready: false,
      reason:
        'Need at least 12 straight, measured moving intervals; gaps, turns and reboots are excluded.',
      intervals: segments.length,
      excluded,
    };
  const cut = Math.floor(segments.length * 0.7),
    train = segments.slice(0, cut),
    heldOut = segments.slice(cut);
  const rawGain =
    train.reduce((s, r) => s + r.s * r.actual, 0) / train.reduce((s, r) => s + r.s * r.s, 0);
  if (rawGain < 0.5 || rawGain > 1.5)
    return {
      ready: false,
      reason:
        'Fitted speed gain is outside the supported physical envelope. Check units and localization.',
      intervals: segments.length,
      excluded,
    };
  const cruiseMps = median(train.map((r) => r.speed));
  try {
    checkedProfile({ ...profile, speedGain: rawGain, cruiseMps }, assetId);
  } catch (error) {
    return {
      ready: false,
      reason:
        'Fitted model cannot be applied: ' +
        error.message +
        ' Check the configured speed envelope.',
      intervals: segments.length,
      excluded,
    };
  }
  const before = rms(heldOut.map((r) => r.actual - r.s * profile.speedGain));
  const after = rms(heldOut.map((r) => r.actual - r.s * rawGain));
  const energy = train.filter((r) => r.drop !== null && r.drop >= -0.01 && r.drop < 5);
  const duration = energy.reduce((s, r) => s + r.dt, 0),
    drop = energy.reduce((s, r) => s + r.drop, 0);
  const energyRate = duration >= 15 && drop >= 0.1 && drop / duration <= 1 ? drop / duration : null;
  const passes = after <= profile.residualLimitM && after <= before + 1e-9;
  return {
    ready: true,
    passes,
    speedGain: rawGain,
    cruiseMps,
    energyRate,
    trainN: train.length,
    heldOutN: heldOut.length,
    beforeM: before,
    afterM: after,
    excluded,
    energySpanS: duration,
    trainThroughMs: train.at(-1).to,
    holdoutStartMs: heldOut[0].from,
    holdoutThroughMs: heldOut.at(-1).to,
    baselineGain: profile.speedGain,
    reason: passes
      ? 'Chronological holdout meets the configured tolerance and does not degrade the current fit.'
      : 'Holdout does not meet tolerance or worsens the current model. Do not apply.',
  };
}

// Independent synthetic observations, deliberately different from the nominal simulator.
export function referenceRecording(fault = 'nominal') {
  const start = 1760000000000,
    events = [],
    gains = [1.12, 0.88, 1.06];
  for (let step = 0; step <= 100; step++) {
    const t = step * 0.5;
    for (let i = 0; i < 3; i++) {
      if (fault === 'dropout' && i === 1 && t >= 18 && t <= 24) continue;
      const outbound = t < 24,
        moving = t < 48,
        travel = moving ? (outbound ? t : 48 - t) : 0;
      const trueSpeed = 0.24 * gains[i],
        jitter = 0.003 * Math.sin(step * 1.7 + i);
      let x = 1.6 + travel * trueSpeed + jitter;
      if (fault === 'jump' && i === 0 && step === 38) x += 3;
      const packet = {
        v: 1,
        device_id: SLOT_IDS[i],
        boot_id: 'abcdef123456780' + i,
        seq: step,
        sent_at_ms: start + step * 500,
        uptime_ms: step * 500,
        state: moving ? 'moving' : 'idle',
        firmware: 'synthetic-reference-2.0',
        frame_id: 'warehouse-01',
        pose_source: 'external',
        pose_sigma_m: 0.015,
        angular_speed_rps: 0,
        pose: {
          x_m: x,
          y_m: (170 + i * 80) / 75 + 0.002 * Math.cos(step + i),
          heading_deg: outbound || !moving ? 0 : 180,
        },
        speed_mps: moving ? 0.24 : 0,
        battery_pct: 96 - i * 9 - 0.024 * Math.min(t, 48),
        wifi_rssi_dbm: -60 - i * 3,
      };
      events.push({ kind: 'telemetry', packet, received_at_ms: packet.sent_at_ms + 40 });
    }
    if (step % 2 === 0)
      events.push({
        kind: 'inventory',
        received_at_ms: start + step * 500 + 40,
        packet: {
          v: 1,
          source_id: 'synthetic-vision',
          boot_id: 'abcdef0012345678',
          frame_id: 'warehouse-01',
          seq: step,
          sent_at_ms: start + step * 500,
          bins: ['A', 'B', 'C', 'D'].map((id, i) => ({
            id,
            count: Math.floor([64, 48, 77, 39][i] - [0.09, 0.13, 0.07, 0.11][i] * t),
          })),
        },
      });
  }
  return {
    schema: 'replenish-twin-recording/v1',
    version: TWIN_VERSION,
    notice: NOTICE,
    provenance: 'synthetic',
    profiles: SLOT_IDS.map((id) => ({
      ...defaultProfile(id),
      frameConfirmed: true,
      provenance: 'synthetic-assumed',
    })),
    facility: referenceFacility(true),
    events,
  };
}
