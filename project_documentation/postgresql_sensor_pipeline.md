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

## Structured database

| Relation | Purpose |
| --- | --- |
| `amr_calibrations` | Versioned calibration parameters, identified by SHA-256 parameter fingerprint |
| `amr_sensor_samples` | Raw accepted v2 fields with database receive timestamp; unique `robot_id + boot_id + seq` |
| `amr_twin_states` | Resulting x/y/heading, SOC fraction, Wh, residual/advisory, freshness/quality metadata, linked to the raw packet |
| `amr_database_version` | Initial schema version |

Do not present the computed values as independently validated ground truth. Source ingestion can lose intervals; unknown motion, charge and magnetic/gyro effects cannot be reconstructed by the database. A worker restart also breaks model continuity until independently reinitialized.

## Installation and deployment

Use a managed PostgreSQL service with backups, TLS, and database roles. Keep all credentials **out of GitHub**. Use a dedicated worker role for writing and a separate Streamlit role restricted to SELECT. Database schema creation needs a provisioning/admin role, and should not remain a general permission of the routine worker in mature deployments.

1. Provision PostgreSQL. Configure automatic backups and limited network access. Create restricted users for worker and read-only dashboard. Bootstrap schema with a dedicated migration/provisioning identity.
2. Deploy the **independent always-on worker** from this repository with `python -m backend_streamlit_and_telemetry.predictive_twin.ingest_worker`. Do not embed an ingestion daemon inside a Streamlit rerun or browser tab.
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
6. Use the dashboard's **Live MQTT sensors** selection to display *persisted* sensor/twin results. The label indicates the acquisition source, not a browser broker connection. Unconfigured live mode shows no fabricated robot measurements.

### Important constraints

- Current database mode **stores** samples from an actively running worker; it does not replay the entire history back into a new online estimator on restart. After a restart or lost interval, pose/SOC from the worker must be treated as partial and reset with physically measured initial state before quantitative use.
- The dashboard's freshness status depends on latest persisted receive time; a stale row cannot be presented as fresh.
- The database update and model computation are transactionally paired for a successfully accepted packet; database failures stop the MQTT worker's active subscription. It is **not** a hard real-time acquisition guarantee or exactly-once MQTT delivery.
- Original raw JSON bytes are not stored; normalized typed fields are stored. For a publication-grade evidence trail, deploy a raw event recorder, verify clock offsets and retention, document device firmware revisions, and run reproducible calibration trials.
- The synthetic demonstration is intentionally separate from physical-trial tables.
- Avoid enabling any remote motor command path without independent local safety checks and physical testing.

## Tests

```bash
python -m pip install -r requirements-dev.txt
python -m pytest automated_software_checks/predictive_twin_checks -q
```

The database integration tests run against isolated SQLite files to check schema relationships, duplicate suppression, model feeding, calibration mismatch and demo isolation. **They are not PostgreSQL deployment or physical hardware validation tests.** The standard CI also checks browser and ESP32 firmware compilation.

## Paper and presentation consistency

See [17-slide exact mapping](slide_to_code_mapping.md). The presentation's scientific model scope is distinct from inventory experiments left in the repository for historical reference.
