# Single-AMR alignment: software evidence and physical limits

The implementation is aligned to the final 17-slide modelling deck and integrated into the previously designed warehouse dashboard. The default remains the original floor UI; Sensor models shows backend calculations. This revision keeps only AMR-01: one robot assembly, one dock, one set of six model cards and one raw-sensor topic. The inventory research baseline remains in source; the inspection workflow retains separate legacy stock/task functions, outside the final presentation. No existing route-planning or stock simulator is replaced with fabricated hardware evidence.

## Verified locally

| Check | Result / scope |
|---|---|
| Python sensor and host checks | Equation units/signs, straight/turn/curved motion, bias, unclipped SOC, finite inputs, runtime boundaries; removed-identity rejection; duplicates, reordering, retired boots, gaps, stale/invalid/retained packets; default Streamlit UI and separate legacy stock/task event forms. See the dated recovery checks below. |
| MQTT service test | Mock client verifies TLS context, the single AMR-01 subscription, callback isolation and absence of command publishing; this is not a broker connectivity test. |
| Research baseline | 21 tests pass: API/quarantine, synthetic discrete events, graph/event explanations, inventory conservation, shared-input policy comparison and legacy gateway. |
| Legacy Python services | 13 tests pass: recorder and coordinator lifecycle. These services remain outside the new active sensor path. |
| Browser regression suite | All 15 suites pass, including direct CPU construction of exactly one robot and one dock; the prior multi-robot reservation study is replaced with single-AMR route/time-window checks, including routing, calibration/replay, simulated stock consistency, reservations and manager-driven route changes. These are legacy workspace tests. |
| Hosting/assets/source boundaries | Original warehouse landing component, server-computed display arguments and registered assets checked using a real Streamlit WebSocket session; file-purpose catalog, local links and existing download reproducibility checked separately. |

Run the commands in the root README to reproduce these checks. CI compiles the direct-sensor ESP32 sketch with the AMR-01-only identity admission check. Local environment has no Arduino toolchain; **no local firmware build, sensor wiring, motor test or hardware validation is claimed**. Read the Actions result for the actual remote compile status. A successful compile still would not validate sensors or mechanics.

## Restart and freshness verification: 15 November 2026

Local sensor/hosting checks: **57 passed**, with the two PostgreSQL service tests skipped locally. The 15 browser suites pass, and a real local Streamlit WebSocket session serves all 66 application files byte-for-byte. Source-boundary checks, 211 local references and seven generated downloads pass. The real PostgreSQL 16 integration and ESP32 compile are separate GitHub Actions jobs; consult that revision's Actions results for their status.

New cases cover the original receive timestamp through a blocked writer queue, stale delayed commits, checkpoint recovery of pose/SOC/energy, first-sample anchoring after downtime, rejected retired boots and calibration changes, atomic rollback of samples/state/events/checkpoint, missing-checkpoint failure, future-clock rejection and additive v1/v2 provisioning. The checkpoint is independent of receive-time ordering, so a corrected UTC clock cannot select an older current state. A restart records uncertainty instead of reconstructing unobserved motion or charge.

Deployment requires the schema-v3 provisioning step and new checkpoint-table grants in the [pipeline guide](postgresql_sensor_pipeline.md). Packet schema remains v2. The RAM queue and QoS-0 source are still not lossless; these checks do not validate the live EMQX deployment, sensor accuracy, physical timing or ground truth.

## Interface interpretation review: 15 November 2026

The six sensor cards retain the final slide order. Source badges now distinguish demo data from physical records, including the page heading. Data-quality codes have plain-language labels and explanations shared by the workspace and detailed view. Left/right values, x/y/heading and voltage/current are individually named with units. SOC is expanded as state of charge, with the current sign and local coordinate frame explained beside the values.

Regression cases exercise stale readings with an old forecast still present in the payload, partial estimates, missing packets, no physical data, zero-current runtime, text-only sensor content, threshold/hold labels and chart breaks across missing residuals, including display decimation. The local sensor/hosting suite has **66 passing checks**, with two PostgreSQL tests deferred to CI; all 15 browser regression suites pass. The new styling uses the existing semantic colors and responsive breakpoints. New screenshot or desktop/mobile pixel verification was unavailable in this environment and is not claimed for this revision.

## Hosted startup regression

The deployed review found that Streamlit could send its initial Python sensor payload while the document was still parsing, before the readout listener at the end of the body existed. The view then remained on the legacy broker form even though the six model cards were present in the HTML. The bridge now waits for DOM readiness before announcing component readiness and retains the latest trusted payload for a late readout listener. Regression cases use the actual head-before-body script order and exercise a single initial render, an early render and a late listener. Parent-window and origin checks remain required; no credential or command path is added.

## Physical commissioning still required

Measure effective x4 counts per wheel revolution, left/right radii and effective track; validate straight, square and turning trials with an independent reference. Verify encoder sign and IMU orientation; collect stationary gyro bias; compare INA219 readings with a meter and measure usable pack capacity/initial SOC. Run healthy/fault/slip trials to select the residual threshold/hold and evaluate false alerts, missed faults and latency on separate validation runs. Demonstrate loss/reboot handling against real network outages. Explicitly confirm pickup/delivery events before any future live inventory integration.

The new firmware is a read-only observation sketch with TB6612 standby low; local motor control/navigation remains commissioning work. The models do not implement a full EKF, absolute map localisation, obstacle detection/avoidance, multi-robot traffic control, battery degradation or remaining useful life. Constant-wheel-speed/runtime projections are assumed-load forecasts. The stock/task example and larger policy experiment remain legacy reference scope, outside the final 17-slide sensor presentation.

Continuous trajectories and battery charge during long data gaps are unknown. PostgreSQL stores accepted physical samples, model states, quality events and a transactional checkpoint. On restart, committed totals survive; a fresh anchor starts the next observed interval and estimates remain partial. The in-memory queue is volatile and source delivery is QoS 0, so this does not guarantee a complete raw evidence archive. Preserve independent trial evidence before drawing experimental conclusions. Paper-to-code attribution and exact PDF pages are in [the slide mapping](slide_to_code_mapping.md).

## Scope alignment

The current architecture, operator guide and feature audit describe one direct-sensor AMR. The hosted UI hides the legacy v1 live-floor selector and legacy kit links. The Reference lab remains in source and is hidden from hosted navigation; it is not connected to the Python v2 state. Manager-movement controls and the unsupported cone-overlay control are hidden in the active hosted workflow; their source remains available as reference simulation code. The original warehouse design, one middle bay, virtual tasks and paper links are retained.

A visible Floor note identifies the remaining local-to-map registration and live 3D synchronisation work. This revision does not implement that transform or claim physical validation. Coordinate calibration requires independent surveyed measurements and a known initial pose.

## Presentation-model alignment

The hosted navigation is limited to Floor, Sensor models, Missions and Activity. Six compact cards follow final slides 5–15, with equations/variables and source details collapsed by default. Competing route-study, legacy observer and simulated energy views are not navigation options in this workflow; their deep links resolve to Sensor models. The detailed view includes separate legacy stock-balance and task-state functions, outside the final presentation.

The residual timer now starts at the first above-threshold sample, matching final slide 14 rather than counting the preceding interval. Forecasts use final slide 15’s 20 midpoint substeps by default. Software checks compare timestamp persistence behavior, integer stock conservation, permitted task transitions, invalid stock rejection and hosted navigation/replay isolation. No physical validation is implied.

## Rendered sensor-panel layout

The model heading now uses a dedicated single-column header instead of the legacy icon/title/badge grid, which had constrained its only text child to 54 px. Local headless Chromium checks cover 1500, 1024, 768 and 390 px viewports in both themes, with Streamlit scroll-container styles active. They verify header width/height, aligned desktop cards, stacked mobile cards and no horizontal overflow, including expanded mobile equations. Desktop and mobile screenshots were inspected. These are local layout checks, not observation of the deployed Streamlit app or physical hardware.
