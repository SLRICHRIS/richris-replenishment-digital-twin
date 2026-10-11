import json
import sqlite3
import tempfile
import time
import unittest
from argparse import Namespace
from pathlib import Path
from backend_streamlit_and_telemetry.mqtt_recording_and_inventory_bridge.mqtt_telemetry_recorder_and_inventory_publisher import (
    Validator,
    database,
    export,
    vision_packet,
    bounded_last,
)
from backend_streamlit_and_telemetry.mqtt_recording_and_inventory_bridge.labview_inventory_observation_adapter import (
    inventory_observation,
)


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.now = time.time_ns() // 1000000
        self.p = {
            "v": 1,
            "device_id": "amr-01",
            "boot_id": "01234567abcdef00",
            "seq": 0,
            "sent_at_ms": self.now,
            "uptime_ms": 0,
            "state": "idle",
            "firmware": "richris-esp32-1.0.0",
            "pose": None,
            "battery_pct": None,
            "speed_mps": None,
            "wifi_rssi_dbm": -60,
        }

    def decode(self, v=None, **kw):
        return (v or Validator()).decode(
            json.dumps({**self.p, **kw}).encode(), "telemetry", "amr-01", self.now
        )

    def test_identity_null_zero_and_replay_rejection(self):
        v = Validator()
        self.assertIsNone(self.decode(v)["pose"])
        with self.assertRaises(ValueError):
            self.decode(v)
        with self.assertRaises(ValueError):
            self.decode(device_id="amr-02")
        with self.assertRaises(ValueError):
            self.decode(speed_mps=float("nan"))
        p = self.decode(
            seq=1,
            battery_pct=0,
            speed_mps=0,
            pose={"x_m": 0, "y_m": 0, "heading_deg": 0},
        )
        self.assertEqual(p["battery_pct"], 0)

    def test_retained_age_and_boot_retirement(self):
        with self.assertRaises(ValueError):
            Validator().decode(
                json.dumps(self.p).encode(), "telemetry", "amr-01", self.now, True
            )
        with self.assertRaises(ValueError):
            self.decode(sent_at_ms=self.now - 16000)
        v = Validator()
        self.decode(v)
        self.decode(v, boot_id="abcdef0123456789", seq=0, sent_at_ms=self.now + 1)
        with self.assertRaises(ValueError):
            self.decode(v, seq=1, sent_at_ms=self.now + 2)

    def test_browser_contract_types(self):
        for value in [True, False, "1", None]:
            with self.assertRaises(ValueError):
                Validator().decode(
                    json.dumps({**self.p, "v": value}).encode(),
                    "telemetry",
                    "amr-01",
                    self.now,
                )
        self.assertEqual(
            Validator().decode(
                json.dumps({**self.p, "v": 1.0}).encode(),
                "telemetry",
                "amr-01",
                self.now,
            )["v"],
            1,
        )
        with self.assertRaises(ValueError):
            self.decode(boot_id=12345678)

    def test_inventory_and_labview_preserve_unknowns(self):
        line = inventory_observation(self.now, '{"A":0,"B":42}')
        packet = vision_packet(
            json.loads(line), "labview-vision", "warehouse-01", "abcdef1234567890", 0
        )
        self.assertEqual([b["id"] for b in packet["bins"]], ["A", "B"])
        self.assertEqual(packet["bins"][0]["count"], 0)
        for counts in ['{"A":true}', '{"A":null}', '{"X":1}', '{"A":-1}', "{}"]:
            with self.assertRaises(ValueError):
                inventory_observation(self.now, counts)
        with self.assertRaises(ValueError):
            vision_packet(
                {"bins": {"A": 1}}, "vision", "warehouse-01", "abcdef1234567890", 0
            )

    def test_sqlite_export_and_session_boundaries(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "evidence.sqlite3")
            out = str(Path(folder) / "recording.json")
            db = database(path)
            for session, n, ok in [("old", 0, 1), ("new", 1, 1), ("new", 2, 0)]:
                db.execute(
                    "INSERT INTO observations(session,received_ms,received_monotonic_ns,kind,asset,accepted,packet,rejection) VALUES(?,?,?,?,?,?,?,?)",
                    (
                        session,
                        self.now + n,
                        n,
                        "telemetry",
                        "amr-01",
                        ok,
                        (
                            json.dumps({**self.p, "seq": n, "sent_at_ms": self.now + n})
                            if ok
                            else None
                        ),
                        "bad" if not ok else None,
                    ),
                )
            db.commit()
            db.close()
            export(Namespace(database=path, output=out, session=None, last=6000))
            r = json.loads(Path(out).read_text())
            self.assertEqual(r["edge_session"], "new")
            self.assertEqual(len(r["events"]), 1)
            self.assertEqual(r["events"][0]["packet"]["seq"], 1)
            self.assertEqual(r["schema"], "replenish-twin-recording/v1")

    def test_limit_and_invalid_database(self):
        self.assertEqual(bounded_last("6000"), 6000)
        with self.assertRaises(Exception):
            bounded_last("6001")
        with self.assertRaises(SystemExit):
            export(
                Namespace(
                    database="/no/such/evidence.sqlite3",
                    output="unused.json",
                    session=None,
                    last=1,
                )
            )


if __name__ == "__main__":
    unittest.main()
