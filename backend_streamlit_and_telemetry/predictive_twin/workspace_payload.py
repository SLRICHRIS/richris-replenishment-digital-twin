"""Public display data for the existing warehouse component; never credentials."""
import json

import streamlit as st

from .dashboard import live_service
from .demo import demo_fleet
from .models import motion_forecast, runtime_hours
from .telemetry import ROBOT_IDS


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
            mqtt = st.secrets['mqtt']
            calibration = st.secrets['calibration'].to_dict()
            service = live_service(mqtt['host'], mqtt['username'], mqtt['password'],
                                   json.dumps(calibration, sort_keys=True))
        except (KeyError, FileNotFoundError, ValueError, TypeError):
            return dict(mode=mode, status='Live mode is not configured. Add private MQTT settings and measured calibration in Streamlit secrets.', robots={})
        fleet = service.fleet
        snapshots = fleet.snapshots()
        status = service.status
    robots = {}
    for rid in ROBOT_IDS:
        snapshot = snapshots[rid]
        c = fleet.robots[rid].calibration
        derived = snapshot['derived']
        forecast = None
        runtime = None
        if not snapshot['stale'] and not snapshot['continuity_lost'] and derived:
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
