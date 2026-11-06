# Predictive replenishment twin: contracts and validation

Owner: **S L RICHRIS**. © 2026 S L RICHRIS. Educational project.

The contribution to demonstrate is synchronized measured state, useful prediction and operator override independence from prediction load. [System architecture](dashboard_and_telemetry_system_architecture.md) owns runtime/mission behavior; [hardware commissioning](operator_override_channel_and_hardware_commissioning.md) owns command and sensor integration.

## Observation contract

Fixed assets are `amr-01`. The topic must match `device_id`. Each packet requires version 1, a hexadecimal boot ID, increasing safe-integer sequence, acquisition `sent_at_ms`, `uptime_ms`, recognized state and the **`firmware`** key. Field/folder names are independent. Battery, speed and pose must be measured values in range or null; zero is a valid measurement.

The browser and Python reject malformed identity, invalid numbers, old/future capture times, duplicate sequences and retired boots. Retained observations cannot refresh state. The native serializer contract test compiles the exact header called by the `.ino` and passes its emitted bytes into both production validators. ZIPs are built from canonical sources.

Inventory packets require a source, frame, boot, sequence, acquisition time and one to four unique A–D integer counts (0–100). A source/frame change restarts demand evidence. Capture age and receiver monotonic age both gate freshness; wall-clock reversal cannot revive stale measurements. Browser memory records up to 6,000 events, while the optional SQLite service supplies durable sessions/export.

The mapped reference zone is 12 × 6.6667 m. +X points right and +Y down; heading 0° points +X and +90° +Y. Transform measured localization before publishing and confirm surveyed origin, scale, headings and asset frames. The illustrative building/apron is larger than the mapped robot zone; decoration adds no measured inventory or destinations.

## Position observer and prediction

The observer uses a constant-twist planar propagation model and a **scalar-variance Kalman-style position correction**. It is not a full covariance EKF. Heading is taken from measurements and is not filtered.

For straight motion, displacement is `gain × speed × interval` along measured heading. Nonzero angular speed integrates circular motion; absent angular speed is estimated from recent heading change. Each incoming pose is compared with the previous prediction before correction, preserving causal error measurement. Measurement/process variance are configured assumptions.

Prediction requires fresh pose/speed, confirmed matching frame, a nonfaulted state and the default 2.5 s age budget. Three successive excessive residuals, impossible displacement, frame mismatch or a forecast outside map bounds withhold prediction. A gap/reboot creates a new anchor; operator re-anchoring is journaled for replay.

Forecast horizon is at most two seconds. The displayed three-sigma scalar engineering envelope grows with age; coverage has not been validated empirically. It is not a complete confidence interval, SLAM system, wheel/torque model or obstacle controller.

## Calibration

Use at least 12 eligible straight moving intervals. Reject missing measurements, turns, gaps, boot/frame changes, sideways error and physically impossible displacement. Fit speed gain on the earliest 70%; evaluate on the later 30%. Record the holdout timestamps and model revision. Applying a fit requires acceptable holdout error and valid configured speed limits.

Battery discharge fits only when training includes at least 15 s moving and 0.1 percentage points decline. It assumes already calibrated battery percentage; it does not infer voltage/current, watt-hours, payload or charging physics. Encoder speed and encoder pose share error, so validate absolute pose using independent surveyed/camera ground truth.

Synthetic reference fits stay separate from live profiles. A recording's physical label is its producer's assertion. Final evaluation requires additional independent later runs, varied speeds/payloads and all AMR-01.

## Frozen policy study

FIFO and earliest-stockout/maintenance policies receive identical immutable stock, demand, battery, models, map, objective, closures, speed and horizon. Four new 30-unit A–D requests are scheduled; existing runtime missions are not continued. Both branches use the production node/segment/corridor window planner and same reference footprint. A robot's journeys cannot overlap; removed-identity rejection may. The study allocates by earliest reserved arrival, then distance/reserve; route search still uses the selected distance/time objective.

The study assumes no charger or pickup dwell, unlike the running simulator's bay charging. It applies the selected demand multiplier on top of the source demand. Metrics integrate chronological arrivals, capacity clamping, actual traveled segments and concurrent battery discharge. Exported records include windows and both route legs. Policy improvement is reported only when the computed outcomes show it; it is not guaranteed.

## Thesis evaluation

| Question | Metric | Required physical evidence |
| --- | --- | --- |
| Does state match the AMR? | Position/heading RMSE, P95, capture age | Independent ground truth, all identities and clock uncertainty |
| Does calibration generalize? | Earlier fit vs later-run error | Separate training/holdout runs and model revisions |
| Are forecasts useful? | Arrival, stockout and return-SOC errors | Predictions stored before outcomes for matched missions |
| Does prediction affect overrides? | Request-to-execution-ACK P50/P95/P99/max | Command IDs under idle/normal/heavy loads on separate hosts |
| Are commands reliable? | Executed/rejected/timed-out counts | Actual onboard execution ACKs; no broker-only substitutes |
| Does recovery work? | Recovery time and withheld-prediction duration | Loss/delay/reboot, stale stock, stop/pause and localization faults |

Set tolerances before trials. Record map/model/software versions, speed, payload, battery, sampling, network and clock method. Software loopback timing is available now; motor execution, physical accuracy and native LabVIEW VI evidence remain pending. [Current results](software_verification_results/current_software_check_results.md) records the software scope.
