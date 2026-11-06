import { BIN_DESTINATIONS } from '../../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  TwinEngine,
  defaultProfile,
  checkedProfile,
  propagatePose,
  fitCalibration,
  referenceRecording,
  replayRecording,
  parseRecording,
  decodeInventory,
} from '../../frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js';
import { comparePolicies } from '../../frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/compare_dispatch_policies_with_shared_inputs.js';
import { observedDemand } from '../../frontend_warehouse_dashboard/browser_modules/robot_state_models_and_policy_experiments/robot_model_validation_and_experiment_panel.js';
import { decodeTelemetry } from '../../frontend_warehouse_dashboard/browser_modules/esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness.js';
import {
  referenceFacility,
  checkedFacility,
  graphRoute,
  travelledMetres,
} from '../../frontend_warehouse_dashboard/browser_modules/shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';

const now = 1760000000000;
const p = (seq, x, extra = {}) => ({
  v: 1,
  device_id: 'amr-01',
  boot_id: '01234567abcdef00',
  seq,
  sent_at_ms: now + seq * 1000,
  uptime_ms: seq * 1000,
  state: 'moving',
  firmware: 'test-2.0',
  pose: { x_m: x, y_m: 2, heading_deg: 0 },
  battery_pct: 90 - seq * 0.03,
  speed_mps: 0.5,
  wifi_rssi_dbm: -60,
  frame_id: 'warehouse-01',
  pose_source: 'external',
  angular_speed_rps: 0,
  ...extra,
});
const configured = (id) => ({ ...defaultProfile(id), frameConfirmed: true });
const engine = new TwinEngine({ profiles: ['amr-01'].map(configured) });
assert(engine.ingest(p(0, 1), now + 20, 0));
assert(engine.ingest(p(1, 1.6), now + 1020, 1000));
let s = engine.snapshot(now + 1020, true, 1000)[0];
assert(Math.abs(s.residual - 0.1) < 1e-12, 'Error is measured before the observer corrects itself');
assert(
  s.estimatedPose.x_m > 1.5 && s.estimatedPose.x_m < 1.6,
  'Posterior blends prediction with measurement',
);
assert(s.eligible);
assert.equal(s.predictions.length, 4);
assert(s.predictions.at(-1).bound_m > s.boundM);
assert(!engine.ingest(p(1, 1.6), now + 1100, 1100), 'Duplicate cannot refresh observer');
assert(
  !engine.snapshot(now + 4500, true, 4500)[0].eligible,
  'Prediction expires before transport freshness',
);
assert.equal(engine.snapshot(now + 6500, true, 6500)[0].status, 'stale');
assert.equal(
  engine.snapshot(now - 100000, true, 18000)[0].status,
  'offline',
  'Monotonic expiry survives wall-clock reversal',
);
assert(
  !engine.snapshot(now + 1020, false, 1000)[0].eligible,
  'Disconnect removes prediction eligibility',
);
assert.throws(() => checkedProfile({ ...configured('amr-01'), speedGain: 3 }));
assert.throws(() => checkedProfile({ ...configured('amr-01'), maxSpeedMps: 0.1 }));
const missing = new TwinEngine();
missing.ingest(p(0, 1, { battery_pct: null, speed_mps: null, pose: null, state: 'unknown' }));
assert(!missing.snapshot(now)[0].eligible);
assert.equal(missing.snapshot(now)[0].boundM, null);
const badFrame = new TwinEngine({ profiles: ['amr-01'].map(configured) });
badFrame.ingest(p(0, 1, { frame_id: 'another-map' }));
assert(!badFrame.snapshot(now)[0].eligible);
assert(badFrame.snapshot(now)[0].quarantine);
const jump = new TwinEngine({ profiles: ['amr-01'].map(configured) });
jump.ingest(p(0, 1));
jump.ingest(p(1, 5));
assert(!jump.snapshot(now + 1000)[0].eligible);
assert.equal(jump.snapshot(now + 1000)[0].estimatedPose, null);
jump.ingest(p(2, 1.5));
jump.ingest(p(3, 2));
assert(
  !jump.snapshot(now + 3000)[0].eligible,
  'Quarantine is not silently released by continued packets',
);
jump.ingest(p(7, 2));
assert(jump.snapshot(now + 7000)[0].eligible, 'A discontinuity re-establishes an anchor');
const divergence = new TwinEngine({
  profiles: ['amr-01'].map((id) => ({
    ...configured(id),
    residualLimitM: 0.05,
  })),
});
for (let i = 0; i <= 3; i++) divergence.ingest(p(i, 1 + i * 0.65));
assert(!divergence.snapshot(now + 3000)[0].eligible);
assert.equal(divergence.assets[0].consecutiveDivergence, 3);
const turn = propagatePose({ x_m: 1, y_m: 1, heading_deg: 0 }, 1, Math.PI / 2, 1);
assert(Math.abs(turn.x_m - 1 - 2 / Math.PI) < 1e-12);
assert(Math.abs(turn.y_m - 1 - 2 / Math.PI) < 1e-12);
assert.equal(propagatePose({ x_m: 1, y_m: 1, heading_deg: 0 }, 0, 0, 2).x_m, 1);

for (const fault of ['nominal', 'dropout', 'jump']) {
  const reference = referenceRecording(fault),
    parsed = parseRecording(JSON.stringify(reference)),
    observer = replayRecording(parsed);
  assert.equal(observer.provenance, 'synthetic');
  assert.equal(observer.assets.length, 1);
  const end = reference.events.at(-1).received_at_ms,
    states = observer.snapshot(end);
  if (fault === 'nominal') assert(states.every((s) => s.eligible));
  if (fault === 'dropout') {
    const gapAt = reference.events[0].received_at_ms + 21000,
      paused = replayRecording(parsed, gapAt);
    assert(!paused.snapshot(gapAt)[0].eligible);
    assert(observer.assets[0].discontinuities > 0);
  }
  if (fault === 'jump') assert(!states[0].eligible);
  for (let i = 0; i < 1; i++) {
    const fit = fitCalibration(observer.events, 'amr-0' + (i + 1), observer.profiles[i]);
    assert(fit.ready);
    assert(fit.passes);
    assert(fit.afterM < fit.beforeM * 0.5);
    assert(fit.heldOutN >= 4);
    assert(fit.energyRate !== null);
    assert(Math.abs(fit.energyRate - 0.024) < 1e-10);
  }
  assert.deepEqual(
    replayRecording(parsed).assets.map((a) => a.posterior),
    observer.assets.map((a) => a.posterior),
    'Replay is deterministic',
  );
}
const ref = referenceRecording(),
  observed = replayRecording(ref),
  fit = fitCalibration(observed.events, 'amr-01', observed.profiles[0]);
assert(Math.abs(fit.speedGain - 1.12) < 0.003);
assert(!fitCalibration([], 'amr-01', configured('amr-01')).ready);
const revision = observed.setProfile(0, { speedGain: fit.speedGain });
assert.equal(revision.revision, 2);
assert(observed.snapshot(ref.events.at(-1).received_at_ms)[0].rmseM < 0.03);
assert.equal(parseRecording(JSON.stringify(observed.evidence())).provenance, 'synthetic');
assert.equal(observedDemand(observed).filter((r) => r.rate !== null).length, 4);
const broken = structuredClone(ref);
broken.events[1].received_at_ms = 0;
assert.throws(() => parseRecording(JSON.stringify(broken)));
const invalid = structuredClone(ref);
invalid.events[0].packet.device_id = 'amr-04';
assert.throws(() => parseRecording(JSON.stringify(invalid)));
const malicious = structuredClone(ref);
malicious.profiles[0].frameId = '<script>';
assert.throws(() => parseRecording(JSON.stringify(malicious)));
const legacy = decodeTelemetry(
  JSON.stringify(p(0, 1, { frame_id: undefined, pose_source: undefined })),
  'amr-01',
  now,
);
assert.equal(
  decodeTelemetry(JSON.stringify(legacy), 'amr-01', now).frame_id,
  null,
  'Normalized legacy packets round-trip',
);

const inv = {
  v: 1,
  source_id: 'labview-vision',
  frame_id: 'warehouse-01',
  boot_id: 'abcdef1234567890',
  seq: 0,
  sent_at_ms: now,
  bins: [
    { id: 'A', count: 0 },
    { id: 'B', count: 42 },
  ],
};
assert.equal(decodeInventory(JSON.stringify(inv), now).bins[0].count, 0);
assert.throws(() =>
  decodeInventory(
    JSON.stringify({
      ...inv,
      bins: [
        { id: 'A', count: 1 },
        { id: 'A', count: 2 },
      ],
    }),
    now,
  ),
);
assert.throws(() =>
  decodeInventory(JSON.stringify({ ...inv, bins: [{ id: 'A', count: -1 }] }), now),
);
assert.throws(() => decodeInventory(JSON.stringify({ ...inv, sent_at_ms: now - 16000 }), now));
assert(observed.ingestInventory(inv));
assert(!observed.ingestInventory(inv));
assert(
  !observed.inventorySnapshot(now + 6000)[0].fresh,
  'Stale counts cannot be used in experiments',
);
assert(!observed.inventorySnapshot(now, false)[0].fresh);

const snapshot = {
  provenance: 'simulation',
  units: [0].map((i) => ({
    id: 'amr-0' + (i + 1),
    x_m: 1.6,
    y_m: 250 / 75,
    battery_pct: 90 - i * 5,
    state: 'idle',
    profile: configured('amr-0' + (i + 1)),
  })),
  bins: ['A', 'B', 'C', 'D'].map((id, i) => ({
    id,
    count: [64, 48, 77, 39][i],
    rate: [0.09, 0.13, 0.07, 0.11][i],
    x_m: BIN_DESTINATIONS[i].x / 75,
    y_m: BIN_DESTINATIONS[i].y / 75,
  })),
};
const options = { horizonS: 120, demandMultiplier: 5, speedFactor: 1, policy: 'urgency' },
  before = JSON.stringify(snapshot),
  comparison = comparePolicies(snapshot, options);
assert.equal(JSON.stringify(snapshot), before, 'Neither branch mutates the live state');
assert.deepEqual(
  comparePolicies(snapshot, options),
  comparison,
  'Same state and disturbances produce the same results',
);
for (const branch of [comparison.baseline, comparison.proposal]) {
  assert(branch.projectedBatteries.every((b) => Number.isFinite(b) && b >= 15));
  assert(branch.finalStock.every((n) => n >= 0 && n <= 100));
  const trips = branch.schedule.filter((x) => !x.blocked);
  for (const unit of snapshot.units) {
    const assigned = trips.filter((t) => t.unit === unit.id).sort((a, b) => a.start - b.start);
    for (let i = 1; i < assigned.length; i++)
      assert(
        assigned[i].start >= assigned[i - 1].release,
        'A unit cannot run two journeys at once',
      );
  }
}
assert(comparison.baseline.unmetUnits >= 0 && comparison.proposal.unmetUnits >= 0);

const off = comparePolicies(snapshot, { ...options, policy: 'maintenance' });
assert(off.proposal.schedule.every((s) => s.unit !== 'amr-01'));
const low = structuredClone(snapshot);
low.units.forEach((u) => (u.battery_pct = 15));
assert.equal(comparePolicies(low, options).baseline.blocked, 4);
const moving = structuredClone(snapshot);
moving.units[0].state = 'moving';
assert.throws(() => comparePolicies(moving, options));
assert.throws(() => comparePolicies(snapshot, { ...options, horizonS: 0 }));
const map = referenceFacility(true);
assert.equal(checkedFacility(map).nodes.length, 19);
const route = graphRoute(map, 'bay01', 'binD', 0.5, 0.25);
assert(route.seconds > graphRoute(map, 'bay01', 'binD', 0.5, 1).seconds);
assert(Math.abs(travelledMetres(route.segments, route.seconds) - route.metres) < 1e-9);
const oneWay = structuredClone(map);
oneWay.edges.find((e) => e.to === 'binD').bidirectional = false;
assert(checkedFacility(oneWay), 'An alternative return keeps a one-way link usable');
const directed = structuredClone(map);
directed.edges = directed.edges.map((e) =>
  e.from === 'binD'
    ? { from: e.to, to: 'binD', bidirectional: false }
    : e.to === 'binD'
      ? { ...e, bidirectional: false }
      : e,
);
assert.throws(() => checkedFacility(directed), 'A one-way trap cannot be commissioned');
const disconnected = structuredClone(map);
disconnected.edges = disconnected.edges.filter((e) => e.to !== 'binD' && e.from !== 'binD');
assert.throws(() => checkedFacility(disconnected));
const wrongBay = structuredClone(snapshot);
wrongBay.units[0].x_m = 5;
assert.throws(() => comparePolicies(wrongBay, options));
const physical = structuredClone(snapshot);
physical.provenance = 'live-telemetry';
physical.facility = map;
assert.throws(
  () => comparePolicies(physical, options),
  'Nominal models cannot support physical reserve decisions',
);
jump.reanchorAsset('amr-01', now + 7100);
jump.ingest(p(8, 2.5), now + 8020, 8020);
assert(jump.snapshot(now + 8020, true, 8020)[0].eligible);
const recovered = replayRecording(parseRecording(JSON.stringify(jump.evidence())));
assert.equal(recovered.assets[0].posterior.x_m, jump.assets[0].posterior.x_m);
assert.equal(recovered.anchorResets.length, 1);
let reply;
const workerContext = { self: { postMessage: (r) => (reply = r) }, comparePolicies };
vm.createContext(workerContext);
vm.runInContext(
  fs
    .readFileSync(
      new URL(
        '../../frontend_warehouse_dashboard/browser_modules/background_calculation_workers/dispatch_policy_experiment_worker.js',
        import.meta.url,
      ),
      'utf8',
    )
    .replace(/^import[\s\S]*?;\s*$/gm, ''),
  workerContext,
);
workerContext.self.onmessage({ data: { requestId: 71, snapshot, options } });
assert.equal(reply.requestId, 71);
assert.deepEqual(reply.result, comparison);
workerContext.self.onmessage({
  data: { requestId: 72, snapshot, options: { ...options, policy: 'invalid' } },
});
assert.equal(reply.requestId, 72);
assert(reply.error.includes('policy'));
console.log(
  'PASS: observer causality, uncertainty growth, missing/old data, frame/jump/divergence gates, chronological holdout, energy fitting, three-asset fault replay, strict imports, legacy packets, stock freshness, deterministic paired policies, reserves and concurrent time-window journeys.',
);
console.log(
  JSON.stringify({
    syntheticHoldout: {
      gain: fit.speedGain,
      before_m: fit.beforeM,
      after_m: fit.afterM,
      train: fit.trainN,
      holdout: fit.heldOutN,
    },
    pairedReference: {
      fifoUnmet: comparison.baseline.unmetUnits,
      urgencyUnmet: comparison.proposal.unmetUnits,
    },
  }),
);
