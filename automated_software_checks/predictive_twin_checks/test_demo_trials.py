"""Independent expectations and replay evidence for the faculty demonstration."""
import hashlib
import json
import math
from pathlib import Path
from unittest.mock import patch

import pytest

from backend_streamlit_and_telemetry.predictive_twin.demo import DEMO_TRIALS, build_demo_trial
from backend_streamlit_and_telemetry.predictive_twin.models import Calibration
from backend_streamlit_and_telemetry.predictive_twin.telemetry import FleetTwin
from backend_streamlit_and_telemetry.predictive_twin.workspace_payload import workspace_payload
from project_maintenance_scripts.replay_generated_trial import verify_trial_evidence


def test_baseline_has_analytic_distance_charge_and_energy_and_recovered_advisory():
    robot = workspace_payload('demo')['robots']['amr01']
    distance = 2 * math.pi * .033 * 1200 / 600
    assert robot['pose'] == pytest.approx((distance, 0, 0))
    assert robot['soc'] == pytest.approx(.9 - .6 * 6 / (3600 * 2))
    assert robot['energy_wh'] == pytest.approx(7.4 * .6 * 6 / 3600)
    assert any(h['advisory'] for h in robot['history'])
    assert robot['derived']['advisory'] is False


def test_turning_matches_the_constant_curvature_solution_without_gyro_disagreement():
    robot = workspace_payload('demo', 'turning')['robots']['amr01']
    theta = 2 * math.pi * .033 * (120 * 4) / (600 * .2)
    assert robot['pose'] == pytest.approx((.5 * math.sin(theta), .5 * (1 - math.cos(theta)), theta), abs=1e-6)
    assert not any(h['advisory'] for h in robot['history'])
    assert robot['derived']['residual_rad_s'] == pytest.approx(0, abs=1e-12)


def test_gyro_disagreement_changes_the_advisory_without_fabricating_encoder_pose():
    baseline = workspace_payload('demo')
    fault = workspace_payload('demo', 'disagreement')
    a, b = baseline['robots']['amr01'], fault['robots']['amr01']
    assert b['pose'] == a['pose']
    assert b['soc'] == a['soc']
    assert b['derived']['residual_rad_s'] == pytest.approx(.12)
    assert b['derived']['advisory'] is True
    assert fault['insights']['recommendations'][0]['title'] == 'Inspect the motion sensors'


def test_low_charge_and_missing_interval_produce_different_operator_decisions():
    low = workspace_payload('demo', 'low_charge')
    assert low['robots']['amr01']['soc'] == pytest.approx(.1795)
    assert low['robots']['amr01']['runtime_hours'] == 0
    assert low['insights']['recommendations'][0]['title'] == 'Recharge before extending the trial'
    interrupted = workspace_payload('demo', 'interruption')
    robot = interrupted['robots']['amr01']
    assert interrupted['demo_trial']['packet_count'] == 90
    assert robot['continuity_lost']
    assert robot['forecast_pose'] is None and robot['runtime_hours'] is None
    assert not interrupted['insights']['ready']
    assert any(h['plot_break_before'] for h in robot['history'])
    assert robot['quality_label'] == 'Demo · Partial estimates after data loss'
    assert robot['pose'][0] < workspace_payload('demo')['robots']['amr01']['pose'][0]


@pytest.mark.parametrize('trial', DEMO_TRIALS)
def test_exported_trial_inputs_replay_to_the_same_outputs_without_database_access(trial):
    with patch('backend_streamlit_and_telemetry.predictive_twin.workspace_payload.database_reader', side_effect=AssertionError('Demo must not access PostgreSQL')):
        exported = json.loads(json.dumps(workspace_payload('demo', trial), allow_nan=False))
    meta = exported['demo_trial']
    assert meta['source'] == 'synthetic'
    assert len(meta['packets']) == meta['packet_count']
    replay = FleetTwin({'amr01': Calibration(**meta['calibration'])})
    for packet in meta['packets']:
        assert replay.ingest(packet, 'robot/amr01/state', received=packet['sample_time_s'])
    result = replay.snapshots(now=meta['duration_s'])['amr01']
    expected = exported['robots']['amr01']
    for key in ('soc', 'energy_wh', 'quality', 'continuity_lost', 'derived', 'raw'):
        assert result[key] == expected[key]
    assert result['pose'] == pytest.approx(expected['pose'])
    source_root = Path(__file__).resolve().parents[2] / 'backend_streamlit_and_telemetry/predictive_twin'
    for name, digest in meta['source_sha256'].items():
        assert hashlib.sha256((source_root / name).read_bytes()).hexdigest() == digest
    assert 'writer_url' not in json.dumps(exported)
    result = verify_trial_evidence(dict(evidence_format='amr01.synthetic-trial.v1',
        source='synthetic', hardware_validation=False, trial=meta, snapshot_time_s=6,
        outputs=exported['robots'], insights=exported['insights']))
    assert result['packets_replayed'] == len(meta['packets'])
    assert result['hardware_validation'] is False


def test_replay_verifier_detects_modified_results_and_source_mismatch():
    exported = workspace_payload('demo', 'disagreement')
    bundle = json.loads(json.dumps(dict(evidence_format='amr01.synthetic-trial.v1',
        source='synthetic', hardware_validation=False, trial=exported['demo_trial'], snapshot_time_s=6,
        outputs=exported['robots'], insights=exported['insights'])))
    bundle['outputs']['amr01']['soc'] += .1
    with pytest.raises(ValueError, match='outputs.amr01.soc'):
        verify_trial_evidence(bundle)
    bundle['trial']['source_sha256'] = {'../private': 'untrusted'}
    with pytest.raises(ValueError, match='Source fingerprints differ'):
        verify_trial_evidence(bundle)
    with pytest.raises(ValueError, match='Expected'):
        verify_trial_evidence([])


@pytest.mark.parametrize('invalid', ['../private', '', None, []])
def test_unknown_generated_trials_are_rejected(invalid):
    with pytest.raises(ValueError, match='Unknown generated trial'):
        build_demo_trial(invalid)
