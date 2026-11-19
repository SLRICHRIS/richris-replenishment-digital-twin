from types import SimpleNamespace
from dataclasses import asdict
from unittest.mock import patch
import pytest

from backend_streamlit_and_telemetry.predictive_twin.workspace_payload import workspace_payload, quality_display
from backend_streamlit_and_telemetry.predictive_twin.database import DatabaseSchemaError


def test_existing_dashboard_receives_only_derived_sensor_display_data():
    payload = workspace_payload('demo')
    assert payload['mode'] == 'demo'
    assert set(payload['robots']) == {'amr01'}
    a = payload['robots']['amr01']
    assert a['forecast_pose'] is not None
    assert len(a['history']) <= 241
    assert any(row['advisory'] for row in a['history'])
    assert a['quality_label'] == 'Demo data'
    assert a['quality_tone'] == 'info'
    assert a['residual_threshold_rad_s'] > 0
    assert a['residual_hold_s'] > 0
    assert not any(key in str(payload).lower() for key in ['password', 'username', 'broker.example'])


def test_unconfigured_live_returns_no_synthetic_robot_state():
    with patch('backend_streamlit_and_telemetry.predictive_twin.workspace_payload.st.secrets', {}):
        result = workspace_payload('live')
    assert result['robots'] == {}
    assert result['notice']['label'] == 'Database not configured'


def test_storage_check_does_not_require_calibration_and_sanitizes_errors():
    from backend_streamlit_and_telemetry.predictive_twin.workspace_payload import database_connection
    from backend_streamlit_and_telemetry.predictive_twin.database import DatabaseSchemaError, SensorDatabase
    from unittest.mock import Mock
    module = 'backend_streamlit_and_telemetry.predictive_twin.workspace_payload'
    db = Mock(spec=SensorDatabase)
    with patch(module + '.st.secrets', {'database': {'url': 'postgresql://private:secret@host/db'}}), \
         patch(module + '.database_reader', return_value=db):
        assert database_connection() == (db, 'ready')
        db.assert_schema_ready.side_effect = DatabaseSchemaError('private:secret@host')
        assert database_connection() == (None, 'schema_not_ready')
        db.healthcheck.side_effect = RuntimeError('private:secret@host')
        assert database_connection() == (None, 'unreachable')
    with patch(module + '.st.secrets', {}):
        assert database_connection() == (None, 'not_configured')


def test_configured_database_without_calibration_is_not_labelled_disconnected():
    from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase
    from unittest.mock import Mock
    module = 'backend_streamlit_and_telemetry.predictive_twin.workspace_payload'
    with patch(module + '.st.secrets', {'database': {'url': 'postgresql://private:secret@host/db'}}), \
         patch(module + '.database_reader', return_value=Mock(spec=SensorDatabase)):
        payload = workspace_payload('live')
    assert payload['robots'] == {}
    assert payload['notice']['label'] == 'Measured calibration required'
    assert 'database is configured' in payload['notice']['detail']
    assert 'private' not in str(payload)
    assert 'secret' not in str(payload)


def test_fresh_commissioning_packet_enables_observation_guidance_independently():
    from automated_software_checks.predictive_twin_checks.test_insights import observation_data
    from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase
    from unittest.mock import Mock
    module='backend_streamlit_and_telemetry.predictive_twin.workspace_payload'
    physical=observation_data()['physical_telemetry']
    with patch(module+'.st.secrets',{'database':{'url':'postgresql://private:secret@host/db'}}), \
         patch(module+'.database_reader',return_value=Mock(spec=SensorDatabase)), \
         patch('backend_streamlit_and_telemetry.predictive_twin.physical_telemetry.display_payload',return_value=physical):
        payload=workspace_payload('live')
    assert payload['robots']=={} and payload['insights']['ready']
    assert payload['insights']['scope']=='physical_observation'
    assert payload['notice']['label']=='Live physical observations'


@pytest.mark.parametrize('error,label', [
    (RuntimeError('private:secret@host'), 'Database connection failed'),
    (DatabaseSchemaError('private:secret@host'), 'Database schema needs attention'),
])
def test_connection_failure_keeps_its_own_source_label(error, label):
    module = 'backend_streamlit_and_telemetry.predictive_twin.workspace_payload'
    with patch(module + '.st.secrets', {'database': {'url': 'postgresql://private:secret@host/db'}}), \
         patch(module + '.database_reader', side_effect=error):
        payload = workspace_payload('live')
    assert payload['notice']['label'] == label
    assert payload['robots'] == {}
    assert 'secret' not in str(payload)


def test_live_display_does_not_leak_database_credentials_or_forecast_stale_robots():
    from backend_streamlit_and_telemetry.predictive_twin.demo import demo_fleet, example_calibrations
    calibrations = {'amr01': asdict(example_calibrations()['amr01'])}
    secrets = {'commissioning': {'measured_calibration_confirmed': True},
               'database': {'url': 'postgresql+psycopg://private:secret@db.example/amr'},
               'calibration': SimpleNamespace(to_dict=lambda: calibrations)}
    fleet = demo_fleet()  # Fixed synthetic times are stale in real monotonic time.
    db = SimpleNamespace(read_snapshot=lambda **kwargs: fleet.snapshots()['amr01'])
    with patch('backend_streamlit_and_telemetry.predictive_twin.workspace_payload.st.secrets', secrets), \
         patch('backend_streamlit_and_telemetry.predictive_twin.workspace_payload.database_reader', return_value=db):
        payload = workspace_payload('live')
    assert payload['mode'] == 'live'
    for robot in payload['robots'].values():
        assert robot['stale']
        assert robot['forecast_pose'] is None
        assert robot['runtime_hours'] is None
    assert 'secret' not in str(payload)
    assert 'private' not in str(payload)


@pytest.mark.parametrize('code,label', [
    ('STALE', 'Readings out of date'), ('CLOCK_SKEW', 'Clock mismatch'),
    ('CALIBRATION_MISMATCH', 'Calibration mismatch'), ('SEQUENCE_GAP', 'Missing sensor packets'),
    ('CONTINUITY_LOST', 'Partial estimates after data loss'),
    ('ANCHORED', 'First sample received'), ('NO_DATA', 'No sensor data yet'),
])
def test_quality_codes_have_plain_language_labels_and_explanations(code, label):
    display = quality_display({'quality': code})
    assert display['label'] == label
    assert len(display['detail']) > 30
    assert display['tone'] != 'success'


def test_stale_and_partial_flags_cannot_receive_a_healthy_data_label():
    assert quality_display({'quality': 'OK', 'stale': True})['label'] == 'Readings out of date'
    assert quality_display({'quality': 'OK', 'continuity_lost': True})['tone'] == 'warning'
    assert quality_display({'quality': 'UNKNOWN'})['tone'] == 'warning'


def test_display_decimation_preserves_missing_residual_boundary():
    from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
    calibrations = {'amr01': asdict(example_calibrations()['amr01'])}
    secrets = {'commissioning': {'measured_calibration_confirmed': True},
               'database': {'url': 'sqlite://'},
               'calibration': SimpleNamespace(to_dict=lambda: calibrations)}
    history = [dict(sample_time_s=i * .05, x_m=0, y_m=0, soc=.9,
                    residual_rad_s=None if i == 1 else .01, advisory=False)
               for i in range(500)]
    snapshot = dict(pose=(0, 0, 0), soc=.9, energy_wh=0, quality='CONTINUITY_LOST',
                    age_s=.1, stale=False, continuity_lost=True, raw={}, derived={}, history=history)
    db = SimpleNamespace(read_snapshot=lambda **kwargs: snapshot)
    with patch('backend_streamlit_and_telemetry.predictive_twin.workspace_payload.st.secrets', secrets), \
         patch('backend_streamlit_and_telemetry.predictive_twin.workspace_payload.database_reader', return_value=db):
        result = workspace_payload('live')['robots']['amr01']
    assert len(result['history']) <= 241
    assert result['history'][1]['plot_break_before'] is True
    assert result['forecast_pose'] is None
