<!-- Generated from project_documentation/operator_override_channel_and_hardware_commissioning.md; edit the canonical document and rebuild downloads. -->

# Operator override channel and hardware commissioning

The control service runs on the Coordinator/LabVIEW computer. Prediction workers and the Streamlit viewer have no operator token and cannot call it. The viewer remains read-only for physical robots.

## Start the Coordinator

Install the recorder network requirements and configure `MQTT_HOST`, `MQTT_USER`, `MQTT_PASSWORD` (or the private prompt), optional `MQTT_CA`, and `MQTT_PREFIX`. Supply a private random `OVERRIDE_OPERATOR_TOKEN` of at least 32 characters. Use a control account distinct from the browser viewer.

```sh
python -m pip install -r backend_streamlit_and_telemetry/mqtt_recording_and_inventory_bridge/mqtt_recorder_network_dependencies.txt
python -m backend_streamlit_and_telemetry.operator_override_control_channel.operator_override_command_coordinator --database operator-command-evidence.sqlite3
```

The HTTP endpoint binds only to `127.0.0.1:8765`. LabVIEW on that computer can call the two functions in [the HTTP adapter](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/backend_streamlit_and_telemetry/operator_override_control_channel/labview_operator_override_http_adapter.py) using a Python Node, or use its HTTP Client VIs directly. This repository supplies the interface and adapter; a native `.vi` is still to be created and tested in LabVIEW.

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /commands` | Bearer token; JSON `device_id`, `action`, optional stable `command_id`, `timeout_ms` | Stored command and current status; HTTP 202 while pending |
| `GET /commands/<command_id>` | Bearer token | Status, execution ACK and measured `latency_ms`, or null when not executed |

Actions are `stop`, `pause`, `resume`. Use the same 32-character lowercase hex command ID when retrying the same request. A reused ID with a different device/action is rejected. Commands bind to the known device boot. Pause/resume require fresh telemetry; STOP can use the last known boot despite stale measurements and never depends on prediction eligibility. Timeouts are 100–5,000 ms.

## MQTT and device execution

| Topic suffix, per `amr-01` / `amr-02` / `amr-03` | Publisher | Subscriber |
| --- | --- | --- |
| `/telemetry` | ESP32 | Viewer, historian, Coordinator |
| `/commands` | Coordinator only | That ESP32 only |
| `/command_ack` | That ESP32 only | Coordinator |

Commands contain `v`, `command_id`, `device_id`, `target_boot_id`, `action`, `issued_at_ms`, `expires_at_ms`. Publish with `retain=False`. Configure broker ACLs for these exact identities/topics and clear any retained command messages before commissioning. PubSubClient's callback does not expose the retained flag; the firmware additionally enforces boot identity, expiry, action allowlist and an expiry-preserving duplicate cache.

`accepted` means forwarded to the controller. Only its matching `executed` ACK records execution latency. Rejections/timeouts have no execution latency, and a late ACK cannot change a terminal result. A restarted Coordinator marks unfinished requests unconfirmed. MQTT acknowledgment alone is not motor execution.

## Connect measured sensor data

Copy `example_esp32_wifi_and_mqtt_settings.h` to the private configured header. Choose the actual UART RX/TX pins, baud, controller frame and electrical interface for the AMR; only then enable `ENABLE_CONTROLLER_UART`. No robot pinout is assumed by the shipped configuration. Install PubSubClient 2.8 and ArduinoJson 7.4.2 with the Arduino-ESP32 core.

The onboard controller sends one JSON object per line, at a rate faster than the one-second freshness budget:

```json
{"kind":"measurements","captured_at_ms":1791724800000,"frame_id":"warehouse-01","state":"moving","resume_allowed":false,"battery_pct":74.2,"speed_mps":0.25,"pose":{"x_m":2.3,"y_m":3.1,"heading_deg":90}}
```

These values must come from calibrated battery sensing and encoder/localization measurements. Synchronize the controller acquisition clock with the ESP32. Missing, invalid, old or mismatched-frame fields remain null; the firmware does not turn Wi-Fi RSSI into position. `readMeasurements()` now reads the fresh controller cache instead of an unconditional NaN stub. The outgoing acquisition timestamp is preserved.

For an override, the ESP32 forwards the validated command as a UART line with `kind:"operator_override"`. The controller must enforce command expiry at actuation, its own stop latch, interlocks and actuator behavior, and only afterward send:

```json
{"kind":"execution_ack","command_id":"0123456789abcdef0123456789abcdef","status":"executed"}
```

Use `status:"rejected"` for an explicit controller refusal. If an execution ACK is missing, the Coordinator records an unconfirmed timeout; the firmware does not invent a rejection or execution. A resume also requires a fresh `resume_allowed:true` controller measurement. A missing controller link is rejected; it never produces a fabricated execution ACK.

## Measure isolation

```sh
python automated_software_checks/streamlit_and_repository_integration_checks/measure_override_latency_under_prediction_load.py --requests 100
```

The reproducible software benchmark exercises the production HTTP/Coordinator with a simulated execution ACK under zero, one and two continuously busy production prediction processes. Its output labels this provenance explicitly. [The current verification record](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/software_verification_results/current_software_check_results.md) gives the measured results.

For the thesis, repeat on the real control and twin computers with ESP32/controller execution ACKs, actual network conditions and correlated command IDs. Query SQLite for executed P50/P95/P99/maximum and executed/rejected/timed-out counts in each load condition. Receiver monotonic request-to-ACK time includes command transport, execution and return transport; do not report it as motor-only execution time. Physical wiring, acquisition, LabVIEW VI, ground truth and hardware latency remain commissioning work.
