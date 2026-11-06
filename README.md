# Warehouse Robot Digital Twin — S. L. Richris

Two ESP32 2WD robots publish raw encoder, MPU6050 gyro and INA219 battery measurements. The **Streamlit Python backend** computes wheel odometry, motion, power/energy/SOC, residual advisories and illustrative forecasts. The browser displays those results. GitHub hosts the source; it does not execute the online twin.

```sh
python -m pip install -r requirements.txt
streamlit run streamlit_app.py
```

The default page runs a clearly labelled deterministic **synthetic demonstration** without broker credentials. Choose Live MQTT sensors only after commissioning both robots and setting private Streamlit secrets. No physical connection or hardware validation is implied by a working demo.

## Active architecture

ESP32 `amr01` / `amr02` → MQTT/TLS **8883** → EMQX → read-only Python subscriber → per-robot models → Streamlit browser view. Topics: `robot/amr01/state`, `robot/amr02/state`. The active app does not subscribe directly from browser JavaScript and does not publish motor commands. TB6612FNG control remains local to each ESP32; no separate UART AMR controller is required by the current BOM.

- [Exact slide, equation, variable and paper-page mapping](project_documentation/slide_to_code_mapping.md)
- [Raw packet schema, units, calibration, firmware and deployment](project_documentation/two_robot_sensor_twin_setup.md)
- [Validation evidence and remaining hardware work](project_documentation/two_robot_alignment_validation.md)
- Active implementation: `backend_streamlit_and_telemetry/predictive_twin/`
- Active direct-sensor firmware: `esp32_telemetry_firmware/publish_raw_sensor_telemetry/`

The Inventory & tasks tab preserves the research branch's synthetic replenishment model. Reserve, transit and picking stock change through explicit demand/pickup/delivery events with conservation checks. Its FIFO/urgency policy experiment has **one virtual robot per run**, separate from the two physical sensor nodes. This preserves the warehouse research scope without inventing physical inventory observations.

## Preserved reference work

The sidebar's **Legacy 3D reference** retains the earlier three-AMR browser dashboard, route planning, animation and experiments. It is separate from the active Python sensor state. Existing browser MQTT connections, UART firmware, recorder/coordinator and LabVIEW adapters are legacy interfaces, not part of the current two-robot path. Earlier documents under `project_documentation/` describe that historical design unless explicitly listed above. Do not use the legacy downloadable UART starter kit to commission the new direct-sensor publisher.

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
