# Replenish · S L RICHRIS

The existing three-AMR digital twin, packaged for **GitHub and Streamlit Community Cloud**.

The 3D warehouse, mission review, exclusive shared-aisle queue, forecasts, dark/bright appearance, motion preference, and optional ESP32 telemetry workspace are preserved. The app serves its own assets; it does not embed or depend on the previous ChatGPT-hosted website.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.

## Deploy from your GitHub

1. Sign in to [Streamlit Community Cloud](https://share.streamlit.io/) using your GitHub account **SLRICHRIS**.
2. Give Streamlit access to this private repository if prompted. GitHub access in ChatGPT and GitHub access in Streamlit are separate connections.
3. Choose **Create app**, then select these settings:

   | Setting | Value |
   |---|---|
   | Repository | `SLRICHRIS/richris-replenishment-digital-twin` |
   | Branch | `main` |
   | Main file path | `streamlit_app.py` |
   | Python version | `3.12` |
   | App URL | Choose an available name |
   | Secrets | None needed for the simulation |

4. Deploy. Streamlit installs the pinned dependency and supplies your actual `streamlit.app` URL. Future commits to the selected branch update the deployment.

This source is in the private repository [SLRICHRIS/richris-replenishment-digital-twin](https://github.com/SLRICHRIS/richris-replenishment-digital-twin). A Streamlit Cloud deployment is still required; uploading code to GitHub does not launch the app. Keep the repository and app private unless you deliberately choose to share them.

## Run locally

Use Python 3.12. In a terminal in this folder:

```sh
python -m venv .venv
```

On Windows:

```powershell
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m streamlit run streamlit_app.py
```

On macOS/Linux:

```sh
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m streamlit run streamlit_app.py
```

## Three ESP32 robot slots

The **Hardware** view retains `amr-01`, `amr-02`, and `amr-03`. Enter your secure MQTT WebSocket address, topic prefix, and a telemetry subscriber account there. The browser connects to the broker; Streamlit does not need a background MQTT process.

Use a `wss://` endpoint reachable from the viewer's browser. `localhost` means the viewer's device, not an ESP32 or the Streamlit cloud server. See `frontend/hardware/SETUP.md` for the existing firmware and telemetry format.

Keep broker passwords out of GitHub. A browser subscriber account should be allowed to read only the intended telemetry topics. The app has no physical motor-command publisher. The simulation and hardware measurements remain separate data sources.

## Session behavior and LabVIEW

Simulation state belongs to the current browser workspace and resets on reload. Use **Activity → Export CSV** to retain the decision log. Appearance and motion preferences remain local browser settings. Different visitors do not share a fleet simulation or operator authority.

The LabVIEW supervision kit remains a separate project. This hosting port does not deploy the Python coordinator or automatically connect to a LabVIEW station. The included simulation retains the twin's existing local approval workflow.

## Project files

| Path | Purpose |
|---|---|
| `streamlit_app.py` | Streamlit entry point |
| `requirements.txt` | Pinned Streamlit dependency |
| `.streamlit/config.toml` | Host configuration |
| `frontend/` | Complete digital twin and bundled assets |
| `frontend/streamlit-host.js` | Component handshake and viewport sizing |
| `tests/` | Existing simulation, telemetry, motion, and workspace checks |
| `VALIDATION.md` | Verification record and remaining deployment checks |

No Node.js build is required to deploy. Node.js is only used for development checks (tested with Node.js 24):

```sh
npm ci
npm test
python -m unittest discover -s tests
python tests/http_smoke.py
```

## Troubleshooting

- **Missing frontend:** upload the complete folder tree, including fonts and vendor scripts.
- **Blank component:** check browser console and Streamlit logs; verify the `frontend/streamlit-host.js` file is present. Blocking JavaScript prevents the app from running.
- **Fallback rendering:** the original app includes a canvas fallback when WebGL is unavailable. Try a browser with WebGL enabled for the full 3D scene.
- **Offline robots:** verify WSS connectivity, broker permissions, topic prefix, fixed IDs, and fresh telemetry. Simulation motion is not evidence of a physical connection.

Primary deployment guidance: [Streamlit deployment](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy) and [local custom components](https://docs.streamlit.io/develop/api-reference/custom-components/st.components.v1.declare_component).

Third-party software and fonts retain their respective licenses. See `frontend/NOTICE.txt` and the license files alongside the bundled assets.
