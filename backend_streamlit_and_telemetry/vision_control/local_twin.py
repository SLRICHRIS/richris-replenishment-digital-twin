"""Laptop-only camera twin, explicit route review and direct ESP32 HTTP control.

The HTTP server listens on loopback only. Starting it never opens a camera or
contacts the robot; Connect and approval are separate user gestures.
"""

from __future__ import annotations

import argparse
import copy
import getpass
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
import uuid
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
from sqlalchemy import create_engine

from .agent import Agent
from .battery_policy import battery_action
from .browser_camera import BrowserCameraFeed
from .camera import CHECKS, load_config
from .contracts import (HEIGHT, WIDTH, OPERATOR_PRESENCE_MS, SCENE_FRESH_MS,
                        SCENE_VERSION, key, scene, seal)
from .coordinator import ACTIVE, Coordinator, metadata
from .local_transport import DeviceHTTPTransport, DEVICE_IP, ROUTE_PWM_CAP, receiver_ip
from .mission import Mission
from .local_session import ProcessLock, normalize_route_key, read_route_key

HOST, PORT = "127.0.0.1", 8765
ALLOWED_HOSTS = {"127.0.0.1:8765", "localhost:8765"}
FRAME_ANCESTORS = ("frame-ancestors 'self' "
    "https://richris-replenishment-digital-twin-s99b4letmnfusbbh6sjab9.streamlit.app")
RUNNING = {"arming", "running", "battery_review", "stopping"}


class LocalTwin:
    def __init__(self, transport, state_dir, *, clock=None, feed=None, engine=None,
                 camera_index=0, capture_factory=None):
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.transport = transport
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.capture_lock = threading.Lock()
        self.stop_event = threading.Event()
        self.feed = feed or BrowserCameraFeed()
        self.capture_factory = capture_factory or cv2.VideoCapture
        self.camera_index = camera_index
        self.session = secrets.token_hex(32)
        self.owner, self.boot = uuid.uuid4().hex, uuid.uuid4().hex
        self._approval_key = secrets.token_hex(32)
        self.engine = engine or create_engine(
            "sqlite:///" + str(self.state_dir / "route_audit.sqlite3"),
            connect_args={"check_same_thread": False},
        )
        metadata.create_all(self.engine)
        self.agent = Agent(self._approval_key, self._send, battery_mode="mission")
        self.coordinator = Coordinator(self.engine, self._approval_key, self._publish, self.clock, battery_mode="mission")
        self.connected = False
        self.reason = "Connect the laptop camera and local ESP32 to begin"
        self.hardware = None
        self.hardware_ok = False
        self.hardware_error = ""
        self.camera_status = self.feed.snapshot()
        self.capture = None
        self.latest_frame = None
        self.last_processed_at = 0
        self.jpeg = None
        self.config = None
        self.config_id = None
        self.calibrating = False
        self.scene_seq = 0
        self.pending_acks = deque()
        self.threads = []
        self.mission = Mission(self)

    def _publish(self, packet):
        try:
            # ESP32 replay state survives a laptop restart within its boot/epoch.
            # Seed a new route from authenticated H1, never browser input.
            if self.agent.state not in RUNNING and self.hardware:
                self.agent.seq = max(self.agent.seq, self.hardware.get("command_seq", 0))
            self.agent.request(packet, self.clock())
        except Exception:
            self._halt("Execution request failed; approve a new route")
            raise

    def _send(self, hardware, route, seq, operation, left, right, now):
        self.transport.send(hardware, route, seq, operation, left, right, now)
        self.pending_acks.append((seq, now))

    def _halt(self, reason, cause="system_fault"):
        """Always retire approval, including when even the stop request fails."""
        try:
            self.agent.halt(reason, self.clock(), cause=cause)
        except Exception:
            pass  # The ESP32's expiring lease remains the final local stop.
        finally:
            self.agent.state = "blocked"
            self.agent.reason = reason
            self.agent.stop_cause = cause
            self.agent.lease_until = 0
            self.pending_acks.clear()
            self.coordinator.status(self.agent.status(self.clock()))
            self.mission.cancel(reason)

    def connect(self, camera=None):
        with self.lock:
            if self.connected:
                self.stop("New operator connection; capture and approve a fresh route")
                return
            camera = self.camera_index if camera is None else camera
            if type(camera) is not int or not 0 <= camera <= 20:
                raise ValueError("Choose a camera index from 0 to 20")
            self.camera_index = camera
            self.connected = True
            self.reason = "Opening the local camera and waiting for authenticated ESP32 feedback"
            # No route is armed here. Camera and device access begin only now.
            for name, target in (("capture", self._capture_loop), ("camera", self._process_loop),
                                 ("receiver", self._hardware_loop), ("watchdog", self._watchdog_loop)):
                thread = threading.Thread(target=target, daemon=True, name="amr-local-" + name)
                self.threads.append(thread)
                thread.start()

    def presence(self, active=True):
        with self.lock:
            if active:
                self.coordinator.touch(self.owner)
            else:
                self.stop("Operator left the local controller")

    def stop(self, reason="Operator requested stop"):
        with self.lock:
            self._halt(reason, cause="explicit_stop")
            self.coordinator.cancel(self.owner)
            if self.coordinator.row and self.coordinator.row["state"] == "pending":
                self.coordinator.row.update(state="cancelled", reason=reason)
                self.coordinator.save()

    def _hardware_value(self, now):
        value = copy.deepcopy(self.hardware) if self.hardware else dict(
            boot_id="0" * 32, epoch_id="0" * 32, ready=False,
            battery_voltage_v=0, left_duty=0, right_duty=0, issued_at_ms=0,
            command_seq=0, route_id="0" * 32, state="unavailable", seq=0,
        )
        value["age_ms"] = min(600000, max(0, now - value["issued_at_ms"]))
        value["ready"] = bool(value["ready"] and self.hardware_ok and value["age_ms"] <= SCENE_FRESH_MS)
        if self.config and value["battery_voltage_v"] <= self.config["geometry"]["min_pack_voltage_v"]:
            value["ready"] = False
        if value["battery_voltage_v"] < 6.7:
            value["ready"] = False
        return value

    def accept_hardware(self, value):
        """Only the authenticated transport supplies this value (also mockable)."""
        with self.lock:
            if self.hardware and any(value[k] != self.hardware[k] for k in ("boot_id", "epoch_id")):
                self._halt("ESP32 boot or connection epoch changed; approve a new route")
                self.coordinator.current = None
                self.coordinator.history.clear()
            self.hardware = copy.deepcopy(value)
            self.hardware_ok = True
            self.hardware_error = ""
            if self.agent.job and value.get("route_id") == self.agent.job["review_id"]:
                while self.pending_acks and self.pending_acks[0][0] <= value.get("command_seq", 0):
                    self.pending_acks.popleft()

    def accept_observation(self, observation, config, config_id, captured_at):
        """Build trusted evidence from a local camera observation, never browser X/Y."""
        with self.lock:
            if self.calibrating or config_id != self.config_id:
                return
            now = self.clock()
            self.last_processed_at = captured_at
            self.scene_seq += 1
            valid = bool(observation.valid and 0 <= now - captured_at <= 400 and not self.calibrating)
            value = scene(dict(version=SCENE_VERSION, floor_width_mm=WIDTH, floor_length_mm=HEIGHT,
                robot_id="amr01", agent_boot_id=self.boot, config_id=config_id, seq=self.scene_seq,
                captured_at_ms=captured_at, valid=valid, reason=observation.reason,
                pose=observation.pose if valid else None,
                obstacles=list(observation.obstacles), geometry=config["geometry"],
                hardware=self._hardware_value(now)))
            self.coordinator.connected = self.connected and self.hardware_ok and not self.calibrating
            self.coordinator.observe(seal("scene", value, self._approval_key))
            try:
                self.agent.tick(value, now)
            except Exception:
                self._halt("Local route processing failed; approve a new route")
            self.coordinator.status(self.agent.status(now))
            self.mission.tick()

    def supervise(self):
        """Never acquire the camera/feed lock: stalled capture cannot stall stopping."""
        with self.lock:
            now = self.clock()
            hw = self._hardware_value(now)
            self.coordinator.connected = self.connected and hw["ready"] and not self.calibrating
            if self.agent.state in RUNNING:
                if now - self.last_processed_at > SCENE_FRESH_MS:
                    self._halt("Camera evidence expired; approve a new route")
                elif not hw["ready"]:
                    self._halt("Authenticated controller feedback expired or became unsafe")
                elif now - self.coordinator.presence.get(self.owner, -10000) > OPERATOR_PRESENCE_MS:
                    self._halt("Operator presence expired; approve a new route")
                elif self.pending_acks and now - self.pending_acks[0][1] > SCENE_FRESH_MS:
                    self._halt("Applied controller acknowledgement timed out; approve a new route")
            try:
                self.coordinator.tick()
                self.coordinator.status(self.agent.status(now))
            except Exception:
                self._halt("Route lease failed; approve a new route")
            row = self.coordinator.row
            if row and row["state"] == "pending" and now >= row["expires_at_ms"]:
                row["state"], row["reason"] = "expired", "Review expired; capture a fresh route"
                self.coordinator.save()
            self.mission.tick()

    def _capture_loop(self):
        try:
            cap = self.capture_factory(self.camera_index, cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY)
            self.capture = cap
            resolution = self.config["resolution"] if self.config else [1280, 720]
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, resolution[0])
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, resolution[1])
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            counter = 0
            while not self.stop_event.is_set():
                ok, frame = cap.read()
                counter += 1
                with self.capture_lock:
                    self.latest_frame = (counter, self.clock(), frame if ok else None)
                if not ok:
                    self.stop_event.wait(0.03)
        except Exception:
            with self.lock:
                self.reason = "Local camera could not be opened; check the camera index"
        finally:
            if self.capture is not None:
                self.capture.release()

    def _process_loop(self):
        previous = -1
        while not self.stop_event.wait(0.04):
            with self.capture_lock:
                latest = self.latest_frame
            if latest is None or latest[0] == previous:
                continue
            previous, captured_at, frame = latest
            if frame is None or self.clock() - captured_at > 150:
                continue
            try:
                with self.feed.lock:
                    annotated, observation = self.feed.observe_frame(frame)
                    cached = self.feed.snapshot()
                    config = copy.deepcopy(self.feed.tracker_config)
                    config_id = self.feed.tracker.config_id if self.feed.tracker else None
                ok, encoded = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
                with self.lock:
                    self.camera_status = cached
                    self.camera_status["captured_at_ms"] = captured_at
                    self.jpeg = encoded.tobytes() if ok else None
                if config and config_id:
                    self.accept_observation(observation, config, config_id, captured_at)
            except Exception as error:
                with self.lock:
                    self.camera_status.update(valid=False, pose=None, reason=str(error)[:160])

    def _hardware_loop(self):
        retry_delay = 0.25
        while not self.stop_event.is_set():
            delay = 0.08
            try:
                self.accept_hardware(self.transport.poll())
                retry_delay = 0.25
            except Exception as error:
                with self.lock:
                    self.hardware_ok = False
                    self.hardware_error = self.reason = str(error)[:160]
                    if self.agent.state in RUNNING:
                        self._halt("Direct ESP32 connection failed; approve a new route")
                # Retire an active approval before waiting. Let the single-client
                # receiver recover instead of opening connections every 80 ms
                # during an outage. This retries observation, never motion.
                delay = retry_delay
                retry_delay = min(2.0, retry_delay * 2)
            self.stop_event.wait(delay)

    def _watchdog_loop(self):
        while not self.stop_event.wait(0.05):
            self.supervise()

    def status(self):
        with self.lock:
            now = self.clock()
            public = self.coordinator.public(self.owner)
            camera = copy.deepcopy(self.camera_status)
            captured_at = camera.get("captured_at_ms")
            camera["age_ms"] = max(0, now - captured_at) if captured_at and captured_at > 0 else None
            if camera["age_ms"] is None:
                camera.update(valid=False, pose=None, reason="Waiting for the first local camera frame")
            elif camera["age_ms"] > SCENE_FRESH_MS:
                camera.update(valid=False, pose=None, reason="Waiting for fresh local camera frames")
            if public["scene"]:
                public["scene"]["age_ms"] = max(0, now - public["scene"]["captured_at_ms"])
                public["scene"]["hardware"] = self._hardware_value(now)
                if now - public["scene"]["captured_at_ms"] > SCENE_FRESH_MS:
                    public["scene"].update(valid=False, pose=None, reason="Camera evidence expired")
            if public["battery"] and self.hardware:
                battery = public["battery"]
                battery["voltage_v"] = self.hardware["battery_voltage_v"]
                advisory = self.config["geometry"].get("battery_advisory_voltage_v") if self.config else None
                battery["action"] = battery_action(battery["voltage_v"], battery["critical_v"], advisory, mode="mission")
            public["ready"] = bool(public["ready"] and camera["valid"] and not self.calibrating
                                   and self._hardware_value(now)["ready"])
            reason = self.reason
            feedback_reason = self.hardware_error
            hw = self._hardware_value(now)
            if not feedback_reason:
                if not self.hardware:
                    feedback_reason = "Waiting for the first authenticated ESP32 response"
                elif hw["age_ms"] > SCENE_FRESH_MS:
                    feedback_reason = "ESP32 feedback is out of date; waiting for a fresh response"
                elif not hw["ready"]:
                    feedback_reason = "Waiting for ready ESP32 feedback; check its physical interlocks and battery"
                else:
                    feedback_reason = "Authenticated feedback over direct Wi-Fi"
            if self.connected and self.hardware_ok:
                if not hw["ready"]:
                    reason = feedback_reason
                elif not camera.get("connected"):
                    reason = "Waiting for the local camera; check the selected camera index"
                elif not self.config:
                    reason = "Complete camera calibration and import the measured profile"
                elif not camera["valid"]:
                    reason = camera["reason"]
                elif self.agent.state in RUNNING:
                    reason = self.agent.reason
                elif public["ready"]:
                    reason = "Ready to preview a route; movement requires your approval"
                else:
                    reason = "Keep the robot still while fresh camera and controller evidence is collected"
            public.update(connected=self.connected, issued_at_ms=now, camera=camera,
                hardware=hw if self.hardware else None,
                controller_ip=getattr(self.transport, "device_ip", DEVICE_IP),
                controller_feedback=dict(ready=hw["ready"], reason=feedback_reason),
                reason=reason, camera_index=self.camera_index,
                agent=dict(state=self.agent.state, reason=self.agent.reason),
                calibration_ready=bool(self.config and not self.calibrating),
                freshness=dict(camera_ms=SCENE_FRESH_MS, hardware_ms=SCENE_FRESH_MS))
            public.update(mission=self.mission.public(), stations=self.mission.stations())
            return public

    def profile(self):
        template = json.loads(Path(__file__).with_name("example_camera_config.json").read_text(encoding="utf-8"))
        with self.feed.lock:
            if self.feed.intrinsics:
                template.update(copy.deepcopy(self.feed.intrinsics))
        template["checks"] = {name: False for name in CHECKS}
        template.setdefault("floor_reference_positions_mm", {str(i): [None, None] for i in range(1, 5)})
        return dict(profile=copy.deepcopy(self.config), template=template, checks=list(CHECKS))

    def calibration(self, action, payload):
        with self.lock:
            if self.calibrating:
                raise ValueError("Another camera calibration action is still running")
            if self.agent.state in RUNNING or (self.coordinator.row and self.coordinator.row["state"] in ACTIVE):
                raise ValueError("Stop the active route before changing camera calibration")
            self.mission.cancel("Camera calibration changed; select and preview a fresh mission")
            if self.coordinator.row and self.coordinator.row["state"] == "pending":
                self.coordinator.row.update(state="cancelled", reason="Calibration changed; capture a fresh route")
                self.coordinator.save()
            self.calibrating = True
            self.config = self.config_id = None
            self.coordinator.current = None
            self.coordinator.history.clear()
            self.agent.scene = None
        try:
            with self.feed.lock:
                self.feed.tracker = self.feed.tracker_config = None
            if action == "checkerboard":
                self.feed.request_checkerboard()
            elif action == "intrinsics":
                self.feed.calculate_intrinsics()
            elif action == "background":
                self.feed.request_background()
            elif action == "camera-profile":
                config = load_config(payload.get("profile"))
                if config["geometry"]["max_pwm"] > ROUTE_PWM_CAP:
                    raise ValueError("Local route firmware requires measured max_pwm at most 60")
                self.feed.enable_trusted_tracking(config)
                with self.feed.lock:
                    background = self.feed.background.copy()
                    config_id = self.feed.tracker.config_id
                self.state_dir.joinpath("camera_profile.json").write_text(json.dumps(config, indent=2))
                if not cv2.imwrite(str(self.state_dir / "empty_floor.png"), background):
                    raise ValueError("Could not save the measured empty-floor image")
                with self.lock:
                    self.config, self.config_id = config, config_id
            else:
                raise ValueError("Unknown calibration action")
        finally:
            with self.lock:
                self.calibrating = False

    def restore_profile(self, profile_path, background_path):
        config = load_config(profile_path)
        if config["geometry"]["max_pwm"] > ROUTE_PWM_CAP:
            raise ValueError("Measured route max_pwm must be at most 60")
        with self.feed.lock:
            self.feed.intrinsics = {k: config[k] for k in ("camera_matrix", "distortion_coefficients", "resolution")}
            self.feed.background = cv2.imread(str(background_path))
        self.feed.enable_trusted_tracking(config)
        self.config, self.config_id = config, self.feed.tracker.config_id

    def mutate(self, path, payload):
        if path in ("checkerboard", "intrinsics", "background", "camera-profile"):
            self.calibration(path, payload)
        else:
            with self.lock:
                if path == "connect":
                    self.connect(payload.get("camera"))
                elif path == "presence":
                    if type(payload.get("active", True)) is not bool:
                        raise ValueError("Presence active must be a boolean")
                    self.presence(payload.get("active", True))
                elif path == "stop":
                    self.stop()
                elif path == "stations":
                    self.mission.configure(payload)
                elif path == "mission":
                    self.mission.start(payload.get("start"), payload.get("destination"))
                elif path == "return-start":
                    self.mission.return_start(payload.get("reason"))
                elif path == "plan":
                    if self.calibrating or not self.status()["ready"]:
                        raise ValueError("Fresh calibrated camera and stationary ESP32 evidence are required")
                    if self.coordinator.row and self.coordinator.row["state"] in ACTIVE:
                        raise ValueError("Stop the active route before previewing another")
                    self.mission.cancel("A manual coordinate route was selected")
                    if self.coordinator.row and self.coordinator.row["state"] == "pending":
                        self.coordinator.row.update(state="cancelled", reason="Replaced by a new route preview")
                        self.coordinator.save()
                    self.coordinator.capture(self.owner, "local_operator", (payload.get("x"), payload.get("y")))
                elif path in ("decision", "battery-decision"):
                    if path == "decision":
                        if payload.get("decision") == "approve" and not self.status()["ready"]:
                            raise ValueError("Fresh calibrated stationary evidence is required for approval")
                        if not self.mission.decision(payload.get("review_id"), payload.get("decision"), payload.get("reason")):
                            self.coordinator.decide(self.owner, payload.get("review_id"), payload.get("decision"), payload.get("reason"))
                    else:
                        if self.mission.row and payload.get("choice") == "divert":
                            self.mission._station("E")
                        baseline = self.coordinator.row.get("battery_warning_voltage_v") if self.coordinator.row else None
                        self.coordinator.battery_decide(self.owner, payload.get("review_id"), payload.get("choice"), payload.get("reason"),
                            battery_review_seq=payload.get("battery_review_seq"))
                        if payload.get("choice") == "divert":
                            self.mission.battery_diversion(payload.get("reason"), baseline)
                    self.coordinator.status(self.agent.status(self.clock()))
                    self.mission.tick()
                else:
                    raise ValueError("Unknown local controller action")
        return self.status()

    def close(self):
        self.stop("Local controller closed")
        self.stop_event.set()
        self.connected = False
        if self.capture is not None:
            self.capture.release()
        for thread in self.threads:
            thread.join(timeout=0.4)


def handler_for(twin):
    class Handler(BaseHTTPRequestHandler):
        server_version = "AMRLocal/1"

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
            self.send_header("Content-Security-Policy", FRAME_ANCESTORS)
            self.end_headers()
            self.wfile.write(body)

        def allowed(self, mutation=False):
            host = self.headers.get("Host", "")
            if host not in ALLOWED_HOSTS:
                self.reply(403, {"error": "Only the fixed loopback host is allowed"})
                return False
            if mutation and (self.headers.get("Origin") != "http://" + host or
                not hmac.compare_digest(self.headers.get("X-AMR-Session", ""), twin.session)):
                self.reply(403, {"error": "Open the local controller page to perform this action"})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            if self.path == "/":
                html = Path(__file__).with_name("local_twin.html").read_text(encoding="utf-8")
                html = html.replace("__AMR_SESSION_TOKEN__", twin.session).replace("__AMR_SESSION__", twin.session)
                self.reply(200, html.encode("utf-8"), "text/html; charset=utf-8")
            elif self.path == "/api/status":
                self.reply(200, twin.status())
            elif self.path.split("?", 1)[0] == "/api/frame.jpg":
                with twin.lock:
                    age = twin.clock() - twin.camera_status.get("captured_at_ms", 0)
                    jpeg = twin.jpeg if 0 <= age <= SCENE_FRESH_MS else None
                self.reply(200 if jpeg else 204, jpeg or b"", "image/jpeg")
            elif self.path == "/api/camera-profile":
                self.reply(200, twin.profile())
            elif self.path == "/api/stations":
                with twin.lock:
                    stations = twin.mission.stations()
                self.reply(200, stations)
            else:
                self.reply(404, {"error": "Unknown local endpoint"})

        def do_POST(self):
            if not self.allowed(mutation=True):
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 65536 or self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
                    raise ValueError("Expected a small JSON request")
                self.connection.settimeout(1)
                def reject_constant(_value):
                    raise ValueError("Non-finite JSON is not permitted")
                payload = json.loads(self.rfile.read(size), parse_constant=reject_constant)
                if not isinstance(payload, dict) or not self.path.startswith("/api/"):
                    raise ValueError("Expected a local action object")
                self.reply(200, twin.mutate(self.path[5:], payload))
            except (ValueError, TypeError, KeyError) as error:
                self.reply(409, {"error": str(error)[:200]})
            except Exception:
                twin.stop("Local request failed; approve a new route")
                self.reply(500, {"error": "Local request failed; movement has been stopped"})

    return Handler



def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--device-ip", type=receiver_ip, default=DEVICE_IP,
                        help="Private ESP32 IPv4 address; the current hotspot address is prefilled")
    parser.add_argument("--config")
    parser.add_argument("--background")
    parser.add_argument("--state-dir", default=str(Path.home() / ".amr-local-twin"))
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)
    if bool(args.config) != bool(args.background):
        parser.error("Supply both --config and --background")
    try:
        secret = read_route_key()
    except ValueError as error:
        parser.error(str(error))
    if secret is None:
        return
    directory = Path(args.state_dir).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    with ProcessLock(directory / "controller.lock"):
        twin = LocalTwin(DeviceHTTPTransport(secret, device_ip=args.device_ip), directory, camera_index=args.camera)
        profile_path = Path(args.config) if args.config else directory / "camera_profile.json"
        background_path = Path(args.background) if args.background else directory / "empty_floor.png"
        if args.config or profile_path.exists() or background_path.exists():
            if not profile_path.is_file() or not background_path.is_file():
                parser.error("The saved camera profile and empty-floor image must both exist; restore the pair or move both aside")
            try:
                twin.restore_profile(profile_path, background_path)
            except (ValueError, TypeError, KeyError, OSError) as error:
                parser.error("The saved camera calibration is invalid: " + str(error))
        server = ThreadingHTTPServer((HOST, PORT), handler_for(twin))
        server.daemon_threads = True
        print("Local AMR twin: http://127.0.0.1:8765 — press Connect in the page to begin.")
        print(f"ESP32 target: http://{args.device_ip}/ — compare with the firmware's AMR WIFI line.")
        if not args.no_browser:
            webbrowser.open("http://127.0.0.1:8765")
        try:
            server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt:
            pass
        finally:
            twin.close()
            server.server_close()


if __name__ == "__main__":
    main()
