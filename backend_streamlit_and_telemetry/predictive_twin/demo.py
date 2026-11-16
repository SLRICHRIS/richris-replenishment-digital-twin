"""Deterministic synthetic sensor sequence. Never represented as measured hardware."""
import math
import hashlib
from dataclasses import asdict, replace
from functools import lru_cache
from pathlib import Path

from .models import Calibration
from .telemetry import FleetTwin, Packet, ROBOT_IDS

DEMO_TRIALS = {
    'baseline': dict(label='Baseline run',
        description='Generated straight-line motion with a gyro disagreement during 3–4 seconds.',
        expected='The residual history records the disagreement; the advisory clears after agreement returns.'),
    'turning': dict(label='Turning motion',
        description='Generated unequal wheel speeds with a matching, bias-corrected gyro rate.',
        expected='Local x, y and heading change together while the motion sensors remain consistent.'),
    'disagreement': dict(label='Sustained sensor disagreement',
        description='A generated +0.12 rad/s gyro offset begins at 3 seconds and continues to the final sample.',
        expected='The hold threshold activates a motion-inspection recommendation; it does not identify a fault.'),
    'low_charge': dict(label='Low battery reserve',
        description='Generated straight-line motion starts at 18% charge with a constant 0.6 A discharge.',
        expected='The assumed 20% reserve has been reached, so runtime to reserve is zero and recharging is recommended.'),
    'interruption': dict(label='Interrupted sensor stream',
        description='Generated packets from 3.00 through 4.50 seconds are omitted, creating a 1.6-second observation gap.',
        expected='Accumulated estimates become partial, the residual plot breaks at the gap and quantitative forecasts are withheld.'),
}


def example_calibrations():
    return {rid: Calibration(.033, .033, .20, 600, 600, 2.0, .90, .01, .04, .5)
            for rid in ROBOT_IDS}


@lru_cache(maxsize=1)
def source_fingerprints():
    root = Path(__file__).parent
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in ('models.py', 'telemetry.py', 'demo.py', 'insights.py', 'workspace_payload.py')}


def build_demo_trial(trial_id='baseline'):
    if not isinstance(trial_id, str) or trial_id not in DEMO_TRIALS:
        raise ValueError('Unknown generated trial')
    calibrations = example_calibrations()
    if trial_id == 'low_charge':
        calibrations['amr01'] = replace(calibrations['amr01'], initial_soc=.18)
    fleet = FleetTwin(calibrations)
    packets = []
    for seq in range(121):
        t = seq * .05
        if trial_id == 'interruption' and 60 <= seq <= 90:
            continue
        for rid in ROBOT_IDS:
            left, right = (8, 12) if trial_id == 'turning' else (10, 10)
            gyro = 2 * math.pi * .033 * (right - left) / (600 * .05 * .20) + .01
            if (trial_id == 'baseline' and 3 <= t < 4) or (trial_id == 'disagreement' and t >= 3):
                gyro += .12
            boot_id = 'synthetic-demo' if trial_id == 'baseline' else 'synthetic-demo-' + trial_id
            packet = asdict(Packet(rid, boot_id, seq, t, seq * left, seq * right,
                                  gyro, 7.0 if trial_id == 'low_charge' else 7.4,
                                  .6, 'synthetic_moving'))
            packets.append(packet)
            fleet.ingest(packet, f'robot/{rid}/state', received=t)
    metadata = dict(id=trial_id, **DEMO_TRIALS[trial_id], source='synthetic',
                    duration_s=6, sample_period_s=.05, packet_count=len(packets),
                    calibration=asdict(calibrations['amr01']), packets=packets,
                    source_sha256=source_fingerprints())
    return fleet, metadata


def demo_fleet(trial_id='baseline'):
    return build_demo_trial(trial_id)[0]
