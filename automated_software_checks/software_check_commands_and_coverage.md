# Software verification

Run from the repository root with Python 3.12, Node.js and a C++17 compiler. Install dashboard dependencies, development packages and the optional MQTT package when running networking:

```sh
python -m pip install -r requirements.txt
npm ci
npm run format:check
npm test
python -m unittest discover -s automated_software_checks/python_telemetry_service_checks -p 'test_*.py' -v
python -m unittest discover -s automated_software_checks/streamlit_and_repository_integration_checks -p 'test_*.py' -v
python automated_software_checks/streamlit_and_repository_integration_checks/check_streamlit_frontend_file_delivery.py
python automated_software_checks/streamlit_and_repository_integration_checks/check_repository_links_source_boundaries_and_downloads.py
python project_maintenance_scripts/rebuild_dashboard_downloads_from_sources.py --check
python automated_software_checks/streamlit_and_repository_integration_checks/measure_override_latency_under_prediction_load.py --requests 100
```

| Checks | Coverage |
| --- | --- |
| Browser telemetry | Three slots, identity, boot/sequence, retained/duplicate rejection, null/zero and monotonic freshness |
| Routing | 2,940 Dijkstra vs independent oracle comparisons; 288 trace/playback cases; both legs, closures and geometry |
| Mission/UI | Human revalidation, reassignment, source isolation, charging, exact stock/arrival events, pause/stop/cancel and scrolling |
| Fleet windows | 48 fleet configurations, head-on/shared/disjoint/nearby corridors, continuing reservations, footprint separation and actual concurrent journeys |
| Movable managers | Mouse/touch/keyboard placement, restrictions and cache invalidation, partial-segment exits, atomic fleet replanning, waiting poses, reserve/return holds, approval invalidation and recovery |
| Twin | Causal residuals, scalar position correction, chronological calibration/holdout, replay and deterministic concurrent policy comparisons |
| Python recorder/inventory | Production packet validation, replay rejection, LabVIEW counts, SQLite sessions/export |
| Coordinator | Boot-bound fresh identity, stable command IDs, execution vs acceptance, timeout, rejection, late/duplicate ACK and automatic expiry |
| Firmware packet contract | Compile the serializer called by `.ino`; send the same actual bytes through browser and recorder validators |
| Hosting/repository | Real Streamlit startup, stable rerun identity, all frontend bytes/MIME, source links/boundaries, kit members and private settings |
| Override experiment | Production command service with simulated execution ACK; production prediction runs in separate busy processes |

## ESP32 build and UART behavior

Install Arduino CLI, Arduino-ESP32 3.3.12, PubSubClient 2.8 and ArduinoJson 7.4.2. Then:

```sh
python automated_software_checks/esp32_firmware_compile_and_contract_checks/verify_esp32_firmware_build.py
```

The script creates a temporary placeholder configuration and compiles UART-disabled/enabled variants for `esp32:esp32:esp32`; it never flashes a board or commits that header. Use `--board`, `--arduino-cli` and `--config-file` for your installation. Supply `--json-include /path/to/ArduinoJson/src` to compile/run the native production UART header contract, covering measurement, frame/type/age, execution ACK, replay and guarded-resume behavior.

[Current results](../project_documentation/software_verification_results/current_software_check_results.md) records software scope. Physical trial evidence is collected using [the commissioning guide](../project_documentation/operator_override_channel_and_hardware_commissioning.md).

## Preset controller embedding

The Windows build workflow also runs a real Chromium embedding check. It starts a separate loopback controller with a synthetic key, serves the production parent module under the exact trusted HTTPS origin with a nested component frame, and simulates granting local-app permission. It checks the actual child's loading confirmation, 200 PWM default, disconnected startup, context removal and rejection of an untrusted ancestor. It never selects Connect or sends a device command and refuses to reuse an occupied port 8765.

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install --with-deps chromium
node automated_software_checks/browser_behavior_checks/verify_preset_embed_chromium.cjs
```

This verifies Chromium behaviour in CI. The operator's Windows browser still must allow access to the locally running application.


## Physical route execution

Run `python -m pytest automated_software_checks/predictive_twin_checks/test_vision_execution.py -q` for offline approved-route simulation and failure cases. Install the optional vision requirements, then run `python -m pytest automated_software_checks/predictive_twin_checks/test_vision_camera.py -q` for synthetic projection/obstacle checks. `npm run test:browser` includes physical route controls. The firmware verifier runs the native guard and compiles disabled and enabled receiver modes. These checks do not commission physical hardware.
