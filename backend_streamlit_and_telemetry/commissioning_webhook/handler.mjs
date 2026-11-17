import { createHash, timingSafeEqual } from 'node:crypto';
import { InvalidTelemetry, MAX_BODY_BYTES, validateEnvelope } from './contract.mjs';

class BodyTooLarge extends Error {}
async function readBoundedJSON(request) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new BodyTooLarge();
  if (!request.body) throw new InvalidTelemetry();
  const reader = request.body.getReader();
  const parts = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new BodyTooLarge(); }
      parts.push(value);
    }
    try { return JSON.parse(Buffer.concat(parts, length).toString('utf8')); }
    catch { throw new InvalidTelemetry(); }
  } finally { reader.releaseLock(); }
}

export function createHandler({ secret, persist, healthcheck, now = Date.now, reportRejection = entry => console.warn(JSON.stringify(entry)) }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('A private webhook secret is required');
  const expected = createHash('sha256').update('Bearer ' + secret).digest();
  // Sample diagnostics per status/route, per isolate. This never limits ingestion.
  // Only controlled labels and our own validation stack may reach the log.
  const lastReported = new Map();
  const report = (status, route, error) => {
    const time = now(), key = status + ':' + route;
    if (lastReported.has(key) && time - lastReported.get(key) < 10000) return;
    lastReported.set(key, time);
    const entry = { event: 'amr_ingest_rejected', status, route };
    if (error instanceof InvalidTelemetry) entry.validation_stack = error.stack;
    try { reportRejection(entry); } catch { /* Diagnostics must not change the response. */ }
  };
  return async function fetch(request) {
    let route = 'unverified';
    const reply = (body, status = 200, error = null) => {
      if (status >= 400) report(status, route, error);
      return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
    };
    // Authentication precedes reading a body or touching the database.
    const provided = request.headers.get('authorization') || '';
    if (provided.length > 256 || !timingSafeEqual(expected, createHash('sha256').update(provided).digest())) return reply({ error: 'Unauthorized' }, 401);
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    route = path === '/ingest' ? 'ingest' : path === '//ingest' ? 'double_slash_ingest' : path === '/' ? 'root' : path === '/health' ? 'health' : 'other';
    if ((request.method === 'GET' || request.method === 'HEAD') && (path === '/' || path === '/health')) {
      try {
        await healthcheck();
        return request.method === 'HEAD' ? new Response(null, { status: 200 }) : reply({ ok: true, storage: 'ready', models_ready: false });
      } catch { return reply({ error: 'Storage unavailable' }, 503); }
    }
    if (path !== '/ingest') return reply({ error: 'Not found' }, 404);
    if (request.method !== 'POST') {
      report(405, route);
      return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply({ error: 'Use application/json' }, 415);
    let record;
    try { record = validateEnvelope(await readBoundedJSON(request), now()); }
    catch (error) {
      if (error instanceof BodyTooLarge) return reply({ error: 'Body too large' }, 413);
      return reply({ error: 'Invalid telemetry' }, 400, error);
    }
    try {
      const outcome = await persist(record);
      if (outcome === 'conflict') return reply({ error: 'Packet identity already has different evidence' }, 409);
      return reply({ ok: true, result: outcome, robot_id: record.robot_id, seq: record.seq, models_ready: false }, outcome === 'stored' ? 201 : 200);
    } catch {
      return reply({ error: 'Storage unavailable' }, 503);
    }
  };
}
