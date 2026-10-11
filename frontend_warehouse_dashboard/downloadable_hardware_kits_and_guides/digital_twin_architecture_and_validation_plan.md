<!-- Generated from project_documentation/digital_twin_architecture_and_validation_plan.md; edit the canonical document and rebuild downloads. -->

# Replenish: predictive twin architecture and physical validation

Owner: **S L RICHRIS**

**© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.**

## The engineering contribution

The project is a centrally supervised three-AMR replenishment testbed. Its contribution should be demonstrated by how accurately it synchronizes physical state, predicts operational outcomes, and keeps operator overrides independent of prediction load. A polished 3D view does not establish those properties. Python is a suitable implementation language; implementation language does not determine digital-twin fidelity.

NIST identifies physical synchronization, reliable connectivity and predictive models as essential elements, and emphasizes verification, validation and uncertainty quantification. This implementation uses those principles as design guidance. It is not an assertion of ISO conformity or industrial certification.

Sources: [NIST essential elements](https://www.nist.gov/digital-twins/essential-elements), [NIST advanced manufacturing program](https://www.nist.gov/programs-projects/digital-twins-advanced-manufacturing), [NIST validation](https://www.nist.gov/digital-twins/validating-and-advancement).

## Two paths, with different responsibilities

| Path | Responsibility | Implemented here | Remaining physical work |
| --- | --- | --- | --- |
| Observations | ESP32 pose, battery, speed and state; camera/LabVIEW stock counts | Three MQTT slots, optional inventory subscription, validation | Measure and calibrate actual sensors and localization |
| Historian | Retain raw accepted observations, rejection reasons and receiver timing | Browser evidence export; optional SQLite edge recorder | Run recorder on the physical testbed; validate throughput and clock setup |
| Twin state | Separate measured, estimated and predicted state | Per-asset observer, residual gates, age budget and pose quarantine | Validate against independently measured trajectories |
| Predictive advisory | Compare consequences without changing operating state | Paired worker experiments using a frozen snapshot and surveyed route graph | Compare predicted arrivals, stockouts and discharge with actual missions |
| Control | LabVIEW approval/override → Coordinator → onboard controller → acknowledgment | Existing virtual controls only; hardware access remains read-only | Implement and measure the physical command/acknowledgment path |

The browser experiment worker has no broker credentials and no motor functions. A Web Worker provides computation isolation inside the browser; it does not establish the deck's separate physical platform requirement or a deterministic real-time override guarantee. Run the twin/advisory service on its intended separate machine, and retain the Coordinator and override path on the control platform when commissioning hardware.

## Physical identity, map and timing

Each AMR has a fixed `amr-01`, `amr-02` or `amr-03` identity, plus a boot ID and monotonically increasing sequence number. The MQTT topic must match the declared identity. Retained, old, duplicate and retired-boot packets cannot refresh the displayed state. TLS protects transport to the broker; broker ACLs must bind each device to its own publish topic. A JSON identity alone does not authenticate a physical robot.

The facility model defines its frame, measured extent, three loading bays, four bin destinations, junctions and directed traversable edges in metres. Dijkstra search defaults to minimum permitted aisle distance. A separate time objective minimizes predicted travel time, including the restricted speed zone. Distance ties prefer time, then link count and a deterministic node sequence; time ties prefer distance. Runtime closures remove graph links without changing the verified base graph. Every bay needs an outward and a return path. Directed traps, missing destinations, duplicate links and invalid coordinates are rejected. The current telemetry envelope supports maps up to 12 × 6.67 m; extend that contract explicitly for a larger testbed.

Confirm the origin, axis directions, metric scale and heading convention against surveyed points. The reference plan and Twin lab use +X right and +Y down. Heading 0° points along +X and +90° along +Y; positive heading and angular speed therefore appear clockwise in the plan. Transform localization into that convention before publishing. The 3D floor remains an illustrative reference warehouse; Twin lab's plan and experiment model use the source's configured graph. Changing the map invalidates asset frame confirmations and holdout approvals. Actual robot footprint, line-following track geometry, clearances and dynamic obstacles still require physical validation.

The reference visualization has twelve storage racks: four active A–D replenishment stations and eight reserve racks. Three cross aisles and four connecting lanes, with depot ingress, form a 22-node, 27-link bidirectional route graph. `warehouse_racks_and_aisle_layout.js` supplies the rack geometry, painted lanes, bin stops and default facility graph to both renderers, virtual dispatch and Twin lab. Imported physical or recorded facility graphs remain separate; importing a graph does not remodel the illustrative 3D warehouse. Reserve cartons are decorative and expose no measured inventory.

The 14.8 × 9.33 m illustrative building/apron surrounds the existing 12 × 6.67 m mapped AMR zone. Receiving and dispatch shutters, staged pallets, a parked pallet jack, packing and quality workstations, cabinets, perimeter guard rails, steel columns and overhead services provide industrial context. Equipment positions do not expand the telemetry contract, add dispatch destinations or claim observed equipment states. Real scene fixture bounds are checked against every reference lane with the same robot clearance envelope. Racks have A-01 through D-03 location addresses and three shelf-level tags. The Facility layer and Plan view allow visual context to be hidden for inspection; neither has control authority.

Virtual dispatch and paired experiments use the same metric graph solver. A pose must lie on a graph node or permitted segment within a small numerical tolerance. Mid-segment cancellation may use either endpoint on a bidirectional segment, or only the forward endpoint on a one-way segment. Disconnected or closed routes produce an explicit hold instead of a cross-rack shortcut. Reference checks use a 34-model-unit circular robot envelope with two additional units of clearance (75 units per metre), a conservative bound for the rendered AMR. All reference lanes and outbound/return routes remain inside the floor and outside declared rack footprints. This static geometry check does not validate real turning dynamics, onboard navigation or dynamic obstacle avoidance. The entire outward and return journey remains reserved for one virtual AMR at a time.

### Interactive route exploration

**Route map** renders the reference facility as an interactive indoor plan with all twelve racks, three bays and twenty-two graph nodes. It offers tap/select endpoints, pan/zoom, individual link closures, shortest-distance/fastest-time comparisons, outbound/return selection, turn directions and model-time playback. The robot marker follows permitted graph segments; timing integrates the same restricted speed zone as virtual dispatch. Travel times exclude mission queues, loading and charging. Imported physical graphs and measured localization remain in the separate source-specific Twin lab and Hardware views.

`graphRouteTrace` instruments `graphRoute` with an optional observer; it does not implement another search algorithm. Each event records the settled node set, ordered unsettled candidates, current tentative costs, predecessor links and improved neighbors. Algorithm playback reveals the final route only when the destination is settled, and reports exhausted candidates explicitly when no route exists. Normal dispatch calls avoid snapshot creation. Tests compare traced and ordinary results and check their monotonic settled costs against the independently verified solver.

The explorer owns its origin, destination, objective, speed assumption and closure set. **Use dispatch conditions** copies the current simulation configuration into that isolated preview. Editing or playing the map never updates mission reservations, approved geometry or physical commands. Leaving the view or hiding the document pauses playback. Reduced motion disables automatic animation while retaining manual search steps and travel scrubbing. Touch gestures and keyboard controls supplement the endpoint selectors. This is reference navigation and algorithm visualization; it does not establish live AMR positioning, physical obstacle avoidance or Google Maps integration.

Start/destination selectors, map pins and endpoint-editing tools refer to the selected leg. Selecting Return reverses them together with the traced search and turn directions; changing a return endpoint also updates the corresponding reversed outbound plan.

### Mission planning and execution

The mission checks run in this order: valid unit/destination and finite stock, demand and battery; the unit at its own bay; no conflicting unit/bin reservation; traversable outbound and return paths; then a minimum 15% return reserve. A destination with a valid outbound path but no return path is not dispatchable. New approval requires sufficient current battery for the selected complete journey; it does not depend on anticipated charging. A longer, faster route may be feasible when the distance policy fails the reserve check under congestion: time mode is explicit, and the planner does not silently substitute a different objective. Route optimization is exact on the configured graph within numerical precision, not over arbitrary free space or a globally coupled fleet schedule.

In distance mode, the recommended unit minimizes round-trip distance among feasible units. In time mode, it minimizes arrival time. Remaining ties use arrival/reserve and stable asset identity. Pending reviews use earliest predicted stockout (with zero demand treated as no finite stockout); approval fixes FIFO order. One unit and one active destination are reserved per open mission. Human confirmation rechecks the current state.

Reassignment assessment discards the previous owner's retained journey and computes both legs from the candidate's own bay. The existing approval remains intact until reassignment succeeds; the replacement becomes pending and requires fresh approval.

Approval stores the outward and return waypoints, graph links, objective and route-configuration signature. The operator cannot change the objective or closure set while approved missions or returns hold the aisle. An externally altered signature invalidates a queued approval. A demand/speed/battery disturbance changes forecasts and dispatch readiness, while approved route geometry is retained. Cancellation returns from the actual on-segment position. The last return releases the resource; delivery completion alone does not release it.

`queueTimeline` computes one chronological schedule shared by reviews and inventory forecasts. An already moving owner contributes its remaining outward/return time. A paused, stopped, unreachable, conflicting or impossible reservation makes later arrivals indeterminate. An approved head with a subsequent low-battery disturbance waits at its own bay until charging restores its reserve; this known delay is included in forecasts. The assumed charger supplies 0.16 percentage points/s up to 100%; motion consumes 0.06 percentage points/s and idle drain is zero. Displayed minimum return battery conservatively excludes additional charging during waits.

The running simulator consumes inventory and charges waiting units up to each arrival, return or charging threshold, then applies the event exactly once. It clamps stock at zero/capacity in chronological order, carries remaining time across phases and uses the same motion integrator for the +5 s preview. This removes frame-size drift in delivery times and capacity-limited inventory. Forecast workers coalesce newer state requests and withhold superseded responses. All control remains virtual.

`sent_at_ms` is the device acquisition time; `received_at_ms` is receiver wall time. A monotonic receiver clock also tracks freshness so a local wall-clock reversal cannot keep an old device live. Receive-minus-capture is an offset that includes clock error; it must not be presented as pure one-way network latency. Record the clock synchronization method and its uncertainty. Use correlated events recorded on one monotonic clock for override latency where possible.

## Model and synchronization cycle

For each measured packet:

1. Validate identity, boot, sequence, schema, capture age and map frame.
2. Propagate the previous state using a constant-twist planar motion model.
3. Compare the prediction with the arriving measured pose **before correction**.
4. Correct the estimated position using scalar measurement/process variance assumptions.
5. Update the short-horizon forecast and its configured uncertainty envelope.
6. Journal the observation, model revision and pre-correction error.

With speed `v`, fitted gain `g`, heading `θ`, angular speed `ω` and interval `Δt`, straight motion is `Δx = gvΔt cos θ`, `Δy = gvΔt sin θ`. For nonzero `ω`, the model integrates constant circular motion. If angular speed is absent, recent heading change estimates it. This is a local motion observer, not a dynamic wheel/torque model, SLAM implementation or collision-avoidance controller.

Prediction requires fresh pose and speed, a confirmed matching frame, a nonfaulted state, and capture age within the configured budget (2.5 s by default). Three successive position errors above the configured tolerance withhold prediction. A displacement outside the physical speed envelope quarantines the pose; a new observation anchor after a gap/reboot or an operator localization check is required. The operator's re-anchor action is recorded for replay. A local forecast leaving the configured map is also withheld.

The displayed envelope is three times the model's assumed scalar position standard deviation, grown with capture age and horizon. It is an **engineering envelope**, not an empirically calibrated confidence interval or a complete covariance model. Prediction lasts at most two seconds. Independent ground truth is needed to validate uncertainty coverage. Fitting encoder-derived poses against encoder-derived speeds can measure internal consistency while hiding common drift; use an overhead camera, surveyed markers or another independent reference to assess absolute localization accuracy.

## Calibration without using the evaluation data to fit

For each asset, construct straight moving intervals from measured pose/speed. Exclude missing measurements, turns, gaps, boot changes, frame mismatch, excessive sideways error and physically implausible displacement. At least 12 eligible intervals are required.

Fit the speed gain by least squares on the earliest 70% of intervals. Evaluate the fit on the later 30%, with holdout timestamps recorded. Application is blocked if holdout error exceeds the configured tolerance or worsens the current model beyond floating-point tolerance. The resulting model has a new revision and provenance. This is an elementary empirical calibration; use additional held-out runs, speeds and payloads before relying on it physically.

Moving battery discharge is a measured percentage-point rate, fitted only when the training intervals contain at least 15 s of discharge and 0.1 percentage points of decline. It is not a watt-hour model and assumes the reported battery percentage is already calibrated. Idle discharge remains an explicit assumption. Voltage, current, battery capacity, payload, turning losses and charging dynamics are not inferred by this implementation. All those effects require additional sensors or experiments if relevant to the project.

The fitted gain and cruise speed must also pass the same profile range and maximum-speed checks used during configuration. A good position holdout cannot enable an unapplyable physical speed model. Automatic recording replay pauses on view exit, hidden documents, page suspension and reduced motion; manual cursor seeking remains available. Replay timers and experiment failure handlers are restored together after browser page restoration.

Live, recorded and synthetic models are separate. Applying a synthetic reference fit cannot modify the live model. A recording's physical provenance is supplied by its producer; an imported file is not independently certified as authentic physical evidence.

## Paired dispatch experiments

The baseline and proposal receive an identical immutable snapshot: asset positions/batteries/model revisions, facility graph, measured or simulated stock, demand estimates and scenario parameters. FIFO is compared with earliest-stockout scheduling, or FIFO with AMR-02 unavailable. Both branches receive the same demand multiplier, restricted-zone speed, route objective, closure set and horizon. Their exported schedules include both leg distances and graph-node sequences.

One new 30-unit study request is created for each A–D bin; existing approved missions are not continued. The shared resource is reserved for the entire outward and return journey. Every dispatch evaluates return battery against the asset's reserve. No further requests, charger model or pickup dwell are generated. This branch deliberately disables charging rather than borrowing the running simulator’s recharge schedule. Simulator snapshots use its zero idle drain and current demand; the study multiplier applies on top of that demand. The chosen study speed and objective apply to both branches. Physical sources use their configured measured models. Energy consumed is bounded by available battery. Outcomes include deliveries within the horizon, unmet demand, aggregate bin stockout duration, predicted fleet discharge, distance and blocked requests. Distance calculation follows the graph segments and speed-zone boundaries; it is not a whole-trip fractional approximation.

An idle unit must be within 0.25 m of its own mapped loading bay and is modeled as docked at that node. Configured pose noise cannot enlarge this limit. All study travel follows graph links; a noisy measured pose does not create an off-network docking connector. This bounded docking assumption still requires physical validation. Switching experiment source invalidates pending replies and old result exports; restored workers retain their error/message-error handlers.

The policy may improve, match or worsen an outcome. The horizon matters: an earlier delivery can reduce an immediate shortage without changing the long-run supply deficit. Report the frozen snapshot, assumptions and all relevant outcomes rather than claiming universal optimization.

Physical experiments require confirmed geometry, matching frames, fresh measured pose/speed/battery for all three idle AMRs, four fresh inventory counts, accepted nonsynthetic motion holdouts and measured moving discharge models. Units must be at their mapped bays because the remaining hardware mission routes are not available. Consumption is estimated from at least 20 s of net observed stock decline; upward jumps are excluded. Detector jitter and unreported replenishment can bias it. Calibrate the perception pipeline against manually counted inventory before interpreting those rates. The simulator remains available for assumption-based studies.

Inventory freshness requires the configured facility frame, a connected source and both capture-clock and monotonic receive age within five seconds. Duplicate sequences and retired boots cannot refresh counts. Partial bins with distinct sequences may share one acquisition timestamp; repeated capture times retain their earliest monotonic receipt age. An older source cannot overwrite a newer per-bin observation. Consumption estimates use only the current per-bin source in the configured frame; replacing a camera requires new consumption evidence. Browser and edge validators reject nonstring inventory boot IDs and boolean protocol versions.

## Physical control contract to implement

Preserve the original central decision point. Do not add a second browser-to-motor authority:

`LabVIEW operator → Coordinator → onboard controller → execution acknowledgment → Coordinator/HMI`

The prediction service submits advisory recommendations and the state/model revision used to produce them. It never decides whether a command was executed. At approval time the Coordinator must recheck the latest state, reservation and command preconditions. Each physical command needs a unique command ID, target asset, action, authority, issue time, expiry, expected state revision and acknowledgment lifecycle.

Distinguish **requested**, **accepted**, **executed**, **rejected**, **expired** and **unacknowledged**. Publishing to MQTT or receiving a broker acknowledgment does not prove that an AMR paused. Duplicate commands must be idempotent; old commands must expire; an unacknowledged override must remain visibly unresolved. The onboard controller must define behavior for loss of communications and local stops. These contracts and their tests are pending physical integration; the downloaded ESP32 firmware still publishes telemetry only.

## Evaluation plan for the final-year project

| Question | Measurement | Required evidence |
| --- | --- | --- |
| Does state match the physical AMR? | Position/heading error, RMSE/P95, age and synchronization delay | Independent measured path; clock uncertainty; all three identities |
| Does calibration generalize? | Error before/after on later runs | Separate training and holdout recordings; fitted parameters/revision |
| Are forecasts useful? | Arrival-time MAE, stockout timing error, return-SOC error | Predictions stored before actual outcomes; same missions and conditions |
| Does prediction affect override? | Request-to-device execution latency, P50/P95/P99 and maximum | Correlated command IDs under idle, normal and heavy prediction load |
| Are commands reliable? | Executed/rejected/unacknowledged counts and response times | Device acknowledgments, not browser handler timings |
| Does the system handle faults? | Recovery time, withheld-prediction duration, duplicate handling | Delayed/lost packets, reboot, stale inventory, weak link and injected pose errors |

Set tolerances based on the physical track, robot speed and operating cycle before running evaluation. Record battery/payload, map revision, software/firmware versions, sampling rates, network conditions and clock method. Repeat runs for each AMR and at several speeds/payloads; reserve additional runs for final evaluation. Display unmeasured metrics as pending. Browser command-handler time and worker round-trip time are software diagnostics, not the physical latency claims in the project objectives.

## What is verified at this release

Executable checks cover observer causality, age/uncertainty behavior, frame/pose-jump/divergence gates, chronological holdout, battery fitting, three-asset recording/replay, strict imports, route connectivity/direction, reference rack/route clearance, mid-segment returns, alternate-link routing, rendered robot/carton bounds, reserve checks, paired experiment determinism, single-journey reservation, source isolation, existing operator workflows and the edge archive/adapter. Interactive map checks cover 288 reachable route/trace/direction/playback combinations, exhausted and directed searches, zero-distance routes, touch pan/pinch geometry, keyboard controls, reduced motion, hidden-view pause and dispatch isolation in the real DOM.

The reference captures are generated by an independent synthetic trajectory source with deliberately biased speed, dropout and jump scenarios. They demonstrate algorithm behavior; their errors and policy outcomes are not physical AMR results. Physical boards/sensors/broker commissioning, the LabVIEW control loop, separate-host deployment, independent ground truth and browser/GPU visual QA remain unverified here.

## Files and use

Open **Twin lab → Load reference run** to demonstrate state agreement. Select each asset under Calibration, fit it, inspect the chronological holdout, and apply its synthetic model. Use Paired experiment to compare policies. Export the full evidence record, including graph, profiles, original observations, source labels and observer resets.

For actual measurements, use **Hardware** and configure the four read topics. Run the downloadable edge recorder for durable SQLite capture, connect the perception inventory adapter, commission the facility/frames and collect independent test runs. The browser keeps up to 6,000 observation events in memory and exports them explicitly. Profile and graph preferences are saved locally, but session evidence is not automatically persistent.
