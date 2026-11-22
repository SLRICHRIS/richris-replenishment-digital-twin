"""Local mission integration with synthetic camera evidence and mocked motor transport."""
import copy
import json
import math

import pytest
from sqlalchemy import select

from backend_streamlit_and_telemetry.vision_control.browser_camera import Observation
from backend_streamlit_and_telemetry.vision_control.local_twin import LocalTwin
from backend_streamlit_and_telemetry.vision_control.mission import MISSIONS
from backend_streamlit_and_telemetry.vision_control.contracts import segment_clear, radius
from test_local_twin import BOOT, EPOCH, FakeTransport, G

STATIONS = dict(A=dict(x=210, y=180), B=dict(x=210, y=430), E=dict(x=300, y=300))
OBSTACLE = [dict(x=520, y=520, width=20, height=20)]


@pytest.fixture
def mission_rig(tmp_path):
    clock, transport = [10000], FakeTransport()
    twin = LocalTwin(transport, tmp_path, clock=lambda: clock[0])
    twin.connected = True  # Never open an actual camera or receiver.
    twin.config = dict(geometry=copy.deepcopy(G), resolution=[1280, 720])
    twin.config_id = "f" * 64

    def frame(stamp, *, x=210, y=180, obstacles=(), voltage=7.4, valid=True,
              route=None, ack=None, state=None, left=0, right=0, epoch=EPOCH, presence=True):
        clock[0] = stamp
        if presence:
            twin.presence(True)
        job = twin.agent.job
        route = route if route is not None else (job["review_id"] if job else "0" * 32)
        ack = twin.agent.seq if ack is None else ack
        state = state or ("stopped" if job else "idle")
        twin.accept_hardware(dict(boot_id=BOOT, epoch_id=epoch, seq=stamp, route_id=route,
            command_seq=ack, state=state, left_duty=left, right_duty=right,
            battery_voltage_v=voltage, ready=True, issued_at_ms=stamp))
        obs = Observation(stamp, (0, 1, 2, 3, 4), valid, "Synthetic camera sample",
                          dict(x=x, y=y, heading=math.pi/2) if valid else None, tuple(obstacles), stamp)
        twin.camera_status.update(connected=True, valid=valid, captured_at_ms=stamp, seq=stamp)
        twin.accept_observation(obs, twin.config, twin.config_id, stamp)
        twin.supervise()
        return twin.status()

    for stamp in (9400, 9700, 10000):
        frame(stamp)
    twin.mutate("stations", dict(verified=True, stations=STATIONS))
    yield twin, clock, transport, frame
    twin.engine.dispose()


def start(twin, destination="B"):
    return twin.mutate("mission", dict(start="A", destination=destination))


def approve(twin):
    rid = twin.status()["review"]["review_id"]
    twin.mutate("decision", dict(review_id=rid, decision="approve", reason="Observed and reviewed the current route"))
    return rid


def running(twin, frame):
    start(twin)
    rid = approve(twin)
    frame(10050, route=rid, state="armed")
    frame(10100, route=rid, state="moving")
    assert twin.agent.state == "running"
    return rid


def settle(frame, start_at, **kwargs):
    value = None
    for offset in (100, 350, 650, 1050):
        value = frame(start_at + offset, **kwargs)
    return value


def obstacle_preview(twin, frame):
    running(twin, frame)
    frame(10200, obstacles=OBSTACLE, state="moving", left=20, right=20)
    assert twin.agent.stop_cause == "obstacle_changed"
    assert twin.mission.row["state"] == "waiting_stop"
    return settle(frame, 10200, obstacles=OBSTACLE)


def test_measured_start_validation_and_station_clearance(mission_rig):
    twin, clock, transport, frame = mission_rig
    assert twin.status()["stations"]["verified"]
    assert twin.status()["stations"]["required_clearance_mm"] > 100
    with pytest.raises(ValueError, match="15 mm"):
        twin.mutate("mission", dict(start="E", destination="B"))
    bad = copy.deepcopy(STATIONS); bad["A"]["x"] = 40
    with pytest.raises(ValueError, match="clearance"):
        twin.mutate("stations", dict(verified=True, stations=bad))
    ambiguous = copy.deepcopy(STATIONS); ambiguous["B"] = dict(x=210, y=200)
    with pytest.raises(ValueError, match="arrival zones"):
        twin.mutate("stations", dict(verified=True, stations=ambiguous))
    result = start(twin)
    assert result["mission"]["original_start"] == dict(x=210, y=180, heading=math.pi/2)
    assert result["mission"]["original_destination"] == dict(x=210, y=430, label="B")
    assert result["review"]["state"] == "pending" and not transport.sent
    twin.config_id = "e" * 64
    assert not twin.mission.stations()["verified"]


@pytest.mark.parametrize("change", ["missing_E", "extra_C", "extra_D"])
def test_only_measured_a_b_e_stations_are_accepted(mission_rig, change):
    twin, clock, transport, frame = mission_rig
    previous = copy.deepcopy(twin.mission.station_data)
    proposed = copy.deepcopy(STATIONS)
    if change == "missing_E":
        proposed.pop("E")
    else:
        proposed[change[-1]] = dict(x=400, y=400)
    with pytest.raises(ValueError, match="A, B and charging stop E"):
        twin.mutate("stations", dict(verified=True, stations=proposed))
    assert twin.mission.station_data == previous
    assert set(twin.status()["stations"]["stations"]) == {"A", "B", "E"}
    assert not transport.sent


def test_old_five_station_map_needs_new_measurements(mission_rig):
    twin, clock, transport, frame = mission_rig
    twin.mission.station_data["stations"].update(C=dict(x=400, y=430), D=dict(x=400, y=180))
    value = twin.mission.stations()
    assert not value["verified"]
    assert set(value["stations"]) == {"A", "B", "E"}
    for label in ("C", "D"):
        with pytest.raises(ValueError, match="Verified measured stations"):
            twin.mutate("mission", dict(start="A", destination=label))
    assert not transport.sent


def test_obstacle_pause_requires_stopped_ack_and_three_new_stable_observations(mission_rig):
    twin, clock, transport, frame = mission_rig
    old = running(twin, frame)
    frame(10200, obstacles=OBSTACLE, state="moving", left=20, right=20)
    stop_seq = twin.agent.stop_command_seq
    assert transport.sent[-1][3] == "stop"
    for stamp in (10300, 10600, 10900, 11300):
        frame(stamp, obstacles=OBSTACLE, ack=stop_seq-1)
    assert twin.mission.row["state"] == "waiting_stop"
    for stamp in (11400, 11700):
        frame(stamp, obstacles=OBSTACLE, ack=stop_seq)
    assert twin.mission.row["state"] == "waiting_stop"
    value = frame(12000, obstacles=OBSTACLE, ack=stop_seq)
    assert value["mission"]["state"] == "review"
    assert value["review"]["review_id"] != old and value["review"]["state"] == "pending"
    assert value["mission"]["proposal_kind"] == "obstacle_replan"
    assert value["mission"]["active_goal"] == value["mission"]["original_destination"]
    rid, sent = value["review"]["review_id"], len(transport.sent)
    for stamp in (12100, 12400, 12700):
        assert frame(stamp, obstacles=OBSTACLE)["review"]["review_id"] == rid
    assert len(transport.sent) == sent  # Preview cannot arm or drive.
    approve(twin)
    assert transport.sent[-1][3] == "arm" and twin.agent.job["review_id"] == rid


def test_reject_prohibits_auto_replan_but_explicit_return_keeps_original_observed_start(mission_rig):
    twin, clock, transport, frame = mission_rig
    value = obstacle_preview(twin, frame)
    original = copy.deepcopy(value["mission"]["original_start"])
    twin.mutate("decision", dict(review_id=value["review"]["review_id"], decision="reject", reason="Return instead"))
    assert twin.mission.row["state"] == "stopped" and not twin.mission.row["auto_replan"]
    sent = len(transport.sent)
    for stamp in (11400, 11700, 12100):
        frame(stamp, obstacles=[])
    assert twin.mission.row["state"] == "stopped" and len(transport.sent) == sent
    twin.mutate("return-start", dict(reason="Return to the captured origin"))
    value = settle(frame, 12100)
    assert value["mission"]["original_start"] == original
    assert value["mission"]["active_goal"] == dict(x=original["x"], y=original["y"], label="A")
    assert value["mission"]["original_destination"]["label"] == "B"
    assert value["mission"]["intent"] == "return_start" and value["review"]["state"] == "pending"
    assert len(transport.sent) == sent


@pytest.mark.parametrize("fault", ["camera", "presence", "epoch"])
def test_non_obstacle_fault_never_creates_automatic_recovery(mission_rig, fault):
    twin, clock, transport, frame = mission_rig
    old = running(twin, frame)
    if fault == "camera":
        frame(10200, valid=False)
    elif fault == "epoch":
        frame(10200, epoch="e" * 32)
    else:
        twin.presence(False)
    assert twin.mission.row["state"] == "stopped"
    sent = len(transport.sent)
    settle(frame, 10500, epoch="e" * 32 if fault == "epoch" else EPOCH)
    assert twin.mission.row["state"] == "stopped" and twin.coordinator.row["review_id"] == old
    assert len(transport.sent) == sent


def test_no_safe_detour_stays_stopped_and_does_not_repeat_same_map(mission_rig):
    twin, clock, transport, frame = mission_rig
    running(twin, frame)
    barrier = [dict(x=0, y=320, width=760, height=10)]
    frame(10200, obstacles=barrier, state="moving", left=20, right=20)
    value = settle(frame, 10200, obstacles=barrier)
    assert value["mission"]["state"] == "blocked"
    assert "No new route" in value["mission"]["reason"]
    attempts = len(twin.mission.row["events"])
    sent = len(transport.sent)
    settle(frame, 11400, obstacles=barrier)
    assert len(twin.mission.row["events"]) == attempts and len(transport.sent) == sent


def test_on_path_obstacle_proposes_a_different_collision_checked_route(mission_rig):
    twin, clock, transport, frame = mission_rig
    measured = copy.deepcopy(STATIONS)
    measured.update(A=dict(x=210, y=140), B=dict(x=210, y=430))
    twin.mutate("stations", dict(verified=True, stations=measured))
    twin.coordinator.history.clear()
    for stamp in (11000, 11300, 11600):
        frame(stamp, y=140)
    start(twin)
    original = copy.deepcopy(twin.coordinator.row["route"])
    approve(twin)
    frame(11650, y=140, state="armed")
    frame(11700, y=140, state="moving")
    obstacle = [dict(x=200, y=270, width=20, height=20)]
    frame(11800, y=140, obstacles=obstacle, state="moving", left=20, right=20)
    value = settle(frame, 11800, y=140, obstacles=obstacle)
    route = value["review"]["route"]
    assert value["review"]["state"] == "pending" and route["points"] != original["points"]
    margin = radius(G)
    assert not all(segment_clear(a, b, obstacle, margin) for a, b in zip(original["points"], original["points"][1:]))
    assert all(segment_clear(a, b, obstacle, margin) for a, b in zip(route["points"], route["points"][1:]))
    assert route["goal"] == [210, 430] and transport.sent[-1][3] == "stop"


def test_previously_seen_map_can_be_proposed_again_after_a_different_map(mission_rig):
    twin, clock, transport, frame = mission_rig
    first = obstacle_preview(twin, frame)["review"]["review_id"]
    other = [dict(x=550, y=520, width=20, height=20)]
    frame(11400, obstacles=other)
    second = settle(frame, 11400, obstacles=other)["review"]["review_id"]
    assert second != first
    frame(12500, obstacles=OBSTACLE)
    third = settle(frame, 12500, obstacles=OBSTACLE)["review"]["review_id"]
    assert third not in (first, second) and twin.coordinator.row["state"] == "pending"
    assert transport.sent[-1][3] == "stop"


def test_battery_continue_keeps_goal_and_diversion_needs_new_e_approval(mission_rig):
    twin, clock, transport, frame = mission_rig
    original = running(twin, frame)
    frame(10200, voltage=6.95, state="moving")
    value = settle(frame, 10200, voltage=7.15, state="armed")
    assert value["mission"]["state"] == "battery_review"
    alert = value["review"]["battery_review_seq"]
    twin.mutate("battery-decision", dict(review_id=original, choice="continue", reason="Continue the original goal", battery_review_seq=alert))
    assert twin.mission.row["active_goal"]["label"] == "B" and twin.agent.state == "running"
    frame(11400, voltage=6.95, state="moving")
    assert twin.agent.state == "running"  # Stopped-voltage rebound is not a new warning.
    frame(11500, voltage=6.84, state="moving")
    value = settle(frame, 11500, voltage=6.84, state="armed")
    assert twin.agent.state == "battery_review"
    with pytest.raises(ValueError, match="battery|Battery"):
        twin.mutate("battery-decision", dict(review_id=original, choice="continue", reason="Old prompt", battery_review_seq=alert))
    twin.mutate("battery-decision", dict(review_id=original, choice="divert", reason="Go to battery station", battery_review_seq=value["review"]["battery_review_seq"]))
    assert twin.mission.row["state"] == "waiting_stop" and transport.sent[-1][3] == "stop"
    sent = len(transport.sent)
    value = settle(frame, 12550, voltage=6.84)
    assert value["mission"]["active_goal"]["label"] == "E" and value["mission"]["original_destination"]["label"] == "B"
    assert value["review"]["state"] == "pending" and value["review"]["review_id"] != original
    assert len(transport.sent) == sent
    rid = approve(twin)
    frame(13700, voltage=6.84, route=rid, state="armed")
    frame(13800, voltage=6.84, route=rid, state="moving")
    assert twin.agent.state == "running"  # E approval carries scoped low-battery consent.
    frame(13900, voltage=6.84, route=rid, state="moving", obstacles=OBSTACLE)
    sent = len(transport.sent)
    value = settle(frame, 13900, voltage=6.84, obstacles=OBSTACLE)
    assert value["review"]["state"] == "pending" and value["mission"]["active_goal"]["label"] == "E"
    assert len(transport.sent) == sent
    rid = approve(twin)  # A separate approval is required for the E detour.
    frame(15000, voltage=6.84, route=rid, state="armed", obstacles=OBSTACLE)
    frame(15100, voltage=6.84, route=rid, state="moving", obstacles=OBSTACLE)
    assert twin.agent.state == "running"
    frame(15200, voltage=6.69, route=rid, state="moving", obstacles=OBSTACLE)
    assert twin.agent.state == "blocked" and twin.mission.row["state"] == "stopped"


def complete_current_route(twin, clock, frame, voltage=7.4):
    """Feed independent fresh poses along the approved route, then stopped ACKs."""
    route = copy.deepcopy(twin.coordinator.row["route"])
    p = dict(twin.coordinator.current["pose"])
    frame(clock[0]+50, x=p["x"], y=p["y"], state="armed", voltage=voltage)
    for target in route["points"][1:]:
        start_point = (p["x"], p["y"])
        steps = max(1, math.ceil(math.dist(start_point, target)/2))
        for step in range(1, steps+1):
            p["x"] = start_point[0] + (target[0]-start_point[0])*step/steps
            p["y"] = start_point[1] + (target[1]-start_point[1])*step/steps
            frame(clock[0]+200, x=p["x"], y=p["y"], state="moving", voltage=voltage)
            assert twin.agent.state in ("running", "stopping"), twin.agent.reason
            if twin.agent.state == "stopping":
                break
        if twin.agent.state == "stopping":
            break
    # Zero-length return routes also need an explicit stop + fresh verification.
    if twin.agent.state == "running":
        frame(clock[0]+200, x=p["x"], y=p["y"], state="moving", voltage=voltage)
    assert twin.agent.state == "stopping"
    for _ in range(6):
        frame(clock[0]+200, x=p["x"], y=p["y"], state="stopped", voltage=voltage)
    assert twin.coordinator.row["state"] == "verified"


@pytest.mark.parametrize("intent,outcome", [("destination", "destination_reached"),
    ("return_start", "returned_to_start"), ("battery_station", "arrived_E")])
def test_mission_arrivals_have_distinct_verified_outcomes(mission_rig, intent, outcome):
    twin, clock, transport, frame = mission_rig
    running(twin, frame)
    voltage = 7.4
    if intent == "return_start":
        frame(10200, y=190, state="moving")
        frame(10300, y=200, state="moving")
        frame(10400, y=210, state="moving")
        twin.mutate("return-start", dict(reason="Return to the captured original start"))
        settle(frame, 10400, y=210)
        approve(twin)
    elif intent == "battery_station":
        voltage = 6.95
        frame(10200, voltage=voltage, state="moving")
        value = settle(frame, 10200, voltage=voltage, state="armed")
        twin.mutate("battery-decision", dict(review_id=value["review"]["review_id"], choice="divert",
            reason="Return to battery station E", battery_review_seq=value["review"]["battery_review_seq"]))
        settle(frame, clock[0], voltage=voltage)
        approve(twin)
    complete_current_route(twin, clock, frame, voltage)
    result = twin.status()["mission"]
    assert result["state"] == "verified" and result["outcome"] == outcome
    assert result["original_destination"]["label"] == "B"
    assert result["original_start"] == dict(x=210, y=180, heading=math.pi/2)


def test_restart_preserves_station_measurements_and_audit_but_never_resumes(mission_rig, tmp_path):
    twin, clock, transport, frame = mission_rig
    running(twin, frame)
    mission_id = twin.mission.row["mission_id"]
    other_transport = FakeTransport()
    other = LocalTwin(other_transport, tmp_path, clock=lambda: clock[0])
    try:
        other.config, other.config_id = copy.deepcopy(twin.config), twin.config_id
        assert other.mission.stations()["verified"]
        assert other.mission.row is None and not other.connected and not other_transport.sent
        with other.engine.connect() as connection:
            row = connection.execute(select(MISSIONS).where(MISSIONS.c.mission_id == mission_id)).mappings().one()
        assert row["state"] == "interrupted"
        audit = json.loads(row["record"])
        assert audit["state"] == "interrupted" and audit["events"][-1]["event"] == "service_restart"
        assert audit["original_destination"]["label"] == "B" and any(e["event"] == "decision_recorded" for e in audit["events"])
    finally:
        other.engine.dispose()
