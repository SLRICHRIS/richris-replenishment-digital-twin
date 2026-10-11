#!/usr/bin/env python3
"""Read-only edge historian and inventory adapter. No command or motor interface.
© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
Python 3.10+. Only network commands require paho-mqtt 2.x.
"""

import argparse
import getpass
import json
import math
import os
import queue
import re
import sqlite3
import ssl
import sys
import time
import uuid
from pathlib import Path

ASSETS = ["amr-01", "amr-02", "amr-03"]
STATES = {"unknown", "idle", "moving", "paused", "charging", "fault"}
NOTICE = "© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes."


def integer(n):
    return type(n) is int and abs(n) <= 9007199254740991


def measured(n, minimum, maximum, optional=False):
    if n is None and optional:
        return True
    return type(n) in (int, float) and math.isfinite(n) and minimum <= n <= maximum


def token(value, pattern=r"[a-zA-Z0-9_-]{1,48}"):
    return type(value) is str and re.fullmatch(pattern, value) is not None


class Validator:
    """Same capture-age/identity contract as the browser; stores rejected evidence."""

    def __init__(self):
        self.latest = {}
        self.retired = {}

    def decode(self, raw, kind, asset, received_ms, retained=False):
        if retained:
            raise ValueError("Retained observations are not fresh evidence")
        if len(raw) > 4096:
            raise ValueError("Observation exceeds 4 KB")
        p = json.loads(
            raw.decode("utf-8"),
            parse_constant=lambda v: (_ for _ in ()).throw(
                ValueError("Non-finite JSON")
            ),
        )
        if (
            type(p) is not dict
            or type(p.get("v")) not in (int, float)
            or p["v"] != 1
            or not token(p.get("boot_id"), r"[a-fA-F0-9]{8,32}")
            or not integer(p.get("seq"))
            or p["seq"] < 0
        ):
            raise ValueError("Invalid version, boot ID or sequence")
        captured = p.get("sent_at_ms")
        if (
            not integer(captured)
            or not received_ms - 15000 <= captured <= received_ms + 5000
        ):
            raise ValueError("Capture timestamp is stale or clock skew exceeds budget")
        if kind == "telemetry":
            if (
                asset not in ASSETS
                or p.get("device_id") != asset
                or p.get("state") not in STATES
                or not integer(p.get("uptime_ms"))
                or p["uptime_ms"] < 0
                or not token(p.get("firmware"), r"[a-zA-Z0-9._-]{1,48}")
            ):
                raise ValueError("Asset identity or state is invalid")
            for key, lo, hi in [
                ("battery_pct", 0, 100),
                ("speed_mps", 0, 10),
                ("wifi_rssi_dbm", -127, 0),
            ]:
                if key not in p or not measured(p[key], lo, hi, True):
                    raise ValueError("Missing or invalid " + key)
            pose = p.get("pose")
            if (
                "pose" not in p
                or pose is not None
                and (
                    type(pose) is not dict
                    or not all(
                        measured(pose.get(k), lo, hi)
                        for k, lo, hi in [
                            ("x_m", 0, 12),
                            ("y_m", 0, 6.6667),
                            ("heading_deg", -360, 360),
                        ]
                    )
                )
            ):
                raise ValueError("Pose requires measured map X/Y/heading or null")
            if p.get("frame_id") is not None and not token(p["frame_id"]):
                raise ValueError("Invalid map frame")
            if p.get("pose_source") is not None and p["pose_source"] not in {
                "encoder_odometry",
                "overhead_camera",
                "uwb",
                "external",
            }:
                raise ValueError("Invalid localization source")
            if (
                p.get("pose_sigma_m") is not None
                and not measured(p["pose_sigma_m"], 0.001, 2)
                or p.get("angular_speed_rps") is not None
                and not measured(p["angular_speed_rps"], -10, 10)
            ):
                raise ValueError("Invalid measurement metadata")
            key = asset
        elif kind == "inventory":
            if (
                not token(p.get("source_id"))
                or not token(p.get("frame_id"))
                or type(p.get("bins")) is not list
                or not 1 <= len(p["bins"]) <= 4
            ):
                raise ValueError("Invalid inventory source or frame")
            ids = set()
            for b in p["bins"]:
                if (
                    type(b) is not dict
                    or b.get("id") not in {"A", "B", "C", "D"}
                    or b["id"] in ids
                    or not integer(b.get("count"))
                    or not 0 <= b["count"] <= 100
                ):
                    raise ValueError("Invalid or repeated inventory bin")
                ids.add(b["id"])
            key = "inventory:" + p["source_id"]
        else:
            raise ValueError("Unknown observation type")
        old = self.latest.get(key)
        if old and (
            captured < old["sent_at_ms"]
            or p["boot_id"] in self.retired.get(key, [])
            or p["boot_id"] == old["boot_id"]
            and p["seq"] <= old["seq"]
        ):
            raise ValueError("Duplicate, retired boot or out-of-order observation")
        if old and p["boot_id"] != old["boot_id"]:
            self.retired[key] = (self.retired.get(key, []) + [old["boot_id"]])[-32:]
        self.latest[key] = p
        return p


def database(path):
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=5000")
    db.execute(
        "CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, session TEXT NOT NULL, received_ms INTEGER NOT NULL, received_monotonic_ns INTEGER NOT NULL, kind TEXT NOT NULL, asset TEXT, accepted INTEGER NOT NULL, packet TEXT, rejection TEXT)"
    )
    db.commit()
    return db


def mqtt_client():
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        raise SystemExit("Install requirements.txt before using network commands")
    host = os.environ.get("MQTT_HOST", "").strip()
    user = os.environ.get("MQTT_USER", "").strip()
    if not host or not user:
        raise SystemExit(
            "Set MQTT_HOST and MQTT_USER; use a broker read-only account for record"
        )
    password = os.environ.get("MQTT_PASSWORD") or getpass.getpass("MQTT password: ")
    prefix = os.environ.get("MQTT_PREFIX", "richris/warehouse01").strip().rstrip("/")
    if not token(prefix, r"[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*") or len(prefix) > 120:
        raise SystemExit("Invalid topic prefix")
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="richris_edge_" + uuid.uuid4().hex[:12],
        protocol=mqtt.MQTTv311,
    )
    client.username_pw_set(user, password)
    client.tls_set_context(
        ssl.create_default_context(cafile=os.environ.get("MQTT_CA") or None)
    )
    client.reconnect_delay_set(1, 10)
    return client, host, int(os.environ.get("MQTT_TLS_PORT", "8883")), prefix


def record(args):
    client, host, port, prefix = mqtt_client()
    topics = {prefix + "/" + id + "/telemetry": ("telemetry", id) for id in ASSETS}
    topics[prefix + "/inventory"] = ("inventory", None)
    inbox = queue.Queue(maxsize=5000)
    session = uuid.uuid4().hex
    overflow = 0

    def on_connect(c, userdata, flags, reason, properties):
        if reason.is_failure:
            print("Broker refused edge subscription", file=sys.stderr)
            return
        c.subscribe([(t, 0) for t in topics])
        print("Edge historian connected; four read-only topics requested", flush=True)

    def on_message(c, userdata, msg):
        nonlocal overflow
        if msg.topic not in topics:
            return
        kind, asset = topics[msg.topic]
        item = (
            time.time_ns() // 1000000,
            time.monotonic_ns(),
            kind,
            asset,
            bytes(msg.payload[:4097]),
            msg.retain,
        )
        try:
            inbox.put_nowait(item)
        except queue.Full:
            overflow += 1

    client.on_connect = on_connect
    client.on_message = on_message
    validator = Validator()
    db = database(args.database)
    client.connect(host, port, keepalive=30)
    client.loop_start()
    accepted = rejected = 0
    try:
        while True:
            try:
                received, monotonic, kind, asset, raw, retained = inbox.get(timeout=1)
            except queue.Empty:
                continue
            try:
                packet = validator.decode(raw, kind, asset, received, retained)
                ok, error = 1, None
                accepted += 1
            except (ValueError, UnicodeError, TypeError, KeyError) as exc:
                packet = None
                ok, error = 0, str(exc)[:240]
                rejected += 1
            db.execute(
                "INSERT INTO observations(session,received_ms,received_monotonic_ns,kind,asset,accepted,packet,rejection) VALUES(?,?,?,?,?,?,?,?)",
                (
                    session,
                    received,
                    monotonic,
                    kind,
                    asset,
                    ok,
                    (
                        json.dumps(packet, separators=(",", ":"), allow_nan=False)
                        if packet
                        else None
                    ),
                    error,
                ),
            )
            db.commit()
    finally:
        client.disconnect()
        client.loop_stop()
        db.close()
        print(
            f"Historian stopped: {accepted} accepted, {rejected} rejected, {overflow} receiver queue overflows. Counts are not radio packet-delivery measurements."
        )


def export(args):
    if not Path(args.database).is_file():
        raise SystemExit("No evidence database exists")
    db = sqlite3.connect(Path(args.database).resolve().as_uri() + "?mode=ro", uri=True)
    session = (
        args.session
        or db.execute(
            "SELECT session FROM observations ORDER BY id DESC LIMIT 1"
        ).fetchone()
    )
    if type(session) is tuple:
        session = session[0]
    if not session:
        raise SystemExit("No recorded session exists")
    rows = db.execute(
        "SELECT received_ms,kind,packet FROM (SELECT id,received_ms,kind,packet FROM observations WHERE session=? AND accepted=1 ORDER BY id DESC LIMIT ?) ORDER BY received_ms,id",
        (session, args.last),
    ).fetchall()
    if not rows:
        raise SystemExit("No accepted observations to export")
    result = {
        "schema": "replenish-twin-recording/v1",
        "version": "2.1.0",
        "notice": NOTICE,
        "provenance": "physical-recording",
        "source_note": "MQTT archive; physical provenance is a user assertion, not independently certified.",
        "edge_session": session,
        "events": [
            {"kind": kind, "received_at_ms": received, "packet": json.loads(packet)}
            for received, kind, packet in rows
        ],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    db.close()
    print(
        f"Exported {len(rows)} observations. Import the JSON in Twin lab and confirm map alignment."
    )


def vision_packet(observation, source, frame, boot, seq):
    captured = observation.get("captured_at_ms")
    bins = observation.get("bins")
    if not integer(captured) or type(bins) is not dict or not 1 <= len(bins) <= 4:
        raise ValueError("Need actual acquisition captured_at_ms and 1–4 measured bins")
    packet = {
        "v": 1,
        "source_id": source,
        "frame_id": frame,
        "boot_id": boot,
        "seq": seq,
        "sent_at_ms": captured,
        "bins": [{"id": id, "count": count} for id, count in bins.items()],
    }
    Validator().decode(
        json.dumps(packet).encode(), "inventory", None, time.time_ns() // 1000000
    )
    return packet


def vision(args):
    client, host, port, prefix = mqtt_client()
    if not token(args.source) or not token(args.frame):
        raise SystemExit("Use a valid source and map-frame identifier")
    client.connect(host, port, keepalive=30)
    client.loop_start()
    boot = uuid.uuid4().hex
    try:
        for seq, line in enumerate(sys.stdin):
            try:
                packet = vision_packet(
                    json.loads(line), args.source, args.frame, boot, seq
                )
                info = client.publish(
                    prefix + "/inventory", json.dumps(packet), qos=1, retain=False
                )
                info.wait_for_publish(timeout=5)
                if not info.is_published():
                    raise ValueError(
                        "Inventory publish was not acknowledged by the broker"
                    )
            except (ValueError, TypeError, KeyError, RuntimeError) as exc:
                print("Inventory observation rejected: " + str(exc), file=sys.stderr)
    finally:
        client.disconnect()
        client.loop_stop()


def bounded_last(value):
    n = int(value)
    if not 1 <= n <= 6000:
        raise argparse.ArgumentTypeError("--last must be 1–6000")
    return n


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    rec = sub.add_parser(
        "record", help="Archive valid and rejected telemetry without actuating robots"
    )
    rec.add_argument("--database", default="warehouse-evidence.sqlite3")
    exp = sub.add_parser("export", help="Export an archived session for browser replay")
    exp.add_argument("--database", default="warehouse-evidence.sqlite3")
    exp.add_argument("--output", default="physical-recording.json")
    exp.add_argument("--session")
    exp.add_argument("--last", type=bounded_last, default=6000)
    vis = sub.add_parser(
        "vision",
        help="Publish actual LabVIEW/perception observations from newline JSON",
    )
    vis.add_argument("--source", default="labview-vision")
    vis.add_argument("--frame", default="warehouse-01")
    args = parser.parse_args()
    try:
        {"record": record, "export": export, "vision": vision}[args.action](args)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
