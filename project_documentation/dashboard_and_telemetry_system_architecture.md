# System architecture

`streamlit_app.py` starts the Python host, which serves the browser component with a stable identity. Browser modules own the reference warehouse, virtual dispatch, shortest-path map and twin models. Independent Python processes archive MQTT observations and handle operator overrides.

| Path | Owner and processing | Output |
| --- | --- | --- |
| Virtual dispatch | Browser mission planner; Dijkstra; node/segment/corridor time windows | Concurrent approved journeys, deliveries and bay returns |
| Measurements | ESP32 controller UART → MQTT → strict JS/Python validators | Boot/sequence-bound measured values; null stays unknown |
| Twin | Scalar position observer, chronological holdout, separate prediction worker | Estimates, forecasts and recorded prediction residuals |
| Historian | Independent Python MQTT recorder | Accepted observations and rejection reasons in SQLite |
| Physical override | LabVIEW adapter/local HTTP → separate Coordinator → MQTT → ESP32 UART → onboard controller | Correlated accepted/executed/rejected ACKs and monotonic timing |

Prediction has no control token or actuator functions. The hardware viewer stays read-only. Physical motor execution belongs to the onboard controller; [commissioning](operator_override_channel_and_hardware_commissioning.md) defines the actual interface.

## Reference geometry and routing

Twelve racks include four monitored A–D destinations and eight decorative reserves. The graph has 22 nodes and 27 bidirectional links. Dijkstra finds shortest permitted distance by default; time mode includes the restricted speed zone. Ties prefer the other objective, fewer links and a stable node sequence. The ordered candidate array is intentional for this small graph; it is not a large-scale routing implementation.

## Mission lifecycle

1. Review the unit, own bay, both route legs, planned start/arrival and at least 15% modeled return battery.
2. Human approval rechecks stock, unit/bin exclusivity, route signature and current battery.
3. Reserve each shared node, bidirectional segment and corridor within the 72-unit reference clearance. Delay departure for conflicts and bay charging; independent journeys overlap.
4. Freeze departure speed/route geometry for that journey so its motion stays consistent with its reservation times.
5. Integrate stock, charging and all moving robots to exact dispatch/arrival/return events. Each delivery occurs once.
6. Return to the same bay, then release the windows. Cancellation suppresses delivery and completes the reserved path; an unplanned reversal could conflict with another robot.

A paused or stopped moving robot freezes the traffic clock for the fleet, retaining spatial separation. Stock consumption continues. This is a conservative fault recovery policy. The runtime does not yet replan around an indefinitely parked obstacle. Route objectives and closures remain locked while approved or moving journeys exist.

Forecasts use the same scheduler and traffic clock. Paired policies use the same window planner and frozen inputs; their separate no-charger study assumption remains explicit. This is deterministic reference traffic scheduling, not physical collision avoidance or globally optimal fleet allocation.

See [model and validation contracts](digital_twin_architecture_and_validation_plan.md), [current checks](software_verification_results/current_software_check_results.md) and [module flow](repository_structure_and_project_flow.md).
