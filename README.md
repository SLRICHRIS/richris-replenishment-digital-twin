# AMR-01 Warehouse Digital Twin — S. L. Richris

One ESP32 2WD robot publishes raw encoder, MPU6050 gyro and INA219 battery measurements. The **Python ingestion worker** computes wheel odometry, motion, power/energy/SOC, residual advisories and illustrative forecasts. The independent worker stores typed sensor samples and derived state in PostgreSQL; the Streamlit browser reads stored results. Synthetic demonstration is separate from physical records. GitHub hosts the source; it does not execute the online twin.

[Open the digital twin](https://richris-replenishment-digital-twin-s99b4letmnfusbbh6sjab9.streamlit.app/).

```sh
python -m pip install -r requirements.txt
streamlit run streamlit_app.py
```

The dashboard opens on **Floor**, a single-AMR warehouse simulation. Open **Sensor models** for the Python sensor twin, then choose **Demo data** or **Stored sensor data**. **Open detailed readings** shows sensor values, charts and references. **Database** shows saved records, table attributes and connection status. The deployed app uses a private read-only PostgreSQL account. Physical data collection and measured calibration require independent commissioning.

## Active architecture

ESP32 `amr01` → MQTT/TLS **8883** → EMQX → Python ingestion worker and AMR-01 models → PostgreSQL → read-only Streamlit view. Topic: `robot/amr01/state`. The active raw-sensor path requires an independently deployed, single-instance Python worker and managed PostgreSQL. EMQX TLS authentication and topic SUBACK are explicitly checked; PostgreSQL enforces a single-writer lease. Streamlit does not subscribe directly from browser JavaScript and does not publish motor commands. TB6612FNG control remains local to the ESP32; no separate UART AMR controller is required by the current BOM.

- Paper hyperlinks appear beside the motion, encoder, gyro and SOC readouts in Sensor models. The workflow reference is also linked in the warehouse model explanation.
- [Structured PostgreSQL ingest worker, database and deployment](project_documentation/postgresql_sensor_pipeline.md)
  - Provision once: `python -m project_maintenance_scripts.provision_amr_sensor_database` with a private `AMR_DATABASE_ADMIN_URL`, then run the worker with restricted `AMR_DATABASE_URL` and no DDL privileges.
  - Database schema v3: one append-only physical sensor table, typed encoder/MPU6050/INA219 SQL views, derived states, a transactional restart checkpoint and sparse quality-event audit. The MQTT packet remains schema v2.
  - Restart recovery preserves committed pose/SOC/energy and rejects retired boots. The first new reading anchors without integrating downtime; partial estimates and suppressed forecasts remain explicit. Receive timestamps are captured before the writer queue, so delayed commits cannot make old readings look fresh.
  - Existing v1/v2 databases require admin provisioning with the worker stopped, plus INSERT/SELECT/UPDATE permission on `amr_worker_checkpoints` for the worker and SELECT for the dashboard. See the migration steps in the pipeline guide before upgrading.
- [EMQX Cloud Serverless: TLS, topic permissions and live broker connection probe](project_documentation/emqx_cloud_amr01_integration.md)
- [Exact final **17-slide** equation/variable/paper mapping](project_documentation/slide_to_code_mapping.md)
- [Raw packet schema, units, calibration, firmware and deployment](project_documentation/single_amr_sensor_twin_setup.md)
- [Current capability scope and outstanding live-3D registration](project_documentation/implemented_dashboard_features_and_limits.md)
- [Validation evidence and remaining hardware work](project_documentation/single_amr_alignment_validation.md)
- Active implementation: `backend_streamlit_and_telemetry/predictive_twin/`
- Active direct-sensor firmware: `esp32_telemetry_firmware/publish_raw_sensor_telemetry/`

The **Sensor models** view follows the 17-slide presentation in six compact stages: wheel travel/speed (slides 5–6), pose (7–8), gyro bias (9–10), battery (11–12), sustained residual alert (13–14) and forecasts (15). Equation/variable details open on demand. **Open detailed readings** opens **Detailed sensor readings**, including a separate manual stock and task example. That example is outside the sensor modelling presentation. The larger FIFO/urgency research experiment remains in source.

The hosted navigation contains **Floor, Sensor models, Missions and Activity**. Route playback, the separate older observer/calibration lab and simulated energy analytics are hidden from this focused workspace; historical deep links return to Sensor models. The Floor and Missions preserve the original single-AMR warehouse illustration, with their virtual nature explicit.

## Dashboard and deployment

The single-AMR virtual warehouse dashboard is the main workspace. Its route planning, animation and experiments are separate from the physical AMR-01 sensor node. Sensor models receives calculated results from Python through the Streamlit component protocol; JavaScript formats readouts and sends source-selection/navigation actions back. Updates preserve the current view, scroll and virtual mission state. Local encoder pose has no surveyed map transform, so it is not placed into the 3D warehouse. Browser MQTT, UART firmware, recorder/coordinator and LabVIEW adapters are legacy reference interfaces outside the current single-AMR path. Their guides identify the applicable version. Use the direct-sensor publisher for current commissioning.

The Streamlit deployment uses repository `SLRICHRIS/richris-replenishment-digital-twin`, branch `main`, and entry point `streamlit_app.py`. Changes to main update that app. Its private PostgreSQL reader connection is configured in deployment secrets. Database connectivity is verified independently from physical telemetry and measured calibration.

The full inventory API/walkthrough remains under `research_baseline/`; its original deployment instructions are local to that experiment. This branch preserves both main's UI and the research baseline commits.

## Software checks

```sh
python -m pip install -r requirements-dev.txt
python -m pytest automated_software_checks/predictive_twin_checks -q
PYTHONPATH=research_baseline python -m pytest research_baseline/tests -q
python -m unittest discover -s automated_software_checks/python_telemetry_service_checks -v
python -m unittest discover -s automated_software_checks/streamlit_and_repository_integration_checks -v
npm ci
npm run test:browser
```

Software tests verify equations, units, isolation, sequence/freshness handling and synthetic stock invariants. Hardware calibration, slip tests, battery capacity tests and anomaly thresholds still require measured trials. The supplied models do not implement an EKF, absolute localisation, obstacle avoidance, fleet coordination or battery remaining useful life.

© 2026 S. L. Richris. See [ownership and external software licences](project_ownership_and_external_software_licenses.txt).

The project configures **AMR-01 only**: one simulated robot, one loading/charging bay centred on the left apron, one sensor card, one calibration and one MQTT state topic. AMR-02 and AMR-03 are not instantiated, selectable or subscribed. Three demo missions remain as sequential jobs for AMR-01. Reuse the existing app deployment.
