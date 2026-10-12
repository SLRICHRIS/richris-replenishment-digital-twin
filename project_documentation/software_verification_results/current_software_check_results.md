# Current software verification

Recorded 11 October 2026. Baseline GitHub commit: `b5c847813141e6744272579583ce8e673f48d260`.
Runtime: Python 3.12.14, Streamlit 1.65.0, Node.js 24.19.0, jsdom 26.1.0, Prettier 3.6.2.
Firmware: Arduino CLI 1.4.1, Arduino-ESP32 3.3.12, PubSubClient 2.8.0, ArduinoJson 7.4.2; reference target `esp32:esp32:esp32`.

| Verification | Result |
| --- | --- |
| Browser behavior | All 12 suites pass; existing operator/source/lifecycle/scrolling checks retained |
| Shortest paths | 2,940 independent oracle comparisons pass |
| Interactive map and reassignment | 288 map combinations and 288 reassignment configurations pass |
| Fleet time windows | 48 configurations pass; 44 have overlapping journeys; minimum sampled separation 80 units against a 72-unit requirement |
| Concurrent policy branches | Same spatial window planner; per-unit exclusivity and overlapping robots verified |
| Python services | All 13 recorder/inventory/Coordinator tests pass |
| Cross-validator firmware contract | Actual compiled serializer bytes accepted by both production validators; renamed-key packets rejected; null/zero preserved |
| Streamlit host/transport | Stable startup/rerun identity; all 62 frontend files served byte-for-byte with valid MIME types |
| ESP32 build | UART-disabled and UART-enabled sketches compile with the real pinned toolchain |
| Native UART firmware behavior | Production header passes actual ArduinoJson measurement/age/frame/type, duplicate, boot, resume and controller execution-ACK checks |
| Generated downloads | Seven downloads match sources; firmware kit has 7 members and recorder/control kit 20 |
| Extracted recorder/control kit | All 13 Python service tests pass from the extracted directory |
| Formatting | Prettier checks pass for project JS, embedded HTML, CSS and browser tests; Python and C++ sources formatted |
| Repository cleanup | Historical logs/hashes/rename maps removed; one verification record and a current file-purpose catalog remain |

## Manager standing areas — 12 October 2026

Baseline before this change: `1def9b660f8c62ae9e038c47aee36cbabdba46e4`. All 12 frontend suites, 13 Python service tests and the two hosting/packet-contract integration tests pass. The running Streamlit host serves all 63 frontend files byte-for-byte; all seven generated downloads match canonical sources.

Manager-zone cases verify segment crossings, footprint tangency, shortest clear detours in both directions/objectives, blocked endpoints and pose anchoring, immutable restrictions during manual lane reopening, metadata validation and JSON preservation. Every default reference lane clears the two configured areas; all published bay/bin routes and paired reference outcomes remain unchanged. DOM, native Three.js geometry and Canvas fallback checks confirm the shared positions, figures and labels. Static native SVG exports were inspected in both themes; a live browser/GPU visual check was unavailable in this environment. This change does not establish live personnel tracking or physical exclusion enforcement.

## Override software experiment

One monotonic Coordinator clock measures persisted request to matching executed ACK. The simulated controller deliberately waits 2 ms. Idle has zero prediction processes; normal/heavy have one/two continuously busy processes running production `comparePolicies`. All 300 requests executed, with no rejected/timed-out results.

| Load | Requests / executed | P50 ms | P95 ms | P99 ms | Maximum ms |
| --- | --- | --- | --- | --- | --- |
| idle | 100 / 100 | 2.376 | 2.853 | 3.703 | 4.974 |
| normal_prediction | 100 / 100 | 2.455 | 5.744 | 6.734 | 10.311 |
| heavy_prediction | 100 / 100 | 2.258 | 3.015 | 4.127 | 6.080 |

This is loopback software evidence with a simulated controller. It does not establish ESP32/network/motor latency or hard real-time isolation. Reproduce using `measure_override_latency_under_prediction_load.py --requests 100` as documented in the [check guide](../../automated_software_checks/software_check_commands_and_coverage.md).

## Synthetic model outcomes

The chronological reference fit remains gain 1.119893, 65 training and 29 holdout intervals; holdout position RMSE changes from 0.014775 m to 0.003230 m. These remain synthetic values.

With concurrent reservations and earliest-arrival unit allocation, the 120 s / 5× demand reference study now reports FIFO unmet demand approximately **3.900001 units**, urgency **0 units**. The preceding serial result (14.9 units) is obsolete. Both branches use the same frozen inputs and no charger model; a policy is not required to win. Export the current scenario rather than quoting old results.

## Physical evidence still required

Wire/calibrate the actual sensor/controller UART, commission broker identities/ACLs and the onboard override interlocks, build/test the native LabVIEW VI, and collect independent ground truth and hardware request-to-execution-ACK measurements on the intended separate hosts. Browser/GPU operation on the user's deployed Cloud session also needs that environment. The [commissioning guide](../operator_override_channel_and_hardware_commissioning.md) defines the interface and physical trials.
