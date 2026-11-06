# 03. Modelling choices and justification

| Choice | What it does | Why selected now | Alternative deferred | Evidence required |
|---|---|---|---|---|
| Discrete-event simulation | Applies task, transfer and demand events in time order | Inventory changes at identifiable operations | Continuous physics or digital rendering | Compare model timestamps with physical observations |
| One robot | Makes queueing and stock transfers explicit with few interacting resources | Focus on calibration first | Three-robot fleet optimization | Independent per-robot task logs, safe interaction model |
| Weighted 2D graph | Routes from reserve to picking locations around blocked aisle nodes | Distances and restrictions can be inspected and tested | Uncalibrated 3D navigation scene | Survey physical geometry and task durations |
| FIFO baseline | Selects oldest pending task | Provides an easy-to-reproduce comparator | Learned dispatch policy | Same demand/workload across scenarios |
| Urgency heuristic | Uses estimated time-to-stockout minus task time | Tests whether state-aware information has value | Deep reinforcement learning | Held-out tests, errors and negative cases |
| Reserve, reserved, in-transit, picking | Models when stock physically moves | Prevents double counting and early stock availability | Single global stock variable | Inventory reconciliation with observed transfers |
| Transactional SQLite | Persists snapshots and event audit for a local research instance | Reproducible replay and rollback under failure | Distributed cloud database | Restart and concurrent access tests |
| Quarantined telemetry | Saves external packet without changing synthetic state | Device data is uncalibrated and cannot be assumed correct | Immediate physical-to-digital synchronization | Coordinate, clock and firmware contract verification |
| Session-local Streamlit app | Exposes the engine through a readable research interface | Makes mechanisms easier for faculty to inspect | Public multi-user warehouse controller | Security and persistence redesign before production |

## Provenance
These are **our** engineering choices, influenced by Ferrari et al. (2024)'s insistence on integrated physical/control-system modelling and experimental validation. Ferrari did not specify this graph, our quantity variables, FIFO-versus-urgency experiment or the Python web stack.
