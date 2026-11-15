"""Public display data for the existing warehouse component; never credentials."""
import json

import streamlit as st

from .database import SensorDatabase, calibration_fingerprint
from .demo import demo_fleet
from .models import Calibration, motion_forecast, runtime_hours
from .telemetry import ROBOT_IDS


def quality_display(snapshot, demo=False):
    """Plain-language interpretation shared by both dashboard views."""
    if demo:
        return dict(label='Demonstration data', tone='info', detail=(
            'Fixed 6-second synthetic trial. No physical robot is connected. '
            'The example includes an injected gyro disagreement at 3–4 seconds.'
        ))
    code = snapshot.get('quality', 'WAITING')
    if snapshot.get('stale') and code not in ('NO_DATA', 'CLOCK_SKEW', 'CALIBRATION_MISMATCH'):
        code = 'STALE'
    elif snapshot.get('continuity_lost') and code == 'OK':
        code = 'CONTINUITY_LOST'
    states = {
        'WAITING': ('Waiting for readings', 'No validated sensor reading has arrived yet.', 'neutral'),
        'NO_DATA': ('No sensor data yet', 'No physical sample has been stored. Check the sensor connection and ingestion worker.', 'neutral'),
        'ANCHORED': ('First sample received', 'The first reading anchors counts and time. The next valid reading enables speed and energy updates.', 'info'),
        'OK': ('Current readings', 'Recent sensor readings are available. Read the motion advisory separately; data freshness does not establish sensor accuracy.', 'success'),
        'STALE': ('Readings out of date', 'No current reading is available. Live values, advisories and forecasts are withheld until fresh data arrives.', 'warning'),
        'CLOCK_SKEW': ('Clock mismatch', 'The receive timestamp is in the future. Synchronize the worker and dashboard clocks before interpreting live values.', 'warning'),
        'CALIBRATION_MISMATCH': ('Calibration mismatch', 'Stored readings use a different calibration. Use matching measured settings before interpreting estimates.', 'warning'),
        'ANCHOR_UNCERTAIN': ('New anchor after data loss', 'Committed totals are preserved, but the unobserved interval is unknown. Estimates are partial and forecasts are withheld.', 'warning'),
        'CONTINUITY_LOST': ('Partial estimates after data loss', 'An interval of motion or charge was not observed. Pose, energy and charge estimates are partial; forecasts are withheld.', 'warning'),
        'SEQUENCE_GAP': ('Missing sensor packets', 'Some samples are missing. The gyro comparison and forecasts are unavailable for this interval.', 'warning'),
        'INVALID_DATA': ('Invalid reading rejected', 'A reading failed validation. Wait for a new valid anchor before using the model outputs.', 'warning'),
    }
    label, detail, tone = states.get(code, (
        'Status unavailable', 'Wait for a validated sensor status before interpreting results.', 'warning'
    ))
    return dict(label=label, detail=detail, tone=tone)


@st.cache_resource(show_spinner=False)
def database_reader(url):
    return SensorDatabase(url, initialize=False)


def workspace_payload(mode):
    if mode not in ('demo', 'live'):
        raise ValueError('Unknown sensor source')
    if mode == 'demo':
        fleet = demo_fleet()
        snapshots = fleet.snapshots(now=6)
        status = 'Demonstration data · fixed 6-second trial · no physical robot connection'
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
            status = ('Physical sensor records · ' + quality_display(snapshot)['label']
                      + ('' if age is None else f' · last received {age:.1f} s ago'))
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
        # Keep missing-comparison boundaries even when display decimation skips
        # the original gap sample. A chart must not join across unknown data.
        chart_history = []
        previous_index = -1
        for index in list(range(0, len(history), stride)) + (
                [len(history) - 1] if history and (len(history) - 1) % stride else []):
            row = history[index]
            chart_history.append({
                **{key: row[key] for key in ('sample_time_s', 'x_m', 'y_m', 'soc', 'residual_rad_s', 'advisory')},
                'plot_break_before': any(
                    h.get('residual_rad_s') is None for h in history[previous_index + 1:index + 1]
                ),
            })
            previous_index = index
        display = quality_display(snapshot, demo=mode == 'demo')
        robots[rid] = dict(**snapshot, forecast_pose=forecast, runtime_hours=runtime,
            quality_label=display['label'], quality_detail=display['detail'], quality_tone=display['tone'],
            gyro_bias_rad_s=c.gyro_bias_rad_s,
            residual_threshold_rad_s=c.residual_threshold_rad_s,
            residual_hold_s=c.residual_hold_s,
            history=chart_history)
    return dict(mode=mode, status=status, robots=robots)
