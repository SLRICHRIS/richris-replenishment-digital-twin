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
        assert max(abs(left), abs(right)) <= 200
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


def start_trial(app, direction="forward", id="a"*32, pwm=50):
    app.action("trial", dict(request_id=id, motion=direction, pwm=pwm, confirmed=True))


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


@pytest.mark.parametrize("voltage", [6.21, 6.01])
def test_requested_six_volt_cutoff_allows_acknowledged_trial_above_boundary(tmp_path, voltage):
    app, receiver, clock = rig(tmp_path)
    receiver.h["battery_voltage_v"] = voltage
    app.tick(receiver.poll())
    assert app.status()["min_voltage_v"] == 6.0 and app.status()["ready"]
    start_trial(app)
    pulse(app, receiver, clock, 20)
    assert app.state == "trial_complete" and app.last_stop is None
    app.action("measurement", dict(trial_id="a"*32, amount=20, verified=True, stopping_mm=5))
    assert app.measurements["samples"]["forward"]["voltage_v"] == voltage


@pytest.mark.parametrize("failure, expected", [
    ("receiver", "ESP32 reported not ready"),
    ("voltage", "5.99 V, below the 6.00 V"),
    ("missing_battery", "battery reading is unavailable"),
    ("stale", "age 501 ms"),
])
def test_stop_preserves_exact_failing_feedback_after_live_readings_recover(tmp_path, failure, expected):
    app, receiver, clock = rig(tmp_path)
    start_trial(app)
    pulse(app, receiver, clock, 3)
    failed = receiver.poll()
    if failure == "receiver":
        failed.update(ready=False, state="unavailable")
    elif failure == "voltage":
        failed.update(battery_voltage_v=5.99, ready=False)
    elif failure == "missing_battery":
        failed.update(battery_voltage_v=0, ready=False)
    else:
        failed["issued_at_ms"] -= 501
    app.tick(failed)
    assert app.state == "stopped" and not app.job and app.last_test is None
    assert expected in app.status()["message"]
    captured = app.status()["last_stop"]
    assert captured["hardware"]["issued_at_ms"] == failed["issued_at_ms"]
    assert captured["hardware"]["battery_voltage_v"] == failed["battery_voltage_v"]
    assert captured["hardware"]["ready"] == failed["ready"]
    assert captured["phase"] == "moving"
    count = len(receiver.calls)
    pulse(app, receiver, clock, 10)
    assert app.status()["ready"] and len(receiver.calls) == count
    assert app.status()["last_stop"] == captured
    assert expected in app.status()["message"]
    app.hardware_error = "A later connection error"
    assert expected in app.status()["message"]
    app.hardware_error = ""
    events = [json.loads(line) for line in (tmp_path/"preset_audit.jsonl").read_text().splitlines()]
    assert events[-1]["stop_details"] == captured
    public = app.status()
    public["last_stop"]["hardware"]["ready"] = "changed by caller"
    assert app.status()["last_stop"] == captured
    start_trial(app, id="d"*32)
    assert app.status()["last_stop"] is None


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


def test_200_pwm_measurements_are_used_for_each_route_step_without_scaling_old_rates(tmp_path):
    app, receiver, clock = rig(tmp_path)
    assert app.status()["max_pwm"] == 200 and app.status()["min_voltage_v"] == 6.0
    for direction, identity in zip(("forward", "left", "right"), ("a", "b", "c")):
        start_trial(app, direction, id=identity*32, pwm=200)
        pulse(app, receiver, clock, 20)
        assert app.state == "trial_complete"
        app.action("measurement", dict(trial_id=identity*32, amount=25 if direction == "forward" else 30,
                                       stopping_mm=5, verified=True))
    restored = PresetController(receiver, tmp_path, clock=lambda:clock[0])
    assert all(s["pwm"] == 200 for s in restored.measurements["samples"].values())
    app.action("start", dict(request_id="d"*32, route="E-A", confirmed=True))
    for _ in range(650):
        pulse(app, receiver, clock)
        if not app.job:
            break
    assert app.state == "sequence_complete", app.message
    assert {(c["left"], c["right"]) for c in receiver.calls if c["operation"] == "drive"} == {
        (200, 200), (-200, 200), (200, -200)}
    assert receiver.h["left_duty"] == receiver.h["right_duty"] == 0
    assert all(step["pwm"] == 50 for step in timed_plan("E-A", measurements(), 7.3)["steps"])


@pytest.mark.parametrize("pwm", [0, 201, 255, True])
def test_preset_rejects_trial_and_saved_rates_outside_200_pwm_limit(tmp_path, pwm):
    app, receiver, clock = rig(tmp_path)
    with pytest.raises(ValueError, match="PWM"):
        start_trial(app, pwm=pwm)
    m = measurements()
    m["samples"]["forward"]["pwm"] = pwm
    with pytest.raises(ValueError, match="PWM"):
        timed_plan("E-A", m, 7.3)
    assert not receiver.calls


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
    elif failure=="low_battery": receiver.h["battery_voltage_v"]=5.99
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


@pytest.mark.parametrize("transit_ms", [40, 70, 110])
def test_delayed_http_does_not_send_expired_renewals_at_end_of_pulse(tmp_path, transit_ms):
    # The real receiver rejects an expired packet, including a Stop after the
    # prior lease already disarmed it. Reproduce with virtual HTTP transit.
    clock = [10000]

    class DelayedReceiver(Receiver):
        rejected = 0

        def send(self, observed, route, seq, operation, left, right, now, *, lease_ms=500):
            clock[0] += transit_ms
            if self.h["state"] in ("armed", "moving") and clock[0] >= self.expiry:
                self.h.update(state="expired", left_duty=0, right_duty=0)
            if now+lease_ms <= clock[0] or (operation != "arm" and self.h["state"] == "expired"):
                self.rejected += 1
                raise ValueError("ESP32 returned HTTP 409; check the local receiver")
            return super().send(observed, route, seq, operation, left, right, now, lease_ms=lease_ms)

    receiver = DelayedReceiver(clock)
    app = PresetController(receiver, tmp_path, clock=lambda:clock[0])
    app.action("connect", {})
    app.action("presence", {"active":True})
    app.tick(receiver.poll())
    start_trial(app)
    pulse(app, receiver, clock, 25)
    assert app.state == "trial_complete", app.message
    assert receiver.rejected == 0
    assert receiver.h["state"] == "expired"
    assert receiver.h["left_duty"] == receiver.h["right_duty"] == 0


def finishing_trial(tmp_path):
    app, receiver, clock = rig(tmp_path)
    start_trial(app)
    for _ in range(10):
        pulse(app, receiver, clock)
        if app.job["segment"]["phase"] == "finishing":
            return app, receiver, clock
    pytest.fail("Final bounded command was not accepted")


@pytest.mark.parametrize("failure", ["stop", "hidden", "presence", "not_ready", "external_stop", "bad_output"])
def test_final_lease_still_obeys_cancellation_and_receiver_guards(tmp_path, failure):
    app, receiver, clock = finishing_trial(tmp_path)
    if failure == "stop": app.action("stop", {})
    elif failure == "hidden": app.action("presence", {"active":False})
    elif failure == "presence": app.presence_at = clock[0]-701
    elif failure == "not_ready": receiver.h["ready"] = False
    elif failure == "external_stop": receiver.h.update(state="stopped", left_duty=0, right_duty=0)
    elif failure == "bad_output": receiver.h["left_duty"] = -50
    app.tick(receiver.poll())
    assert app.job is None and app.state == "stopped" and app.last_test is None
    assert receiver.calls[-1]["operation"] == "stop"
    count = len(receiver.calls)
    pulse(app, receiver, clock, 15)
    assert len(receiver.calls) == count  # Never restart the expired/disarmed route.


def test_final_lease_completion_requires_its_sequence_and_actual_zero_outputs(tmp_path):
    app, receiver, clock = finishing_trial(tmp_path)
    final_seq = receiver.calls[-1]["seq"]
    clock[0] = receiver.expiry+1
    app.action("presence", {"active":True})
    h = receiver.poll()
    h["left_duty"] = 50  # MCU guard expired before motor task applied zero.
    app.tick(h)
    assert app.job and app.last_test is None
    h.update(left_duty=0, command_seq=final_seq-1)
    app.tick(h)
    assert app.job and app.last_test is None
    app.tick(receiver.poll())
    assert app.state == "trial_complete" and app.last_test
    assert receiver.calls[-1]["operation"] == "drive"  # No Stop sent to an expired route.


def test_missing_final_acknowledgement_times_out_without_valid_measurement(tmp_path):
    app, receiver, clock = finishing_trial(tmp_path)
    count = len(receiver.calls)
    final_seq = receiver.calls[-1]["seq"]
    for _ in range(20):
        clock[0] += 100
        app.action("presence", {"active":True})
        h = receiver.poll()
        h["command_seq"] = final_seq-1
        app.tick(h)
        if app.job is None:
            break
        assert len(receiver.calls) == count
    assert app.state == "stopped" and app.last_test is None
    assert "final command" in app.message


def test_failed_command_details_survive_the_best_effort_stop(tmp_path):
    app, receiver, clock = rig(tmp_path)
    start_trial(app)
    pulse(app, receiver, clock, 3)
    send = receiver.send

    def reject_drive(*args, **kwargs):
        if args[3] == "drive":
            clock[0] += 70
            raise ValueError("ESP32 returned HTTP 409; check the local receiver")
        return send(*args, **kwargs)

    receiver.send = reject_drive
    pulse(app, receiver, clock)
    command = app.status()["last_stop"]["last_command"]
    assert command["operation"] == "drive" and command["accepted"] is False
    assert command["returned_at_ms"]-command["sent_at_ms"] == 70
    assert command["command_seq"] == app.last_stop["hardware"]["command_seq"]+1
    assert receiver.calls[-1]["operation"] == "stop"
    pulse(app, receiver, clock, 10)
    assert app.last_stop["last_command"] == command


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
