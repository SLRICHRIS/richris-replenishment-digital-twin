# 01. System architecture

## Objective
Reproduce one internal replenishment task in a synthetic warehouse, track stock movement and task duration, and provide an inspectable basis for later physical validation.

## Physical interpretation of software responsibilities
- **WMS, Warehouse Management System:** decides that picking stock is below its reorder threshold, generates a request, and reserves reserve stock. In this model the WMS-like part is `_request_replenishment` in `warehouse_twin/simulation.py`.
- **WCS, Warehouse Control System:** dispatches a scheduled resource to a task, checks route feasibility and schedules the associated pickup and delivery events. In this model the WCS-like part is `_dispatch` and `_duration` in the same module.
- **Discrete-event engine:** chooses the next event by timestamp, then changes stock and resource state. Functions `step` and `run_until` handle this.
- **Persistent boundary:** `warehouse_twin/database.py` atomically stores the latest active state and appends timestamped audit events. `warehouse_twin/api.py` exposes these actions via local HTTP and WebSocket.
- **Streamlit boundary:** `streamlit_app.py` imports the *same* simulation engine, but stores model state per browser session. It does not use shared SQLite, call the external MQTT broker, or control hardware.

## One request as an operational event trace

```text
Low pick-face quantity
  -> TASK_CREATED (logical reservation; reserve is unchanged)
  -> DISPATCH (task selected; route and estimated arrival time recorded)
  -> PICKUP (reserve decreases; in-transit increases)
  -> DELIVERY (in-transit decreases; pick-face increases)
  -> DEMAND (pick-face decreases up to available stock; unmet units reported)
```

Depending on event timestamps, demand may occur before or during a replenishment mission. That is why the simulation records the exact order.

## What cannot be inferred from this model
An attractive map or a plausible simulated robot path does not demonstrate physically calibrated travel time. Real data from an independently observed replenishment task is required. The API's telemetry table is not used to infer robot motion automatically.
