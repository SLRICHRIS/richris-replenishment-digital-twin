# AMR-01 PostgreSQL telemetry pipeline

## End-to-end architecture

```text
Wheel encoders + MPU6050 gyro + INA219 voltage/current
   -> ESP32 acquisition (schema v2; monotonic timestamp and boot/sequence IDs)
   -> MQTT over TLS (EMQX topic robot/amr01/state)
   -> dedicated Python ingestion worker
   -> strict packet checks -> existing model equations (pose / SOC / residual)
   -> single PostgreSQL transaction: raw measurement + derived state
   -> read-only Streamlit database reader -> sensor cards, history and alerts
```

This is **one AMR-01**. The older warehouse scene, missions and inventory simulation are distinct from the physical telemetry and are not synchronized to surveyed warehouse coordinates. The LabVIEW return/command path on slide 16 is still a proposal, not a live motor-control feature. GitHub holds source code; it cannot run the always-on telemetry worker.

## Structured physical database schema (v3; MQTT packet v2)

**One canonical, typed, append-only physical sensor fact table** stores each
admitted 20 Hz MQTT packet once. Three sensor-specific, read-only SQL **views**
provide clean per-sensor attributes without triplicating write traffic. This is
an intentional data-engineering choice: at 20 Hz one continuously active AMR
generates 1,728,000 packets per day. The existing v1 sensor table and its
primary-key shape are retained for non-destructive migration.

| Object | Kind | Primary attributes | Purpose |
| --- | --- | --- | --- |
| `amr_sensor_samples` | Physical fact table | `robot_id` (varchar 16), `boot_id` (varchar 64), `seq` (bigint), `schema_version` (int), `sample_time_s` (double), `received_at` (timestamptz), `robot_state` (varchar 64), `calibration_fingerprint` (varchar 64 FK) and the typed encoder/gyro/battery columns listed below | Single source of truth for actually received measurements |
| `amr_encoder_readings` | SQL view | `robot_id`, `boot_id`, `seq`, `sample_time_s`, `received_at`, `encoder_left_count` (bigint), `encoder_right_count` (bigint), `calibration_fingerprint` | Physically observed cumulative encoder counts, signed, including x4 decoding |
| `amr_imu_readings` | SQL view | `robot_id`, `boot_id`, `seq`, `sample_time_s`, `received_at`, `gyro_z_rad_s` (double), `calibration_fingerprint` | MPU6050 measured z-axis angular rate only, not corrected yaw or absolute heading |
| `amr_ina219_readings` | SQL view | `robot_id`, `boot_id`, `seq`, `sample_time_s`, `received_at`, `battery_voltage_v` (double), `battery_current_a` (double), `calibration_fingerprint` | INA219 terminal voltage and signed current (positive means discharge) |
| `amr_calibrations` | Physical table | `fingerprint` (SHA-256 PK), `robot_id`, `parameters` (JSON), `created_at` | Sensor/wheel/battery calibrations linked to every packet |
| `amr_twin_states` | Physical table | Same 3-part packet PK/FK, `received_at`, `sample_time_s`, `quality`, `continuity_lost`, `x_m`, `y_m`, `theta_rad`, `soc_fraction`, `energy_wh`, `derived` (JSON) | Calculated odometry, power, SOC, angular residual, advisory and model quality |
| `amr_worker_checkpoints` | One mutable pointer per robot | `robot_id` (PK), `boot_id`, `seq`; composite FK to `amr_twin_states` | Last committed model state, updated atomically with each accepted sample; receive-time clock corrections cannot rewind the current state |
| `amr_pipeline_events` | Physical sparse event table | `id` (PK), `robot_id`, `boot_id`, `seq`, `observed_at`, `event_type`, `details` (JSON) | Persisted sequence gaps, excessive sample-time gaps, reboot, worker restart and rejected-packet evidence |
| `amr_database_version` | Physical table | `id` (PK), `schema_version=3` | Database compatibility guard; independent of MQTT packet version |

**Raw versus computed:** `battery_voltage_v`, `battery_current_a` and
`gyro_z_rad_s` come from physical sensor readings. `soc_fraction`, battery
Wh, bias-corrected yaw rate, position, angular residual and forecasts are
**model outputs**. MPU6050 acceleration and other sensor readings are **not**
advertised as stored because our schema-v2 firmware does not publish them.

**Keys and validation:** unique `(robot_id, boot_id, seq)` prevents duplicate
packets from duplicating sensor records. The database constrains schema v2,
non-negative device sample time and positive battery voltage on new tables;
the Python validator additionally enforces exact fields, finite numerical
measurements and correct `robot/amr01/state` topic identity. Raw sample and
derived state, quality events and checkpoint pointer are stored together in one PostgreSQL transaction. Historical measurements and model states remain append-only; only the checkpoint pointer is updated.

**Timestamp interpretation:** `sample_time_s` is the ESP32's monotonic time
since boot, *not* an absolute timestamp. `received_at` is the server's
UTC receive time captured in the MQTT callback, before writer-queue or database delay, not a hardware acquisition wall clock. Their
difference cannot be used to claim network latency without clock alignment.
The dashboard uses that original receive time for freshness. A row more than
one second in the future is marked `CLOCK_SKEW` and its live readouts are
suppressed. Keep the worker and dashboard host clocks synchronized. Current
state comes from the committed checkpoint; per-boot history uses sequence order.
Historical v1/v2 timestamps retain their earlier database-processing meaning.

### Query the sensor views

```sql
SELECT seq, sample_time_s, encoder_left_count, encoder_right_count
FROM amr_encoder_readings
WHERE robot_id = 'amr01' AND boot_id = '<actual-boot-id>'
ORDER BY seq DESC
LIMIT 100;

SELECT seq, battery_voltage_v, battery_current_a
FROM amr_ina219_readings
WHERE robot_id = 'amr01'
ORDER BY received_at DESC
LIMIT 100;

SELECT event_type, seq, observed_at, details
FROM amr_pipeline_events
WHERE robot_id = 'amr01'
ORDER BY id DESC
LIMIT 20;
```

### Real-time engineering and data-quality rules

1. **Ingestion:** ESP32 publishes non-retained schema-v2 JSON through EMQX
   TLS 8883. Worker subscribes to one AMR-01 topic. Source firmware currently
   uses **MQTT QoS 0**; delivery is best effort and outage gaps are possible.
2. **Validate:** Reject malformed, non-finite, wrong-robot, wrong-topic,
   retained or out-of-order packets. Store an audit **category** for malformed
   or retained AMR-01 samples, never the untrusted payload body.
3. **Sequence quality:** Count missing `seq` values, record long device-time
   gaps, and log boot-ID transitions. Never synthesize missing physical samples.
   A missing intermediate packet suppresses that interval's gyro–encoder
   consistency residual and short-term forecast rather than reporting
   a potentially misleading fault result.
4. **Transform:** Apply only the equations from the final 17-slide deck.
   Net encoder count displacement across short losses is an approximation;
   battery current is integrated from the available endpoint sample.
5. **Persist:** Commit accepted typed raw packet, calculated model state,
   calibration link, checkpoint and any quality event atomically. Failed database writes
   terminate the ingester rather than claiming successful delivery.
6. **Serve:** Streamlit queries the authoritative database (read-only account),
   displays recorded quality evidence, marks readings stale after 2 s by default
   and refreshes its component approximately once per second.
7. **Govern:** Separate database roles, private TLS credentials, backups and
   restore drills; never auto-delete research evidence without an approved
   retention and archive policy.

**Timing boundary:** 20 Hz is the *target ESP32 acquisition period* (50 ms).
The Streamlit view refreshes near 1 Hz. This is a **soft real-time telemetry and
advisory pipeline**, not a hard real-time motor or safety controller. PostgreSQL
write latency, EMQX packet loss, WAN jitter and real-hardware calibration
must be measured during commissioning. Do not claim latency SLAs until
production traces confirm them.

**Scale plan:** A raw table and matching derived table can accumulate about
3.46 million rows/day at continuous 20 Hz even before indexes and
calibration/event rows. We deliberately avoid three duplicate physical sensor
tables. Monitor actual database size and query plans; implement a
**reviewed PostgreSQL range-partitioning migration** and archive/retention
policy before long-duration trials. The existing primary key does not contain
a partitioning timestamp, so it cannot be converted to a time-partitioned
parent table safely with a simple unreviewed DDL change.

**Current ingestion design:** Paho MQTT uses an ordered **bounded queue**
(256 packets). A separate single-writer thread processes samples and
commits each admitted packet and derived state in a PostgreSQL transaction.
The network callback is not blocked by PostgreSQL write latency. On queue
overflow or database failure, the worker **fails closed** and surfaces an
error; it does not claim telemetry is healthy. Worker logs report MQTT
received, persisted, rejected, queue depth, overflows and latest processing
time every 30 seconds. The queue is **in RAM only**: abrupt power loss
may discard queued records, and MQTT QoS-0 on the ESP32 does not guarantee
delivery. Benchmark the actual 20 Hz flow and implement publisher-side
QoS-1 buffering plus a **durable staging/replay design** if research
requires loss-bounded collection. Do not infer a hard real-time SLA from
CI passing.

## Installation and deployment

### Deployment state, 15 November 2026

The Neon free-plan project `richris-amr-digital-twin` (`round-hat-75413619`)
now exists in Singapore, using PostgreSQL 16 and fixed 0.25 CU compute with
the plan's default suspension behavior. Database: `amr_twin`.
Production branch: `br-small-water-azc8jgij`; isolated development branch:
`br-floral-hat-azct1esl` (`dev-database-integration`).

**Schema initialization remains pending:** automatic approval review required
explicit approval for the additive CREATE/INSERT transaction. Read-only checks
confirmed both new databases contain zero public tables/views. No physical
sensor data or synthetic trial records have been inserted. Restricted reader
and writer roles, the Streamlit private connection secret, and the always-on
MQTT worker remain to be configured. Project creation alone does not complete
the sensor pipeline.

The app's **Sensor models → Database** button opens a SELECT-only browser.
It checks storage independently from measured calibration and distinguishes
missing app configuration, an unreachable server, an unreadable/unprovisioned
schema, and a verified schema with an empty selected dataset. It shows up to
200 stored rows per request, with attributes and bounded CSV export. Expected
schema definitions remain visible when storage is disconnected; they are
explicitly labeled as definitions, not proof of hosted tables.

### Provisioning steps

Use a managed PostgreSQL service with backups, TLS, and database roles. Keep all credentials **out of GitHub**. Use a dedicated worker role for writing and a separate Streamlit role restricted to SELECT. Database schema creation uses a separate provisioning/admin role. The live worker never creates tables or views.

1. Provision PostgreSQL with TLS, backups and limited network access. Create separate identities: a temporary DDL-capable administrator for schema provisioning, a worker with limited INSERT/SELECT permissions on evidence tables, INSERT/SELECT/UPDATE on `amr_worker_checkpoints`, and SELECT/USAGE on the pipeline-event ID sequence, and a read-only dashboard account. The dashboard needs SELECT on the checkpoint as well as existing sample/state/event/calibration tables and views. The ingestion worker also requires permission to hold the PostgreSQL advisory lock.
   Set the private environment variable `AMR_DATABASE_ADMIN_URL` to a **provisioning account** connection string and run `python -m project_maintenance_scripts.provision_amr_sensor_database` once. Keep this administrator credential outside both the ingestion worker and Streamlit. Apply reviewed migrations separately before worker restarts.
2. Deploy the **independent always-on worker** (holds a PostgreSQL advisory lease to reject a concurrent AMR-01 writer) from this repository with `python -m backend_streamlit_and_telemetry.predictive_twin.ingest_worker`. Do not embed an ingestion daemon inside a Streamlit rerun or browser tab.
   Use a **direct, non-pooled PostgreSQL URL** for this worker and for schema provisioning: its single-writer lease depends on a session-level advisory lock. A transaction pooler does not preserve that lock's session. The SELECT-only Streamlit reader may use the pooled endpoint. See [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).
3. Give the worker these private environment variables:
   - `AMR_DATABASE_URL`: `postgresql+psycopg://<writer>:<password>@<host>:5432/<database>?sslmode=require`
   - `AMR_MQTT_HOST`, `AMR_MQTT_USERNAME`, `AMR_MQTT_PASSWORD`: TLS MQTT read credentials, scoped to one topic
   - `AMR_MEASURED_CALIBRATION_CONFIRMED=true` **only after real measurements**
   - `AMR_CALIBRATION_JSON`: one `amr01` dictionary with `radius_left_m`, `radius_right_m`, `track_m`, `counts_left_per_rev`, `counts_right_per_rev`, `capacity_ah`, `initial_soc`, `gyro_bias_rad_s`, `residual_threshold_rad_s`, `residual_hold_s`, `max_gap_s`. Refer to `.streamlit/secrets.example.toml` for illustrative values; they are not measurements.
4. Set the private Streamlit secrets:
   ```toml
   [commissioning]
   measured_calibration_confirmed = false

   [database]
   url = "postgresql+psycopg://<reader>:<password>@<host>:5432/<database>?sslmode=require"

   [calibration.amr01]
   radius_left_m = 0.033
   radius_right_m = 0.033
   track_m = 0.20
   counts_left_per_rev = 600
   counts_right_per_rev = 600
   capacity_ah = 2.0
   initial_soc = 0.90
   gyro_bias_rad_s = 0.01
   residual_threshold_rad_s = 0.04
   residual_hold_s = 0.5
   max_gap_s = 1.0
   ```
   These numeric values are **illustrations only**. Replace them with measured values, and set the commissioning flag only after physical validation.
5. ESP32 uses the existing raw-sensor sketch and publishes to `robot/amr01/state`. It is an observation-only firmware, with the TB6612 standby held low; it does not autonomously navigate or issue LabVIEW motor commands.
6. Use the dashboard's **Live EMQX sensor data** selection to display *persisted* sensor/twin results. The label indicates the acquisition source, not a browser broker connection. Unconfigured live mode shows no fabricated robot measurements.

### Important constraints

- On restart, the worker loads the last committed pose/SOC/energy and all previously observed boot IDs using the checkpoint. It never replays history or reuses another process's monotonic clock. Duplicate sequences and retired boots remain rejected. The first new sample only establishes a count/time anchor and atomically records `worker_restart`; no downtime motion or charge is fabricated. Estimates remain partial with `continuity_lost=true`, and quantitative forecasts stay suppressed. To reset from measured initial pose/SOC or change calibration, start a separately provisioned trial database; restarting against existing evidence does not reset its totals. Preserve the prior trial.
- The dashboard's freshness status depends on latest persisted receive time; a stale row cannot be presented as fresh.
- The database update and model computation are transactionally paired for a successfully accepted packet; database failures stop the MQTT worker's active subscription. The worker validates database schema v3, the checkpoint table and its three sensor views without DDL permissions. It is **not** a hard real-time acquisition guarantee or exactly-once MQTT delivery.
- Original raw JSON bytes are not stored; normalized typed fields are stored. For a publication-grade evidence trail, deploy a raw event recorder, verify clock offsets and retention, document device firmware revisions, and run reproducible calibration trials.
- The synthetic demonstration is intentionally separate from physical-trial tables.
- Avoid enabling any remote motor command path without independent local safety checks and physical testing.

### Upgrade an existing v1/v2 database

1. Stop the ingestion worker and back up the trial database. Use the provisioning administrator, never the worker's restricted credentials.
2. Run `python -m project_maintenance_scripts.provision_amr_sensor_database` with private `AMR_DATABASE_ADMIN_URL`. Provisioning adds the checkpoint table and seeds its pointer from the most recent stored v1/v2 state by receive time. Existing samples, calibrations, model states and events are retained. If historical clocks were incorrect, review which old row should represent the trial endpoint before migration; old records lack an independent commit-order pointer.
3. Grant the worker INSERT/SELECT/UPDATE and the dashboard SELECT on the new table. For example, if the existing role names are `amr_worker` and `amr_reader`:

   ```sql
   GRANT SELECT, INSERT, UPDATE ON TABLE public.amr_worker_checkpoints TO amr_worker;
   GRANT SELECT ON TABLE public.amr_worker_checkpoints TO amr_reader;
   ```

4. Start the updated single worker with the same measured calibration. Verify schema readiness and a new `worker_restart` event after the first accepted packet. Readings stay uncertain across the unobserved interval. The runtime worker does not migrate or delete evidence.

## Tests

```bash
python -m pip install -r requirements-dev.txt
python -m pytest automated_software_checks/predictive_twin_checks -q
```

Isolated SQLite tests check schema relationships, duplicate suppression, model feeding, calibration mismatch and demo isolation. An additional GitHub Actions job tests database transactions, duplicate rejection and the single-writer advisory lease on a real PostgreSQL 16 instance. These tests are not physical hardware validation or a live cloud broker handshake. The standard CI also checks browser and ESP32 firmware compilation.

For EMQX Cloud setup and a real-world, read-only broker SUBACK/packet probe, see [EMQX Cloud AMR-01 guide](emqx_cloud_amr01_integration.md).

## Paper and presentation consistency

See [17-slide exact mapping](slide_to_code_mapping.md). The presentation's scientific model scope is distinct from inventory experiments left in the repository for historical reference.
