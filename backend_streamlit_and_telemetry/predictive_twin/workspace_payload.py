"""Public display data for the existing warehouse component; never credentials."""
import json

import streamlit as st

from .database import SensorDatabase, calibration_fingerprint
from .demo import demo_fleet
from .models import Calibration, motion_forecast, runtime_hours
from .telemetry import ROBOT_IDS


@st.cache_resource(show_spinner=False)
def database_reader(url):
    return SensorDatabase(url, initialize=False)


def workspace_payload(mode):
    if mode not in ('demo', 'live'):
        raise ValueError('Unknown sensor source')
    if mode == 'demo':
        fleet = demo_fleet()
        snapshots = fleet.snapshots(now=6)
        status = 'Synthetic fixed 6 s trial; no hardware connection'
    else:
        try:
            if st.secrets['commissioning']['measured_calibration_confirmed'] is not True:
                raise ValueError('Calibration not confirmed')
            values = st.secrets['calibration'].to_dict()
            if set(values) != {'amr01'}:
                raise ValueError('Only AMR-01 calibration is supported')
            c = Calibration(**values['amr01'])
            db = database_reader(st.secrets['database']['url'])
            snapshots = {'amr01': db.read_snapshot(
                expected_fingerprint=calibration_fingerprint(c)
            )}
            calibrations = {'amr01': c}
            snapshot = snapshots['amr01']
            age = snapshot.get('age_s')
            status = ('EMQX → PostgreSQL: ' + snapshot['quality']
                      + ('' if age is None else f' · last stored sample {age:.1f}s ago'))
        except Exception:
            return dict(mode=mode, status='Live is not configured or database is unavailable: add private DB and measured calibration, then verify worker connectivity.', robots={})
    robots = {}
    for rid in ROBOT_IDS:
        snapshot = snapshots[rid]
        c = fleet.robots[rid].calibration if mode == 'demo' else calibrations[rid]
        derived = snapshot['derived']
        forecast = None
        runtime = None
        if snapshot['quality'] == 'OK' and not snapshot['stale'] and not snapshot['continuity_lost'] and derived:
            forecast = motion_forecast(snapshot['pose'], derived['v_left_m_s'],
                                       derived['v_right_m_s'], c.track_m)[-1]
            runtime = runtime_hours(snapshot['soc'], .2, c.capacity_ah,
                                    snapshot['raw']['battery_current_a'])
        history = snapshot.pop('history')
        # Display-only decimation bounds component traffic; calculations use all samples.
        stride = max(1, (len(history) + 239) // 240)
        rows = history[::stride]
        if history and (not rows or rows[-1] is not history[-1]):
            rows.append(history[-1])
        robots[rid] = dict(**snapshot, forecast_pose=forecast, runtime_hours=runtime,
            gyro_bias_rad_s=c.gyro_bias_rad_s,
            history=[{key: row[key] for key in ('sample_time_s', 'x_m', 'y_m', 'soc', 'residual_rad_s', 'advisory')} for row in rows])
    return dict(mode=mode, status=status, robots=robots)
