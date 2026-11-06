# AMR-01 Warehouse Digital Twin — S. L. Richris

One ESP32 2WD robot publishes raw encoder, MPU6050 gyro and INA219 battery measurements. The **Streamlit Python backend** computes wheel odometry, motion, power/energy/SOC, residual advisories and illustrative forecasts. The browser displays those results. GitHub hosts the source; it does not execute the online twin.

```sh
python -m pip install -r requirements.txt
streamlit run streamlit_app.py
```

The **previously designed warehouse dashboard is the default screen**, with its floor scene, routes, missions, inventory and styling preserved. Open **Hardware** for the single-AMR Python sensor twin. It starts with a labelled synthetic trial without broker credentials; select Live MQTT sensors only after commissioning AMR-01 and setting private Streamlit secrets. The new sensor results are integrated into the existing design, rather than replacing it with a separate app. No physical connection or hardware validation is implied by a working demo.

## Active architecture

ESP32 `amr01` → MQTT/TLS **8883** → EMQX → read-only Python subscriber → AMR-01 models → Streamlit browser view. Topic: `robot/amr01/state`. The active raw-sensor path does not subscribe directly from browser JavaScript and does not publish motor commands. TB6612FNG control remains local to the ESP32; no separate UART AMR controller is required by the current BOM.

- [Exact slide, equation, variable and paper-page mapping](project_documentation/slide_to_code_mapping.md)
- [Raw packet schema, units, calibration, firmware and deployment](project_documentation/single_amr_sensor_twin_setup.md)
- [Validation evidence and remaining hardware work](project_documentation/single_amr_alignment_validation.md)
- Active implementation: `backend_streamlit_and_telemetry/predictive_twin/`
- Active direct-sensor firmware: `esp32_telemetry_firmware/publish_raw_sensor_telemetry/`

The Hardware view's **Open detailed model inspection** button opens the native scientific view; its Inventory & tasks tab preserves the research branch's synthetic replenishment model. Reserve, transit and picking stock change through explicit demand/pickup/delivery events with conservation checks. Its FIFO/urgency policy experiment has **one virtual robot per run**, separate from the physical AMR-01 sensor node. This preserves the warehouse research scope without inventing physical inventory observations.

## Existing dashboard and deployment

The existing single-AMR virtual warehouse dashboard remains the main workspace. Its route planning, animation and experiments are separate from the physical AMR-01 sensor node. The Hardware screen receives calculated sensor results from Python through the Streamlit component protocol; JavaScript formats these readouts and sends only source-selection/inspection actions back. Periodic model updates preserve the current view, scroll and virtual mission state. Local encoder pose has no surveyed map transform, so it is not silently placed into the 3D warehouse. Existing browser MQTT connections, UART firmware, recorder/coordinator and LabVIEW adapters are legacy interfaces, not part of the current single-AMR path. Earlier documents under `project_documentation/` describe that historical design unless explicitly listed above. Do not use the legacy downloadable UART starter kit to commission the new direct-sensor publisher.

**Use the existing Streamlit deployment**, repository `SLRICHRIS/richris-replenishment-digital-twin`, branch `main`, entry point `streamlit_app.py`, Python 3.12. An existing app already using these settings picks up changes from main; no second app or private-app slot is required. If it uses the older research entry point, update that deployment to the root entry point. Deployment changes and live connection still require access to the existing Streamlit app.

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
