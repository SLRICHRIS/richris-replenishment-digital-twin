# Guided walkthrough: one replenishment, with real state transitions

This is the shortest path to understanding the research model. Follow it in the **1 Follow one replenishment** tab before interpreting policy comparison metrics.

## What warehouse process do we model?

A *picking shelf* supplies customer demand. A separate *reserve shelf* holds additional units. When picking stock falls below its threshold, a **WMS-like** function creates a replenishment task and reserves units in reserve. A **WCS-like** function assigns the task to one virtual transport resource, selects an available graph route, and schedules pickup and delivery. The discrete-event engine changes physical quantities only when a real state-transition event is processed.

The WMS and WCS modules are intentionally simplified research functions. They are not a connection to production warehouse software or controllers.

## Walk through task T001, default configuration

The default, entirely synthetic inputs for KIT-A are:

| Input | Value | Meaning |
|---|---:|---|
| Initial picking stock | 4 units | Available for customer demand |
| Reserve stock | 70 units | Physically in reserve at start |
| Reorder threshold | 8 units | 4 is at or below threshold; create task |
| Target picking stock | 18 units | Replenish toward this quantity |
| Task T001 | 14 units | 18 target minus 4 existing |
| Travel speed | 0.42 graph units/s | Assumption, not a measured robot speed |
| Load / unload time | 4 / 3 s | Assumed handling delays |
| Route | R, A, B, C, P1 | Shortest unblocked reserve-to-pick route |
| Route weight | 8 graph units | Summed synthetic graph weights |

1. **At t = 0**, the WMS-like logic creates T001 for 14 units and reserves them. KIT-A reserve physically remains **70**, reserved becomes **14** and picking remains **4**. The WCS-like dispatch function assigns T001. The assigned-to-delivered time estimate is `0/0.42 + 4 + 8/0.42 + 3 = 26.048 s` (rounded). The robot starts at reserve R, so the first travel distance is zero.
2. **At t = 4 s**, the pickup event occurs after loading. KIT-A reserve changes **70 → 56**, reserved **14 → 0**, in-transit **0 → 14**, picking stays **4**. No new stock was created: only its physical location changed.
3. **At t = 12 s**, demand asks for **5 KIT-A units** but only **4** are on the picking shelf. The model serves 4 and records 1 as **unmet**; picking changes **4 → 0**. The remaining unit is **not backordered** in this model.
4. **At t = 26.048 s**, T001 reaches picking node P1 after simulated travel and unloading. In-transit changes **14 → 0**, picking changes **0 → 14**, and task T001 is completed. The robot becomes available for another task.

Other SKUs receive demand events between steps 3 and 4, so reaching the T001 delivery requires more than four clicks through the global chronological event queue.

## What to look at on screen

- **What happens next?** Shows the next event before it is processed, including its expected purpose.
- **Process the next event.** Executes one event in the shared Python simulation engine; the screen is then refreshed.
- **Inspect a processed step.** Shows the actual event log and **Before → After** physical stock changes, not a made-up animation.
- **Where is the stock now?** Physical reserve, physical picking, and physical in-transit quantities. The `reserved` column is a subset of reserve, not a new stock bucket.
- **All tasks and full event log.** Exact timestamps, actions and task states for audit and CSV export.

## Why two user interfaces exist

The **Streamlit interface** is an isolated research session designed for explanations and policy comparisons. It has no direct MQTT, robot-control or durable SQLite service. The **FastAPI + SQLite system** runs locally with a persistent state/event ledger and separate ingestion of unverified telemetry. Both call the same `warehouse_twin.simulation` package.

## What is and is not evidence

Passing stock-conservation tests supports **software correctness under synthetic assumptions**. Running FIFO and urgency under matched inputs provides a **controlled simulated comparison**, not a causal operational field result. Real-world fidelity requires measured geometry, observed handling and travel times, an explicit calibration/training set, and independent held-out physical test observations. No part of the Streamlit display establishes bidirectional hardware synchronization.

## Primary methodological source

Ferrari, A., Carlin, A., Rafele, C., and Zenezini, G. (2024). *A method for developing and validating simulation models for automated storage and retrieval system digital twins.* *The International Journal of Advanced Manufacturing Technology*, 131, 5369–5382. https://doi.org/10.1007/s00170-023-12660-y.

The synthetic graph, timings, policy choices, Python code and inventory data in this project are **our independent implementation**. Ferrari's original apparatus, measurements, simulation and source figures were not copied or reproduced.
