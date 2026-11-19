"""Read-only display checks using synthetic rows in isolated SQLite only."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select

from backend_streamlit_and_telemetry.predictive_twin.physical_telemetry import metadata, samples, display_payload, read_records
from backend_streamlit_and_telemetry.predictive_twin.commissioning_profile import profile_payload, wheel_magnitude_estimates, gyro_bias_correction

ROOT = Path(__file__).resolve().parents[2]


def synthetic_record():
    program = "import {envelope} from './backend_streamlit_and_telemetry/commissioning_webhook/tests/fixture.mjs';import{validateEnvelope}from'./backend_streamlit_and_telemetry/commissioning_webhook/contract.mjs';const record=validateEnvelope(envelope());console.log(JSON.stringify(record));"
    result = subprocess.run(['node', '--input-type=module', '-e', program], cwd=ROOT, capture_output=True, text=True, check=True)
    row = json.loads(result.stdout)
    row['received_at'] = datetime.fromisoformat(row['received_at'].replace('Z', '+00:00'))
    row['stored_at'] = row['received_at']
    return row


@pytest.fixture
def physical_db(tmp_path):
    engine = create_engine('sqlite+pysqlite:///' + str(tmp_path / 'synthetic.sqlite3'))
    metadata.create_all(engine)
    yield SimpleNamespace(engine=engine)
    engine.dispose()


def test_live_raw_values_are_visible_without_authorizing_models_or_showing_device_soc(physical_db):
    row = synthetic_record()
    row['battery_voltage_v'] = .82
    row['device_soc_estimate_percent'] = 100
    with physical_db.engine.begin() as connection:
        connection.execute(samples.insert(), row)
    result = display_payload(physical_db, now=row['received_at'] + timedelta(seconds=1))
    assert result['fresh'] and result['state'] == 'receiving'
    assert result['measurements']['left_pulses_total'] == 3
    assert result['models_ready'] is False
    assert result['commissioning']['ppr_count_test_confirmed'] is True
    assert result['commissioning']['gyro_bias_measured'] is True
    assert result['measurements']['rpm_calibration_confirmed'] is False
    assert result['wheel_estimates']['left_rpm_magnitude'] == pytest.approx(row['left_pulse_hz'] * 3)
    assert result['wheel_estimates']['left_travel_magnitude_m'] == pytest.approx(row['left_pulse_hz']*row['interval_s']*.01021017612416683)
    assert result['gyro_estimates']['corrected_gyro_rad_s'] == pytest.approx(row['gyro_z_rad_s']-.00034906585039886593)
    assert any('below 1 V' in line for line in result['recommendations'])
    assert 'payload' not in result['measurements']
    assert 'payload_sha256' not in result['measurements']
    assert 'client_id' not in result['measurements']


def test_retry_store_time_cannot_make_an_old_broker_packet_fresh(physical_db):
    row = synthetic_record()
    now = row['received_at'] + timedelta(hours=1)
    row['stored_at'] = now
    with physical_db.engine.begin() as connection:
        connection.execute(samples.insert(), row)
    result = display_payload(physical_db, now=now)
    assert result['state'] == 'stale' and not result['fresh']
    assert result['measurements'] == {} and result['models_ready'] is False
    assert result['wheel_estimates'] == {}
    assert result['gyro_estimates'] == {}
    assert len(result['history']) == 1
    assert result['energy_observation']['fresh'] is False
    assert result['energy_observation']['received_at'] == row['received_at'].isoformat()


def test_energy_comes_from_stored_battery_samples_without_model_calibration(physical_db):
    row = synthetic_record()
    records = []
    for seq in range(3):
        record = {**row, 'seq':seq, 'sample_time_s':1+seq*.5,
                  'battery_sample_time_s':1+seq*.5, 'battery_available':True,
                  'battery_voltage_v':8.0, 'battery_current_a':.25,
                  'received_at':row['received_at']+timedelta(seconds=seq*.5)}
        records.append(record)
    with physical_db.engine.begin() as connection:
        connection.execute(samples.insert(), records)
    now=records[-1]['received_at']+timedelta(seconds=.1)
    result=display_payload(physical_db, now=now)
    energy=result['energy_observation']
    assert result['fresh'] and not result['models_ready']
    assert energy['net_wh']==pytest.approx(2/3600)
    assert energy['covered_s']==1 and energy['intervals']==2
    assert display_payload(physical_db, now=now)['energy_observation']==energy
    from backend_streamlit_and_telemetry.predictive_twin.observed_energy import EnergyMonitor
    with physical_db.engine.connect() as connection:
        recovered=EnergyMonitor().read(connection,samples,records[-1])
    assert all(energy[key]==value for key,value in recovered.items())
    last_recorded=display_payload(physical_db,now=now+timedelta(seconds=10))
    assert last_recorded['measurements']=={}
    assert last_recorded['energy_observation']['net_wh']==energy['net_wh']
    assert last_recorded['energy_observation']['fresh'] is False
    newer={**records[-1],'seq':3,'sample_time_s':2.5,'battery_sample_time_s':2.5,
           'received_at':now+timedelta(seconds=.5)}
    with physical_db.engine.begin() as connection:connection.execute(samples.insert(),newer)
    advanced=display_payload(physical_db,now=newer['received_at'])
    assert advanced['energy_observation']['net_wh']==pytest.approx(3/3600)
    reboot={**newer,'boot_id':'f'*16,'seq':0,'sample_time_s':.5,'battery_sample_time_s':.5,
            'received_at':newer['received_at']+timedelta(seconds=.5)}
    with physical_db.engine.begin() as connection:connection.execute(samples.insert(),reboot)
    assert display_payload(physical_db,now=reboot['received_at'])['energy_observation']['state']=='anchoring'


def test_large_boot_energy_recovery_is_bounded_per_refresh(physical_db, monkeypatch):
    import backend_streamlit_and_telemetry.predictive_twin.observed_energy as energy
    monkeypatch.setattr(energy,'READ_BATCH',2)
    row=synthetic_record()
    records=[{**row,'seq':seq,'sample_time_s':1+seq*.5,'battery_sample_time_s':1+seq*.5,
              'received_at':row['received_at']+timedelta(seconds=seq*.5)} for seq in range(5)]
    with physical_db.engine.begin() as connection:connection.execute(samples.insert(),records)
    now=records[-1]['received_at']
    assert display_payload(physical_db,now=now)['energy_observation']['state']=='loading'
    assert display_payload(physical_db,now=now)['energy_observation']['state']=='loading'
    assert display_payload(physical_db,now=now)['energy_observation']['state']=='ready'


def test_future_broker_clock_is_not_live_and_archive_is_bounded(physical_db):
    row = synthetic_record()
    with physical_db.engine.begin() as connection:
        connection.execute(samples.insert(), row)
    assert display_payload(physical_db, now=row['received_at'] - timedelta(seconds=2))['state'] == 'clock_skew'
    assert len(read_records(physical_db, limit=1)) == 1
    for limit in (True, 0, 201):
        with pytest.raises(ValueError): read_records(physical_db, limit=limit)


def test_optional_missing_table_and_empty_table_do_not_break_existing_model_storage(physical_db):
    assert display_payload(physical_db)['state'] == 'waiting'
    with physical_db.engine.begin() as connection:
        samples.drop(connection)
    assert display_payload(physical_db)['state'] == 'unavailable'
    assert display_payload(None)['measurements'] == {}


def test_physical_table_does_not_enter_signed_model_dataset_allowlist():
    from backend_streamlit_and_telemetry.predictive_twin.database import DATABASE_DATASETS
    from backend_streamlit_and_telemetry.predictive_twin.database_inspection import attributes, DATASET_LABELS
    assert samples.name not in DATABASE_DATASETS
    assert samples.name in DATASET_LABELS
    assert len(attributes(samples.name)) == len(samples.c)


def test_corrected_geometry_yields_unsigned_quantities_without_promoting_incomplete_reports():
    profile = profile_payload()
    assert profile['wheel_radius_m'] == .0325
    assert profile['track_m'] == .1
    assert profile['distance_per_pulse_m'] == pytest.approx(.01021017612416683)
    assert profile['imu_axes'] == dict(x='forward', y='left', z='up')
    assert profile['reported_gyro_bias']['raw_report'] == 'Z = +0.02 degree/sec'
    assert profile['reported_gyro_bias']['unit'] == 'deg/s'
    assert profile['reported_gyro_bias']['axis'] == 'z'
    assert profile['reported_gyro_bias']['sign'] == 1
    assert profile['reported_gyro_bias_rad_s']['x'] is None
    assert profile['reported_gyro_bias_rad_s']['y'] is None
    assert profile['reported_gyro_bias_rad_s']['z'] == pytest.approx(.00034906585039886593)
    assert profile['gyro_bias_measured'] is True
    assert profile['gyro_bias_source'] == 'operator_reported_stationary'
    assert profile['direction_measured'] is False
    assert profile['battery_capacity_ah'] is None and profile['initial_soc'] is None
    assert profile['reported_battery']['capacity_ah'] == 2.2
    assert profile['reported_battery']['initial_soc'] == 1.0
    assert profile['reported_battery']['discharge_positive'] is True
    assert profile['reported_battery']['usable_capacity_verified'] is False
    assert profile['models_ready'] is False
    # Twenty counted pulses per second is one wheel revolution per second.
    estimates = wheel_magnitude_estimates(dict(left_pulse_hz=20, right_pulse_hz=0,
                                             left_rpm=-999, direction_measured=True))
    assert estimates['left_rpm_magnitude'] == 60
    assert estimates['left_rim_speed_m_s'] == pytest.approx(.20420352248333656)
    assert estimates['right_rpm_magnitude'] == estimates['right_rim_speed_m_s'] == 0
    assert estimates['left_travel_magnitude_m'] is None
    assert set(estimates) == {'left_rpm_magnitude', 'right_rpm_magnitude', 'left_rim_speed_m_s', 'right_rim_speed_m_s', 'left_travel_magnitude_m', 'right_travel_magnitude_m'}


@pytest.mark.parametrize('invalid', [None, True, -1, float('nan'), float('inf'), '20'])
def test_invalid_pulse_frequency_cannot_become_a_wheel_estimate(invalid):
    estimates = wheel_magnitude_estimates(dict(left_pulse_hz=invalid))
    assert all(value is None for value in estimates.values())


def test_raw_wheel_travel_and_speed_use_packet_interval_and_preserve_stationary_zero():
    estimates=wheel_magnitude_estimates(dict(left_pulse_hz=4,right_pulse_hz=0,interval_s=.25))
    assert estimates['left_travel_magnitude_m']==pytest.approx(.01021017612416683)
    assert estimates['left_rim_speed_m_s']==pytest.approx(.04084070449666731)
    assert estimates['right_travel_magnitude_m']==0
    assert estimates['right_rim_speed_m_s']==0
    assert profile_payload()['models_ready'] is False


@pytest.mark.parametrize('interval',[None,True,0,-1,float('nan'),float('inf')])
def test_invalid_interval_cannot_create_wheel_travel(interval):
    estimates=wheel_magnitude_estimates(dict(left_pulse_hz=4,right_pulse_hz=0,interval_s=interval))
    assert estimates['left_travel_magnitude_m'] is None
    assert estimates['right_travel_magnitude_m'] is None
    assert estimates['left_rim_speed_m_s']==pytest.approx(.04084070449666731)


@pytest.mark.parametrize('raw', [-.01306, 0, .00034906585039886593, .02])
def test_raw_z_gyro_correction_needs_no_wheel_or_battery_calibration(raw):
    result=gyro_bias_correction(dict(gyro_available=True,gyro_z_rad_s=raw))
    assert result['corrected_gyro_rad_s']==pytest.approx(raw-.00034906585039886593)
    assert result['bias_source']=='operator_reported_stationary'
    assert profile_payload()['models_ready'] is False


@pytest.mark.parametrize('raw', [None, True, float('nan'), float('inf'), '.02'])
def test_invalid_raw_z_gyro_cannot_be_corrected(raw):
    assert gyro_bias_correction(dict(gyro_available=True,gyro_z_rad_s=raw))=={}


def test_missing_sensor_or_recorded_bias_keeps_correction_unavailable():
    measurement=dict(gyro_available=True,gyro_z_rad_s=.02)
    assert gyro_bias_correction({**measurement,'gyro_available':False})=={}
    assert gyro_bias_correction(measurement,{})=={}
    assert gyro_bias_correction(measurement,{**profile_payload(),'gyro_bias_measured':False})=={}
    assert gyro_bias_correction(measurement,{**profile_payload(),'reported_gyro_bias_rad_s':{'z':None}})=={}
