from types import SimpleNamespace
from dataclasses import asdict
from unittest.mock import patch

from backend_streamlit_and_telemetry.predictive_twin.workspace_payload import workspace_payload


def test_existing_dashboard_receives_only_derived_sensor_display_data():
    payload = workspace_payload('demo')
    assert payload['mode'] == 'demo'
    assert set(payload['robots']) == {'amr01'}
    a = payload['robots']['amr01']
    assert a['forecast_pose'] is not None
    assert len(a['history']) <= 241
    assert any(row['advisory'] for row in a['history'])
    assert not any(key in str(payload).lower() for key in ['password', 'username', 'broker.example'])


def test_unconfigured_live_returns_no_synthetic_robot_state():
    with patch('backend_streamlit_and_telemetry.predictive_twin.workspace_payload.st.secrets', {}):
        result = workspace_payload('live')
    assert result['robots'] == {}
    assert 'not configured' in result['status']


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
