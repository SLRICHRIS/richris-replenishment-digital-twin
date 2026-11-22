"""Offline local-route tests: fake camera/ESP32, never real motor requests."""

import http.client
import io
import json
import math
import threading
import urllib.error
from pathlib import Path

import pytest

from backend_streamlit_and_telemetry.vision_control.browser_camera import Observation
from backend_streamlit_and_telemetry.vision_control.local_transport import DeviceHTTPTransport, NoRedirect
from backend_streamlit_and_telemetry.vision_control.local_twin import LocalTwin, ProcessLock, handler_for
from backend_streamlit_and_telemetry.vision_control.protocol import signed, verified
from http.server import ThreadingHTTPServer

SECRET = "a" * 64
BOOT, EPOCH = "b" * 32, "c" * 32
G = dict(robot_length_mm=60, robot_width_mm=40, robot_height_mm=50,
         wheel_track_mm=100, clearance_mm=10, uncertainty_mm=2,
         stopping_distance_mm=5, tracking_tolerance_mm=20, max_speed_mm_s=10,
         max_angular_rad_s=.6, max_pwm=40, left_pwm_per_mm_s=4,
         right_pwm_per_mm_s=4, minimum_drive_pwm=0, min_pack_voltage_v=6.6,
         left_polarity=1, right_polarity=1)


class Reply:
    status = 200

    def __init__(self, body):
        self.body = body.encode() if isinstance(body, str) else body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, size):
        return self.body[:size]


class Opener:
    def __init__(self):
        self.body = b""
        self.calls = []

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        if isinstance(self.body, Exception):
            raise self.body
        return Reply(self.body)


def heartbeat(stamp=10000, seq=1, epoch=EPOCH, secret=SECRET, duty=0, version="H1"):
    fields = (version, BOOT, epoch, seq, "0" * 32, 0, "idle", duty, 0, 7400, 1, stamp)
    if version == "H2":
        fields += (255,)
    return signed(fields, secret)


def test_transport_has_no_startup_io_and_rejects_replay_wrong_key_and_unsafe_caps():
    clock, opener = [10000], Opener()
    transport = DeviceHTTPTransport(SECRET, opener=opener, clock=lambda: clock[0])
    assert not opener.calls
    opener.body = heartbeat()
    hw = transport.poll()
    assert hw["max_pwm"] == 60 and hw["battery_voltage_v"] == 7.4
    assert opener.calls[0][0].full_url == "http://10.15.213.112/api/route/hardware"
    assert opener.calls[0][1] <= .25
    with pytest.raises(ValueError, match="Repeated"):
        transport.poll()
    for bad in (heartbeat(seq=2, secret="f" * 64), heartbeat(seq=2, duty=61), heartbeat(seq=2, version="H2")):
        opener.body = bad
        with pytest.raises(ValueError):
            transport.poll()
    opener.body = heartbeat(seq=2, epoch="d" * 32)
    transport.poll()
    opener.body = heartbeat(seq=3)
    with pytest.raises(ValueError, match="retired"):
        transport.poll()
    with pytest.raises(ValueError, match="identity"):
        transport.send(hw, "e" * 32, 1, "arm", 0, 0, 10000)


def test_transport_acceptance_does_not_forge_applied_ack_or_allow_stale_motion():
    clock, opener = [10000], Opener()
    transport = DeviceHTTPTransport(SECRET, opener=opener, clock=lambda: clock[0])
    opener.body = heartbeat()
    hw = transport.poll()
    opener.body = b'{"ok":true}'
    transport.send(hw, "e" * 32, 1, "drive", 60, -60, 10000)
    command = verified(opener.calls[-1][0].data, SECRET, 10)
    assert command[5:8] == ["drive", "60", "-60"]
    assert transport.latest["command_seq"] == 0
    with pytest.raises(ValueError, match="limit"):
        transport.send(hw, "e" * 32, 2, "drive", 61, 0, 10000)
    clock[0] = 10501
    with pytest.raises(ValueError, match="Fresh"):
        transport.send(hw, "e" * 32, 3, "drive", 1, 1, 10501)
    transport.send(hw, "e" * 32, 4, "stop", 0, 0, 10501)
    with pytest.raises(ValueError, match="redirect"):
        NoRedirect().redirect_request(None, None, 302, "", {}, "http://elsewhere")


@pytest.mark.parametrize("failure, expected", [
    (TimeoutError("private detail"), "timed out.*150 ms"),
    (urllib.error.URLError(TimeoutError("private detail")), "timed out.*150 ms"),
    (urllib.error.URLError(PermissionError("private detail")), "denied"),
    (urllib.error.URLError(ConnectionRefusedError("private detail")), "Cannot connect.*10.15.213.112:80"),
])
def test_transport_explains_network_fault_without_retrying_or_claiming_route_approval(failure, expected):
    opener = Opener()
    transport = DeviceHTTPTransport(SECRET, opener=opener, clock=lambda: 10000)
    opener.body = heartbeat()
    hw = transport.poll()
    opener.body = failure
    with pytest.raises(ValueError, match=expected) as result:
        transport.send(hw, "e" * 32, 1, "drive", 20, 20, 10000)
    assert len(opener.calls) == 2  # Exactly one send; an uncertain command is never retried.
    assert "private detail" not in str(result.value)
    assert "approve" not in str(result.value)
    assert transport.latest["command_seq"] == 0


def test_transport_distinguishes_http_rejection_and_closes_its_response_body():
    opener = Opener()
    transport = DeviceHTTPTransport(SECRET, opener=opener)
    body = io.BytesIO(b"private receiver detail")
    opener.body = urllib.error.HTTPError("http://10.15.213.112/api/route/hardware",
        503, "Unavailable", {}, body)
    with pytest.raises(ValueError, match="HTTP 503") as result:
        transport.poll()
    assert body.closed and len(opener.calls) == 1
    assert "private receiver detail" not in str(result.value)
    assert transport.latest is None


class FakeTransport:
    def __init__(self):
        self.sent = []
        self.fail = False

    def send(self, *args):
        self.sent.append(args)
        if self.fail:
            raise ValueError("Simulated unavailable receiver")


@pytest.fixture
def rig(tmp_path):
    clock, transport = [10000], FakeTransport()
    twin = LocalTwin(transport, tmp_path, clock=lambda: clock[0])
    assert not transport.sent and not twin.connected
    twin.connected = True  # Offline fixture: deliberately do not call Connect.
    twin.config = {"geometry": G, "resolution": [1280, 720]}
    twin.config_id = "f" * 64

    def observe(stamp, *, x=210, y=180, state="idle", route="0" * 32,
                ack=0, left=0, right=0, valid=True, epoch=EPOCH, acquired=None):
        clock[0] = stamp
        twin.accept_hardware(dict(boot_id=BOOT, epoch_id=epoch, seq=stamp,
            route_id=route, command_seq=ack, state=state, left_duty=left,
            right_duty=right, battery_voltage_v=7.4, ready=True, issued_at_ms=stamp))
        acquired = stamp if acquired is None else acquired
        obs = Observation(acquired, (0, 1, 2, 3, 4), valid, "Fixture",
                          dict(x=x, y=y, heading=math.pi / 2) if valid else None, (), stamp)
        twin.camera_status.update(connected=True, valid=valid, captured_at_ms=acquired, seq=stamp)
        twin.accept_observation(obs, twin.config, twin.config_id, acquired)
        return twin.status()

    for stamp in (9400, 9700, 10000):
        observe(stamp)
    yield twin, clock, transport, observe
    twin.engine.dispose()


def approve(twin, goal=(210, 190)):
    result = twin.mutate("plan", dict(x=goal[0], y=goal[1]))
    rid = result["review"]["review_id"]
    twin.mutate("decision", dict(review_id=rid, decision="approve", reason="Checked the clear measured route"))
    return rid


def test_failed_polls_back_off_after_stopping_and_recovery_never_resumes_motion(rig, monkeypatch):
    twin, clock, transport, observe = rig
    approve(twin, (210, 250))
    outcomes = [False] * 5 + [True, False, True]
    waits, states = [], []
    polls = iter(outcomes)

    def poll():
        if not next(polls):
            raise ValueError("ESP32 request timed out")
        return dict(twin.hardware, seq=clock[0], issued_at_ms=clock[0])

    class ControlledWait:
        def is_set(self):
            return len(waits) == len(outcomes)

        def wait(self, delay):
            waits.append(delay)
            states.append((twin.hardware_ok, twin.agent.state, len(transport.sent)))
            clock[0] += round(delay * 1000)
            return self.is_set()

    monkeypatch.setattr(transport, "poll", poll, raising=False)
    monkeypatch.setattr(twin, "stop_event", ControlledWait())
    twin._hardware_loop()

    assert states[0] == (False, "blocked", 2)  # Stop is attempted before the first retry wait.
    assert all(.25 <= delay <= 2 for delay in waits[:5])
    assert waits[:5] == sorted(waits[:5]) and sum(waits[:5]) >= 5
    assert waits[5] == waits[7] == .08  # Successful observations restore the existing cadence.
    assert waits[6] == waits[0]  # A recovered connection resets its retry pause.
    assert [state[0] for state in states] == outcomes
    assert all(state[1] == "blocked" for state in states)
    assert [call[3] for call in transport.sent] == ["arm", "stop"]
    assert twin.agent.lease_until == 0 and not twin.pending_acks
    assert not twin.status()["ready"]  # The camera evidence has independently expired.


def test_local_review_arms_only_after_explicit_approval_and_stops_on_presence_loss(rig):
    twin, clock, transport, observe = rig
    assert twin.status()["ready"]
    plan = twin.mutate("plan", dict(x=210, y=250))
    assert not transport.sent
    twin.mutate("decision", dict(review_id=plan["review"]["review_id"], decision="reject", reason="Wait"))
    assert not transport.sent
    rid = approve(twin, (210, 250))
    assert [call[3] for call in transport.sent] == ["arm"]
    assert transport.sent[0][4:6] == (0, 0)
    observe(10050, state="armed", route=rid, ack=1)
    assert twin.agent.state == "running"
    twin.supervise()
    observe(10100, state="armed", route=rid, ack=1)
    assert transport.sent[-1][3] == "drive" and any(transport.sent[-1][4:6])
    twin.mutate("presence", {"active": False})
    assert twin.agent.state == "blocked" and transport.sent[-1][3] == "stop"
    assert twin.owner not in twin.coordinator.presence
    previous = len(transport.sent)
    observe(10200, state="stopped", route=rid, ack=transport.sent[-1][2])
    twin.presence(True)
    twin.supervise()
    assert len(transport.sent) == previous  # No auto-resume after returning.


def test_reconnect_and_stop_retire_both_running_and_pending_reviews(rig):
    twin, clock, transport, observe = rig
    rid = approve(twin)
    twin.mutate("connect", {})
    assert twin.agent.state == "blocked" and transport.sent[-1][3] == "stop"
    assert twin.status()["review"]["state"] not in ("pending", "sent", "arming", "running")
    old_count = len(transport.sent)
    twin.presence(True)
    observe(10100, state="stopped", route=rid, ack=transport.sent[-1][2])
    twin.supervise()
    assert len(transport.sent) == old_count
    pending = twin.mutate("plan", {"x": 210, "y": 250})
    twin.stop()
    assert twin.status()["review"]["state"] == "cancelled"
    with pytest.raises(ValueError, match="pending"):
        twin.mutate("decision", dict(review_id=pending["review"]["review_id"], decision="approve", reason="Old preview"))


def test_laptop_restart_seeds_command_sequence_from_signed_receiver_state(rig):
    twin, clock, transport, observe = rig
    observe(10001, ack=42)
    approve(twin)
    assert transport.sent[0][2:4] == (43, "arm")


def test_dispatch_failure_attempts_stop_and_never_retries_approval(rig):
    twin, clock, transport, observe = rig
    transport.fail = True
    with pytest.raises(ValueError, match="Dispatch failed"):
        approve(twin)
    assert [item[3] for item in transport.sent] == ["arm", "stop"]
    assert twin.agent.state == "blocked" and twin.agent.lease_until == 0
    assert twin.status()["review"]["state"] == "uncertain"
    twin.supervise()
    assert len(transport.sent) == 2


@pytest.mark.parametrize("fault", ["camera", "hardware", "presence", "ack", "identity"])
def test_independent_watchdog_stops_without_a_new_camera_callback(rig, fault):
    twin, clock, transport, observe = rig
    rid = approve(twin, (210, 250))
    clock[0] = 10600
    twin.last_processed_at = clock[0]
    twin.hardware["issued_at_ms"] = clock[0]
    twin.coordinator.touch(twin.owner)
    if fault == "camera":
        twin.last_processed_at = 10000
    elif fault == "hardware":
        twin.hardware_ok = False
    elif fault == "presence":
        twin.coordinator.presence[twin.owner] = 0
    elif fault == "identity":
        twin.accept_hardware(dict(twin.hardware, epoch_id="d" * 32))
    # The ACK case retains the unacknowledged arm at t=10000.
    twin.supervise()
    assert twin.agent.state == "blocked"
    assert transport.sent[-1][3] == "stop"
    assert twin.agent.lease_until == 0


def test_failed_stop_retires_approval_and_stale_scene_pose_is_not_shown(rig):
    twin, clock, transport, observe = rig
    approve(twin)
    transport.fail = True
    twin.stop()
    assert twin.agent.state == "blocked" and twin.agent.lease_until == 0
    clock[0] += 600
    twin.camera_status.update(captured_at_ms=clock[0], valid=True)
    public = twin.status()
    assert public["scene"]["pose"] is None and public["scene"]["valid"] is False
    assert public["scene"]["age_ms"] == 600 and not public["ready"]


def test_acquisition_age_not_processing_time_controls_route_readiness(rig):
    twin, clock, transport, observe = rig
    approve(twin)
    observe(10600, acquired=10000)
    assert twin.agent.state == "blocked"
    assert not twin.status()["ready"]


def test_camera_route_arrival_requires_new_observations_and_signed_output_ack(rig):
    twin, clock, transport, observe = rig
    rid = approve(twin)
    observe(10050, route=rid, state="armed", ack=1)
    twin.supervise()
    observe(10100, x=210, y=190, route=rid, state="armed", ack=1)
    assert twin.agent.state == "stopping"
    stop_seq = transport.sent[-1][2]
    assert twin.status()["review"]["state"] == "stopping"
    for stamp in (10200, 10400, 10600, 10800, 11000):
        twin.presence(True)
        observe(stamp, x=210, y=190, route=rid, state="stopped", ack=stop_seq)
        twin.supervise()
    assert twin.agent.state == "verified"
    assert twin.status()["review"]["state"] == "verified"
    assert all(call[3] in ("arm", "stop") for call in transport.sent)


def test_profile_template_never_claims_measurement_and_calibration_invalidates_old_scene(rig):
    twin, clock, transport, observe = rig
    profile = twin.profile()
    assert not any(profile["template"]["checks"].values())
    assert profile["template"]["floor_reference_positions_mm"]["1"] == [None, None]
    twin.calibration("checkerboard", {})
    assert twin.config is None and not twin.status()["calibration_ready"]
    assert twin.coordinator.current is None
    assert twin.feed.calibration_request
    assert not transport.sent


@pytest.mark.parametrize("captured_at", [None, 0])
def test_camera_without_a_capture_has_no_age_and_cannot_be_ready(tmp_path, captured_at):
    transport = FakeTransport()
    twin = LocalTwin(transport, tmp_path, clock=lambda: 1795338640100)
    try:
        twin.camera_status.update(captured_at_ms=captured_at, valid=True)
        public = twin.status()
        assert public["camera"]["age_ms"] is None
        assert not public["camera"]["valid"] and public["camera"]["pose"] is None
        assert not public["ready"] and not transport.sent
        twin.camera_status.update(captured_at_ms=1795338640000)
        assert twin.status()["camera"]["age_ms"] == 100
        twin.camera_status.update(captured_at_ms=1795338639500, valid=True)
        public = twin.status()
        assert public["camera"]["age_ms"] == 600 and not public["camera"]["valid"]
    finally:
        twin.engine.dispose()


def test_loopback_http_origin_csrf_and_host_guards_without_camera_or_device_io(tmp_path, monkeypatch):
    read_text = Path.read_text

    def windows_default_read(path, encoding=None, errors=None):
        return read_text(path, encoding=encoding or "cp1252", errors=errors)

    monkeypatch.setattr(Path, "read_text", windows_default_read)
    transport = FakeTransport()
    twin = LocalTwin(transport, tmp_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(twin))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(method, path, payload=None, **headers):
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
        base = {"Host": "127.0.0.1:8765"}
        base.update(headers)
        body = json.dumps(payload) if payload is not None else None
        connection.request(method, path, body=body, headers=base)
        response = connection.getresponse()
        result = response.status, response.read(), response.getheaders()
        connection.close()
        return result

    try:
        code, body, headers = request("GET", "/")
        assert code == 200 and twin.session.encode() in body
        assert b"__AMR_SESSION" not in body
        html = body.decode("utf-8")
        assert "AMR-01 · Local camera mission" in html
        assert "610 × 630 mm" in html
        assert "Â" not in html and "â€" not in html
        assert ("Content-Type", "text/html; charset=utf-8") in headers
        assert not any(k.lower() == "access-control-allow-origin" for k, _ in headers)
        csp = next(value for name, value in headers if name.lower() == "content-security-policy")
        assert "frame-ancestors 'self'" in csp and "https://richris-replenishment-digital-twin-s99b4letmnfusbbh6sjab9.streamlit.app" in csp
        assert request("GET", "/api/status", Host="attacker.example")[0] == 403
        assert request("POST", "/api/presence", {})[0] == 403
        proper = {"Origin": "http://127.0.0.1:8765", "X-AMR-Session": twin.session, "Content-Type": "application/json"}
        assert request("POST", "/api/presence", {}, **dict(proper, Origin="https://attacker.example"))[0] == 403
        assert request("POST", "/api/presence", {}, **dict(proper, **{"X-AMR-Session": "bad"}))[0] == 403
        assert request("POST", "/api/presence", {"active": True}, **proper)[0] == 200
        assert request("GET", "/api/frame.jpg")[0] == 204
        assert request("GET", "/api/camera-profile")[0] == 200
        assert request("POST", "/api/plan", {"x": 100, "y": 100}, **proper)[0] == 409
        assert not transport.sent and not twin.connected and not twin.threads
    finally:
        server.shutdown()
        server.server_close()
        thread.join(1)
        twin.engine.dispose()


def test_single_local_owner_lock(tmp_path):
    with ProcessLock(tmp_path / "owner.lock"):
        with pytest.raises(ValueError, match="already owns"):
            with ProcessLock(tmp_path / "owner.lock"):
                pass


def test_cli_restores_saved_profile_without_connecting_or_arming(tmp_path, monkeypatch):
    from backend_streamlit_and_telemetry.vision_control import local_twin as module

    (tmp_path / "camera_profile.json").write_text("{}")
    (tmp_path / "empty_floor.png").write_bytes(b"fixture")
    restored = []

    class Twin:
        def __init__(self, transport, directory, **kwargs):
            assert transport.latest is None
            self.closed = False

        def restore_profile(self, config, background):
            restored.append((config, background))

        def close(self):
            self.closed = True

    class Server:
        def __init__(self, address, handler):
            assert address == ("127.0.0.1", 8765)

        def serve_forever(self, **kwargs):
            raise KeyboardInterrupt

        def server_close(self):
            pass

    monkeypatch.setenv("AMR_DRIVE_KEY", SECRET)
    monkeypatch.setattr(module, "LocalTwin", Twin)
    monkeypatch.setattr(module, "ThreadingHTTPServer", Server)
    module.main(["--state-dir", str(tmp_path), "--no-browser"])
    assert restored == [(tmp_path / "camera_profile.json", tmp_path / "empty_floor.png")]
