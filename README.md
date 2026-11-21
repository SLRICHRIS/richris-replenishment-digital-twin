# AMR-01 Warehouse Digital Twin | S. L. Richris

One ESP32 2WD robot publishes raw encoder, MPU6050 gyro and INA219 battery measurements. The **Python ingestion worker** computes wheel odometry, motion, power/energy/SOC, residual advisories and illustrative forecasts. The independent worker stores typed sensor samples and derived state in PostgreSQL; the Streamlit browser reads stored results. Synthetic demonstration is separate from physical records. GitHub hosts the source; it does not execute the online twin.

[Open the digital twin](https://richris-replenishment-digital-twin-s99b4letmnfusbbh6sjab9.streamlit.app/).

## Real sensor data: datasets, training and evaluation

The [physical data studies](physical_data_studies/README.md) contain **68,130 recorded AMR-01 packets from 86 boots**, preprocessing code, labelled datasets, fitted models, test predictions and PDF reports. The frozen snapshot supports two experiments: next-10-second monitored-voltage forecasting and next-two-reading gyro-rate forecasting.

Start with the [methodology guide](physical_data_studies/methodology.md), then open the [voltage study](physical_data_studies/battery_voltage/README.md) or [gyro study](physical_data_studies/gyroscope/README.md). Each study compares its trained model with simple baselines on later held-out boots. A single [offline reproduction command](physical_data_studies/README.md#reproduce-on-windows) rebuilds and checks the results.

## Run the dashboard

```sh
python -m pip install -r requirements.txt
streamlit run streamlit_app.py
```

The dashboard opens on **Floor**, a single-AMR warehouse simulation. **Connect AMR** provides the operator-protected, on-demand EMQX recorder. **Sensor models** shows six Python models with Demo data or Stored sensor data, their equations, sources and recommendations. **Detailed readings and export** opens packet values and charts. **Database** browses saved records, attributes and storage status. Display reads use a private SELECT-only account; the optional recorder uses a separate limited writer. Physical data collection and measured calibration require independent commissioning.

For attended manual driving, open **Live AMR mission → Direct Wi-Fi drive → Connect controller**. The ESP32 controller appears inside the dashboard using the saved address `10.15.213.112`; no address entry or firmware upload is needed. Allow local-network access if Chrome asks. Commands travel directly over local Wi-Fi; EMQX continues carrying sensor data. See the [direct Wi-Fi setup](project_documentation/manual_motor_control_setup.md).

## Reproducible demonstration

Choose one of five generated trials in Sensor models: baseline, turning, sustained sensor disagreement, low battery reserve or an interrupted stream. The same Python engine calculates every result. The examples demonstrate normal estimation, inspection/recharge guidance and withholding forecasts after missing evidence. They never write to the physical database.

**Export trial evidence** saves input packets, example calibration, computed outputs, recommendations and source fingerprints. Replay the file without a database:

```sh
python -m project_maintenance_scripts.replay_generated_trial amr01_disagreement_synthetic_trial.json
```

The verifier rejects altered outputs and mismatched source files. It checks software reproducibility, not physical validity or signed origin. See the [demonstration and evidence guide](project_documentation/demonstration_and_evidence_guide.md) for the walkthrough, expected outcomes and evidence boundaries.

## Human review and action

Live recommendations cover **battery, power, wheel feedback, gyro/acceleration, controller output and connection quality**. Current packets and up to 30 seconds of history support specific checks such as load-related voltage drops, missing encoder feedback and requests that remain stopped. Each finding shows evidence, priority and a suggested response. Stale data stops supporting current guidance.

**Review & decide** records nine available operator responses using the existing protected audit. The operator captures evidence, chooses a response and records a reason. **Open Drive control** opens the embedded local controller with the saved instructions; the operator applies the response or performs the physical check. This observation review sends no motor command. Three subsequent readings record follow-up without claiming that the physical task was completed. The separate commissioned model-intervention contract retains its own acknowledgement and outcome checks.

See the [live checks and action catalog](project_documentation/live_sensor_recommendations.md) and [website operator review guide](project_documentation/website_human_review_and_action.md).

## Active architecture

ESP32 `amr01` → MQTT/TLS **8883** → EMQX → Python sensor pipeline → PostgreSQL → read-only display. Topic: `robot/amr01/state`. Use the independent worker for unattended recording or the session-bound Connect AMR recorder for attended trials. Both reuse the same sensor engine, verified TLS subscription, transaction boundaries and exclusive PostgreSQL writer lease. Browser JavaScript does not ingest raw MQTT data or publish motor commands. Motor control remains local to the AMR.

- Paper hyperlinks appear beside the motion, encoder, gyro and SOC readouts in Sensor models. The workflow reference is also linked in the warehouse model explanation.
- [Structured PostgreSQL ingest worker, database and deployment](project_documentation/postgresql_sensor_pipeline.md)
  - Provision once: `python -m project_maintenance_scripts.provision_amr_sensor_database` with a private `AMR_DATABASE_ADMIN_URL`, then run the worker with restricted `AMR_DATABASE_URL` and no DDL privileges.
  - Database structure: one append-only physical sensor table, typed encoder/MPU6050/INA219 SQL views, derived states, a transactional restart checkpoint and sparse quality-event audit. The MQTT packet contract is unchanged.
  - Restart recovery preserves committed pose/SOC/energy and rejects retired boots. The first new reading anchors without integrating downtime; partial estimates and suppressed forecasts remain explicit. Receive timestamps are captured before the writer queue, so delayed commits cannot make old readings look fresh.
  - Existing databases without a restart checkpoint require admin provisioning with the worker stopped, plus INSERT/SELECT/UPDATE permission on `amr_worker_checkpoints` for the worker and SELECT for the dashboard. See the migration steps in the pipeline guide before upgrading.
- [EMQX Cloud Serverless: TLS, topic permissions and live broker connection probe](project_documentation/emqx_cloud_amr01_integration.md)
- [Exact final **17-slide** equation/variable/paper mapping](project_documentation/slide_to_code_mapping.md)
- [Raw packet schema, units, calibration, firmware and deployment](project_documentation/single_amr_sensor_twin_setup.md)
- [Supplied TB6612 / MH IR hardware: local control, unsigned pulse commissioning and model limits](project_documentation/mh_ir_hardware_commissioning.md)
- [Current capability scope and outstanding live-3D registration](project_documentation/implemented_dashboard_features_and_limits.md)
- [Validation evidence and remaining hardware work](project_documentation/single_amr_alignment_validation.md)
- Active implementation: `backend_streamlit_and_telemetry/predictive_twin/`
- Active direct-sensor firmware: `esp32_telemetry_firmware/publish_raw_sensor_telemetry/`
- Current MH IR hardware bring-up: `esp32_telemetry_firmware/publish_mh_ir_commissioning/`. This preserves the supplied motor pins and serial commands, and publishes unsigned pulse diagnostics on `/commissioning`. The six-model `/state` path requires direction-sensing wheel feedback, gyro/current/voltage sensors and measured calibration.

The **Sensor models** view follows the 17-slide presentation in six compact stages: wheel travel/speed (slides 5–6), pose (7–8), gyro bias (9–10), battery (11–12), sustained residual alert (13–14) and forecasts (15). Each model has one collapsed **How it works & source** section containing explanations, equations and paper links. **Detailed readings and export** opens sensor values, charts and exports. The larger stock/task and FIFO/urgency experiments remain in source.

The hosted navigation contains **Floor, Connect AMR, Sensor models and Database**. Floor keeps the original warehouse and one virtual AMR with basic camera controls. Mission approval, stock forecasts, manager markers, route studies, activity logs and older calibration tools are outside this UI; their historical deep links return to Sensor models. Database shares the dashboard shell and shows saved physical records and their attributes without deployment settings. It supports seven allowlisted datasets, bounded 50-row reads, explicit empty/error states and JSON export. The six sensor models use a responsive three/two/one-column layout, with Dark/Bright appearance and local fonts.

## Dashboard and deployment

The single-AMR virtual warehouse dashboard is the main workspace. Its route planning, animation and experiments are separate from the physical AMR-01 sensor node. Sensor models receives calculated results from Python through the Streamlit component protocol; JavaScript formats readouts and sends source-selection/navigation actions back. Updates preserve the current view, scroll and virtual mission state. Local encoder pose has no surveyed map transform, so it is not placed into the 3D warehouse. Browser MQTT, UART firmware, recorder/coordinator and LabVIEW adapters are legacy reference interfaces outside the current single-AMR path. Their guides identify their reference scope. Use the direct-sensor publisher for calibrated full-sensor trials; use the [MH IR multisensor Wi-Fi firmware](esp32_telemetry_firmware/publish_mh_ir_commissioning/UPLOAD_STEPS.md) for the supplied TB6612, MH IR, IMU and INA219 build. Its truthful unsigned commissioning packet remains separate from the full signed-odometry model contract.

The Streamlit deployment uses repository `SLRICHRIS/richris-replenishment-digital-twin`, branch `main`, and entry point `streamlit_app.py`. Changes to main update that app. Its private PostgreSQL reader connection is configured in deployment secrets. Database connectivity is verified independently from physical telemetry and measured calibration.

The separate inventory API/walkthrough remains under `research_baseline/`; its deployment instructions apply to that experiment.

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

The project configures **AMR-01 only**: one simulated robot, one loading/charging bay, six sensor-model cards, one calibration and one MQTT state topic. AMR-02 and AMR-03 are not instantiated, selectable or subscribed. Legacy mission examples remain in source, outside the hosted interface.


Human-approved physical camera routes now have a guarded execution implementation. See the [physical execution setup](project_documentation/human_approved_physical_route_execution.md). Camera/motor commissioning, private topic permissions and ESP32 upload are required before movement is enabled.


Vision floor measurements reported on 18 November 2026: paper **425 × 630 mm**, camera height **92 cm** (lens-to-paper interpretation unverified). These replace the earlier A0 assumption. Entering dimensions does not complete camera or motor commissioning.
