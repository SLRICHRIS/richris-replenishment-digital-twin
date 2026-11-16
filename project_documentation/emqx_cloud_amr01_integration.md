# EMQX Cloud connection for the final AMR-01 Digital Twin

**Purpose:** Transport only physical raw sensor packets to the model worker, then persist source readings and derived state to PostgreSQL. **EMQX is a message broker, not the Digital Twin computer, not the SQL database and not a motor controller.**

## Data flow (final 17-slide presentation)

```text
Physical AMR-01
 wheel encoders (signed cumulative counts)
 MPU6050 (angular rate z, rad/s)
 INA219 (battery terminal voltage V; discharge-positive current A)
            |
            | ESP32 firmware timestamps and publishes raw sensor JSON
            v
EMQX Cloud Serverless / MQTT over TLS (port 8883)
 topic: robot/amr01/state     non-retained JSON packets
            |
            | one dedicated, independently deployed subscriber
            v
Python `ingest_worker` + MQTTService
  validate robot_id, topic, boot_id, sequence, monotonic sample_time_s
  calculate wheel distance -> differential-drive pose
  gyro stationary-bias correction -> encoder/IMU yaw residual -> advisory
  INA219 power/Wh -> SOC fraction -> assumption-based forecast
            |
            | one committed relational transaction
            v
PostgreSQL
  amr_calibrations, amr_sensor_samples, amr_twin_states
            |
            | read-only authenticated DB connection
            v
Existing Streamlit warehouse interface
  Sensor models page: fresh/stale, x/y/theta, SOC, power/Wh,
  residual alert and assumption-based forecast.
  Simulated warehouse floor remains separate from sensor-based local pose.
```

The current human review path uses the [website operator panel](website_human_review_and_action.md). Physical command transport is separate from telemetry and remains disabled until local receiver commissioning. The observation-only ESP32 sketch leaves TB6612 standby LOW; no remote motor commands are issued. Do not connect an uncontrolled cloud path to physical actuation.

## 1. Prepare the EMQX deployment

1. In EMQX Cloud create or use a **Serverless** deployment and confirm it is running. Open **Overview** and copy the connection hostname and port, and download the server CA certificate if needed.
2. Use **hostname only**, with no `mqtts://`, no URL path and no `:8883` suffix. The intended port is `8883` with TLS and full hostname verification.
3. Under **Access Control > Authentication**, create two different credentials:
   - `amr01_publisher`: used ONLY by the ESP32 to publish sensor telemetry
   - `amr01_subscriber`: used ONLY by the Python ingestion worker to subscribe to telemetry
4. Under **Access Control > Authorization**, permit **Publish** only for the publisher on `robot/amr01/state`, and **Subscribe** only for the subscriber on `robot/amr01/state`. Enable restrictive whitelist/deny-by-default behavior so the credentials cannot access unrelated topics. Verify rules with your console's ordering and deployment version; EMQX Cloud's initial authorization configuration can otherwise be permissive.
5. Use SNI/hostname-based TLS to the exact deployment host. The ESP32 secure client must trust the broker CA; the Python worker trusts the OS CA store or a private CA file.

**Do not commit** Wi-Fi passwords, EMQX passwords, CA private keys, PostgreSQL URLs or local secret headers to GitHub. EMQX's server-side CA certificate is not itself a password, but storing a private deployment certificate chain outside the repository is convenient for rotation. Never disable TLS peer validation for debugging.

EMQX references: [Paho Python](https://docs.emqx.com/en/cloud/latest/connect_to_deployments/python_sdk.html), [Serverless port guide](https://docs.emqx.com/en/cloud/latest/deployments/port_guide_serverless.html), [Authorization](https://docs.emqx.com/en/cloud/latest/deployments/default_authz.html).

## 2. Configure the ESP32 publisher

Copy:
`esp32_telemetry_firmware/publish_raw_sensor_telemetry/example_esp32_wifi_and_mqtt_settings.h`
to `esp32_wifi_and_mqtt_settings.h` in the same directory, and set the private:

- `WIFI_SSID`, `WIFI_PASSWORD`
- `MQTT_HOST` (deployment hostname)
- `MQTT_USERNAME`, `MQTT_PASSWORD` (**publisher-only**)
- `BROKER_ROOT_CA` (trusted PEM certificate from EMQX Overview)
- `LEFT_SIGN`, `RIGHT_SIGN`, and `CURRENT_SIGN` after physical polarity checks

Wire SDA21/SCL22 for MPU6050 and INA219; actual encoder pins are specified in the firmware header. The sketch samples at nominal 50 ms (20 Hz), but the **measured device monotonic time** determines all integration intervals, not an assumed fixed 50 ms.

The current firmware library, `PubSubClient`, publishes **QoS 0**, even though the Python subscriber asks EMQX for QoS 1. This **does not guarantee QoS 1 delivery** from the ESP32. Missing packets are identified by the sequence field and physically missing intervals are not fabricated. Upgrade the publisher/library and consider local offline buffering if stronger delivery guarantees become necessary.

Payload sent on `robot/amr01/state` (example only; not observed physical data):

```json
{"schema_version":2,"robot_id":"amr01","boot_id":"unique-per-reboot","seq":1,"sample_time_s":0.05,"encoder_left_count":10,"encoder_right_count":10,"gyro_z_rad_s":0.01,"battery_voltage_v":7.4,"battery_current_a":0.6,"robot_state":"standby"}
```

The outgoing message must be **non-retained**. At start, the first valid packet establishes the count/time anchor. Database samples have unique `(robot_id, boot_id, seq)`.

## 3. Probe EMQX before moving the robot

Set these environment variables privately on the computer that has network access to EMQX:

```text
AMR_MQTT_HOST=<emqx-deployment-hostname>
AMR_MQTT_USERNAME=<subscriber-username>
AMR_MQTT_PASSWORD=<subscriber-password>
AMR_EMQX_CA_FILE=<optional-absolute-path-to-trusted-CA-file>
```

**Read-only handshake test** (never writes to PostgreSQL or sends motor commands):

```sh
python -m project_maintenance_scripts.probe_emqx_connection --timeout 15
```

If the broker explicitly acknowledges the subscription it prints a TLS/SUBACK success. That check validates broker connectivity and authorization, **not** hardware accuracy.

Once physical telemetry is enabled, additionally require a correctly typed packet:

```sh
python -m project_maintenance_scripts.probe_emqx_connection --timeout 30 --require-packet
```

The probe never writes a synthetic example packet to the actual physical-trial tables.

## 4. Deploy the model worker, database, dashboard

Provision PostgreSQL as described in [PostgreSQL integration guide](postgresql_sensor_pipeline.md). Configure the worker privately:

```text
AMR_DATABASE_URL=postgresql+psycopg://<writer>:<password>@<dbhost>:5432/<database>?sslmode=require
AMR_MQTT_HOST=<emqx-deployment-hostname>
AMR_MQTT_USERNAME=<subscriber-username>
AMR_MQTT_PASSWORD=<subscriber-password>
AMR_EMQX_CA_FILE=<optional-ca-file>
AMR_MQTT_CLIENT_ID=amr01-db-ingester
AMR_MEASURED_CALIBRATION_CONFIRMED=true
AMR_CALIBRATION_JSON=<one-measured-amr01-calibration-object>
```

Start exactly **one instance** of the writer:

```sh
python -m backend_streamlit_and_telemetry.predictive_twin.ingest_worker
```

The worker will not start without explicit measured calibration and provisioned database tables. Existing databases without a restart checkpoint need the additive checkpoint migration and new table grants described in the pipeline guide before starting the worker. On restart, committed totals are preserved, downtime is not integrated, and the first new sample records a restart event. MQTT success is shown only after EMQX SUBACK, not TCP connection alone; EMQX authorization refusal and database failures terminate the worker instead of being represented as healthy telemetry. Unattended recording requires a persistent host. For attended sessions, the optional [Connect AMR panel](single_amr_sensor_twin_setup.md#connect-amr-from-the-site) reuses this subscriber and database pipeline in a session-bound background resource; it does not rely on page reruns to ingest each packet.

Configure `[database].url` with a SELECT-only database account in private Streamlit secrets, along with the *same calibration* and `[commissioning].measured_calibration_confirmed=true`. The UI reads persisted records and labels stale/continuity-lost data.

## 5. What counts as verified

- **Unit tests:** TLS verification, topic-only subscription, SUBACK success/denial, authentication rejection, non-publishing, error paths.
- **PostgreSQL integration test:** Local CI database receives normalized raw source measurements and paired model states with uniqueness checks.
- **Live connection test:** Must use your real deployment hostname/CA/authentication and report actual SUBACK.
- **Hardware validation:** Independently check encoder distance, IMU orientation/bias, INA219 voltage/current against a meter, usable Ah, and healthy/fault runs. MQTT connection alone cannot establish any of those.

No claims of full EKF, absolute warehouse pose, automated motor control, physical fault diagnosis, fleet management or battery RUL are made by this pipeline.
