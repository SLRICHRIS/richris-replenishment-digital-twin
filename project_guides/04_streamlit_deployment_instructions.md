# Streamlit Deployment and Local Startup

## Deploy from GitHub

1. Open [Streamlit Community Cloud](https://share.streamlit.io/) and connect the GitHub account SLRICHRIS.
2. For private repositories, open your username menu → Settings → Linked accounts → Source control → Connect here and authorize private-repository access.
3. Choose Create app and use the settings below.
4. Select Python 3.12 under Advanced settings and deploy.

| Field | Value |
|---|---|
| Repository | SLRICHRIS/richris-replenishment-digital-twin |
| Branch | main |
| Main file | streamlit_app.py |
| Python | 3.12 |
| Simulation secrets | None |

Keep the main file as streamlit_app.py. The complete digital_twin_application folder must be present.

If Streamlit cannot find main, check its private-repository permission and linked GitHub account. Paste GitHub URL also accepts the [application launcher URL](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/streamlit_app.py); pasting a URL does not grant permission.

The user supplied a screenshot of the loaded dashboard on 9 October 2026. The deployed URL and a complete live-browser interaction check have not been recorded.

## Run on Windows

Use Python 3.12 and open a terminal in the repository's main folder.

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m streamlit run streamlit_app.py
```

## Run on macOS or Linux

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m streamlit run streamlit_app.py
```

## Run the checks

Node.js is used only for JavaScript checks, not for Streamlit deployment. The reference environment uses Node.js 24 and Python 3.12.

```sh
npm ci
npm test
python -m unittest discover -s automated_tests
python automated_tests/check_project_file_links.py
python automated_tests/check_served_application_files.py
```

Use the Python executable from the activated environment.

## Troubleshooting

| Symptom | Check |
|---|---|
| Missing application folder | Upload the complete digital_twin_application folder |
| Blank dashboard | JavaScript availability, browser errors and Streamlit logs |
| Canvas view instead of 3D | WebGL availability; the app has a canvas fallback |
| Offline robot slots | Broker endpoint, credentials, topics and fresh device measurements |
| Reset after refreshing | Expected behavior; export the activity log before reloading if needed |

The browser needs a reachable secure WebSocket broker endpoint for ESP32 telemetry. Keep configured firmware credentials out of GitHub.

Official references: [deployment](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy), [private repository access](https://docs.streamlit.io/deploy/streamlit-community-cloud/get-started/connect-your-github-account), and [custom components](https://docs.streamlit.io/develop/api-reference/custom-components/st.components.v1.declare_component).

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
