# Installation and Deployment

Use Python 3.12 and a browser with JavaScript enabled.

## Run locally

Open a terminal in the repository's main folder.

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

## Deploy on Streamlit

1. Open [Streamlit Community Cloud](https://share.streamlit.io/) and connect GitHub.
2. For private repositories, open Settings → Linked accounts → Source control → Connect here and authorize access.
3. Select Create app and enter:

| Field | Value |
|---|---|
| Repository | SLRICHRIS/richris-replenishment-digital-twin |
| Branch | main |
| Main file | streamlit_app.py |
| Python, under Advanced settings | 3.12 |

4. Deploy and open the generated application URL.

Simulation requires no secrets. Upload the complete repository, including digital_twin_application.

## Optional hardware and development

- [ESP32 setup](../digital_twin_application/esp32_robot_firmware/esp32_wifi_and_telemetry_setup.md): board configuration, broker access and measurement format.
- [Testing](../automated_tests/README.md): development dependencies and verification commands.

## Troubleshooting

| Issue | Check |
|---|---|
| Repository or branch unavailable | Streamlit's linked GitHub account and private-repository permission |
| Missing application or blank page | Complete application folder, JavaScript availability and browser/Streamlit errors |
| Canvas fallback instead of 3D | Browser WebGL availability |
| Offline devices | Follow the hardware guide's connection checks |

Official references: [deployment](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy) and [private repository access](https://docs.streamlit.io/deploy/streamlit-community-cloud/get-started/connect-your-github-account).
