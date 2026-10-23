# 04. Validation protocol before claiming a Digital Twin

## A. What is currently established
Software-level checks pass for synthetic scenarios. Conservation invariants and state transition correctness can be evaluated without a physical robot. This does **not** establish real-world accuracy.

## B. Independent observed data required
Collect for each real or instrumented prototype transfer:
`task_id`, `sku`, `quantity`, `source_location`, `destination_location`, `dispatch_time`, `pickup_time`, `delivery_time`, `measured_route`, equipment identifier, waiting time, and an independent timing reference. Maintain clock synchronization and describe instrument accuracy.

## C. Calibrate without leakage
1. Record a declared calibration set covering different route lengths, load sizes and restrictions.
2. Fit the travel-speed assumption and load/unload delays. Record parameter values and uncertainty.
3. Freeze parameters before testing.
4. Evaluate against previously unseen tasks. Do not tune on held-out samples.

## D. Metrics, with full units

- Mean absolute error (MAE), seconds: `mean(abs(simulated_duration - observed_duration))`.
- Root mean squared error (RMSE), seconds: `sqrt(mean((simulated_duration - observed_duration)^2))`.
- Signed bias, seconds: `mean(simulated_duration - observed_duration)`.
- Event order correctness and missing/duplicate-event rate.
- SKU-location stock agreement with observed counts.
- Telemetry lag after time synchronization, milliseconds.

The API accepts manually entered observed durations and calculates errors, but cannot authenticate those observations.

## E. Controlled experimental design
Select levels of replenishment quantity, route availability, workload and physical resource status. Repeat physical trials. For policy comparison use matched demand schedules and initial conditions, and report the entire outcome distribution, including cases where urgency does not improve performance.

## F. Digital Twin claim gate
Only claim a physically synchronized Digital Twin after physical telemetry ingestion, state reconciliation, validated mapping, measured fidelity, reliable updates and (if applicable) reviewed feedback/control logic have been demonstrated. Never equate a Streamlit dashboard with physical synchronization.
