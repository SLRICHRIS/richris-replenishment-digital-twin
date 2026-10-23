"""Deterministic discrete-event internal warehouse replenishment model.

A *digital model* only. Synthetic timings are illustrative until calibrated.
Uses explicit reserve, reserved, transit and pick-face quantities.
"""
from __future__ import annotations

import copy
import heapq
import math
from typing import Any

NODES = {
    "R": (1, 4), "A": (3, 4), "B": (5, 4), "C": (7, 4),
    "D": (1, 2), "E": (3, 2), "F": (6, 2),
    "P1": (9, 5), "P2": (9, 2), "P3": (5, 6),
}
EDGES = [
    ("R", "A", 2), ("R", "D", 3), ("A", "B", 2), ("B", "C", 2),
    ("D", "E", 2), ("E", "F", 3), ("E", "B", 3), ("F", "C", 3),
    ("C", "P1", 2), ("F", "P2", 3), ("B", "P3", 2), ("C", "P2", 4),
    ("B", "P1", 5),
]
SKUS = {
    "KIT-A": {"location": "P1", "pick": 4, "reserve": 70, "threshold": 8, "target": 18, "rate": .30},
    "KIT-B": {"location": "P2", "pick": 5, "reserve": 70, "threshold": 9, "target": 20, "rate": .43},
    "KIT-C": {"location": "P3", "pick": 3, "reserve": 70, "threshold": 7, "target": 16, "rate": .27},
}
# Externally imposed demand schedule. Both comparison policies receive the SAME schedule.
DEMAND = [
    (12, "KIT-A", 5), (14, "KIT-B", 8), (24, "KIT-C", 4),
    (30, "KIT-A", 6), (40, "KIT-B", 7), (52, "KIT-C", 6),
    (60, "KIT-A", 7), (70, "KIT-B", 8), (80, "KIT-C", 7),
    (93, "KIT-A", 6), (105, "KIT-B", 7),
]
VALID_POLICIES = {"fifo", "urgency"}
BLOCKABLE = set(NODES) - {"R", "P1", "P2", "P3"}
EPS = 1e-8


def shortest_path(start: str, end: str, blocked: list[str] | set[str] | None = None) -> tuple[list[str], float]:
    blocked_set = set(blocked or ())
    if start not in NODES or end not in NODES or start in blocked_set or end in blocked_set:
        raise ValueError("Route endpoint is invalid or blocked")
    graph: dict[str, list[tuple[str, float]]] = {k: [] for k in NODES}
    for u, v, weight in EDGES:
        if u not in blocked_set and v not in blocked_set:
            graph[u].append((v, float(weight)))
            graph[v].append((u, float(weight)))
    frontier = [(0.0, (start,), start)]
    seen: set[str] = set()
    while frontier:
        distance, path, node = heapq.heappop(frontier)
        if node == end:
            return list(path), distance
        if node in seen:
            continue
        seen.add(node)
        for nxt, weight in sorted(graph[node]):
            if nxt not in seen:
                heapq.heappush(frontier, (distance + weight, path + (nxt,), nxt))
    raise ValueError(f"No traversable path from {start} to {end}")


def _queue_event(state: dict, at: float, kind: str, **data: Any) -> None:
    state["next_event_id"] += 1
    state["queue"].append({"at": round(float(at), 3), "id": state["next_event_id"], "kind": kind, "data": data})


def _audit(state: dict, kind: str, description: str, **data: Any) -> dict:
    return {"time": round(state["time"], 3), "kind": kind, "message": description, "details": data}


def _request_replenishment(state: dict, sku: str, log: list[dict]) -> None:
    item = state["inventory"][sku]
    if item["pick"] > item["threshold"]:
        return
    if any(t["sku"] == sku and t["status"] in {"pending", "assigned", "in_transit"} for t in state["tasks"].values()):
        return
    free_stock = item["reserve"] - item["reserved"]
    needed = item["target"] - item["pick"] - item["transit"]
    qty = max(0, min(int(needed), int(free_stock)))
    if qty <= 0:
        log.append(_audit(state, "REPLENISHMENT_UNAVAILABLE", f"No unreserved stock available for {sku}", sku=sku))
        return
    state["next_task_id"] += 1
    task_id = f"T{state['next_task_id']:03d}"
    item["reserved"] += qty
    state["tasks"][task_id] = {
        "id": task_id, "sku": sku, "quantity": qty,
        "created_at": state["time"], "status": "pending", "location": item["location"],
        "assigned_at": None, "picked_at": None, "delivered_at": None,
        "route_to_reserve": [], "route_to_pick": [], "estimated_duration": None,
    }
    log.append(_audit(state, "TASK_CREATED", f"{task_id}: replenish {qty} units of {sku}", task_id=task_id, sku=sku, quantity=qty))


def _duration(state: dict, task: dict) -> tuple[float, list[str], list[str], float, float]:
    robot_to_reserve, d1 = shortest_path(state["robot"]["node"], "R", state["blocked"])
    reserve_to_pick, d2 = shortest_path("R", task["location"], state["blocked"])
    # Synthetic movement units correspond to simulated seconds. No physical timing claim.
    travel_speed = state["parameters"]["speed_units_per_second"]
    return (d1 + d2) / travel_speed + state["parameters"]["load_seconds"] + state["parameters"]["unload_seconds"], robot_to_reserve, reserve_to_pick, d1 / travel_speed, d2 / travel_speed


def _dispatch(state: dict, log: list[dict]) -> None:
    if state["robot"]["status"] != "idle":
        return
    candidates = []
    for task in state["tasks"].values():
        if task["status"] != "pending":
            continue
        try:
            duration, path_in, path_out, travel_in, travel_out = _duration(state, task)
        except ValueError:
            continue
        inv = state["inventory"][task["sku"]]
        stockout_eta = inv["pick"] / inv["rate"] if inv["rate"] else math.inf
        slack = stockout_eta - duration
        key = (task["created_at"], task["id"]) if state["policy"] == "fifo" else (slack, task["created_at"], task["id"])
        candidates.append((key, task, duration, path_in, path_out, travel_in, travel_out, slack))
    if not candidates:
        return
    _, task, duration, path_in, path_out, travel_in, travel_out, slack = min(candidates, key=lambda c: c[0])
    task["status"] = "assigned"
    task["assigned_at"] = state["time"]
    task["route_to_reserve"] = path_in
    task["route_to_pick"] = path_out
    task["estimated_duration"] = round(duration, 3)
    pickup_at = state["time"] + travel_in + state["parameters"]["load_seconds"]
    delivered_at = pickup_at + travel_out + state["parameters"]["unload_seconds"]
    state["robot"]["status"] = "busy"
    state["robot"]["task_id"] = task["id"]
    _queue_event(state, pickup_at, "pickup", task_id=task["id"])
    _queue_event(state, delivered_at, "deliver", task_id=task["id"])
    log.append(_audit(state, "DISPATCH", f"{task['id']} assigned to simulated robot", task_id=task["id"], duration_estimate=round(duration, 3), route_to_reserve=path_in, route_to_pick=path_out, slack=round(slack, 3)))


def new_state(policy: str = "fifo", blocked: list[str] | None = None, parameters: dict | None = None) -> tuple[dict, list[dict]]:
    if policy not in VALID_POLICIES:
        raise ValueError("Policy must be fifo or urgency")
    blocked = sorted(set(blocked or []))
    if any(node not in BLOCKABLE for node in blocked):
        raise ValueError(f"Only these aisle nodes may be restricted: {', '.join(sorted(BLOCKABLE))}")
    defaults = {"speed_units_per_second": 0.42, "load_seconds": 4.0, "unload_seconds": 3.0}
    if parameters:
        if set(parameters) - set(defaults):
            raise ValueError("Unrecognized simulation parameter")
        defaults.update(parameters)
    if not (0.05 <= defaults["speed_units_per_second"] <= 10 and
            0 <= defaults["load_seconds"] <= 60 and 0 <= defaults["unload_seconds"] <= 60):
        raise ValueError("Simulation movement and handling parameters outside supported range")
    state = {
        "mode": "SYNTHETIC_SIMULATION", "version": 1, "time": 0.0,
        "policy": policy, "blocked": blocked,
        "inventory": {sku: {**copy.deepcopy(values), "reserved": 0, "transit": 0, "initial_total": values["pick"] + values["reserve"]} for sku, values in SKUS.items()},
        "robot": {"id": "SIM-01", "node": "R", "status": "idle", "task_id": None},
        "tasks": {}, "queue": [], "next_event_id": 0, "next_task_id": 0,
        "parameters": defaults,
        "demand_requested": {sku: 0 for sku in SKUS},
        "demand_fulfilled": {sku: 0 for sku in SKUS},
        "stockout_started": {sku: None for sku in SKUS},
        "stockout_completed_seconds": {sku: 0.0 for sku in SKUS},
    }
    log: list[dict] = [_audit(state, "SIMULATION_INITIALIZED", "Synthetic model initialized; no physical linkage", policy=policy, blocked=blocked)]
    for at, sku, quantity in DEMAND:
        _queue_event(state, at, "demand", sku=sku, quantity=quantity)
    for sku in SKUS:
        _request_replenishment(state, sku, log)
    _dispatch(state, log)
    assert_invariants(state)
    return state, log


def step(state: dict) -> list[dict]:
    """Process exactly one time-stamped scheduled event and dispatch next task if idle."""
    if not state["queue"]:
        return []
    upcoming = min(state["queue"], key=lambda e: (e["at"], e["id"]))
    state["queue"].remove(upcoming)
    state["time"] = upcoming["at"]
    event = upcoming["data"]
    log: list[dict] = []
    if upcoming["kind"] == "demand":
        sku, qty = event["sku"], int(event["quantity"])
        item = state["inventory"][sku]
        fulfilled = min(qty, item["pick"])
        item["pick"] -= fulfilled
        state["demand_requested"][sku] += qty
        state["demand_fulfilled"][sku] += fulfilled
        if item["pick"] == 0 and state["stockout_started"][sku] is None:
            state["stockout_started"][sku] = state["time"]
        log.append(_audit(state, "DEMAND", f"{sku}: fulfilled {fulfilled} of {qty} demanded", sku=sku, requested=qty, fulfilled=fulfilled, unmet=qty-fulfilled))
        _request_replenishment(state, sku, log)
    elif upcoming["kind"] == "pickup":
        task = state["tasks"][event["task_id"]]
        inv = state["inventory"][task["sku"]]
        qty = task["quantity"]
        assert task["status"] == "assigned" and inv["reserve"] >= qty and inv["reserved"] >= qty
        inv["reserve"] -= qty
        inv["reserved"] -= qty
        inv["transit"] += qty
        task["status"] = "in_transit"
        task["picked_at"] = state["time"]
        state["robot"]["node"] = "R"
        log.append(_audit(state, "PICKUP", f"{task['id']}: {qty} units moved into transit", task_id=task["id"], quantity=qty))
    elif upcoming["kind"] == "deliver":
        task = state["tasks"][event["task_id"]]
        inv = state["inventory"][task["sku"]]
        qty = task["quantity"]
        assert task["status"] == "in_transit" and inv["transit"] >= qty
        inv["transit"] -= qty
        inv["pick"] += qty
        task["status"] = "completed"
        task["delivered_at"] = state["time"]
        robot = state["robot"]
        robot["node"] = task["location"]
        robot["status"] = "idle"
        robot["task_id"] = None
        if inv["pick"] > 0 and state["stockout_started"][task["sku"]] is not None:
            state["stockout_completed_seconds"][task["sku"]] += state["time"] - state["stockout_started"][task["sku"]]
            state["stockout_started"][task["sku"]] = None
        log.append(_audit(state, "DELIVERY", f"{task['id']}: {qty} units arrived at {task['location']}", task_id=task["id"], quantity=qty, location=task["location"]))
        _request_replenishment(state, task["sku"], log)
    else:
        raise ValueError(f"Unknown scheduled event: {upcoming['kind']}")
    _dispatch(state, log)
    assert_invariants(state)
    return log


def run_until(state: dict, until: float = 120.0, max_steps: int = 250) -> list[dict]:
    if not 0 <= until <= 1440 or until + EPS < state["time"]:
        raise ValueError("until must be between current simulation time and 1440")
    if not 1 <= max_steps <= 5000:
        raise ValueError("max_steps out of range")
    logs: list[dict] = []
    count = 0
    while state["queue"] and min(e["at"] for e in state["queue"]) <= until + EPS and count < max_steps:
        logs.extend(step(state))
        count += 1
    state["time"] = max(state["time"], float(until))
    assert_invariants(state)
    return logs


def set_block(state: dict, node: str, blocked: bool) -> list[dict]:
    if node not in BLOCKABLE:
        raise ValueError("Only intermediate aisle nodes may be restricted")
    if state["robot"]["status"] != "idle":
        raise ValueError("Changing a route during an in-flight task is not supported. Wait until idle or reset.")
    was = set(state["blocked"])
    if blocked:
        was.add(node)
    else:
        was.discard(node)
    if state["robot"]["node"] in was:
        raise ValueError("Cannot block the robot's current position")
    state["blocked"] = sorted(was)
    logs = [_audit(state, "RESTRICTION", f"Aisle {node} {'blocked' if blocked else 'reopened'}", node=node, blocked=blocked)]
    _dispatch(state, logs)
    assert_invariants(state)
    return logs


def metrics(state: dict) -> dict:
    requested = sum(state["demand_requested"].values())
    fulfilled = sum(state["demand_fulfilled"].values())
    completed = [task for task in state["tasks"].values() if task["status"] == "completed"]
    durations = [task["delivered_at"] - task["assigned_at"] for task in completed]
    durations = [round(x, 3) for x in durations]
    durations_by_sku = {sku: round(state["stockout_completed_seconds"][sku] + (state["time"] - state["stockout_started"][sku] if state["stockout_started"][sku] is not None else 0), 3) for sku in SKUS}
    return {
        "time": round(state["time"], 3), "requested": requested, "fulfilled": fulfilled,
        "unmet": requested - fulfilled,
        "fill_rate_pct": round(100 * fulfilled / requested, 2) if requested else None,
        "tasks_completed": len(completed), "tasks_pending": sum(t["status"] == "pending" for t in state["tasks"].values()),
        "mean_task_duration_seconds": round(sum(durations) / len(durations), 3) if durations else None,
        "stockout_seconds_by_sku": durations_by_sku,
        "stockout_seconds_total": round(sum(durations_by_sku.values()), 3),
    }


def conservation(state: dict) -> list[dict]:
    checks = []
    for sku, inv in state["inventory"].items():
        observed = inv["reserve"] + inv["pick"] + inv["transit"]
        expected = inv["initial_total"] - state["demand_fulfilled"][sku]
        checks.append({"sku": sku, "expected": expected, "observed": observed, "difference": observed-expected, "valid": observed == expected})
    return checks


def assert_invariants(state: dict) -> None:
    for inv in state["inventory"].values():
        for key in ("pick", "reserve", "reserved", "transit"):
            if not isinstance(inv[key], int) or inv[key] < 0:
                raise AssertionError(f"Invalid quantity {key}")
        if inv["reserved"] > inv["reserve"]:
            raise AssertionError("Reservations exceed reserve on hand")
    if not all(c["valid"] for c in conservation(state)):
        raise AssertionError("Physical inventory conservation violated")
    for event in state["queue"]:
        if event["at"] + EPS < state["time"]:
            raise AssertionError("Scheduled event is earlier than simulation clock")


def comparison(blocked: list[str] | None = None, until: float = 120.0, parameters: dict | None = None) -> dict:
    policies = {}
    for name in ("fifo", "urgency"):
        state, logs = new_state(policy=name, blocked=blocked, parameters=parameters)
        logs.extend(run_until(state, until))
        policies[name] = {"metrics": metrics(state), "task_summary": [copy.deepcopy(t) for t in state["tasks"].values()], "conservation": conservation(state), "event_count": len(logs)}
    return {"mode": "SYNTHETIC_UNCALIBRATED", "matched_inputs": True, "blocked": sorted(set(blocked or [])), "until": until, "policies": policies,
            "warning": "Both policies use the same synthetic warehouse and demand schedule. Results are not physical validation."}
