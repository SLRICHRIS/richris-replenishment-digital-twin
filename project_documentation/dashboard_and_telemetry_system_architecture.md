# System Architecture

## Runtime and data flow

`streamlit_app.py` calls `backend_streamlit_and_telemetry/streamlit_dashboard_host.py`, which registers one local component from `frontend_warehouse_dashboard/`. Its stable key preserves the workspace during ordinary Python reruns. Browser modules own simulation state, visualization, route search, MQTT reception and experiment workers. The host bridge sends only readiness and viewport height to Streamlit; it does not return robot telemetry or credentials.

| Input | Processing | Output |
| --- | --- | --- |
| Virtual fleet and four bins | Approved journey reservations, motion and charging-aware forecasts | Simulated positions, stock and battery |
| ESP32 MQTT over secure WebSockets | Fixed three-slot identity, schema, sequence, capture-age and monotonic-age validation | Fresh measured device fields; unknown values stay unknown |
| Optional inventory topic | Source, map frame, capture age, sequence and per-bin freshness gates | Measured A–D counts and eligible demand evidence |
| Measurements and recordings | Observer residual gates, chronological calibration and deterministic replay | Measured, estimated and predicted state with provenance |
| Frozen experiment snapshot | Isolated paired worker using identical graph, conditions and demand settings | Scenario-specific policy outcomes; no dispatch authority |
| Route-map endpoints and closures | The same production Dijkstra solver and actual search trace | Shortest-distance or fastest-time preview with both journey legs |

## Shared reference geometry

Twelve racks surround three cross aisles and four connecting lanes. Four racks have monitored A–D bins; eight are reserve decoration. The route graph contains 22 nodes and 27 bidirectional links. The interactive map, simulator and Twin lab reference facility use this geometry.

Dijkstra defaults to shortest permitted aisle distance. Fastest-time mode accounts for the configured speed zone. Equal distances prefer lower time, then fewer links and a deterministic node sequence. These are per-journey results, not a globally optimal fleet schedule.

## Virtual mission lifecycle

1. Review the assigned unit, bin, outward route, return route, queue wait and minimum return battery.
2. Recheck availability, source data, graph reachability, own bay and the full-trip 15% modeled reserve on approval.
3. Keep approved geometry and FIFO approval order while one complete journey reserves the shared aisle.
4. Advance movement and charging to exact event boundaries; deliver up to 30 units within bin capacity.
5. Return to the assigned unit's own bay before releasing the reservation.
6. Require fresh approval after reassignment. Pausing or stopping retains the reservation.

Route settings remain locked while approved reservations or moving journeys exist. Route map and paired comparisons are separate previews and cannot alter approved missions.

## Authority and evidence

Hardware is read-only. The observer can withhold prediction for missing, stale, inconsistent-frame or divergent data. Calibration uses a chronological training/holdout split; synthetic recordings remain explicitly labeled. The optional edge historian stores observations in SQLite and supplies a LabVIEW inventory adapter.

The graph-only paired study starts eligible units at their own bays and assumes no charger or pickup dwell. The operating simulator has its own charging-aware queue model. Physical AMRs, the Coordinator, calibrated ground truth and the LabVIEW command/acknowledgment channel need separate commissioning.

See the [application source map](../frontend_warehouse_dashboard/frontend_dashboard_source_file_guide.md), [detailed architecture](digital_twin_architecture_and_validation_plan.md) and [final feature audit](digital_twin_feature_alignment_audit.md).

