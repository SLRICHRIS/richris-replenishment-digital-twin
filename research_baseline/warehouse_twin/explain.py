"""Pure presentation helpers for reading the warehouse model's event history.

Nothing in this module advances time or changes the simulation. A view is derived
from the authoritative state maintained by warehouse_twin.simulation.
"""
from __future__ import annotations

from typing import Any


FIELDS = ("reserve", "reserved", "transit", "pick")
FIELD_LABELS = {
    "reserve": "Reserve shelf",
    "reserved": "Reserved within reserve",
    "transit": "On the robot",
    "pick": "Picking shelf",
}


def next_event(state: dict) -> dict | None:
    """The next scheduled event, including those tied by timestamp."""
    if not state.get("queue"):
        return None
    event = min(state["queue"], key=lambda e: (e["at"], e["id"]))
    kind = event["kind"]
    info = event.get("data", {})
    if kind == "pickup":
        task = state["tasks"][info["task_id"]]
        detail = f"The robot picks up {task['quantity']} units of {task['sku']} for {task['id']}."
        reason = "The goods leave the reserve shelf and enter the in-transit inventory. Picking stock does not increase yet."
    elif kind == "deliver":
        task = state["tasks"][info["task_id"]]
        detail = f"The robot delivers {task['quantity']} units of {task['sku']} to {task['location']}."
        reason = "Goods leave in-transit inventory and become available at the picking shelf. The robot can then receive a new task."
    elif kind == "demand":
        detail = f"A demand event requests {info['quantity']} units of {info['sku']}."
        reason = "The model fulfills only the quantity currently available at the picking shelf. Any shortage in this example is counted as unmet demand, not backordered."
    else:
        detail = f"Process the scheduled {kind} event."
        reason = "Inspect the resulting state and event log for the actual effect."
    return {"at": float(event["at"]), "kind": kind, "detail": detail, "why": reason}


def inventory_differences(before: dict, after: dict) -> list[dict[str, Any]]:
    """Return one row per field changed. Reserved is a subset of reserve."""
    rows: list[dict[str, Any]] = []
    for sku in sorted(after["inventory"]):
        for field in FIELDS:
            old, new = before["inventory"][sku][field], after["inventory"][sku][field]
            if old != new:
                rows.append({
                    "Product": sku,
                    "Quantity": FIELD_LABELS[field],
                    "Before": old,
                    "After": new,
                    "Change": f"{new-old:+d}",
                })
    return rows


def interpret_event_logs(logs: list[dict]) -> list[dict[str, str]]:
    labels = {
        "SIMULATION_INITIALIZED": "Synthetic warehouse initialized",
        "TASK_CREATED": "WMS-like task created and stock reserved",
        "DISPATCH": "WCS-like robot task assigned",
        "PICKUP": "Goods loaded onto simulated robot",
        "DELIVERY": "Goods available at picking shelf",
        "DEMAND": "Picking order arrives",
        "REPLENISHMENT_UNAVAILABLE": "Reserve stock insufficient",
        "RESTRICTION": "Route restriction changed",
    }
    return [{"Time (s)": f"{float(log['time']):.3f}",
             "Action": labels.get(log["kind"], log["kind"]),
             "Recorded outcome": log["message"]} for log in logs]


def current_task(state: dict) -> dict | None:
    task_id = state["robot"].get("task_id")
    return state["tasks"].get(task_id) if task_id else None


def stock_explanation(kind: str) -> str:
    return {
        "pickup": "Reserve stock decreases; the same units become in-transit stock.",
        "deliver": "In-transit stock decreases; the same units become picking stock.",
        "demand": "Picking stock decreases by the fulfilled quantity; unmet units are counted as a shortage.",
    }.get(kind, "See the change table for the exact inventory effects.")
