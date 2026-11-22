# Software verification record

## Final preset command expiry: 23 November 2026

Fixed unnecessary drive renewals near a timed segment's deadline. Once an accepted command covers the intended end, the preset controller waits for signed feedback with that command's sequence, an expired state and zero applied motor outputs. It does not send progressively shorter renewals or a normal Stop to the already expired route. Cancellation, attendance, freshness, receiver readiness, ownership and output checks remain active during this wait. Other command rejections still stop the job without retrying or restarting it. Stop records now preserve the attempted command's sequence, timing, lease and HTTP acceptance result before any best-effort Stop overwrites the current request.

Verification: a fake receiver with 70 ms command transit reproduced HTTP 409 with the previous controller. The corrected controller completes with 40, 70 and 110 ms transit, with no rejected commands. Tests require the final sequence and actual zero outputs, reject missing final acknowledgement, retain cancellation/interlock handling and preserve failed-command diagnostics. The full predictive/integration Python suite passed 559 tests with 5 skips. Compiled production receiver protocol/runtime checks, source preset HTTP startup, repository/download consistency and whitespace checks passed. No firmware, cutoff, 500 ms lease or 60 PWM cap change is required. This reproduces a code defect consistent with the reported late-command failure; the user's precise rejected packet and physical pulse outcome still need the updated application trial. Windows packaging is checked separately in CI.

## Operator-requested 6.0 V preset cutoff: 23 November 2026

Changed the preset application's pack threshold to 6.0 V and the Local Routes receiver's supported minimum and example setting to 6.0 V. Firmware revision r3 prints its configured cutoff at startup, while the preset page displays its own threshold. The Windows preset bundle now includes the matching firmware source without private credentials. Existing installations must retain their private settings, set `AMR_ROUTE_MIN_PACK_V` to `6.0`, and upload r3; replacing the Windows application alone does not change the running ESP32. Camera mission voltage policies remain separate.

Verification: 547 predictive/integration Python tests passed, with 5 skips. Preset trials complete in the fake-receiver tests at 6.21 V and 6.01 V, while 5.99 V records a low-voltage stop. The compiled production ESP32 runtime accepts active drive at 6.21 V and 6.01 V and cancels it at the 6.0 V boundary. Protocol/runtime checks, preset browser behavior, source HTTP startup, repository/generated-download checks and whitespace checks passed. Authentication, feedback age, 500 ms command leases, 60 PWM cap and all other interlocks remain in force. These checks do not validate the condition or balance of the physical battery cells or establish successful route travel.

## Preserved preset stop evidence: 23 November 2026

The preset controller now reports the specific failed readiness condition instead of combining expired feedback, receiver readiness and low voltage into one message. Interrupted movements preserve the feedback available at the stop, including voltage, ready flag, state, age, sequence and segment phase, in the status response and audit record. The page shows this evidence separately from current readings. A recovered sample or subsequent connection error cannot replace the recorded reason or resume movement. Zero voltage is identified as unavailable battery feedback. Controller limits, leases and firmware are unchanged.

Verification: 545 predictive/integration Python tests passed, with 5 skips. The browser behavior test passed with a recovered live sample alongside a preserved not-ready stop sample. Tests cover each readiness failure, retained audit evidence, independent status copies, no automatic resumption and clearing the previous evidence only on a new explicit movement. Source HTTP startup, repository/download consistency and whitespace checks passed. This diagnostic change does not establish which internal ESP32 interlock caused the previously reported stop.

## Local receiver command clock: 23 November 2026

Fresh H1 feedback can pass its existing age check while a command stamped with a laptop clock 220 ms ahead fails the receiver's 100 ms future-time check. The HTTP transport now derives command time from the last authenticated receiver timestamp and elapsed laptop time since receipt. Reply transit and lock delay shorten the usable command window; the caller's attendance/segment deadline is not renewed. Original feedback timestamps, replay/identity checks, 500 ms maximum lease and receiver protections remain unchanged. No firmware change is required.

Verification: 541 predictive/integration Python tests passed, with 5 skips. The production Python transport's output passed the compiled production C++ parser/guard with both a leading and lagging laptop clock. Tests cover short leases, delayed sends, rejected samples, epoch changes, original freshness and unchanged applied-output evidence. The native receiver runtime checks, both source entry-point HTTP smoke checks, repository/download consistency and whitespace checks passed. The reported hardware HTTP 409 was not captured with a simultaneous clock measurement, so this reproduces and fixes a possible cause, not a confirmed diagnosis of that particular packet or a physical movement result.

## Attended three-route controller: 23 November 2026

Added camera-free A → B, E → A and B → E timed sequences for the reported 760 × 560 mm floor. The robot front targets and fixed parked headings determine the body-centre path. Three operator-measured motor pulses supply empirical forward/left/right rates. The existing signed Wi-Fi transport, firmware PWM cap and expiry/interlock protections are retained. Camera-route checks remain unchanged.

Local verification: the full predictive/integration Python suite passed 529 tests with 5 skips; the final focused preset suite passed 22 tests after adding HTTP-origin and stopping-distance rejection cases. All browser behaviour checks, including the new real-DOM preset test, passed. Both camera and preset source entry points passed live loopback HTTP startup checks without contacting a robot. Repository links, file catalog, canonical generated downloads and whitespace checks passed.

Tests simulate receiver feedback and applied outputs. They cover exact front-reference geometry, three-route progression, bounded leases, measured timing, changed identity, battery/freshness/input loss, explicit Stop, no restart after failure and operator-only arrival confirmation. They do not establish actual turn angles, distance accuracy, obstacle response or physical arrival. Windows packaging is separately checked by the build workflow.

## Physical data study packaging and replay: 22 November 2026

Baseline before this addition: `7f81def53a9cde4b8564a92b0c2e9ff83220d1c3`. Scope: the offline [physical data studies](../../physical_data_studies/README.md), repository navigation, source catalog and study CI. Dashboard and firmware behavior were not changed.

Using Python 3.12.14, NumPy 2.3.5, pandas 2.2.3, SciPy 1.17.0 and scikit-learn 1.8.0:

| Verification | Observed result |
| --- | --- |
| Packaged evidence | All 47 file fingerprints pass; both gzip sources decompress to the original byte counts and SHA-256 values. |
| Shared source | The 17-field gyro projection matches the same 68,130 physical packets in the voltage export. |
| Voltage replay | Rebuilt 1,518 labelled examples and 364 test predictions; 10 dataset, fitted-model and evaluation files match the recorded outputs at numeric tolerance 1e-9. |
| Gyro replay | Rebuilt 18,766 labelled examples and 8,562 test predictions; 13 dataset, fitted-model and evaluation files match at numeric tolerance 1e-9. |
| Gyro source verification | All 68,130 packet identities, 18,766 six-packet windows, saved-model forecasts and subgroup error scores pass. |
| Repository integration | Local references, catalog coverage and source boundaries pass; all 7 existing downloadable kits still match their canonical sources. |
| Syntax and whitespace | Study Python compilation and `git diff --check` pass. |

Reproduce with `python physical_data_studies/reproduce.py`. This verifies repeatability of forecasts against recorded sensors. Independent ground truth for physical heading, travel and battery lifetime remains separate from these checks.

## Historical software verification

> The October sections below describe the earlier multi-AMR/UART reference implementation. They are retained for reproducibility, not as current single-AMR capability or physical evidence. Use [current AMR-01 software evidence](../single_amr_alignment_validation.md) and [scope](../implemented_dashboard_features_and_limits.md) for the active path.

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

## Movable managers — 12 October 2026

Baseline before this change: `0fbd7141ffe9c9be44a8d1d2146b698b96c40633`. The frontend now has 13 suites. Manager tests cover reactive paths and cache reopening, current-pose/return/reserve holds, safe partial-segment exits, waiting poses, cancelled deliveries, fixed journey speeds and four concurrent replan configurations with 6,496 fleet samples. DOM tests exercise mouse/touch/keyboard, invalid drops, cancellation, page changes and automatic preview updates. Actual dashboard tests complete rerouted delivery/docking, invalidate queued approval, hold/recover motion and retain operator pause/hardware isolation. Native Three.js/Canvas checks verify moved figures, boundaries and network restrictions. Browser/GPU visual QA remains unavailable; positions are manual simulation inputs, not tracked people or physical enforcement.

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
