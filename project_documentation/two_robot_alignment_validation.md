# Two-robot alignment: software evidence and physical limits

The implementation is aligned to the 15-slide modelling deck. The parent is `research-baseline-2026-10` commit `96e76b33529137750c004a72b6751473e8277199`, which contains all of main plus the inventory research baseline. No existing route-planning or stock simulator is replaced with fabricated hardware evidence.

## Verified locally

| Check | Result / scope |
|---|---|
| Python sensor and host tests | Equation units/signs, straight/turn/curved motion, bias, unclipped SOC, finite inputs, runtime boundaries; independent robots; duplicates, reordering, retired boots, gaps, stale/invalid/retained packets; default Streamlit UI and inventory event buttons. |
| MQTT service test | Mock client verifies TLS context, exact two subscriptions, callback isolation and absence of command publishing; this is not a broker connectivity test. |
| Research baseline | 21 tests pass: API/quarantine, synthetic discrete events, graph/event explanations, inventory conservation, shared-input policy comparison and legacy gateway. |
| Legacy Python services | 13 tests pass: recorder and coordinator lifecycle. These services remain outside the new active sensor path. |
| Browser regression suite | All 13 suites pass, including routing, calibration/replay, simulated stock consistency, reservations and manager-driven route changes. These are legacy workspace tests. |
| Hosting/assets/source boundaries | Root Python landing page and optional registered reference assets checked using a real Streamlit WebSocket session; file-purpose catalog, local links and existing download reproducibility checked separately. |

Run the commands in the root README to reproduce these checks. CI additionally compiles the direct-sensor ESP32 sketch. Local environment has no Arduino toolchain; **no local firmware build, sensor wiring, motor test or hardware validation is claimed**. Read the Actions result for the actual remote compile status. A successful compile still would not validate sensors or mechanics.

## Physical commissioning still required

Measure effective x4 counts per wheel revolution, left/right radii and effective track; validate straight, square and turning trials with an independent reference. Verify encoder sign and IMU orientation; collect stationary gyro bias; compare INA219 readings with a meter and measure usable pack capacity/initial SOC. Run healthy/fault/slip trials to select the residual threshold/hold and evaluate false alerts, missed faults and latency on separate validation runs. Demonstrate loss/reboot handling against real network outages. Explicitly confirm pickup/delivery events before any future live inventory integration.

The new firmware is a read-only observation sketch with TB6612 standby low; local motor control/navigation remains commissioning work. The models do not implement a full EKF, absolute map localisation, obstacle detection/avoidance, multi-robot traffic control, battery degradation or remaining useful life. Constant-wheel-speed/runtime projections are assumed-load forecasts. The stock/task experiment uses one synthetic robot per policy, not a validated physical fleet.

Continuous trajectories and battery charge during long data gaps are unknown. Integrals resume as partial estimates; missing data are never silently filled. The backend state is process memory with bounded history, not a publication-grade measurement archive. Export trial data and use an independent durable recorder before drawing experimental conclusions. Paper-to-code attribution and exact PDF pages are in [the slide mapping](slide_to_code_mapping.md).
