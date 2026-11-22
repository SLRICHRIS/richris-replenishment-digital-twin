"""Authenticated, bounded HTTP transport to the local route-only ESP32 receiver."""

import copy
import json
import threading
import time
import urllib.error
import urllib.request

from .contracts import key, fresh
from .protocol import drive, hardware

DEVICE_IP = "10.15.213.112"
ROUTE_PWM_CAP = 60


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        raise ValueError("The local receiver must not redirect requests")


class DeviceHTTPTransport:
    """Construction is read-only. Only explicit send() can issue a motor request.

    A 200 response means accepted, not applied: callers must check the next
    signed heartbeat's route ID and command sequence before claiming execution.
    """

    def __init__(self, secret, *, timeout=0.15, opener=None, clock=None):
        key(secret)
        if not 0 < timeout <= 0.25:
            raise ValueError("Receiver timeout must be at most 250 milliseconds")
        self._secret = secret
        self.timeout = timeout
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.opener = opener or urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect()
        )
        self.lock = threading.Lock()
        self.latest = None
        self.retired = set()

    def _request(self, path, body=None):
        request = urllib.request.Request(
            "http://" + DEVICE_IP + path,
            data=body.encode("ascii") if body is not None else None,
            headers={"Content-Type": "text/plain", "Cache-Control": "no-store"},
            method="POST" if body is not None else "GET",
        )
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                if response.status != 200:
                    raise ValueError("Local receiver rejected the request")
                data = response.read(1025)
                if len(data) > 1024:
                    raise ValueError("Oversized receiver response")
                return data
        except (OSError, urllib.error.URLError) as error:
            raise ValueError("Local ESP32 connection failed; approve a new route") from error

    def poll(self):
        with self.lock:
            raw = self._request("/api/route/hardware")
            value = hardware(raw, self._secret, self.clock(), max_pwm=ROUTE_PWM_CAP)
            identity = value["boot_id"], value["epoch_id"]
            if identity in self.retired:
                raise ValueError("A retired controller epoch cannot be reused")
            if self.latest:
                old = self.latest["boot_id"], self.latest["epoch_id"]
                if identity == old and value["seq"] <= self.latest["seq"]:
                    raise ValueError("Repeated or out-of-order controller heartbeat")
                if identity != old:
                    self.retired.add(old)
            # H1 has no advertised cap; this route-only firmware is limited to 60.
            value["max_pwm"] = ROUTE_PWM_CAP
            self.latest = value
            return copy.deepcopy(value)

    def send(self, observed, route, seq, operation, left, right, now):
        with self.lock:
            current = self.latest
            if not current or any(observed.get(k) != current[k] for k in ("boot_id", "epoch_id")):
                raise ValueError("Controller identity changed; approve a new route")
            if operation != "stop" and (
                not fresh(current["issued_at_ms"], self.clock()) or not current["ready"]
            ):
                raise ValueError("Fresh ready controller feedback is required")
            wire = drive(current["boot_id"], current["epoch_id"], route, seq,
                         operation, left, right, now, self._secret,
                         max_pwm=ROUTE_PWM_CAP)
            raw = self._request("/api/route/command", wire)
            try:
                accepted = json.loads(raw)
            except (ValueError, UnicodeError) as error:
                raise ValueError("Invalid controller acceptance response") from error
            if not isinstance(accepted, dict) or accepted.get("ok") is not True:
                raise ValueError("Controller did not accept the command")
