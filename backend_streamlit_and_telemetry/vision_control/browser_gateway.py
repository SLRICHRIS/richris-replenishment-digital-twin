"""Protected Streamlit WebRTC -> measured scene -> MQTT route follower.

All numerical camera observations come from OpenCV running on the server.
A browser cannot post poses or motor packets. No connection is made unless
explicitly commissioned protected broker identities and drive limits are set.
"""
from __future__ import annotations

import ssl
import threading
import time
import uuid

from .agent import Agent
from .contracts import (
    SCENE_TOPIC, STATUS_TOPIC, REQUEST_TOPIC, DRIVE_TOPIC, HARDWARE_TOPIC,
    SCENE_VERSION, HEIGHT, WIDTH, canonical, key, scene, seal,
)
from .protocol import drive, hardware

MAX_FRAME_GAP_MS = 250
MAX_FRAME_AGE_MS = 300


def validate_browser_profile(route, browser):
    """Distinct least-privilege MQTT identity; fail closed on unmeasured latency."""
    if route.get("enabled") is not True or route.get("commissioned") is not True:
        raise ValueError("Protected route coordinator and physical commissioning required")
    if browser.get("enabled") is not True or browser.get("transport_latency_verified") is not True:
        raise ValueError("Attended browser WebRTC latency/stopping validation required")
    for name in ("mqtt_host", "mqtt_username", "mqtt_password", "drive_key"):
        if not isinstance(browser.get(name), str) or not browser[name]:
            raise ValueError("Private browser camera MQTT " + name + " required")
    for name in ("mqtt_host", "control_key"):
        if not isinstance(route.get(name), str) or not route[name]:
            raise ValueError("Private website " + name + " required")
    if route["mqtt_host"] != browser["mqtt_host"]:
        raise ValueError("Website and browser camera MQTT hosts differ")
    key(route["control_key"])
    key(browser["drive_key"])
    if route["control_key"] == browser["drive_key"]:
        raise ValueError("Control and drive authentication keys must differ")
    if browser["mqtt_username"] == route.get("mqtt_username"):
        raise ValueError("Browser camera and website require separate broker identities")
    return True


class BrowserVisionGateway:
    """Exactly one active cloud-camera controller per broker receiver identity."""

    def __init__(self, config, route, browser):
        validate_browser_profile(route, browser)
        import paho.mqtt.client as mqtt

        self.config = config
        self.route, self.profile = route, browser
        self.lock = threading.RLock()
        self.boot = uuid.uuid4().hex
        self.connected = False
        self.subscribed = False
        self.closed = False
        self.last_video_ms = 0
        self.last_frame_seq = -1
        self.seq = 0
        self.hw = None
        self.agent = Agent(route["control_key"], self._send_drive)
        # Fixed broker client ID forces a different instance to disconnect the
        # existing receiver. Motor firmware independently stops on lost leases.
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id="amr01-browser-vision-controller"
        )
        self.client.username_pw_set(browser["mqtt_username"], browser["mqtt_password"])
        self.client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
        self.client.on_connect = self._connected
        self.client.on_subscribe = self._subscribed
        self.client.on_disconnect = self._disconnected
        self.client.on_message = self._message
        self.client.connect_async(browser["mqtt_host"], 8883, 10)
        self.client.loop_start()
        self.stop = threading.Event()
        self.watchdog = threading.Thread(
            target=self._watch, daemon=True, name="amr01-browser-vision-watchdog"
        )
        self.watchdog.start()

    @staticmethod
    def _now():
        return int(time.time() * 1000)

    def _connected(self, client, _userdata, _flags, reason, _properties):
        with self.lock:
            if self.closed:
                return
            self.connected = not reason.is_failure
            self.subscribed = False
        if not reason.is_failure:
            client.subscribe([(REQUEST_TOPIC, 0), (HARDWARE_TOPIC, 0)])

    def _subscribed(self, _client, _userdata, _mid, reasons, _properties):
        with self.lock:
            self.subscribed = not self.closed and len(reasons) == 2 and all(
                not reason.is_failure for reason in reasons
            )

    def _disconnected(self, *_args):
        with self.lock:
            self.connected = False
            self.subscribed = False
            self.agent.state = "blocked"
            self.agent.reason = "Browser camera MQTT transport disconnected"
            self.agent.lease_until = 0

    def _message(self, _client, _userdata, message):
        if message.retain:
            return
        with self.lock:
            if self.closed or not self.subscribed:
                return
            now = self._now()
            try:
                if message.topic == HARDWARE_TOPIC:
                    packet = hardware(message.payload, self.profile["drive_key"], now)
                    if self.hw is not None and packet["boot_id"] == self.hw["boot_id"] and (
                        packet["epoch_id"] == self.hw["epoch_id"]
                        and packet["seq"] <= self.hw["seq"]
                    ):
                        return
                    self.hw = packet
                elif message.topic == REQUEST_TOPIC:
                    if now - self.last_video_ms > MAX_FRAME_AGE_MS:
                        raise ValueError("Browser video not fresh")
                    self.agent.request(message.payload, now)
            except (ValueError, TypeError, KeyError):
                return
            except Exception:
                self.agent.state = "blocked"
                self.agent.reason = "Protected browser camera request failed"
                self.agent.lease_until = 0

    def _send_drive(self, h, route_id, seq, operation, left, right, stamp):
        if self.closed or not (self.connected and self.subscribed):
            raise ValueError("Protected browser camera MQTT is disconnected")
        packet = drive(
            h["boot_id"], h["epoch_id"], route_id, seq, operation,
            left, right, stamp, self.profile["drive_key"],
        )
        published = self.client.publish(DRIVE_TOPIC, packet, qos=0, retain=False)
        if published.rc != 0:
            raise ValueError("Drive packet did not reach MQTT transport")

    def submit(self, observation):
        """Called only from a real WebRTC video frame callback."""
        with self.lock:
            if self.closed:
                return
            now = self._now()
            if observation.frame_seq <= self.last_frame_seq:
                self.agent.halt("Repeated browser video frame", now)
                return
            if now - observation.captured_at_ms > MAX_FRAME_AGE_MS:
                self.agent.halt("Old browser camera frame", now)
                return
            if self.last_video_ms and now - self.last_video_ms > MAX_FRAME_GAP_MS:
                self.agent.halt("Browser camera frame gap", now)
            self.last_video_ms = now
            self.last_frame_seq = observation.frame_seq
            self.seq += 1
            h = dict(self.hw) if self.hw is not None else dict(
                boot_id="0" * 32, epoch_id="0" * 32, ready=False,
                age_ms=600000, battery_voltage_v=0, left_duty=0, right_duty=0
            )
            h["age_ms"] = min(600000, max(0, now - h.get("issued_at_ms", 0)))
            if not self.subscribed:
                h["ready"] = False
            s = scene(dict(
                version=SCENE_VERSION, floor_width_mm=WIDTH, floor_length_mm=HEIGHT,
                robot_id="amr01", agent_boot_id=self.boot,
                config_id=self.config["config_id"], seq=self.seq,
                captured_at_ms=observation.captured_at_ms,
                valid=observation.valid, reason=observation.reason,
                geometry=self.config["geometry"], pose=observation.pose,
                obstacles=list(observation.obstacles), hardware=h,
            ))
            try:
                self.agent.tick(s, now)
            except Exception:
                self.agent.state = "blocked"
                self.agent.reason = "Browser camera execution halted"
                self.agent.lease_until = 0
            if self.subscribed:
                self.client.publish(SCENE_TOPIC, canonical(seal("scene", s, self.route["control_key"])), qos=0, retain=False)
                self.client.publish(STATUS_TOPIC, canonical(self.agent.status(now)), qos=0, retain=False)

    def _watch(self):
        while not self.stop.wait(0.05):
            with self.lock:
                if self.closed:
                    return
                now = self._now()
                if self.last_video_ms and now - self.last_video_ms > MAX_FRAME_AGE_MS:
                    if self.agent.state in ("arming", "running", "stopping"):
                        try:
                            self.agent.halt("WebRTC camera feed stalled", now)
                        except Exception:
                            self.agent.state = "blocked"
                            self.agent.lease_until = 0

    def public(self):
        with self.lock:
            return dict(
                connected=self.connected, subscribed=self.subscribed,
                frames=self.seq, scene_age_ms=self._now() - self.last_video_ms if self.last_video_ms else None,
                state=self.agent.state, reason=self.agent.reason,
            )

    def close(self):
        with self.lock:
            if self.closed:
                return
            try:
                self.agent.halt("WebRTC camera disconnected", self._now())
            except Exception:
                pass
            self.closed = True
            self.connected = False
            self.subscribed = False
        self.stop.set()
        self.client.disconnect()
        self.client.loop_stop()
        if self.watchdog is not threading.current_thread():
            self.watchdog.join(timeout=0.5)
