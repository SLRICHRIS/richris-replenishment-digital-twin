"""Verify a downloaded synthetic trial by replaying its packets without a database.

Usage: python -m project_maintenance_scripts.replay_generated_trial trial.json
Fingerprints establish source alignment, not signed origin or hardware validity.
"""
import argparse
import json
import math
from pathlib import Path

from backend_streamlit_and_telemetry.predictive_twin.demo import DEMO_TRIALS, source_fingerprints
from backend_streamlit_and_telemetry.predictive_twin.insights import predictive_insights
from backend_streamlit_and_telemetry.predictive_twin.models import Calibration, motion_forecast, runtime_hours
from backend_streamlit_and_telemetry.predictive_twin.telemetry import FleetTwin
from backend_streamlit_and_telemetry.predictive_twin.workspace_payload import quality_display


def compare(actual, expected, path):
    if isinstance(actual, bool) or actual is None or isinstance(actual, str):
        if type(expected) is not type(actual) or actual != expected:
            raise ValueError('Evidence differs at ' + path)
    elif isinstance(actual, (int, float)):
        if (isinstance(expected, bool) or not isinstance(expected, (int, float)) or
                not math.isfinite(expected) or not math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-12)):
            raise ValueError('Evidence differs at ' + path)
    elif isinstance(actual, dict):
        if not isinstance(expected, dict) or set(actual) != set(expected):
            raise ValueError('Evidence fields differ at ' + path)
        for key in actual:
            compare(actual[key], expected[key], path + '.' + key)
    elif isinstance(actual, (list, tuple)):
        if not isinstance(expected, (list, tuple)) or len(actual) != len(expected):
            raise ValueError('Evidence shape differs at ' + path)
        for index, (a, b) in enumerate(zip(actual, expected)):
            compare(a, b, path + '.' + str(index))


def verify_trial_evidence(bundle):
    if not isinstance(bundle, dict):
        raise ValueError('Expected a synthetic-trial object')
    if (bundle.get('evidence_format') != 'amr01.synthetic-trial.v1' or
            bundle.get('source') != 'synthetic' or bundle.get('hardware_validation') is not False):
        raise ValueError('Expected a labelled synthetic-trial export')
    trial = bundle['trial']
    if not isinstance(trial, dict) or not isinstance(trial.get('id'), str) or trial['id'] not in DEMO_TRIALS or trial.get('source') != 'synthetic':
        raise ValueError('Unknown generated trial')
    if trial.get('source_sha256') != source_fingerprints():
        raise ValueError('Source fingerprints differ; use the matching repository revision')
    packets = trial['packets']
    if not isinstance(packets, list) or not 1 <= len(packets) <= 121 or trial.get('packet_count') != len(packets):
        raise ValueError('Invalid generated packet count')
    if bundle.get('snapshot_time_s') != 6:
        raise ValueError('This evidence format requires a six-second snapshot')
    calibration = Calibration(**trial['calibration'])
    fleet = FleetTwin({'amr01': calibration})
    for packet in packets:
        if not fleet.ingest(packet, 'robot/amr01/state', received=packet['sample_time_s']):
            raise ValueError('A generated packet failed admission during replay')
    robot = fleet.snapshots(now=6)['amr01']
    expected = bundle['outputs']['amr01']
    for field in ('pose', 'soc', 'energy_wh', 'quality', 'continuity_lost', 'raw', 'derived'):
        compare(robot[field], expected[field], 'outputs.amr01.' + field)
    derived = robot['derived']
    eligible = robot['quality'] == 'OK' and not robot['stale'] and not robot['continuity_lost'] and bool(derived)
    forecast = motion_forecast(robot['pose'], derived['v_left_m_s'], derived['v_right_m_s'], calibration.track_m)[-1] if eligible else None
    runtime = runtime_hours(robot['soc'], .2, calibration.capacity_ah, robot['raw']['battery_current_a']) if eligible else None
    compare(forecast, expected['forecast_pose'], 'outputs.amr01.forecast_pose')
    compare(runtime, expected['runtime_hours'], 'outputs.amr01.runtime_hours')
    display = quality_display(robot, demo=True, demo_detail=trial['description'] + ' ' + trial['expected'])
    robot.update(forecast_pose=forecast, runtime_hours=runtime,
                 quality_label=display['label'], quality_detail=display['detail'])
    compare(predictive_insights(dict(mode='demo', robots={'amr01':robot})), bundle['insights'], 'insights')
    return dict(trial=trial['id'], packets_replayed=len(packets),
                checks=['source fingerprints', 'packet admission', 'final state', 'forecasts', 'recommendations'],
                hardware_validation=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence', type=Path)
    args = parser.parse_args()
    try:
        if args.evidence.stat().st_size > 2_000_000:
            raise ValueError('Evidence file exceeds the 2 MB limit')
        def reject_constant(_value):
            raise ValueError('Evidence contains a non-finite JSON value')
        bundle = json.loads(args.evidence.read_text(), parse_constant=reject_constant)
        result = verify_trial_evidence(bundle)
    except (OSError, KeyError, TypeError, ValueError) as error:
        parser.exit(1, 'FAIL: ' + str(error) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
