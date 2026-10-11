// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
export const SLOT_IDS = ['amr-01', 'amr-02', 'amr-03'];
export const FRESH_MS = 5000;
export const OFFLINE_MS = 15000;
export const STATES = ['unknown', 'idle', 'moving', 'paused', 'charging', 'fault'];

export function connectionConfig({ url, username, password, prefix }) {
  let endpoint;
  try { endpoint = new URL(url.trim()); } catch { throw new Error('Enter a valid secure WebSocket broker address.'); }
  if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
    throw new Error('Use a wss:// address without credentials, query parameters or a fragment.');
  }
  const topicPrefix = prefix.trim().replace(/\/+$/, '');
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(topicPrefix) || topicPrefix.length > 120) {
    throw new Error('Topic prefix must contain letters, numbers, hyphens, underscores or slash-separated names.');
  }
  if (!username.trim() || !password) throw new Error('Enter the broker’s read-only username and password.');
  return { url: endpoint.href, username: username.trim(), password, prefix: topicPrefix,
    topics: SLOT_IDS.map(id => `${topicPrefix}/${id}/telemetry`), inventoryTopic: `${topicPrefix}/inventory` };
}

function measurement(value, min, max, field) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} is missing or outside its permitted range.`);
  }
  return value;
}

export function decodeTelemetry(payload, expectedId, now = Date.now()) {
  if ((typeof payload === 'string' ? new TextEncoder().encode(payload).length : payload.length) > 4096) throw new Error('Packet exceeds the 4 KB telemetry limit.');
  let p;
  try { p = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder('utf-8', { fatal: true }).decode(payload)); }
  catch { throw new Error('Packet is not valid UTF-8 JSON.'); }
  if (!p || Array.isArray(p) || p.v !== 1 || p.device_id !== expectedId) throw new Error('Packet version or device identity does not match this slot.');
  if (typeof p.boot_id !== 'string' || !/^[a-fA-F0-9]{8,32}$/.test(p.boot_id)) throw new Error('Packet needs a valid boot identifier.');
  if (!Number.isSafeInteger(p.seq) || p.seq < 0) throw new Error('Packet sequence is invalid.');
  if (!Number.isSafeInteger(p.sent_at_ms) || p.sent_at_ms < now - OFFLINE_MS || p.sent_at_ms > now + FRESH_MS) {
    throw new Error('Device timestamp is stale or ahead of this browser. Check clock synchronization.');
  }
  if (!Number.isSafeInteger(p.uptime_ms) || p.uptime_ms < 0) throw new Error('Device uptime is invalid.');
  if (!STATES.includes(p.state)) throw new Error('Device state is not recognized.');
  if (typeof p.firmware !== 'string' || !/^[a-zA-Z0-9._-]{1,48}$/.test(p.firmware)) throw new Error('Firmware identifier is invalid.');
  let pose = null;
  if (p.pose !== null) {
    if (!p.pose || Array.isArray(p.pose)) throw new Error('Position must be a measured pose or null.');
    pose = { x_m: measurement(p.pose.x_m, 0, 12, 'X position'), y_m: measurement(p.pose.y_m, 0, 6.6667, 'Y position'),
      heading_deg: measurement(p.pose.heading_deg, -360, 360, 'Heading') };
    if (Object.values(pose).includes(null)) throw new Error('A pose requires X, Y and heading; use null until localization is ready.');
  }
  if (p.frame_id != null && (typeof p.frame_id !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(p.frame_id))) throw new Error('Map frame identifier is invalid.');
  if (p.pose_source != null && !['encoder_odometry', 'overhead_camera', 'uwb', 'external'].includes(p.pose_source)) throw new Error('Pose source is invalid.');
  const poseSigma = p.pose_sigma_m === undefined ? null : measurement(p.pose_sigma_m, .001, 2, 'Pose uncertainty');
  const angular = p.angular_speed_rps === undefined ? null : measurement(p.angular_speed_rps, -10, 10, 'Angular speed');
  return { v: 1, device_id: p.device_id, boot_id: p.boot_id, seq: p.seq, sent_at_ms: p.sent_at_ms,
    uptime_ms: p.uptime_ms, state: p.state, firmware: p.firmware, pose,
    battery_pct: measurement(p.battery_pct, 0, 100, 'Battery'),
    speed_mps: measurement(p.speed_mps, 0, 10, 'Speed'),
    wifi_rssi_dbm: measurement(p.wifi_rssi_dbm, -127, 0, 'Wi-Fi signal'),
    frame_id: p.frame_id ?? null, pose_source: p.pose_source ?? null,
    pose_sigma_m: poseSigma, angular_speed_rps: angular };
}

export class TelemetryStore {
  constructor() { this.reset(); }
  reset() { this.slots = SLOT_IDS.map(id => ({ id, data: null, receivedAt: 0, receivedTick: 0, accepted: 0, rejected: 0, issue: '', retiredBoots: [], samples: [], reboots: 0, sequenceGaps: 0, lastRejectedAt: null, lastIssue: '' })); }
  ingest(index, payload, packet = {}, now = Date.now(), tick = performance.now()) {
    const slot = this.slots[index];
    if (!slot) return false;
    try {
      if (packet.retain) throw new Error('Retained packet ignored. Waiting for a fresh device update.');
      const next = decodeTelemetry(payload, slot.id, now), previous = slot.data;
      if (previous && (next.sent_at_ms < previous.sent_at_ms || slot.retiredBoots.includes(next.boot_id) ||
        (next.boot_id === previous.boot_id && next.seq <= previous.seq))) throw new Error('Duplicate or out-of-order packet ignored.');
      const reboot = previous && previous.boot_id !== next.boot_id;
      const gap = previous && !reboot ? Math.max(0, next.seq - previous.seq - 1) : 0;
      if (reboot) { slot.retiredBoots = [...slot.retiredBoots, previous.boot_id].slice(-32); slot.reboots++; }
      slot.sequenceGaps += gap;
      slot.samples.push({ tick, offset: now - next.sent_at_ms, gap, boot: next.boot_id });
      slot.samples = slot.samples.filter(sample => tick - sample.tick <= 60000).slice(-120);
      slot.data = next; slot.receivedAt = now; slot.receivedTick = tick; slot.accepted++; slot.issue = ''; return true;
    } catch (error) { slot.rejected++; slot.issue = error.message; slot.lastIssue = error.message; slot.lastRejectedAt = now; return false; }
  }
  snapshot(connected, now = Date.now(), tick = performance.now()) {
    return this.slots.map(slot => {
      const age = slot.data ? Math.max(0, now - slot.data.sent_at_ms, tick - slot.receivedTick) : null;
      const status = !connected ? 'offline' : !slot.data ? 'waiting' : age <= FRESH_MS ? 'live' : age <= OFFLINE_MS ? 'stale' : 'offline';
      const recent = slot.samples.filter(sample => tick - sample.tick <= 60000);
      const intervals = recent.slice(1).flatMap((sample, i) => sample.boot === recent[i].boot ? [sample.tick - recent[i].tick] : []);
      const span = recent.length > 1 ? recent.at(-1).tick - recent[0].tick : 0;
      const percentile = values => { const ordered = values.slice().sort((a, b) => a - b); return ordered.length ? ordered[Math.ceil(ordered.length * .95) - 1] : null; };
      const measurements = slot.data ? { pose: !!slot.data.pose, battery: slot.data.battery_pct !== null, speed: slot.data.speed_mps !== null, state: slot.data.state !== 'unknown' } : { pose: false, battery: false, speed: false, state: false };
      return { ...slot, age, status, tracked: status === 'live' && !!slot.data.pose, measurements,
        diagnostics: { rateHz: span > 0 ? (recent.length - 1) * 1000 / span : null,
          p95OffsetMs: recent.length >= 5 ? percentile(recent.map(s => s.offset)) : null,
          p95IntervalMs: intervals.length >= 4 ? percentile(intervals) : null,
          windowGaps: recent.reduce((sum, sample) => sum + sample.gap, 0), windowSamples: recent.length, intervals: intervals.slice(-30) } };
    });
  }
}
