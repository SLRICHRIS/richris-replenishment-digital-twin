"""Three measured-layout timed routes; no camera, automatic obstacle or pose claim.

Commands use the existing signed V1/H1 receiver and its unchanged 60 PWM cap.
Each packet expires by both the attended-input deadline and segment deadline.
Timing is empirical and approximate; only the operator can confirm arrival.
"""
from __future__ import annotations

import argparse
import copy
import hmac
import json
import math
from pathlib import Path
import secrets
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .contracts import fresh, identifier, numeric
from .local_session import ProcessLock, read_route_key
from .local_transport import DeviceHTTPTransport, DEVICE_IP, receiver_ip

HOST, PORT = "127.0.0.1", 8765
PRESENCE_MS = 700
MIN_VOLTAGE = 6.7
STATIONS = {
    "A": {"front_mm": [630, 350], "heading_deg": 0, "facing": "RIGHT"},
    "B": {"front_mm": [205, 430], "heading_deg": 90, "facing": "UP"},
    "E": {"front_mm": [290, 75], "heading_deg": -90, "facing": "DOWN"},
}
PAIRS = {"A-B": ("A", "B"), "E-A": ("E", "A"), "B-E": ("B", "E")}
BODY_LENGTH, BODY_WIDTH = 170, 155
DUTIES = {"forward": (1, 1), "left": (-1, 1), "right": (1, -1)}


def wrap(degrees):
    return (degrees + 180) % 360 - 180


def centre(station):
    x, y = station["front_mm"]
    theta = math.radians(station["heading_deg"])
    return [x - BODY_LENGTH / 2 * math.cos(theta), y - BODY_LENGTH / 2 * math.sin(theta)]


def layout(route_id):
    if route_id not in PAIRS:
        raise ValueError("Choose A to B, E to A, or B to E")
    start, destination = PAIRS[route_id]
    a, b = centre(STATIONS[start]), centre(STATIONS[destination])
    bearing = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    before = wrap(bearing - STATIONS[start]["heading_deg"])
    after = wrap(STATIONS[destination]["heading_deg"] - bearing)
    steps = [dict(motion="left" if before > 0 else "right", amount=abs(before), unit="deg"),
             dict(motion="forward", amount=math.dist(a, b), unit="mm"),
             dict(motion="left" if after > 0 else "right", amount=abs(after), unit="deg")]
    return dict(id=route_id, start=start, destination=destination, start_centre_mm=a,
                goal_centre_mm=b, start_facing=STATIONS[start]["facing"],
                end_facing=STATIONS[destination]["facing"], steps=steps)


def valid_measurements(raw):
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise ValueError("Repeat the three short movement measurements")
    result = {"version": 1, "samples": {}}
    for direction, s in raw.get("samples", {}).items():
        if direction not in DUTIES or not isinstance(s, dict):
            raise ValueError("Invalid movement sample")
        if type(s.get("pwm")) is not int or not 1 <= s["pwm"] <= 60:
            raise ValueError("Measured PWM must be from 1 to 60")
        sample = {"pwm": s["pwm"], "rate": numeric(s.get("rate"), 1, 300, "measured rate"),
                  "voltage_v": numeric(s.get("voltage_v"), MIN_VOLTAGE, 8.5, "sample voltage"),
                  "at_ms": numeric(s.get("at_ms"), 0, 10**14, "sample date")}
        if direction == "forward":
            sample["stopping_mm"] = numeric(s.get("stopping_mm"), 0, 100, "stopping distance")
        result["samples"][direction] = sample
    return result


def timed_plan(route_id, measured, voltage):
    measured = valid_measurements(measured)
    if set(measured["samples"]) != set(DUTIES):
        raise ValueError("Complete forward, left-turn and right-turn measurements first")
    if any(abs(s["voltage_v"] - voltage) > .35 for s in measured["samples"].values()):
        raise ValueError("Battery differs from the measured trials by more than 0.35 V; repeat the trials")
    plan = layout(route_id)
    # A convex rectangle contains the straight segment if both endpoint discs fit.
    # This is nominal swept-body geometry, NOT observed position or obstacle clearance.
    margin = math.hypot(BODY_LENGTH, BODY_WIDTH) / 2 + 20 + measured["samples"]["forward"]["stopping_mm"]
    for x, y in (plan["start_centre_mm"], plan["goal_centre_mm"]):
        if min(x, y, 760-x, 560-y) < margin:
            raise ValueError("Measured stopping distance does not fit this layout; move the paper edge inward")
    for step in plan["steps"]:
        sample = measured["samples"][step["motion"]]
        amount = step["amount"] - (sample["stopping_mm"] if step["motion"] == "forward" else 0)
        step.update(pwm=sample["pwm"], duration_ms=round(1000 * amount / sample["rate"]))
        if not 250 <= step["duration_ms"] <= 30000:
            raise ValueError("Measured speed needs a pulse shorter than 0.25 s or longer than 30 s; use a slower tested setting")
    if sum(s["duration_ms"] for s in plan["steps"]) > 60000:
        raise ValueError("This timed route exceeds the 60 second limit")
    plan["nominal_clearance_mm"] = margin
    return plan


class PresetController:
    def __init__(self, transport, directory, *, clock=None):
        self.transport = transport
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.session = secrets.token_hex(32)
        self.connected = False
        self.hardware = None
        self.hardware_error = ""
        self.presence_at = -10000
        self.cancel = threading.Event()
        self.closed = threading.Event()
        self.job = None
        self.last_test = None
        self.state = "idle"
        self.message = "Connect ESP32. The camera is not used."
        self.used_requests = set()
        self.measurements = {"version": 1, "samples": {}}
        path = self.directory / "preset_measurements.json"
        if path.exists():
            try:
                self.measurements = valid_measurements(json.loads(path.read_text()))
            except (ValueError, TypeError, OSError, KeyError):
                self.message = "Saved movement measurements are invalid; repeat the three trials"

    def ready(self, zero=False):
        h = self.hardware
        return bool(self.connected and not self.hardware_error and h and fresh(h["issued_at_ms"], self.clock())
                    and h["ready"] and h["battery_voltage_v"] >= MIN_VOLTAGE
                    and (not zero or not (h["left_duty"] or h["right_duty"])))

    def status(self):
        with self.lock:
            h = copy.deepcopy(self.hardware)
            if h:
                h["age_ms"] = max(0, self.clock()-h["issued_at_ms"])
            message = self.hardware_error or self.message
            if self.connected and self.state == "idle" and not self.hardware_error:
                if not h:
                    message = "Waiting for the first authenticated ESP32 response"
                elif not fresh(h["issued_at_ms"], self.clock()):
                    message = "ESP32 feedback is out of date; waiting for a fresh sample"
                elif h["battery_voltage_v"] < MIN_VOLTAGE:
                    message = "ESP32 connected; battery is below the 6.7 V movement minimum"
                elif not h["ready"]:
                    message = "ESP32 connected; controller is not ready. Keep the robot still during startup and check its interlocks."
                elif h["left_duty"] or h["right_duty"]:
                    message = "ESP32 connected; wait for zero motor outputs and close other controllers"
                elif set(self.measurements["samples"]) == set(DUTIES):
                    message = "ESP32 connected and ready. Select a route and confirm its starting position."
                else:
                    message = "ESP32 connected and ready. Complete the one-time movement measurements below."
            return dict(state=self.state, message=message,
                        connected=self.connected, ready=self.ready(zero=True), hardware=h,
                        controller_ip=self.transport.device_ip, busy=bool(self.job),
                        measurements=copy.deepcopy(self.measurements), last_test=copy.deepcopy(self.last_test),
                        routes=[layout(r) for r in PAIRS], stations=copy.deepcopy(STATIONS),
                        job=copy.deepcopy(self.job), camera_required=False,
                        arrival_verification="operator", automatic_obstacle_detection=False)

    def _event(self, event, **values):
        record = dict(at_ms=self.clock(), event=event, **values)
        with (self.directory / "preset_audit.jsonl").open("a", encoding="utf-8") as out:
            out.write(json.dumps(record, allow_nan=False) + "\n")

    def _begin(self, payload, *, trial=False):
        if self.job:
            raise ValueError("Stop the current movement first")
        identifier(payload.get("request_id"))
        if payload["request_id"] in self.used_requests:
            raise ValueError("This request already ended; use a new Start action")
        if payload.get("confirmed") is not True:
            raise ValueError("Confirm the clear floor, starting position and direction")
        if not self.ready(zero=True) or self.clock()-self.presence_at > PRESENCE_MS:
            raise ValueError("Keep this page visible and wait for fresh ready ESP32 feedback with zero outputs")
        if trial:
            direction, pwm = payload.get("motion"), payload.get("pwm")
            if direction not in DUTIES or type(pwm) is not int or not 1 <= pwm <= 60:
                raise ValueError("Choose a trial direction and PWM from 1 to 60")
            steps = [dict(motion=direction, pwm=pwm, duration_ms=1000)]
            plan = None
        else:
            plan = timed_plan(payload.get("route"), self.measurements, self.hardware["battery_voltage_v"])
            steps = copy.deepcopy(plan["steps"])
        self.used_requests.add(payload["request_id"])
        self.last_test = None
        self.cancel.clear()
        self.job = dict(request_id=payload["request_id"], kind="trial" if trial else "route",
                        plan=plan, steps=steps, index=0, segment=None, created_at=self.clock(),
                        boot_id=self.hardware["boot_id"], epoch_id=self.hardware["epoch_id"],
                        voltage_v=self.hardware["battery_voltage_v"], last_tick=self.clock())
        self._event("start", kind=self.job["kind"], request_id=payload["request_id"], plan=plan, steps=steps)
        self.state = "running"
        self.message = "Starting one-second measurement" if trial else "Running the selected timed route"

    def action(self, name, payload):
        # Presence/stop must not wait behind a network call holding the state lock.
        if name == "presence":
            if payload.get("active") is not True:
                self.cancel.set()
                self.presence_at = -10000
            else:
                self.presence_at = self.clock()
            return {"ok": True}
        if name == "stop":
            self.cancel.set()
            return {"ok": True}
        with self.lock:
            if name == "connect":
                self.connected = True
                self.message = "Waiting for authenticated ESP32 feedback"
            elif name in ("trial", "start"):
                self._begin(payload, trial=name == "trial")
            elif name == "measurement":
                t = self.last_test
                if not t or t["saved"] or payload.get("trial_id") != t["id"] or self.job:
                    raise ValueError("Finish a fresh one-second trial before saving its result")
                if payload.get("verified") is not True:
                    raise ValueError("Confirm that the robot moved in the requested direction without slipping")
                amount = numeric(payload.get("amount"), 1, 300, "measured distance or angle")
                sample = dict(pwm=t["pwm"], rate=amount, voltage_v=t["voltage_v"], at_ms=self.clock())
                if t["motion"] == "forward":
                    sample["stopping_mm"] = numeric(payload.get("stopping_mm"), 0, 100, "extra stopping distance")
                    sample["rate"] = amount - sample["stopping_mm"]
                updated = copy.deepcopy(self.measurements)
                updated["samples"][t["motion"]] = sample
                updated = valid_measurements(updated)
                path = self.directory / "preset_measurements.json"
                temp = path.with_suffix(".tmp")
                temp.write_text(json.dumps(updated, indent=2), encoding="utf-8")
                temp.replace(path)
                self.measurements = updated
                t["saved"] = True
                self._event("measurement", motion=t["motion"], sample=sample)
                self.message = "Measurement saved. Complete all three directions, then choose a route."
            elif name == "confirm-arrival":
                if self.state != "sequence_complete" or payload.get("confirmed") is not True:
                    raise ValueError("Check the front position after a completed sequence first")
                if not self.ready(zero=True):
                    raise ValueError("Wait for fresh zero-output feedback before confirming arrival")
                self.state = "operator_confirmed"
                self.message = "Arrival confirmed by the operator. E remains a manual charging reference."
                self._event("operator_confirmed_arrival")
            else:
                raise ValueError("Unknown preset controller action")
        return self.status()

    def _send(self, segment, operation, left=0, right=0, deadline=None):
        now = self.clock()
        lease = 500 if operation == "stop" else min(500, self.presence_at+PRESENCE_MS-now,
                                                   (deadline-now) if deadline is not None else 500)
        if operation != "stop" and (self.cancel.is_set() or lease <= 0):
            raise ValueError("Movement permission ended")
        seq = max(segment.get("seq", 0), self.hardware["command_seq"]) + 1
        segment["seq"] = seq
        self.transport.send(self.hardware, segment["id"], seq, operation, left, right, now, lease_ms=int(lease))
        segment["last_sent"] = now
        return seq

    def _abort(self, reason):
        job = self.job
        self.job = None  # Retire first; an exception or reconnect cannot restart it.
        self.last_test = None
        self.state, self.message = "stopped", reason
        if job:
            segment = job.get("segment")
            if segment and self.hardware and all(job[k] == self.hardware[k] for k in ("boot_id", "epoch_id")):
                try:
                    self._send(segment, "stop")
                except Exception:
                    pass  # Every outstanding MCU command expires within 500 ms.
            self._event("stopped", reason=reason, request_id=job["request_id"])

    def _finish_segment(self, now):
        job = self.job
        segment = job["segment"]
        if not segment["confirmed"]:
            raise ValueError("No applied-motion acknowledgement; repeat this trial")
        if job["index"] + 1 < len(job["steps"]):
            segment.update(phase="rest", rest_until=now+500)
            self.message = "Stopped between steps"
            return
        if job["kind"] == "trial":
            step = job["steps"][0]
            self.last_test = dict(id=job["request_id"], motion=step["motion"], pwm=step["pwm"],
                                  voltage_v=job["voltage_v"], saved=False)
            self.state, self.message = "trial_complete", "One-second pulse finished. Measure and enter the actual movement."
        else:
            self.state = "sequence_complete"
            self.message = "Motor sequence finished. Check the robot's front at the paper edge and its final direction."
        self._event(self.state, request_id=job["request_id"])
        self.job = None

    def tick(self, hardware):
        """One authenticated sample advances at most one bounded step; never auto-resumes."""
        with self.lock:
            self.hardware, self.hardware_error = copy.deepcopy(hardware), ""
            now = self.clock()
            job = self.job
            if not job:
                return
            try:
                if self.cancel.is_set() or now-self.presence_at > PRESENCE_MS:
                    raise ValueError("Stopped: operator left the page or requested Stop")
                if any(job[k] != hardware[k] for k in ("boot_id", "epoch_id")):
                    raise ValueError("Controller restarted or reconnected; reposition before starting again")
                if not self.ready():
                    raise ValueError("Stopped: feedback expired, receiver is not ready, or battery is low")
                if now-job["created_at"] > 75000:
                    raise ValueError("Timed route exceeded its overall limit")
                if now < job["last_tick"] or now-job["last_tick"] > 500:
                    raise ValueError("Control timing was interrupted; repeat from the starting position")
                job["last_tick"] = now
                segment = job["segment"]
                step = job["steps"][job["index"]]
                if segment is None:
                    if hardware["left_duty"] or hardware["right_duty"]:
                        raise ValueError("Other motor output detected; close the other controller")
                    segment = job["segment"] = dict(id=secrets.token_hex(16), phase="arming", since=now,
                                                     confirmed=False, last_sent=0)
                    segment["arm_seq"] = self._send(segment, "arm")
                    return
                same = hardware["route_id"] == segment["id"]
                if not same:
                    if segment["phase"] == "arming" and now-segment["since"] < 500:
                        return
                    raise ValueError("Another controller owns the motors; route ended")
                if hardware["command_seq"] > segment["seq"]:
                    raise ValueError("Unexpected controller command; route ended")
                if segment["phase"] == "arming":
                    if now-segment["since"] > 1000:
                        raise ValueError("Controller did not acknowledge arming")
                    if hardware["state"] == "armed" and hardware["command_seq"] >= segment["arm_seq"]:
                        # The receiver can insert its 150 ms reversal interlock.
                        # Estimate onset from the signed zero/moving sample bracket;
                        # do not count the whole arming/interlock delay as travel.
                        segment.update(phase="moving", deadline=now+step["duration_ms"]+500,
                                       started_at=now, last_zero_stamp=now)
                        left, right = DUTIES[step["motion"]]
                        segment["first_drive"] = self._send(segment, "drive", left*step["pwm"], right*step["pwm"], segment["deadline"])
                        self.message = f"Step {job['index']+1}: {step['motion']} ({step['duration_ms']/1000:.2f} s)"
                    return
                if segment["phase"] == "rest":
                    if hardware["left_duty"] or hardware["right_duty"]:
                        raise ValueError("Unexpected motion between steps")
                    if now >= segment["rest_until"]:
                        job["index"] += 1
                        job["segment"] = None
                    return
                left, right = (v*step["pwm"] for v in DUTIES[step["motion"]])
                if hardware["state"] == "moving" and hardware["command_seq"] >= segment["first_drive"]:
                    if (hardware["left_duty"], hardware["right_duty"]) != (left, right):
                        raise ValueError("Applied wheel output differs from the selected step")
                    if not segment["confirmed"]:
                        onset = (segment["last_zero_stamp"] + max(segment["last_zero_stamp"], hardware["issued_at_ms"])) // 2
                        segment["deadline"] = onset + step["duration_ms"]
                        segment["onset_uncertainty_ms"] = max(0, hardware["issued_at_ms"]-segment["last_zero_stamp"])
                        segment["confirmed"] = True
                elif not segment["confirmed"] and not (hardware["left_duty"] or hardware["right_duty"]):
                    segment["last_zero_stamp"] = max(segment["last_zero_stamp"], hardware["issued_at_ms"])
                if segment["phase"] == "stopping":
                    if not (hardware["left_duty"] or hardware["right_duty"]) and hardware["state"] in ("stopped", "expired"):
                        self._finish_segment(now)
                    elif now-segment["stop_at"] > 1000:
                        raise ValueError("No signed zero-output acknowledgement")
                    return
                if now >= segment["deadline"]:
                    segment.update(phase="stopping", stop_at=now)
                    if hardware["state"] in ("armed", "moving", "interlock"):
                        self._send(segment, "stop")
                    elif hardware["state"] == "expired" and not (hardware["left_duty"] or hardware["right_duty"]):
                        self._finish_segment(now)
                    else:
                        raise ValueError("Controller stopped unexpectedly; route ended")
                    return
                if hardware["state"] not in ("armed", "moving", "interlock"):
                    raise ValueError("Motor command expired or was stopped early; reposition before restarting")
                if not segment["confirmed"] and now-segment["started_at"] > 500:
                    raise ValueError("No applied-motion feedback within 500 ms")
                self._send(segment, "drive", left, right, segment["deadline"])
            except Exception as error:
                self._abort(str(error)[:180])

    def run(self):
        while not self.closed.wait(.04):
            if not self.connected:
                continue
            try:
                self.tick(self.transport.poll())
            except Exception as error:
                with self.lock:
                    self.hardware_error = str(error)[:180]
                    if self.job:
                        self._abort("Wi-Fi or authenticated feedback failed; reposition before restarting")
                self.closed.wait(.25)

    def close(self):
        self.cancel.set()
        self.closed.set()
        with self.lock:
            self._abort("Preset controller closed")
            self.connected = False


def handler_for(controller):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, code, body, content_type="application/json"):
            if not isinstance(body, bytes):
                body = json.dumps(body, allow_nan=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; connect-src 'self'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def allowed(self, mutation=False):
            host = self.headers.get("Host", "")
            allowed = host in {"127.0.0.1:8765", "localhost:8765"}
            if mutation:
                allowed = allowed and self.headers.get("Origin") == "http://"+host and hmac.compare_digest(
                    self.headers.get("X-AMR-Session", ""), controller.session)
            if not allowed:
                self.reply(403, {"error": "Use the local preset controller page"})
            return allowed

        def do_GET(self):
            if not self.allowed():
                return
            if self.path == "/":
                html = Path(__file__).with_name("preset_routes.html").read_text(encoding="utf-8")
                self.reply(200, html.replace("__AMR_SESSION__", controller.session).encode(), "text/html; charset=utf-8")
            elif self.path == "/api/status":
                self.reply(200, controller.status())
            else:
                self.reply(404, {"error": "Unknown endpoint"})

        def do_POST(self):
            if not self.allowed(mutation=True):
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096 or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("Expected a small JSON action")
                self.connection.settimeout(1)
                def invalid(_value):
                    raise ValueError("Non-finite input")
                value = json.loads(self.rfile.read(length), parse_constant=invalid)
                if not self.path.startswith("/api/") or not isinstance(value, dict):
                    raise ValueError("Invalid action")
                self.reply(200, controller.action(self.path[5:], value))
            except (ValueError, TypeError, KeyError) as error:
                self.reply(409, {"error": str(error)[:200]})
            except Exception:
                controller.cancel.set()
                self.reply(500, {"error": "Request failed; movement has been cancelled"})
    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device-ip", type=receiver_ip, default=DEVICE_IP)
    parser.add_argument("--state-dir", default=str(Path.home()/".amr-local-twin"))
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)
    try:
        secret = read_route_key()
    except ValueError as error:
        parser.error(str(error))
    if secret is None:
        return
    directory = Path(args.state_dir).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with ProcessLock(directory / "controller.lock"):
        controller = PresetController(DeviceHTTPTransport(secret, device_ip=args.device_ip), directory)
        server = ThreadingHTTPServer((HOST, PORT), handler_for(controller))
        server.daemon_threads = True
        worker = threading.Thread(target=controller.run, daemon=True)
        worker.start()
        print("AMR three-route controller: http://127.0.0.1:8765")
        print("Close other motor controllers. Connect in the page; startup never moves the robot.")
        if not args.no_browser:
            webbrowser.open("http://127.0.0.1:8765")
        try:
            server.serve_forever(poll_interval=.2)
        except KeyboardInterrupt:
            pass
        finally:
            controller.close()
            server.server_close()
            worker.join(timeout=1)


if __name__ == "__main__":
    main()
