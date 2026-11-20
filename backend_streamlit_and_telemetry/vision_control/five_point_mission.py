"""Five-point paper-warehouse mission decisions for the existing camera route planner.

Rack coordinates are configured in millimetres in the camera's floor frame.
This module proposes decisions; it never publishes a motor command or bypasses
the existing signed ESP32 command path.
"""
from dataclasses import dataclass, field
from math import isfinite
from .contracts import WIDTH, HEIGHT, plan, ready

RACKS = ("A", "B", "C", "D")
BATTERY_POINT = "E"


def validate_stations(stations):
    if set(stations) != set(RACKS + (BATTERY_POINT,)):
        raise ValueError("Configure exactly A, B, C, D and battery station E")
    normalized = {}
    for name, point in stations.items():
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError("Station coordinates must be [x_mm, y_mm]")
        x, y = point
        if any(type(v) not in (int, float) or not isfinite(v) for v in (x, y)):
            raise ValueError("Station coordinates must be finite")
        if not (0 <= x <= WIDTH and 0 <= y <= HEIGHT):
            raise ValueError("Station is outside the calibrated paper")
        normalized[name] = [float(x), float(y)]
    if len({tuple(v) for v in normalized.values()}) != 5:
        raise ValueError("Stations must not overlap")
    return normalized


@dataclass
class FivePointMission:
    stations: dict
    start: str
    destination: str
    reserve_fraction: float = 0.2
    status: str = "waiting_for_start"
    active_target: str = ""
    pending: dict | None = None
    events: list = field(default_factory=list)

    def __post_init__(self):
        self.stations = validate_stations(self.stations)
        if self.start not in RACKS or self.destination not in RACKS or self.start == self.destination:
            raise ValueError("Select two different racks A, B, C or D")
        if not (0 < self.reserve_fraction < 1):
            raise ValueError("Reserve fraction must be between zero and one")
        self.active_target = self.destination

    def begin(self, scene, now_ms):
        if self.status != "waiting_for_start":
            raise ValueError("Mission already started")
        if not ready(scene, now_ms):
            raise ValueError("Fresh camera and ESP32 telemetry required")
        # The start rack is a declared starting area, not a teleport command.
        self.status = "navigating"
        route = plan(scene, self.stations[self.destination])
        self.events.append(("started", self.start, self.destination))
        return route

    def obstacle_changed(self, scene, now_ms):
        """Stop motors via the caller before presenting this alternative route."""
        if self.status != "navigating":
            return None
        self.status = "awaiting_obstacle_decision"
        try:
            candidate = plan(scene, self.stations[self.active_target]) if ready(scene, now_ms) else None
        except ValueError:
            candidate = None
        self.pending = dict(kind="obstacle", route=candidate, target=self.active_target)
        self.events.append(("obstacle_detected", self.active_target))
        return self.pending

    def battery_warning(self, scene, now_ms, predicted_remaining_fraction, required_fraction):
        """Forecast is advisory; hardware critical-voltage cutoff stays independent."""
        if self.status != "navigating":
            return None
        for value in (predicted_remaining_fraction, required_fraction):
            if type(value) not in (int, float) or not isfinite(value) or not 0 <= value <= 1:
                raise ValueError("Battery forecast fractions must be within [0,1]")
        if predicted_remaining_fraction - required_fraction >= self.reserve_fraction:
            return None
        self.status = "awaiting_battery_decision"
        try:
            diversion = plan(scene, self.stations[BATTERY_POINT]) if ready(scene, now_ms) else None
        except ValueError:
            diversion = None
        self.pending = dict(kind="battery", route=diversion, target=BATTERY_POINT,
                            predicted_remaining_fraction=predicted_remaining_fraction,
                            required_fraction=required_fraction)
        self.events.append(("battery_warning", self.destination))
        return self.pending

    def decide(self, approved, scene, now_ms):
        """Caller must validate a fresh scene and re-arm the physical controller."""
        if not isinstance(approved, bool) or not self.pending:
            raise ValueError("A pending decision and explicit approval are required")
        item = self.pending
        if not ready(scene, now_ms):
            raise ValueError("Cannot resume without fresh safe hardware evidence")
        if item["kind"] == "obstacle" and not approved:
            self.status = "paused"
            self.pending = None
            self.events.append(("obstacle_rejected", item["target"]))
            return None
        target = item["target"] if approved else self.destination
        route = plan(scene, self.stations[target])
        self.active_target = target
        self.pending = None
        self.status = "navigating"
        self.events.append((item["kind"] + ("_approved" if approved else "_rejected"), target))
        return route

    def arrived(self, camera_verified, motors_stopped):
        if self.status != "navigating" or not camera_verified or not motors_stopped:
            return False
        self.status = "completed"
        self.events.append(("arrived", self.active_target))
        return True
