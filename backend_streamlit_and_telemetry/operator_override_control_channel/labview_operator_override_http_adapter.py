"""LabVIEW Python Node / command-line adapter for the independent Coordinator."""

import json
import os
from urllib.request import Request, urlopen


def operator_command(device_id, action, command_id, timeout_ms=2000):
    """Use one stable command_id across retries; returns JSON for LabVIEW parsing."""
    packet = {
        "device_id": device_id,
        "action": action,
        "command_id": command_id,
        "timeout_ms": timeout_ms,
    }
    request = Request(
        "http://127.0.0.1:8765/commands",
        json.dumps(packet).encode(),
        {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + os.environ["OVERRIDE_OPERATOR_TOKEN"],
        },
        method="POST",
    )
    with urlopen(request, timeout=3) as response:
        return response.read().decode()


def command_status(command_id):
    request = Request(
        "http://127.0.0.1:8765/commands/" + command_id,
        headers={"Authorization": "Bearer " + os.environ["OVERRIDE_OPERATOR_TOKEN"]},
    )
    with urlopen(request, timeout=3) as response:
        return response.read().decode()
