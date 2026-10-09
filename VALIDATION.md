# Streamlit port validation

Date: 8 October 2026. Python 3.12.14; Streamlit 1.65.0; Node.js 24.19.0.

| Check | Result |
|---|---|
| Source preservation | Based on current Replenishment Twin version 18, source commit `dfc8561ae050b0da006593870a7f6177782b7950`. All original frontend files are byte-identical except the added host script reference in `index.html`. |
| Python app | Streamlit AppTest passes with no application exceptions; one local component registered and its ID remains stable on rerun. |
| Actual server | Streamlit process starts; health endpoint and a real WebSocket session pass. |
| Asset delivery | All 46 frontend files served byte-for-byte from the registered component route. JavaScript, CSS, and HTML content types checked. Includes the worker, Three.js, fonts, and ESP32 download. |
| JavaScript | Five suites pass: dispatch, telemetry, motion, workspace, and Streamlit host handshake. See `verification-javascript.txt`. |
| Missions | Existing tests check approval revalidation, exclusive shared-aisle occupancy, full delivery/return cycles, pause/stop retention, cancellation, and reassignment. |
| Telemetry | Existing tests check fixed robot slots, freshness, retained/duplicate/reboot rejection, measurement readiness, and live/simulation isolation. |
| Host boundary | Handshake, message origin/source validation, viewport resizing, resize-loop prevention, and listener cleanup checked in a JavaScript test harness. |

## Still requiring the target environment

- Streamlit Community Cloud deployment in the user's account.
- Full browser visual inspection and WebGL rendering within the deployed Streamlit app. Python AppTest does not execute JavaScript; the DOM tests do not render WebGL.
- Actual broker/WSS credentials, ESP32 telemetry, viewer network access, and browser behavior with that broker.

The user created the private repository `SLRICHRIS/richris-replenishment-digital-twin`; this commit contains the prepared project. Streamlit Cloud deployment is still pending, and no physical robot commands were sent during this port. LabVIEW remains separate. The original hosted Site was not modified.

The native interface's appearance and behavior are preserved in the served frontend. This record distinguishes source and transport checks from browser and hardware validation.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
