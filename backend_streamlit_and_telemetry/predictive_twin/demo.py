"""Deterministic synthetic sensor sequence. Never represented as measured hardware."""
import math
from dataclasses import asdict

from .models import Calibration
from .telemetry import FleetTwin, Packet, ROBOT_IDS


def example_calibrations():
    return {rid: Calibration(.033, .033, .20, 600, 600, 2.0, .90, .01, .04, .5)
            for rid in ROBOT_IDS}


def demo_fleet():
    fleet = FleetTwin(example_calibrations())
    for seq in range(121):
        t = seq * .05
        for index, rid in enumerate(ROBOT_IDS):
            left, right = (10, 10) if index == 0 else (8, 11)
            gyro = 2 * math.pi * .033 * (right - left) / (600 * .05 * .20) + .01
            if rid == "amr01" and 3 <= t < 4:
                gyro += .12  # deliberate disagreement for detector demonstration
            packet = Packet(rid, "synthetic-demo", seq, t, seq * left, seq * right,
                            gyro, 7.4, .6 + index * .2, "synthetic_moving")
            fleet.ingest(asdict(packet), f"robot/{rid}/state", received=t)
    return fleet
