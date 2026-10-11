# Final system audit — 11 October 2026

**Owner: S L RICHRIS · Twin software 2.1.0**

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.

## Release decision

**Software audit passed after the corrections below.** The reference simulator, route explorer, read-only hardware observer and Twin lab now have consistent data and authority boundaries. The release is suitable for a software demonstration and project review.

Physical commissioning and browser/GPU visual verification remain open. This result does not establish industrial navigation, physical collision avoidance, measured localization accuracy, deterministic override latency or reliable physical command execution. The system retains those gates as pending.

Audited starting source: `9ad26c3a7883b514b8195165a3284d8bb62c52f1`. The published audit release includes the corrections and checks in this report. Tests use the actual routing/model modules and real HTML/SVG DOM fixtures; camera and scene geometry checks run without a GPU.

## Feature alignment

| Feature | Contract checked | Result |
| --- | --- | --- |
| Floor and industrial scene | Three units, twelve racks, four A–D supply bins and eight reserve racks; scene, simulator and default facility share geometry; reserve cartons expose no measured stock | Passed software/geometry checks |
| Route map | Production Dijkstra search; permitted links; distance/time objectives; selected-leg start/destination, pins, directions and exact segment-time playback; arbitrary preview closures | Passed math and DOM checks |
| Missions | Recheck bay readiness, data, reservations, both legs and full-trip battery; approval retains geometry; route settings lock; reassignment uses the replacement unit's own bay | Passed |
| Queue and stock forecast | One full journey reserves the aisle; FIFO after approval; charging waits and paused/impossible holds; exact arrivals, returns and capacity clamping | Passed |
| Hardware | Three fixed identities; secure configured broker; capture/sequence/boot gates; unknown measurements stay unknown; stale poses are hidden; no actuator commands | Passed local contract and source review; physical broker/device integration pending |
| Live inventory | Correct frame, connected source and five-second wall/monotonic age; latest per-bin observation; typed identity; partial captures preserve capture age | Passed |
| Observer and prediction | Score before correction; configured uncertainty growth; frame, gap, jump, divergence and map-bound gates; quarantines and replayable re-anchors | Passed; uncertainty is a configured engineering envelope |
| Calibration | Chronological holdout; straight/gap/boot/frame exclusions; sufficient moving discharge; fitted gain/cruise respect the same physical speed limits as saved profiles | Passed on synthetic fixtures; physical identification pending |
| Paired experiment | Identical frozen input and disturbances; graph-only docked journeys; four new requests; separate no-charger model; source changes invalidate old replies and exports | Passed; results are predictions |
| Evidence and downloads | Source/provenance labels; model/profile/map export and deterministic replay; bounded session memory; CSV notices; edge/archive schema and ZIP member integrity | Passed local checks |
| Interface and lifecycle | Stable controls/focus, seven-page navigation, both themes, keyboard/touch fixtures, reduced motion, view-exit pause, restored workers/replay, expanded-view cleanup | Passed DOM/static checks; live visual and device-gesture checks pending |

## Corrections made

| ID | Finding | Corrected behavior |
| --- | --- | --- |
| A01 | A reassignment candidate could inherit the previous robot's return route and reserve calculation | Candidate assessment recomputes both legs from the new unit's own bay; the old approval stays intact until reassignment succeeds |
| A02 | Fresh-stock gates admitted wrong frames, used only wall time, and could mix inventory sources; browser/edge identity types differed | Frame and monotonic age gate all live counts; older sources cannot replace newer counts; demand uses the current per-bin source/frame; protocol/boot types agree; same-capture partial bins work without renewing capture age |
| A03 | Twin lab plotted +Y upward while the Floor/Route map used +Y downward; heading prose was inconsistent | All reference plans use +X right / +Y down; 0° follows +X and +90° follows +Y; hardware and edge documentation agree |
| A04 | Return playback reversed the path but left outbound S/D pins and editing controls | Pins, selectors, tap tools, search origin and arrival instructions follow the selected leg together |
| A05 | A holdout could pass while fitted cruise × gain exceeded the permitted profile speed | Fitting checks the complete candidate profile before enabling Apply; application errors remain visible and leave the model unchanged |
| A06 | Selecting simulator experiment mode did not invalidate an in-flight recording result; restored workers lost failure handlers | Source changes invalidate request IDs, results and exports; restored workers retain error/message-error handling; new runs clear old results |
| A07 | Recording replay continued after leaving Twin lab and failed after page restoration | Replay pauses on view exit, hidden/suspended pages and reduced motion; restored timers support explicit replay; manual seeking remains available |
| A08 | Leaving an expanded Floor could retain document scroll lock; preview/guide labels were incomplete | Navigation exits expansion; Route map identifies a reference preview; the guide and experiment text state the distinct control/model roles |
| A09 | Large configured pose noise enlarged the bay tolerance, and experiments invented a direct docking connector from the measured pose | A fixed 0.25 m bay check applies; accepted units are modeled as docked at mapped nodes; every study leg follows graph links |

## Verification evidence

The final run contains **ten JavaScript suites and six Python unit tests**:

```sh
node automated_tests/robot_telemetry_checks.mjs
node automated_tests/mission_approval_and_route_checks.mjs
node automated_tests/shortest_path_optimality_checks.mjs
node automated_tests/warehouse_geometry_checks.mjs
node automated_tests/twin_calibration_and_replay_checks.mjs
node automated_tests/dashboard_interaction_checks.cjs
node automated_tests/interactive_route_map_checks.mjs
node automated_tests/route_map_interaction_checks.cjs
node automated_tests/interface_animation_checks.cjs
node automated_tests/final_feature_alignment_checks.mjs
python3 -m unittest discover -s digital_twin_application/engineering/edge -p test_gateway.py
```

The two DOM suites require jsdom 26.1.x available to Node. Production assets do not require jsdom.

- **2,940 independent optimality comparisons:** directed/disconnected/closed random graphs checked against a separate Floyd–Warshall oracle, with deterministic ties and distance/time tradeoffs.
- **288 route/trace/direction/playback combinations:** actual trace agrees with dispatch; distances and times sum correctly; playback stays on permitted segments; same-stop and exhausted searches are handled.
- **288 reassignment configurations:** all unit pairs and bins, two objectives, two speed modes and three reachable closure conditions; new-bay geometry, reserve feasibility and preservation of the existing approval.
- **Cross-feature DOM cases:** reversed return endpoints, consistent map axes, expanded-view exit, source-switch invalidation, replay pause/restoration, reduced-motion manual seeking and restored-worker failure handling.
- **Static and download checks:** unique HTML IDs; local assets; module syntax/import resolution; CSS/Python parsing; both ZIP CRCs and exact member/source bytes.

Existing end-to-end simulator checks also retain the one-journey invariant, compare forecast stock and charging/arrival times with execution, and verify that live/reference/model sources do not overwrite one another. The synthetic calibration fixture still identifies its injected speed gain; those numbers are not physical AMR accuracy measurements.

## Deliberate model differences

| Surface | Time and state | Charging and authority |
| --- | --- | --- |
| Operating simulator | Simulation seconds, actual approved queue and event-time execution | Bay charging at 0.16 pp/s, moving drain at 0.06 pp/s, 15% return reserve; human approval controls virtual units |
| Route map | Preview travel seconds, selected reference endpoints and local closures | No queue, loading or charging time; no dispatch or hardware authority |
| Paired study | Frozen positions/batteries/stock; four new bin requests; selected shared objective/speed; simulator demand already included before the study multiplier | No charger or pickup dwell; existing approved missions are not continued; advisory only |
| Hardware / live observer | UTC capture times plus monotonic receive age; actual packets and configured source models | Read-only observations; physical commands and acknowledgments remain outside this implementation |

These differences are explicit assumptions, not synchronization defects. Imported physical graphs remain source-specific; they do not rebuild the illustrative 3D warehouse. Physical provenance in an imported file is a user declaration rather than independently authenticated evidence.

## Remaining acceptance work

1. **Browser/device visual QA:** inspect desktop and Android layouts, actual touch gestures, chart readability, both themes, WebGL and compatibility rendering. Supported browser QA was unavailable in this environment; DOM and geometry checks cannot substitute for it.
2. **Physical synchronization:** survey the map/axes, commission localization and sensors on all three AMRs, synchronize clocks, and verify source/topic ACLs and receiver throughput.
3. **Measured prediction validation:** collect independent ground truth and reserved test runs for position/arrival/stockout/return-SOC error, including payload, speed, dropout and disturbance cases.
4. **Physical control path:** implement Coordinator approval, idempotent command IDs, expiry, device execution acknowledgment and explicit unresolved overrides; measure stop/override latency under prediction load.
5. **Navigation scope:** validate real footprints, turning dynamics and obstacle handling before any physical execution. The current shared reservation permits one complete virtual journey at a time.

The final software result is a coherent educational twin prototype with tested routing and predictive workflows. Its industrial claims should follow the remaining measurements and integration evidence.
