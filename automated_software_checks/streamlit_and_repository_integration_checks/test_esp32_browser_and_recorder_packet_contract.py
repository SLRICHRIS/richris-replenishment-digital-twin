"""Compile the firmware's serializer; validate its actual bytes in JS and Python."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from backend_streamlit_and_telemetry.mqtt_recording_and_inventory_bridge.mqtt_telemetry_recorder_and_inventory_publisher import (
    Validator,
)

ROOT = Path(__file__).resolve().parents[2]
SKETCH = ROOT / "esp32_telemetry_firmware/publish_esp32_robot_telemetry"
BROWSER = (
    ROOT
    / "frontend_warehouse_dashboard/browser_modules/esp32_telemetry_monitoring/robot_telemetry_validation_and_freshness.js"
)


class FirmwareContractTests(unittest.TestCase):
    def test_firmware_serialized_bytes_in_both_production_validators(self):
        ino = (SKETCH / "publish_esp32_robot_telemetry.ino").read_text()
        self.assertIn('#include "robot_telemetry_packet_serializer.h"', ino)
        self.assertRegex(ino, r"encodeTelemetryPacket\s*\(\s*payload")
        # The version is read from the sketch, rather than copied into a fixture.
        import re

        firmware = re.search(r'FIRMWARE\[\]\s*=\s*"([^"]+)"', ino)[1]
        harness = r"""
#include "robot_telemetry_packet_serializer.h"
int main(int argc, char** argv) {
  char payload[768];
  for (unsigned long long seq = 1; seq <= 2; ++seq) {
    int size = encodeTelemetryPacket(payload, sizeof(payload), "amr-01",
      "01234567abcdef00", seq, 1791724800000ULL, 1000UL,
      seq == 1 ? "unknown" : "idle", seq == 1 ? "null" : "0.0000",
      seq == 1 ? "null" : "{\"x_m\":0,\"y_m\":0,\"heading_deg\":0}",
      seq == 1 ? "null" : "0.0000", -60, argv[1]);
    if (size <= 0 || size >= int(sizeof(payload))) return 1;
    puts(payload);
  }
}
"""
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "firmware_serializer_contract.cpp"
            binary = Path(directory) / "firmware_serializer_contract"
            source.write_text(harness)
            subprocess.run(
                [
                    "g++",
                    "-std=c++17",
                    "-Wall",
                    "-Werror",
                    "-Wno-unused-parameter",
                    "-I",
                    str(SKETCH),
                    str(source),
                    "-o",
                    str(binary),
                ],
                check=True,
                capture_output=True,
            )
            packets = subprocess.check_output(
                [str(binary), firmware], text=True
            ).splitlines()
        javascript = """
import {decodeTelemetry} from BROWSER_URL;
import assert from "node:assert/strict";
let input=''; for await (const chunk of process.stdin) input += chunk;
const rows=JSON.parse(input);
for(const raw of rows){const bad=JSON.parse(raw);bad.esp32_telemetry_firmware=bad.firmware;delete bad.firmware;assert.throws(()=>decodeTelemetry(JSON.stringify(bad),"amr-01",1791724800000),/Firmware/);}
console.log(JSON.stringify(rows.map(raw=>decodeTelemetry(raw,'amr-01',1791724800000))));
""".replace("BROWSER_URL", json.dumps(BROWSER.as_uri()))
        browser = json.loads(
            subprocess.check_output(
                ["node", "--input-type=module", "-e", javascript],
                input=json.dumps(packets),
                text=True,
            )
        )
        recorder = Validator()
        for raw, decoded in zip(packets, browser):
            packet = recorder.decode(raw.encode(), "telemetry", "amr-01", 1791724800000)
            self.assertEqual(packet["firmware"], firmware)
            self.assertNotIn("esp32_telemetry_firmware", packet)
            for key, value in packet.items():
                self.assertEqual(decoded[key], value, key)
        self.assertIsNone(browser[0]["battery_pct"])
        self.assertEqual(browser[1]["battery_pct"], 0)
        renamed = json.loads(packets[0])
        renamed["esp32_telemetry_firmware"] = renamed.pop("firmware")
        with self.assertRaises(ValueError):
            Validator().decode(
                json.dumps(renamed).encode(), "telemetry", "amr-01", 1791724800000
            )


if __name__ == "__main__":
    unittest.main()
