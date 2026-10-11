"""Control semantics, replay protection and device execution correlation."""

import json
import unittest
from backend_streamlit_and_telemetry.operator_override_control_channel.operator_override_command_coordinator import (
    CommandCoordinator,
)


class OverrideTests(unittest.TestCase):
    def setUp(self):
        self.ns = 1000000000
        self.now = 1791724800000
        self.published = []
        self.c = CommandCoordinator(
            lambda asset, p: self.published.append((asset, p)),
            clock=lambda: self.ns,
            wall_clock=lambda: self.now,
        )
        self.packet = {
            "v": 1,
            "device_id": "amr-01",
            "boot_id": "01234567abcdef00",
            "seq": 1,
            "sent_at_ms": self.now,
            "uptime_ms": 1000,
            "state": "idle",
            "firmware": "richris-esp32-1.0.0",
            "battery_pct": None,
            "pose": None,
            "speed_mps": None,
            "wifi_rssi_dbm": -60,
        }
        self.c.observe("amr-01", json.dumps(self.packet).encode())
        self.addCleanup(self.c.close)

    def ack(self, command, status="executed", **changes):
        p = {
            "v": 1,
            "command_id": command["packet"]["command_id"],
            "device_id": "amr-01",
            "boot_id": self.packet["boot_id"],
            "status": status,
            **changes,
        }
        return self.c.acknowledge("amr-01", json.dumps(p).encode())

    def test_execution_not_transport_acceptance_is_latency(self):
        command = self.c.request("amr-01", "stop")
        self.ns += 2000000
        self.assertIsNone(self.ack(command, "accepted")["latency_ms"])
        self.ns += 5000000
        executed = self.ack(command)
        self.assertEqual(executed["latency_ms"], 7)
        self.ns += 9000000
        self.assertEqual(self.ack(command)["latency_ms"], 7)

    def test_duplicate_request_never_republishes(self):
        command = self.c.request("amr-01", "pause")
        self.c.request("amr-01", "pause", command["packet"]["command_id"])
        self.assertEqual(len(self.published), 1)
        with self.assertRaises(ValueError):
            self.c.request("amr-01", "resume", command["packet"]["command_id"])

    def test_boot_identity_and_retained_ack(self):
        command = self.c.request("amr-01", "stop")
        with self.assertRaises(ValueError):
            self.ack(command, boot_id="ffffffffffffffff")
        with self.assertRaises(ValueError):
            self.c.acknowledge("amr-01", b"{}", retained=True)
        self.assertEqual(self.c.get(command["packet"]["command_id"])["status"], "sent")

    def test_timeout_and_rejection_never_count_as_execution(self):
        command = self.c.request("amr-01", "stop", timeout_ms=100)
        self.ns += 100000000
        result = self.ack(command)
        self.assertEqual(result["status"], "timed_out")
        self.assertIsNone(result["latency_ms"])
        rejected = self.c.request("amr-01", "pause")
        result = self.ack(rejected, "rejected", reason="Controller fault latched")
        self.assertEqual(result["status"], "rejected")
        self.assertIsNone(result["latency_ms"])

    def test_stop_is_not_blocked_by_stale_measurements(self):
        self.ns += 6000000000
        self.now += 6000
        stop = self.c.request("amr-01", "stop")
        self.assertEqual(stop["packet"]["target_boot_id"], self.packet["boot_id"])
        with self.assertRaises(ValueError):
            self.c.request("amr-01", "resume")

    def test_pending_requests_expire_without_polling(self):
        command = self.c.request("amr-01", "stop", timeout_ms=100)
        self.ns += 100000001
        self.c.expire_pending()
        self.assertEqual(
            self.c._get(command["packet"]["command_id"])["status"], "timed_out"
        )

    def test_fresh_identity_and_allowlisted_actions(self):
        with self.assertRaises(ValueError):
            self.c.request("amr-01", "drive")
        self.ns += 6000000000
        with self.assertRaises(ValueError):
            self.c.request("amr-01", "resume")


if __name__ == "__main__":
    unittest.main()
