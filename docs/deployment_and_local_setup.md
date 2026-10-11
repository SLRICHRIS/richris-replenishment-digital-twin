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

Streamlit serves the whole local component, including ES modules, workers, styles, fonts and downloadable kits. A separate HTTP server, Node runtime and ChatGPT Site session are not needed for deployment.

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

Deploy from the repository root with the complete repository, including `frontend/` and `backend/`. Simulation needs no secrets. The browser's Hardware panel accepts MQTT credentials; they are not placed in the Python host, source files or GitHub.

## Optional hardware and development

- [ESP32 setup](./esp32_wifi_and_telemetry_setup.md): starter firmware, broker access and measurement format.
- [Edge historian and LabVIEW inventory adapter](./edge_observation_recorder_setup.md): separate optional Python process and its own requirements.
- [Automated checks](../tests/README.md): JavaScript and Python verification.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Old dashboard after a commit | Existing app branch and entrypoint; refresh/reboot from its management panel |
| Repository or branch unavailable | Linked GitHub account and private-repository authorization |
| Missing frontend/index.html message | Complete frontend/ and backend/ folders beside streamlit_app.py |
| Blank or clipped workspace | Browser console and Streamlit logs; local component files must be present |
| Canvas compatibility view | Browser WebGL availability; the Canvas fallback remains usable |
| Offline hardware | Secure broker WebSocket URL, topic identity, credentials and freshness gates |

Official references: [deploy](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy), [committed updates](https://docs.streamlit.io/deploy/streamlit-community-cloud/manage-your-app/edit-your-app) and [private repository access](https://docs.streamlit.io/deploy/streamlit-community-cloud/get-started/connect-your-github-account).

