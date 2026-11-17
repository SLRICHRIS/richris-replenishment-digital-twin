import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEnvelope, InvalidTelemetry, MAX_BODY_BYTES } from '../contract.mjs';
import { createHandler } from '../handler.mjs';
import { persistRecord } from '../storage.mjs';
import { envelope } from './fixture.mjs';
const secret = 'isolated-test-only-' + 'a'.repeat(48);
const now = Date.now();

test('unsigned observations retain units, metadata, hash and disabled predictions', () => {
  const input = envelope(now);
  const result = validateEnvelope(input, now);
  assert.equal(result.gyro_z_rad_s, .02);
  assert.equal(result.battery_current_a, .5);
  assert.equal(result.received_at.getTime(), now);
  assert.equal(result.left_pulses_total, 3);
  assert.equal(result.left_rpm, null);
  assert.equal(result.predictive_models_ready, false);
  assert.equal(result.direction_measured, false);
  assert.match(result.payload_sha256, /^[a-f0-9]{64}$/);
  input.payload = Object.fromEntries(Object.entries(input.payload).reverse());
  assert.equal(validateEnvelope(input, now).payload_sha256, result.payload_sha256);
});

const bad = {
  'wrong topic': p => p.topic = 'robot/amr01/state',
  'wrong publisher': p => p.username = 'subscriber-amr01',
  'wrong boot binding': p => p.payload.boot_id = 'aaaaaaaaaaaaaaaa',
  'different robot': p => p.payload.robot_id = 'amr02',
  'wrong version': p => p.payload.schema_version = 2,
  'forged wheel direction': p => p.payload.direction_measured = true,
  'forged model readiness': p => p.payload.predictive_models_ready = true,
  'unknown field': p => p.payload.command = 'F',
  'missing field': p => delete p.payload.battery_continuity,
  'unsafe integer count': p => p.payload.left_pulses_total = 9007199254740992,
  'negative count': p => p.payload.right_pulses_total = -1,
  'bad sequence': p => p.payload.seq = true,
  'infinite measurement': p => p.payload.battery_voltage_v = Infinity,
  'NaN gyro': p => p.payload.gyro_z_rad_s = NaN,
  'missing valid gyro': p => p.payload.gyro_dps = null,
  'gyro units inconsistent': p => p.payload.gyro_z_rad_s = 100,
  'stale gyro channel': p => p.payload.imu_sample_time_s = 9,
  'future gyro channel': p => p.payload.imu_sample_time_s = 11,
  'stale battery channel': p => p.payload.battery_sample_time_s = 8,
  'inconsistent battery power': p => p.payload.battery_power_w = 100,
  'unconfirmed RPM claimed': p => p.payload.left_rpm = 120,
  'invalid starting SOC': p => p.payload.soc_estimate_percent = 101,
  'unknown motion': p => p.payload.commanded_motion = '<script>',
  'future broker time': p => p.broker_received_at_ms = now + 60000,
};
for (const [label, mutate] of Object.entries(bad)) test('rejects ' + label, () => {
  const p = envelope(now); mutate(p);
  assert.throws(() => validateEnvelope(p, now), InvalidTelemetry);
});

test('unavailable channels remain null; low voltage is recorded with an attention note', () => {
  const p = envelope(now);
  p.payload.gyro_available = false;
  for (const field of ['imu_sample_time_s', 'accel_g', 'gyro_dps', 'gyro_z_rad_s', 'yaw_estimate_deg']) p.payload[field] = null;
  p.payload.battery_voltage_v = p.payload.battery_bus_voltage_v = .82;
  p.payload.battery_power_w = .41;
  const r = validateEnvelope(p, now);
  assert.equal(r.accel_x_g, null);
  assert(r.quality_notes.includes('battery_source_needs_check'));
  assert.equal(r.predictive_models_ready, false);
});

test('old broker time is preserved during retry rather than replaced with ingest time', () => {
  const p = envelope(now - 86400000);
  p.payload = JSON.stringify(p.payload);
  assert.equal(validateEnvelope(p, now).received_at.getTime(), now - 86400000);
});

function request(body, auth = 'Bearer ' + secret, options = {}) {
  return new Request('https://test.invalid/ingest', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', ...options.headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
test('authentication rejects before reading any body or touching storage', async () => {
  let reads = 0;
  const handler = createHandler({ secret, persist: () => assert.fail('unexpected database access'), healthcheck: () => assert.fail('unexpected healthcheck') });
  const response = await handler({ headers: new Headers(), get body() { reads++; throw new Error('must not read'); } });
  assert.equal(response.status, 401); assert.equal(reads, 0);
});
test('bounded input, content type and validation stop writes', async () => {
  const handler = createHandler({ secret, persist: () => assert.fail('invalid input written'), healthcheck: async () => {} });
  assert.equal((await handler(request('x'.repeat(MAX_BODY_BYTES + 1)))).status, 413);
  assert.equal((await handler(request('{}', undefined, { headers: { 'content-type': 'text/plain' } }))).status, 415);
  assert.equal((await handler(request('{broken'))).status, 400);
  const p = envelope(now); p.payload.direction_measured = true;
  assert.equal((await handler(request(p))).status, 400);
});
test('storage success, retries, identity collisions and failures are distinct and sanitized', async () => {
  for (const [outcome, status] of [['stored', 201], ['duplicate', 200], ['conflict', 409]]) {
    const handler = createHandler({ secret, persist: async () => outcome, healthcheck: async () => {}, now: () => now });
    assert.equal((await handler(request(envelope(now)))).status, status);
  }
  const handler = createHandler({ secret, persist: async () => { throw new Error('postgresql://private:password@host/db'); }, healthcheck: async () => {} });
  const response = await handler(request(envelope(now)));
  assert.equal(response.status, 503);
  assert(!/password|private|host/.test(await response.text()));
});
test('health requires authentication and an actually readable table', async () => {
  const handler = createHandler({ secret, persist: async () => 'stored', healthcheck: async () => { throw new Error('missing table'); } });
  assert.equal((await handler(new Request('https://test.invalid/health'))).status, 401);
  assert.equal((await handler(new Request('https://test.invalid/health', { headers: { authorization: 'Bearer ' + secret } }))).status, 503);
});
test('storage never updates existing evidence or its receive time', async () => {
  const record = validateEnvelope(envelope(now), now);
  for (const [row, expected] of [[{ payload_sha256: record.payload_sha256 }, 'duplicate'], [{ payload_sha256: 'different' }, 'conflict']]) {
    const queries = [];
    const pool = { async query(sql, values) { queries.push([sql, values]); return queries.length === 1 ? { rowCount: 0 } : { rows: [row] }; } };
    assert.equal(await persistRecord(pool, record), expected);
    assert(queries[0][0].includes('ON CONFLICT (robot_id,boot_id,seq) DO NOTHING'));
    assert(!/DO UPDATE|DELETE|TRUNCATE/.test(queries[0][0]));
  }
});

test('rejection diagnostics identify routes without exposing request or database secrets', async () => {
  const entries = [];
  let clock = now;
  const handler = createHandler({ secret, persist: async () => { throw new Error('private-database-password'); }, healthcheck: async () => {}, now: () => clock, reportRejection: entry => entries.push(entry) });
  const invalid = envelope(now); invalid.payload.direction_measured = true;
  invalid.payload.accel_g = [12345.6789, 0, 0];
  assert.equal((await handler(request(invalid))).status, 400);
  assert.equal((await handler(request(invalid))).status, 400);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 400);
  assert.equal(entries[0].route, 'ingest');
  assert.match(entries[0].validation_stack, /validateEnvelope/);
  clock += 10001;
  await handler(request(invalid));
  assert.equal(entries.length, 2);
  assert.equal((await handler(new Request('https://test.invalid//ingest?token=private-query', { headers: { authorization: 'Bearer ' + secret } }))).status, 404);
  assert.equal(entries.at(-1).route, 'double_slash_ingest');
  assert.equal((await handler(request(envelope(now)))).status, 503);
  assert.equal(entries.at(-1).status, 503);
  assert(!JSON.stringify(entries).match(/private-query|private-database-password|12345|isolated-test-only|Bearer/));
});

test('a failed diagnostic sink cannot change authorization or rejection behavior', async () => {
  const handler = createHandler({ secret, persist: () => assert.fail('unexpected write'), healthcheck: async () => {}, reportRejection: () => { throw new Error('logger unavailable'); } });
  assert.equal((await handler(request('{}', 'wrong'))).status, 401);
  assert.equal((await handler(request('{broken'))).status, 400);
});
