"""Local A–E mission intent; every changed route still needs a new human approval."""

import copy
import json
import math
import uuid

from sqlalchemy import BigInteger, Column, MetaData, String, Table, Text, select, update

from .contracts import HEIGHT, WIDTH, OPERATOR_PRESENCE_MS, angle, canonical, map_digest, radius, ready, stopped_for_route

STATIONS = tuple("ABCDE")
MISSION_METADATA = MetaData()
MISSIONS = Table("amr_local_missions", MISSION_METADATA,
    Column("mission_id", String(32), primary_key=True),
    Column("created_at_ms", BigInteger, nullable=False),
    Column("state", String(32), nullable=False),
    Column("record", Text, nullable=False))


class Mission:
    def __init__(self, twin):
        self.twin = twin
        self.row = None
        self.samples = []
        self.attempted_maps = set()
        self.stop_route = None
        self.stop_seq = 0
        self.stop_at = 0
        self.diversion_baseline = None
        self.station_path = twin.state_dir / "measured_stations.json"
        self.station_data = None
        self.station_error = None
        if self.station_path.exists():
            try:
                self.station_data = json.loads(self.station_path.read_text())
            except (ValueError, OSError):
                self.station_error = "Stored station measurements are invalid; enter and verify them again"
        MISSION_METADATA.create_all(twin.engine)
        # History is retained, but neither mission intent nor approval is resumed.
        with twin.engine.begin() as connection:
            interrupted = connection.execute(select(MISSIONS).where(
                MISSIONS.c.state.not_in(("verified", "stopped", "interrupted")))).mappings().all()
            for previous in interrupted:
                record = json.loads(previous["record"])
                record.update(state="interrupted", auto_replan=False, reason="Local service restarted; no automatic resume")
                record["events"].append(dict(at_ms=twin.clock(), event="service_restart"))
                connection.execute(update(MISSIONS).where(MISSIONS.c.mission_id == previous["mission_id"]).values(
                    state="interrupted", record=canonical(record)))

    def _save(self, event=None, **details):
        if not self.row:
            return
        if event:
            self.row["events"].append(dict(at_ms=self.twin.clock(), event=event, **details))
        record = dict(mission_id=self.row["mission_id"], created_at_ms=self.row["created_at_ms"],
                      state=self.row["state"], record=canonical(self.row))
        with self.twin.engine.begin() as connection:
            found = connection.execute(select(MISSIONS.c.mission_id).where(
                MISSIONS.c.mission_id == self.row["mission_id"])).first()
            if found:
                connection.execute(update(MISSIONS).where(MISSIONS.c.mission_id == self.row["mission_id"]).values(**record))
            else:
                connection.execute(MISSIONS.insert().values(**record))

    def _coordinates(self, data):
        if not isinstance(data, dict) or set(data) != set(STATIONS):
            raise ValueError("Measure all station centres A, B, C, D and E in floor millimetres")
        if not self.twin.config or not self.twin.config_id:
            raise ValueError("Load the measured camera profile before verifying stations")
        margin = radius(self.twin.config["geometry"])
        result = {}
        for label in STATIONS:
            point = data[label]
            if not isinstance(point, dict) or set(point) != {"x", "y"}:
                raise ValueError("Enter measured X and Y for station " + label)
            x, y = point["x"], point["y"]
            if any(type(v) not in (int, float) or not math.isfinite(v) for v in (x, y)):
                raise ValueError("Station coordinates must be finite measured millimetres")
            if not margin <= x <= WIDTH - margin or not margin <= y <= HEIGHT - margin:
                raise ValueError("Station " + label + " lacks the measured footprint and stopping clearance")
            result[label] = dict(x=float(x), y=float(y))
        points = [(p["x"], p["y"]) for p in result.values()]
        if any(math.dist(a, b) <= 30 for index, a in enumerate(points) for b in points[index+1:]):
            raise ValueError("Station centres must be more than 30 mm apart so 15 mm arrival zones do not overlap")
        return result

    def stations(self):
        output = dict(verified=False, stations={s: dict(x=None, y=None) for s in STATIONS},
                      config_id=None, reason="Enter and verify measured station centres")
        if self.twin.config:
            margin = radius(self.twin.config["geometry"])
            output.update(required_clearance_mm=margin,
                usable_bounds=dict(x_min=margin, x_max=WIDTH-margin, y_min=margin, y_max=HEIGHT-margin))
        if self.station_error:
            output["reason"] = self.station_error
        elif isinstance(self.station_data, dict):
            try:
                output["stations"] = self._coordinates(self.station_data.get("stations"))
                output["config_id"] = self.station_data.get("config_id")
                output["verified"] = (self.station_data.get("verified") is True
                                      and output["config_id"] == self.twin.config_id)
                output["reason"] = ("Measured stations match this camera calibration" if output["verified"] else
                                    "Camera calibration changed; remeasure and verify station centres")
            except ValueError as error:
                output["reason"] = str(error)
        return output

    def configure(self, payload):
        if self.twin.agent.state in ("arming", "running", "battery_review", "stopping"):
            raise ValueError("Stop the route before changing station measurements")
        if payload.get("verified") is not True:
            raise ValueError("Confirm that all five station centres were physically measured")
        coordinates = self._coordinates(payload.get("stations"))
        self.twin.stop("Station measurements changed; preview a new mission")
        data = dict(verified=True, stations=coordinates, config_id=self.twin.config_id)
        temporary = self.station_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, indent=2))
        temporary.replace(self.station_path)
        self.station_data, self.station_error = data, None

    def _station(self, label):
        configured = self.stations()
        if label not in STATIONS or not configured["verified"]:
            raise ValueError("Verified measured stations A–E are required")
        return dict(configured["stations"][label], label=label)

    def _retire_pending(self, reason):
        review = self.twin.coordinator.row
        if review and review["state"] == "pending":
            review.update(state="cancelled", reason=reason)
            self.twin.coordinator.save()

    def start(self, start, destination):
        t = self.twin
        if t.agent.state in ("arming", "running", "battery_review", "stopping"):
            raise ValueError("Stop the current mission before selecting another")
        origin, goal = self._station(start), self._station(destination)
        if start == destination:
            raise ValueError("Choose a destination different from the selected start")
        if not t.status()["ready"] or not t.coordinator.stationary():
            raise ValueError("Fresh stationary ArUco and ESP32 evidence is required")
        pose = t.coordinator.current["pose"]
        if math.dist((pose["x"], pose["y"]), (origin["x"], origin["y"])) > 15:
            raise ValueError("The observed robot is not within 15 mm of selected start " + start)
        self.cancel("A new mission was selected")
        self._retire_pending("A new station mission replaces the previous preview")
        self.row = dict(mission_id=uuid.uuid4().hex, created_at_ms=t.clock(), state="review",
            config_id=t.config_id, start_station=start, original_start=copy.deepcopy(pose),
            destination_station=destination, original_destination=goal, active_goal=copy.deepcopy(goal),
            intent="destination", proposal_kind="initial", review_id=None, auto_replan=False,
            reason="Review the measured route before approving movement", outcome=None, events=[])
        self.samples, self.attempted_maps, self.diversion_baseline = [], set(), None
        self._save("mission_selected")
        try:
            self._capture("initial")
        except ValueError as error:
            self.row.update(state="blocked", reason="No route can be proposed: " + str(error))
            self._save("proposal_blocked", reason=str(error))
            raise

    def _capture(self, kind):
        t, mission = self.twin, self.row
        goal = mission["active_goal"]
        self._retire_pending("A new route proposal replaces this preview")
        e_intent = mission["intent"] == "battery_station"
        t.coordinator.capture(t.owner, "local_operator", (goal["x"], goal["y"]),
                              battery_consent=e_intent,
                              battery_consent_voltage=self.diversion_baseline if e_intent else None)
        mission.update(state="review", proposal_kind=kind, review_id=t.coordinator.row["review_id"],
            reason=("Obstacle change: review this new route to " + goal["label"] if kind == "obstacle_replan" else
                    "Review the new route to " + goal["label"] + "; approval is required before movement"))
        self._save("route_proposed", review_id=mission["review_id"], map_id=t.coordinator.row["map_id"], kind=kind)

    def cancel(self, reason):
        if self.row and self.row["state"] not in ("stopped", "verified"):
            self.row.update(state="stopped", auto_replan=False, reason=reason)
            self.samples.clear()
            self._retire_pending(reason)
            self._save("mission_stopped", reason=reason)

    def decision(self, rid, decision, reason):
        t = self.twin
        if not self.row or rid != self.row["review_id"]:
            return False
        if self.row["state"] != "review":
            raise ValueError("Preview a current mission route before deciding")
        self._save("decision_requested", review_id=rid, decision=decision, reason=reason)
        try:
            t.coordinator.decide(t.owner, rid, decision, reason)
        except Exception:
            if t.coordinator.row and t.coordinator.row["state"] == "uncertain":
                self.cancel("Approval dispatch failed; no automatic retry")
            raise
        if decision == "approve":
            self.row.update(state="running", auto_replan=True, reason="Executing the approved route to " + self.row["active_goal"]["label"])
        else:
            self.row.update(state="stopped", auto_replan=False, reason="Route " + decision + " recorded; the robot remains stopped")
            self.samples.clear()
        self._save("decision_recorded", review_id=rid, decision=decision)
        return True

    def _wait_for_goal(self, goal, intent, kind, reason):
        t = self.twin
        self._retire_pending(reason)
        # This is an explicit stop, never permission to execute the next goal.
        try:
            t.agent.halt(reason, t.clock(), cause="explicit_stop")
        except Exception:
            t._halt("The requested stop could not be sent; no route will be proposed")
            raise ValueError("Stop acknowledgement unavailable")
        t.coordinator.status(t.agent.status(t.clock()))
        self.stop_route = t.agent.job["review_id"] if t.agent.job else None
        self.stop_seq = getattr(t.agent, "stop_command_seq", t.agent.seq)
        self.stop_at = t.clock()
        self.samples, self.attempted_maps = [], set()
        self.row.update(state="waiting_stop", active_goal=copy.deepcopy(goal), intent=intent,
                        proposal_kind=kind, auto_replan=False, reason=reason + "; waiting for an acknowledged stable stop")
        self._save("goal_change_requested", goal=goal, intent=intent)

    def return_start(self, reason):
        if not self.row or self.row["config_id"] != self.twin.config_id:
            raise ValueError("A mission start captured with the current camera calibration is required")
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 240:
            raise ValueError("Record a short return-to-start reason")
        origin = self.row["original_start"]
        goal = dict(x=origin["x"], y=origin["y"], label=self.row["start_station"])
        self.twin.coordinator.touch(self.twin.owner)
        self._save("return_requested", reason=reason.strip())
        self._wait_for_goal(goal, "return_start", "return_start", "Return to the observed original start requested")

    def battery_diversion(self, reason, baseline=None):
        if not self.row:
            return
        self.diversion_baseline = baseline
        self._save("battery_diversion_requested", reason=reason)
        self._wait_for_goal(self._station("E"), "battery_station", "battery_diversion", "Battery station E requested")

    def _settled(self, s):
        t, now = self.twin, self.twin.clock()
        hw = s["hardware"]
        quiet = not (hw["left_duty"] or hw["right_duty"])
        if self.stop_route:
            quiet = quiet and stopped_for_route(s, now, self.stop_route, self.stop_seq)
        if not quiet or s["captured_at_ms"] <= self.stop_at:
            self.samples.clear()
            return False
        identity = map_digest(s)
        if self.samples and self.samples[-1]["map"] != identity:
            self.samples.clear()
            self.attempted_maps.clear()
        if not self.samples or s["seq"] > self.samples[-1]["seq"]:
            self.samples.append(dict(seq=s["seq"], at=s["captured_at_ms"], pose=copy.deepcopy(s["pose"]), map=identity))
        self.samples = [sample for sample in self.samples if now - sample["at"] <= 1000]
        if len(self.samples) < 3 or self.samples[-1]["at"] - self.samples[0]["at"] < 500:
            return False
        p = s["pose"]
        stationary = all(math.dist((q["pose"]["x"], q["pose"]["y"]), (p["x"], p["y"])) <= 5
                         and abs(angle(q["pose"]["heading"] - p["heading"])) <= .05 for q in self.samples)
        if not stationary:
            self.samples = self.samples[-1:]
        return stationary and t.coordinator.stationary()

    def tick(self):
        t, mission = self.twin, self.row
        if not mission or mission["state"] in ("stopped", "verified"):
            return
        now, s = t.clock(), t.coordinator.current
        if (not t.connected or not t.hardware_ok or not t._hardware_value(now)["ready"] or not s or not ready(s, now)
            or s["config_id"] != mission["config_id"] or t.calibrating
            or now - t.coordinator.presence.get(t.owner, -10000) > OPERATOR_PRESENCE_MS):
            self.cancel("Camera, controller, calibration or operator evidence was lost; explicitly preview a new mission")
            return
        review = t.coordinator.row
        if review and review["review_id"] == mission["review_id"]:
            if review["state"] == "verified":
                outcome = {"destination": "destination_reached", "return_start": "returned_to_start", "battery_station": "arrived_E"}[mission["intent"]]
                mission.update(state="verified", auto_replan=False, outcome=outcome,
                    reason={"destination_reached": "Original destination verified", "returned_to_start": "Return to the original start verified", "arrived_E": "Arrival at battery station E verified; original destination remains unfinished"}[outcome])
                self._save("arrival_verified", outcome=outcome)
                return
            if review["state"] == "expired":
                self.cancel("Route review expired; explicitly request a new preview")
                return
        if t.agent.state == "battery_review" and mission["state"] == "running":
            mission.update(state="battery_review", reason="Low battery: continue to " + mission["active_goal"]["label"] + " or request battery station E")
            self._save("battery_review")
        elif t.agent.state == "running" and mission["state"] == "battery_review":
            mission.update(state="running", reason="Continue approved to " + mission["active_goal"]["label"])
            self._save("battery_continue")
        if t.agent.state == "blocked" and mission["state"] in ("running", "battery_review"):
            if getattr(t.agent, "stop_cause", None) != "obstacle_changed" or not mission["auto_replan"]:
                self.cancel(t.agent.reason)
                return
            self.stop_route = t.agent.job["review_id"]
            self.stop_seq = t.agent.stop_command_seq
            self.stop_at = now
            self.samples, self.attempted_maps = [], set()
            mission.update(state="waiting_stop", proposal_kind="obstacle_replan",
                reason="Obstacle change detected; waiting for a stable acknowledged stop before proposing a route")
            self._save("obstacle_pause", stop_command_seq=self.stop_seq)
        if mission["state"] == "review" and mission["auto_replan"] and review and map_digest(s) != review["map_id"]:
            self._retire_pending("Obstacles changed after the preview")
            mission.update(state="waiting_stop", proposal_kind="obstacle_replan", reason="Waiting for the new obstacle map to settle")
            self.samples.clear()
            self.attempted_maps.clear()
            self._save("preview_invalidated")
        if mission["state"] not in ("waiting_stop", "blocked") or not self._settled(s):
            return
        identity = map_digest(s)
        if identity in self.attempted_maps:
            return
        self.attempted_maps.add(identity)
        try:
            self._capture(mission["proposal_kind"])
        except ValueError as error:
            mission.update(state="blocked", reason="No new route can be proposed: " + str(error))
            self._save("proposal_blocked", map_id=identity, reason=str(error))

    def public(self):
        if not self.row:
            return None
        return {key: copy.deepcopy(value) for key, value in self.row.items() if key not in ("events", "config_id")}
