# Installation and Deployment

Use Python 3.12 and a browser with JavaScript enabled. The tested runtime remains Streamlit 1.65.0.

## Run locally

Open a terminal in the repository root.

**Windows**

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m streamlit run streamlit_app.py
```

**macOS / Linux**

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m streamlit run streamlit_app.py
```

Streamlit serves the whole local component, including ES modules, workers, styles, fonts and downloadable kits. A separate HTTP server or Node runtime is not needed for deployment.

## Streamlit Community Cloud

For an existing app connected to `main`, committed repository changes are copied automatically. Open the existing app and refresh after the update. Use its management panel to inspect logs or reboot if it remains stale.

For a new app, open [Streamlit Community Cloud](https://share.streamlit.io/), connect GitHub and choose Create app. Enter:

| Field | Value |
| --- | --- |
| Repository | SLRICHRIS/richris-replenishment-digital-twin |
| Branch | main |
| Main file path | streamlit_app.py |
| Python, under Advanced settings | 3.12 |

For a private repository, authorize that repository in Streamlit's linked GitHub account. Keep the repository private unless you deliberately change its audience. Preserve the existing app's sharing settings when updating it.

Deploy from the repository root with the complete repository, including `frontend_warehouse_dashboard/` and `backend_streamlit_and_telemetry/`. The default synthetic trial needs no secrets. For live sensors, configure private Streamlit server secrets using `.streamlit/secrets.example.toml`; do not commit credentials. The independent worker connects to MQTT/TLS 8883 and writes PostgreSQL. Streamlit reads stored records through its private reader connection. Choose Stored sensor data in Sensor models or inspect saved rows in Database. Follow [current single-AMR commissioning](single_amr_sensor_twin_setup.md). Reuse the existing app; no second deployment is required.

## Optional hardware and development

- [Single-AMR setup](single_amr_sensor_twin_setup.md): direct-sensor firmware, private secrets, broker access, raw units and calibration.
- [Edge historian and LabVIEW inventory adapter](mqtt_sqlite_recorder_and_labview_adapter_setup.md): legacy v1 reference, outside the active raw-sensor path.
- [Automated checks](../automated_software_checks/software_check_commands_and_coverage.md): JavaScript and Python verification.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Old dashboard after a commit | Existing app branch and entrypoint; refresh/reboot from its management panel |
| Repository or branch unavailable | Linked GitHub account and private-repository authorization |
| Missing frontend_warehouse_dashboard/index.html message | Complete frontend_warehouse_dashboard/ and backend_streamlit_and_telemetry/ folders beside streamlit_app.py |
| Blank or clipped workspace | Browser console and Streamlit logs; local component files must be present |
| Canvas compatibility view | Browser WebGL availability; the Canvas fallback remains usable |
| Offline hardware | Private server secrets, MQTT/TLS 8883, `robot/amr01/state`, commissioning calibration and freshness gates |

Official references: [deploy](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy), [committed updates](https://docs.streamlit.io/deploy/streamlit-community-cloud/manage-your-app/edit-your-app) and [private repository access](https://docs.streamlit.io/deploy/streamlit-community-cloud/get-started/connect-your-github-account).

