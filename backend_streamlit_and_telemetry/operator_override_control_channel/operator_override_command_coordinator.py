"""Independent operator command service. Prediction is never imported here.

LabVIEW/CLI -> local HTTP -> MQTT -> onboard controller -> execution acknowledgment.
TLS and broker ACLs provide transport identity. Run this on the control platform.
"""

import argparse
import hmac
import json
import os
import sqlite3
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from backend_streamlit_and_telemetry.mqtt_recording_and_inventory_bridge.mqtt_telemetry_recorder_and_inventory_publisher import (
    ASSETS,
    Validator,
    integer,
    mqtt_client,
    token,
)

ACTIONS = {"stop", "pause", "resume"}
TERMINAL = {"executed", "rejected", "timed_out"}


class CommandCoordinator:
    """Persist requests before publishing; correlate execution on one receiver clock."""

    def __init__(
        self,
        publisher,
        database=":memory:",
        clock=time.monotonic_ns,
        wall_clock=lambda: time.time_ns() // 1000000,
    ):
        self.publish = publisher
        self.clock = clock
        self.wall_clock = wall_clock
        self.lock = threading.RLock()
        self.telemetry = Validator()
        self.devices = {}
        self.db = sqlite3.connect(database, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS commands (
            command_id TEXT PRIMARY KEY, packet TEXT NOT NULL, status TEXT NOT NULL,
            requested_ns INTEGER NOT NULL, deadline_ns INTEGER NOT NULL,
            terminal_ns INTEGER, latency_ms REAL, reason TEXT, acknowledgment TEXT)""")
        self.db.commit()
        # An earlier process's monotonic epoch and MQTT delivery cannot be recovered.
        self.db.execute(
            "UPDATE commands SET status='timed_out', reason='Coordinator restarted; execution unconfirmed' WHERE status NOT IN ('executed','rejected','timed_out')"
        )
        self.db.commit()

    def observe(self, asset, raw, retained=False):
        with self.lock:
            now = self.wall_clock()
            packet = self.telemetry.decode(raw, "telemetry", asset, now, retained)
            self.devices[asset] = (packet, self.clock())

    def request(self, asset, action, command_id=None, timeout_ms=2000):
        if (
            type(asset) is not str
            or type(action) is not str
            or asset not in ASSETS
            or action not in ACTIONS
        ):
            raise ValueError("Choose a known device and stop, pause or resume")
        if not integer(timeout_ms) or not 100 <= timeout_ms <= 5000:
            raise ValueError("Execution timeout must be 100..5000 ms")
        command_id = command_id or uuid.uuid4().hex
        if not token(command_id, r"[a-f0-9]{32}"):
            raise ValueError("Command ID must be 32 lowercase hexadecimal characters")
        with self.lock:
            self._expire(command_id)
            old = self._get(command_id)
            if old:
                if (
                    old["packet"]["device_id"] != asset
                    or old["packet"]["action"] != action
                ):
                    raise ValueError(
                        "Command ID was already used for a different request"
                    )
                return old  # HTTP retries never execute a command twice.
            observed = self.devices.get(asset)
            now_ns, now_ms = self.clock(), self.wall_clock()
            fresh = (
                observed
                and now_ns - observed[1] <= 5000000000
                and now_ms - 5000 <= observed[0]["sent_at_ms"] <= now_ms + 5000
            )
            if not observed or (action != "stop" and not fresh):
                raise ValueError(
                    "Known device boot required; pause/resume also require fresh telemetry"
                )
            # A last-known boot permits STOP despite measurement loss; predictions
            # and observation freshness never veto an authenticated stop request.
            packet = {
                "v": 1,
                "command_id": command_id,
                "device_id": asset,
                "target_boot_id": observed[0]["boot_id"],
                "action": action,
                "issued_at_ms": now_ms,
                "expires_at_ms": now_ms + timeout_ms,
            }
            self.db.execute(
                "INSERT INTO commands(command_id,packet,status,requested_ns,deadline_ns) VALUES(?,?,?,?,?)",
                (
                    command_id,
                    json.dumps(packet),
                    "sent",
                    now_ns,
                    now_ns + timeout_ms * 1000000,
                ),
            )
            self.db.commit()
        try:
            self.publish(asset, packet)
        except Exception:
            with self.lock:
                if self._get(command_id)["status"] not in TERMINAL:
                    self._finish(command_id, "rejected", "Command transport failed")
            raise
        return self.get(command_id)

    def acknowledge(self, asset, raw, retained=False):
        if retained or len(raw) > 2048:
            raise ValueError("Acknowledgment must be live and at most 2 KB")
        packet = json.loads(raw)
        if (
            type(packet) is not dict
            or packet.get("v") != 1
            or type(packet.get("v")) is bool
        ):
            raise ValueError("Invalid acknowledgment version")
        with self.lock:
            command = self._get(packet.get("command_id"))
            if (
                not command
                or asset != command["packet"]["device_id"]
                or packet.get("device_id") != asset
            ):
                raise ValueError("Acknowledgment identity does not match a command")
            if packet.get("boot_id") != command["packet"]["target_boot_id"]:
                raise ValueError("Acknowledgment belongs to another boot")
            status = packet.get("status")
            if status not in {"accepted", "executed", "rejected"}:
                raise ValueError("Invalid execution acknowledgment status")
            reason = packet.get("reason", "")
            if not isinstance(reason, str) or len(reason) > 160:
                raise ValueError("Invalid acknowledgment reason")
            self._expire(packet["command_id"])
            if self._get(packet["command_id"])["status"] in TERMINAL:
                return self._get(
                    packet["command_id"]
                )  # Late/duplicate ACK cannot revive a request.
            if status == "accepted":
                self.db.execute(
                    "UPDATE commands SET status='accepted', acknowledgment=? WHERE command_id=?",
                    (json.dumps(packet), packet["command_id"]),
                )
                self.db.commit()
            else:
                self._finish(packet["command_id"], status, reason, packet)
            return self._get(packet["command_id"])

    def _finish(self, command_id, status, reason, packet=None):
        now = self.clock()
        row = self.db.execute(
            "SELECT requested_ns FROM commands WHERE command_id=?", (command_id,)
        ).fetchone()
        latency = (now - row[0]) / 1000000 if status == "executed" else None
        self.db.execute(
            "UPDATE commands SET status=?,terminal_ns=?,latency_ms=?,reason=?,acknowledgment=? WHERE command_id=?",
            (
                status,
                now,
                latency,
                reason,
                json.dumps(packet) if packet else None,
                command_id,
            ),
        )
        self.db.commit()

    def _expire(self, command_id):
        row = self.db.execute(
            "SELECT status,deadline_ns FROM commands WHERE command_id=?", (command_id,)
        ).fetchone()
        if row and row[0] not in TERMINAL and self.clock() >= row[1]:
            self._finish(
                command_id, "timed_out", "No execution acknowledgment before deadline"
            )

    def _get(self, command_id):
        row = self.db.execute(
            "SELECT packet,status,requested_ns,deadline_ns,terminal_ns,latency_ms,reason,acknowledgment FROM commands WHERE command_id=?",
            (command_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "packet": json.loads(row[0]),
            "status": row[1],
            "requested_ns": row[2],
            "deadline_ns": row[3],
            "terminal_ns": row[4],
            "latency_ms": row[5],
            "reason": row[6],
            "acknowledgment": json.loads(row[7]) if row[7] else None,
        }

    def get(self, command_id):
        with self.lock:
            self._expire(command_id)
            return self._get(command_id)

    def expire_pending(self):
        with self.lock:
            ids = self.db.execute(
                "SELECT command_id FROM commands WHERE status NOT IN ('executed','rejected','timed_out')"
            ).fetchall()
            for (command_id,) in ids:
                self._expire(command_id)

    def close(self):
        self.db.close()


def handler_for(coordinator, access_token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Do not put request headers/tokens in logs.

        def respond(self, status, body):
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def authorized(self):
            if not hmac.compare_digest(
                self.headers.get("Authorization", "").encode(),
                ("Bearer " + access_token).encode(),
            ):
                self.respond(401, {"error": "Operator authorization required"})
                return False
            return True

        def do_POST(self):
            if not self.authorized():
                return
            if self.path != "/commands":
                return self.respond(404, {"error": "Unknown endpoint"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 2048:
                    raise ValueError("Request must be 1..2048 bytes")
                self.connection.settimeout(2)
                body = json.loads(self.rfile.read(size))
                result = coordinator.request(
                    body["device_id"],
                    body["action"],
                    body.get("command_id"),
                    body.get("timeout_ms", 2000),
                )
                self.respond(202 if result["status"] not in TERMINAL else 200, result)
            except (ValueError, KeyError, TypeError, TimeoutError) as exc:
                self.respond(400, {"error": str(exc)})
            except Exception:
                self.respond(
                    503,
                    {"error": "Command transport unavailable; inspect command status"},
                )

        def do_GET(self):
            if not self.authorized():
                return
            command_id = self.path.removeprefix("/commands/")
            if not self.path.startswith("/commands/") or not token(
                command_id, r"[a-f0-9]{32}"
            ):
                return self.respond(404, {"error": "Unknown command"})
            result = coordinator.get(command_id)
            self.respond(200 if result else 404, result or {"error": "Unknown command"})

    return Handler


def serve(args):
    access_token = os.environ.get("OVERRIDE_OPERATOR_TOKEN", "")
    if len(access_token) < 32:
        raise SystemExit(
            "Set OVERRIDE_OPERATOR_TOKEN to a random private value of at least 32 characters"
        )
    client, host, port, prefix = mqtt_client()

    def publish(asset, packet):
        info = client.publish(
            f"{prefix}/{asset}/commands", json.dumps(packet), qos=1, retain=False
        )
        if info.rc != 0:
            raise RuntimeError("Broker command publish failed")

    coordinator = CommandCoordinator(publish, args.database)

    def on_connect(c, _userdata, _flags, reason, _properties):
        if not reason.is_failure:
            c.subscribe(
                [
                    (f"{prefix}/{asset}/{kind}", 1)
                    for asset in ASSETS
                    for kind in ("telemetry", "command_ack")
                ]
            )

    def on_message(_client, _userdata, message):
        parts = message.topic.removeprefix(prefix + "/").split("/")
        if len(parts) != 2 or parts[0] not in ASSETS:
            return
        try:
            if parts[1] == "telemetry":
                coordinator.observe(parts[0], bytes(message.payload), message.retain)
            elif parts[1] == "command_ack":
                coordinator.acknowledge(
                    parts[0], bytes(message.payload), message.retain
                )
        except (ValueError, TypeError, UnicodeError):
            pass  # Rejected traffic has no control authority.

    client.on_connect, client.on_message = on_connect, on_message
    client.connect(host, port, keepalive=30)
    client.loop_start()

    class CommandHTTPServer(ThreadingHTTPServer):
        def service_actions(self):
            coordinator.expire_pending()

    server = CommandHTTPServer(
        ("127.0.0.1", args.port), handler_for(coordinator, access_token)
    )
    print(
        f"Override service listening on 127.0.0.1:{args.port}; execution evidence: {args.database}",
        flush=True,
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
        client.disconnect()
        client.loop_stop()
        coordinator.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--database", default="operator-command-evidence.sqlite3")
    serve(parser.parse_args())
