# Physical AMR-01 sensor recording

The installed ESP32 sends `mh_ir_commissioning` observations to
`robot/amr01/commissioning`. EMQX forwards that exact topic to an authenticated
HTTPS receiver on Neon Functions. The receiver validates the device packet and
writes `amr_commissioning_samples`. The existing Streamlit reader displays these
stored measurements in **Sensor models → Stored sensor data → Device telemetry**.
No worker runs on the lab laptop or in a Streamlit rerun.

Both Sensor models and the separate Detailed readings view show Device telemetry
before measured calibration is confirmed. The calibration warning applies to
model estimates, while raw observations retain their freshness and quality
warnings. Inspect stored packets opens the Device telemetry dataset directly;
empty calibrated-model tables do not establish that no device packets exist.
The shared dashboard archive also defaults to Device telemetry and allows that
dataset through the read-only component bridge. Calibrated sensor samples names
the separate model-input table explicitly; it is not an all-packet archive.
The record grid puts packet identity and sensor values before metadata, keeps
rows on one line, and clips long JSON cells visually. Hover text and the JSON
export retain complete values; no fields or stored evidence are discarded.

The model cards also show fresh raw yaw rate, battery voltage, current and power
when calibrated model state is unavailable. Those input fields retain their
device-observation labels; wheel travel, pose, calibrated bias, SOC, accumulated
energy, residuals and forecasts remain unavailable until their model requirements
are met. Stale observations are withheld from both readout locations.

## Storage and interpretation

| Field group | Stored attributes | Interpretation |
| --- | --- | --- |
| Packet identity | `robot_id`, `boot_id`, `seq`, `client_id`, `topic` | One immutable record per device boot and sequence |
| Times | `sample_time_s`, per-sensor sample times, `received_at`, `stored_at` | Device uptime, broker receive time and database write time remain distinct |
| Wheels | Unsigned totals, pulse rates, optional RPM magnitudes, calibration claim | Counts cannot establish actual wheel direction |
| IMU | Acceleration, gyro rates, bias estimate, relative yaw estimate, availability | Sensor values and device estimates retain their units and availability |
| Battery | Bus/shunt/input voltage, signed current, voltage × current power, continuity, device SOC claim | SOC claims are retained for inspection but never promoted to verified battery percentage |
| Evidence | Semantic JSON payload, canonical SHA-256, quality notes | Original wire bytes are not claimed to be retained |

The table has 47 typed columns and a `(robot_id, boot_id, seq)` primary key.
An identical retry is acknowledged without changing evidence or receive time.
A different payload with the same identity is rejected with HTTP 409.
Five concurrent copies still produce one row. The table does not feed signed
odometry or create records in `amr_twin_states`.

The website uses broker receive time for freshness, never database write time.
Values older than five seconds, or over one second in the future, are withheld
from live readouts. The bounded archive remains available. No network latency
or hard real-time guarantee follows from these timestamps.

## Receiver

Source: [commissioning webhook](../backend_streamlit_and_telemetry/commissioning_webhook/index.mjs).

The Node.js 24 handler requires these private environment variables:

- `AMR_WRITER_DATABASE_URL`: the restricted `amr_worker` connection, using TLS.
- `AMR_WEBHOOK_SECRET`: a dedicated random secret of at least 32 characters.

All routes authenticate `Authorization: Bearer <private webhook secret>` before
reading a body or accessing storage. The secret stays in server/EMQX settings.
The receiver has no browser CORS route and never exposes database credentials.
It bounds bodies to 16 KiB, accepts the configured publisher and topic only,
checks the boot/client binding, rejects non-finite values and inconsistent
units, and preserves null channels. Database errors return a sanitized 503.
All 36 core device fields are required. Additional finite JSON fields are
retained in the semantic payload and its hash, with an
`additional_device_fields_unmodeled` quality note. They never replace typed
measurements, confirm calibration, enable predictions or dispatch commands.
JSON nesting is bounded to protect validation and canonicalization.
Rejected requests emit sampled status/route diagnostics. Validation failures
include the receiver's validation stack and, for a payload-shape mismatch,
expected missing field names and counts. Arbitrary field names, request headers,
sensor values, request URLs and database exception details are never logged.
Sampling bounds logs per status/route on each isolate and does not throttle ingestion.

| Request | Result |
| --- | --- |
| Authenticated `GET /` or `GET /health` | 200 only when all recording columns can be read |
| Authenticated `POST /ingest` | 201 stored, 200 identical retry, 409 identity conflict |
| No valid secret | 401 before body parsing or database work |
| Invalid telemetry / oversized body / wrong content type | 400 / 413 / 415 |
| Storage unavailable | 503; EMQX must retry according to its action configuration |

The native function URL remains publicly reachable; authentication rejects
application work, not network traffic before it reaches function compute.
This receiver is a trusted EMQX-to-database server hop, not a public user API.

## Deployment

1. Review [schema.sql](../backend_streamlit_and_telemetry/commissioning_webhook/schema.sql)
   on an isolated branch first. It adds one table and one index, grants the
   worker SELECT/INSERT and the reader SELECT, and changes no existing rows.
   The runtime never performs DDL. Apply the reviewed production migration
   separately before forwarding real data.
2. Run `npm ci --prefix backend_streamlit_and_telemetry/commissioning_webhook`
   and `npm run build --prefix backend_streamlit_and_telemetry/commissioning_webhook`.
   Zip `runtime/commissioning_function/index.mjs` at the archive root and deploy
   it with the private environment above. Retrieve the actual invocation URL
   from Neon; do not invent a URL from a branch name.
3. Verify the authenticated health route and unauthorized rejection.
   Synthetic fixtures belong only to an isolated branch, never production.
4. Open EMQX **Data Integration → HTTP Server**. Set the receiver's actual
   base URL, enable HTTPS verification and set the Authorization header.
   Configure `Content-Type: application/json`. Test with the same header.
5. Use [emqx_rule.sql](../backend_streamlit_and_telemetry/commissioning_webhook/emqx_rule.sql).
   Check in **Try It Out** that `broker_received_at_ms` is a millisecond
   timestamp from `publish_received_at`. Configure a POST action to `/ingest`
   with [the body template](../backend_streamlit_and_telemetry/commissioning_webhook/emqx_body_template.json.tmpl).
   Preserve action retries; duplicate attempts are safe. Do not change the
   existing publisher/subscriber permissions, spend limit or firmware topic.
6. Keep the actual ESP32 and hotspot on. Verify that production rows arrive
   with its real boot ID, increasing sequence numbers and recent broker time.
   Check the website, then stop the device and verify the stale indication.

The broker's QoS 0 device feed is not durable offline replay. HTTP retries can
deduplicate packets that reached the receiver but cannot reconstruct packets
lost before EMQX. Preserve acquisition and clock limitations in demonstrations.

## Model boundary

Receiving physical data establishes connectivity and storage, not calibrated
accuracy. The MH inputs remain unsigned. Measured counts per revolution,
wheel radii, track, current polarity, usable capacity, starting charge and
motion residual thresholds still require physical validation. Device SOC and
yaw are estimates, not independent measurements. Existing model readiness and
human-review action guards remain in force; the webhook has no motor command
path.

Official references:

- [EMQX HTTP service integration](https://docs.emqx.com/en/cloud/latest/data_integration/http_server.html)
- [EMQX message fields](https://docs.emqx.com/en/cloud/latest/rule_engine/rule_engine_events.html)
- [Neon Functions deployment](https://neon.com/docs/compute/functions/deploy)
- [Neon Functions authentication](https://neon.com/docs/compute/functions/authentication)
