"""Camera-free route geometry and bounded real-command state machine, fake MCU only."""
import copy
import json
import math

import pytest

from backend_streamlit_and_telemetry.vision_control.preset_routes import (
    PresetController, STATIONS, centre, layout, timed_plan, handler_for,
)


class Receiver:
    device_ip = "10.55.54.112"

    def __init__(self, clock):
        self.clock = clock
        self.calls = []
        self.expiry = 0
        self.h = dict(boot_id="b"*32, epoch_id="e"*32, seq=0, command_seq=0,
                      route_id="0"*32, state="idle", left_duty=0, right_duty=0,
                      ready=True, battery_voltage_v=7.3, issued_at_ms=clock[0])

    def send(self, observed, route, seq, operation, left, right, now, *, lease_ms=500):
        assert 1 <= lease_ms <= 500
        assert max(abs(left), abs(right)) <= 60
        self.calls.append(dict(route=route, seq=seq, operation=operation, left=left,
                               right=right, now=now, lease=lease_ms))
        self.h.update(route_id=route, command_seq=seq, left_duty=left, right_duty=right,
                      state={"arm":"armed", "drive":"moving" if left or right else "armed", "stop":"stopped"}[operation])
        self.expiry = now+lease_ms

    def poll(self):
        now = self.clock[0]
        if self.h["state"] in ("armed", "moving") and now >= self.expiry:
            self.h.update(state="expired", left_duty=0, right_duty=0)
        self.h["issued_at_ms"] = now
        self.h["seq"] += 1
        return copy.deepcopy(self.h)


def measurements():
    return {"version":1, "samples":{
        k:dict(pwm=50, rate=20 if k=="forward" else 30, voltage_v=7.3, at_ms=10000,
               **({"stopping_mm":5} if k=="forward" else {})) for k in ("forward","left","right")}}


def rig(tmp_path):
    clock = [10000]
    receiver = Receiver(clock)
    app = PresetController(receiver, tmp_path, clock=lambda:clock[0])
    assert not receiver.calls and app.hardware is None
    app.action("connect", {})
    app.action("presence", {"active":True})
    app.tick(receiver.poll())
    return app, receiver, clock


def pulse(app, receiver, clock, n=1, attended=True):
    for _ in range(n):
        clock[0] += 100
        if attended:
            app.action("presence", {"active":True})
        app.tick(receiver.poll())


def start_trial(app, direction="forward", id="a"*32):
    app.action("trial", dict(request_id=id, motion=direction, pwm=50, confirmed=True))


def test_layout_has_only_three_correct_front_reference_routes():
    assert centre(STATIONS["A"]) == [545,350]
    assert centre(STATIONS["B"]) == [205,345]
    assert centre(STATIONS["E"]) == [290,160]
    p=layout("E-A")
    assert [s["motion"] for s in p["steps"]] == ["left","forward","right"]
    assert [s["amount"] for s in p["steps"]] == pytest.approx([126.6897228,318.0015723,36.6897228])
    for route in ("A-B","E-A","B-E"):
        p=layout(route); x,y=p["start_centre_mm"]
        heading=STATIONS[p["start"]]["heading_deg"]
        for s in p["steps"]:
            if s["motion"] == "forward":
                x += s["amount"]*math.cos(math.radians(heading))
                y += s["amount"]*math.sin(math.radians(heading))
            else:
                heading += s["amount"]*(1 if s["motion"]=="left" else -1)
        assert [x,y] == pytest.approx(p["goal_centre_mm"])
        front = [x+85*math.cos(math.radians(heading)),y+85*math.sin(math.radians(heading))]
        assert front == pytest.approx(STATIONS[p["destination"]]["front_mm"])
    with pytest.raises(ValueError): layout("A-E")


def test_timing_requires_real_measurements_and_checks_layout_and_battery():
    with pytest.raises(ValueError): timed_plan("E-A",{"version":1,"samples":{}},7.3)
    with pytest.raises(ValueError,match="Battery"): timed_plan("E-A",measurements(),7.8)
    m=measurements();m["samples"]["forward"]["stopping_mm"]=40
    with pytest.raises(ValueError,match="stopping distance"): timed_plan("E-A",m,7.3)
    p=timed_plan("E-A",measurements(),7.3)
    assert p["steps"][1]["duration_ms"] == 15650


def test_start_is_explicit_and_no_camera_profile_is_required(tmp_path):
    app,receiver,clock=rig(tmp_path)
    assert not receiver.calls
    assert app.status()["ready"] is True
    assert "connected and ready" in app.status()["message"]
    assert app.status()["camera_required"] is False
    assert app.status()["automatic_obstacle_detection"] is False
    with pytest.raises(ValueError,match="Confirm"):
        app.action("trial",dict(request_id="a"*32,motion="forward",pwm=50,confirmed=False))
    assert not receiver.calls
    start_trial(app)
    assert not receiver.calls  # Explicit action schedules; worker is sole motor writer.
    pulse(app,receiver,clock,20)
    assert app.state == "trial_complete" and app.last_test
    assert receiver.calls[0]["operation"] == "arm"
    assert not receiver.h["left_duty"] and not receiver.h["right_duty"]
    with pytest.raises(ValueError,match="already ended"): start_trial(app)


def test_idle_banner_tracks_receiver_readiness_without_changing_completed_outcomes(tmp_path):
    app, receiver, clock = rig(tmp_path)
    receiver.h["ready"] = False
    app.tick(receiver.poll())
    assert "not ready" in app.status()["message"] and not app.status()["ready"]
    receiver.h["ready"] = True
    app.tick(receiver.poll())
    clock[0] += 501
    assert "out of date" in app.status()["message"] and not app.status()["ready"]
    app.tick(receiver.poll())
    app.state, app.message = "sequence_complete", "Check the destination"
    assert app.status()["message"] == "Check the destination"
    assert not receiver.calls


def test_calibration_saved_only_after_completed_acknowledged_trial(tmp_path):
    app,receiver,clock=rig(tmp_path)
    with pytest.raises(ValueError,match="fresh one-second"):
        app.action("measurement",dict(trial_id="a"*32,amount=20,verified=True,stopping_mm=5))
    start_trial(app); pulse(app,receiver,clock,20)
    app.action("measurement",dict(trial_id="a"*32,amount=20,verified=True,stopping_mm=5))
    saved=json.loads((tmp_path/"preset_measurements.json").read_text())
    assert saved["samples"]["forward"]["rate"] == 15
    restored=PresetController(receiver,tmp_path,clock=lambda:clock[0])
    assert not restored.connected and not restored.job and not restored.hardware
    assert restored.measurements == saved
    with pytest.raises(ValueError):
        app.action("measurement",dict(trial_id="a"*32,amount=20,verified=True,stopping_mm=5))


@pytest.mark.parametrize("route",["E-A","A-B","B-E"])
def test_three_routes_execute_and_stop_but_never_claim_observed_arrival(tmp_path,route):
    app,receiver,clock=rig(tmp_path);app.measurements=measurements()
    app.action("start",dict(request_id="a"*32,route=route,confirmed=True))
    for _ in range(650):
        pulse(app,receiver,clock)
        if not app.job: break
    assert app.state == "sequence_complete", app.message
    assert sum(c["operation"]=="arm" for c in receiver.calls) == 3
    assert not receiver.h["left_duty"] and not receiver.h["right_duty"]
    assert app.status()["arrival_verification"] == "operator"
    app.action("confirm-arrival",{"confirmed":True})
    assert app.state == "operator_confirmed"


@pytest.mark.parametrize("failure",["stop","hidden","presence","boot","epoch","low_battery","expired","external","bad_output","stale","clock_pause"])
def test_failures_stop_and_never_resume(tmp_path,failure):
    app,receiver,clock=rig(tmp_path);start_trial(app);pulse(app,receiver,clock,3)
    assert app.job
    if failure=="stop": app.action("stop",{})
    elif failure=="hidden": app.action("presence",{"active":False})
    elif failure=="presence": app.presence_at=clock[0]-701
    elif failure=="boot": receiver.h["boot_id"]="c"*32
    elif failure=="epoch": receiver.h["epoch_id"]="d"*32
    elif failure=="low_battery": receiver.h["battery_voltage_v"]=6.5
    elif failure=="expired": receiver.h.update(state="expired",left_duty=0,right_duty=0)
    elif failure=="external": receiver.h["route_id"]="c"*32
    elif failure=="bad_output": receiver.h["left_duty"]=-50
    elif failure=="clock_pause": clock[0]+=600
    h=receiver.poll()
    if failure=="stale": h["issued_at_ms"]-=501
    app.tick(h)
    assert not app.job and app.state=="stopped"
    count=len(receiver.calls)
    pulse(app,receiver,clock,10)
    assert len(receiver.calls)==count
    assert app.last_test is None


def test_packet_expiry_cannot_extend_presence_or_segment_deadline(tmp_path):
    app,receiver,clock=rig(tmp_path);start_trial(app);pulse(app,receiver,clock,3)
    deadline=app.job["segment"]["deadline"]
    for _ in range(10):
        pulse(app,receiver,clock)
        for call in receiver.calls:
            if call["operation"]=="drive":
                assert call["now"]+call["lease"] <= deadline
                assert call["lease"] <= 500
    assert app.state=="trial_complete"


def test_unacknowledged_motion_cannot_create_measurement(tmp_path):
    app,receiver,clock=rig(tmp_path);start_trial(app);pulse(app,receiver,clock,2)
    for _ in range(8):
        receiver.h.update(state="interlock",left_duty=0,right_duty=0)
        pulse(app,receiver,clock)
    assert app.state=="stopped" and app.last_test is None


def test_local_http_mutations_require_exact_origin_host_and_session(tmp_path):
    app, receiver, clock = rig(tmp_path)
    cls = handler_for(app)
    handler = object.__new__(cls)
    replies = []
    handler.reply = lambda code, body: replies.append(code)
    valid = {"Host":"127.0.0.1:8765", "Origin":"http://127.0.0.1:8765", "X-AMR-Session":app.session}
    for changed in ({"Host":"evil.example"}, {"Origin":"https://evil.example"},
                    {"X-AMR-Session":"wrong"}, {"Origin":"null"}):
        handler.headers = {**valid, **changed}
        assert not handler.allowed(mutation=True)
        assert replies[-1] == 403
    handler.headers = valid
    assert handler.allowed(mutation=True)
    assert not receiver.calls


def test_forward_roll_cannot_exceed_total_measured_travel(tmp_path):
    app, receiver, clock = rig(tmp_path)
    start_trial(app); pulse(app, receiver, clock, 20)
    with pytest.raises(ValueError, match="rate"):
        app.action("measurement", dict(trial_id="a"*32,amount=5,stopping_mm=10,verified=True))
    assert not app.measurements["samples"]
