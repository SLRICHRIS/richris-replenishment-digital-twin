# 02. Inventory and event contract

## Quantities per SKU

| Name | Meaning | Counted in conservation? |
|---|---|---|
| `reserve` | Physical units stored at reserve | Yes |
| `reserved` | Part of `reserve` committed to existing tasks | No additional count |
| `pick` | Units physically present at the pick-face | Yes |
| `transit` | Units already collected but not delivered | Yes |
| `initial_total` | Reserve plus picking units at experiment start | Reference only |

The accounting identity checked after each event is:

`initial_total - fulfilled_demand = reserve + pick + transit`

A TASK_CREATED event reserves goods but **does not** subtract reserve. The PICKUP event subtracts reserve and reserved, adds transit, and changes task status. DELIVERY moves the same quantity from transit to pick. Thus a task creation never fabricates available picking inventory.

## Task lifecycle

`pending` -> `assigned` -> `in_transit` -> `completed`.

The model uses a single synthetic robot with statuses `idle` and `busy`. A route blockage can be applied only while the robot is idle. There is no mid-mission dynamic replanning.

## Event record

`{time, kind, message, details}` is produced by the simulation engine. In the persistent server, events are written with per-run `seq` numbers and timestamps. Time is simulated elapsed seconds. `recorded_at` is a database insertion timestamp and is **not** proof of an observed physical event.

## Outside demand

The demand schedule is exogenous and predetermined for experiments. Two compared policies receive **the same** demand events. The urgency policy uses assumed current demand rates rather than looking up future timestamps. This avoids giving the proposed policy information unavailable to an actual dispatcher.
