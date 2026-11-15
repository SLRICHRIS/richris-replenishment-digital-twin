"""Public display data for the existing warehouse component; never credentials."""
import json

import streamlit as st

from .database import DatabaseSchemaError, SensorDatabase, calibration_fingerprint
from .demo import demo_fleet
from .models import Calibration, motion_forecast, runtime_hours
from .telemetry import ROBOT_IDS

SOURCE_LABELS = {'demo': 'Demo data', 'live': 'Stored sensor data'}


def quality_display(snapshot, demo=False):
    """Plain-language interpretation shared by both dashboard views."""
    if demo:
        return dict(label='Demo data', tone='info', detail=(
            'Fixed 6-second example with generated sensor values. '
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
    db = SensorDatabase(url, initialize=False)
    try:
        db.assert_schema_ready()
    except Exception:
        db.engine.dispose()
        raise
    return db


def database_url():
    """Read private configuration without returning it in a display payload."""
    try:
        value = st.secrets['database']['url']
        return value.strip() if isinstance(value, str) else ''
    except (KeyError, FileNotFoundError):
        return ''


def database_connection():
    """Check storage independently from calibration; return sanitized status."""
    url = database_url()
    if not url:
        return None, 'not_configured'
    try:
        db = database_reader(url)
        db.healthcheck()
    except DatabaseSchemaError:
        return None, 'schema_not_ready'
    except Exception:
        return None, 'unreachable'
    try:
        db.assert_schema_ready()
    except DatabaseSchemaError:
        return None, 'schema_not_ready'
    except Exception:
        return None, 'unreachable'
    return db, 'ready'


def stored_sensor_context():
    """Use the same source and commissioning messages in both sensor views."""
    def notice(label, detail):
        return dict(label=label, detail=detail, tone='warning')

    url = database_url()
    if not url:
        return None, None, notice('Database not configured',
            'Add a private database connection in the app settings. Open Database for connection status and table attributes.')
    try:
        db = database_reader(url)
    except DatabaseSchemaError:
        return None, None, notice('Database schema needs attention',
            'The database responded, but the required sensor schema or read permissions could not be verified. Open Database for details.')
    except Exception:
        return None, None, notice('Database connection failed',
            'The configured database could not be reached. Open Database to check the connection.')
    try:
        if st.secrets['commissioning']['measured_calibration_confirmed'] is not True:
            raise ValueError('Calibration not confirmed')
        values = st.secrets['calibration'].to_dict()
        if set(values) != {'amr01'}:
            raise ValueError('Only AMR-01 calibration is supported')
        calibration = Calibration(**values['amr01'])
    except Exception:
        return db, None, notice('Measured calibration required',
            'The database is configured. Confirm measured AMR-01 calibration before interpreting model estimates. Stored records remain available in Database.')
    return db, calibration, None


def workspace_payload(mode):
    if mode not in ('demo', 'live'):
        raise ValueError('Unknown sensor source')
    if mode == 'demo':
        fleet = demo_fleet()
        snapshots = fleet.snapshots(now=6)
        status = 'Demo data · fixed 6-second generated example'
    else:
        db, c, notice = stored_sensor_context()
        if notice:
            return dict(mode=mode, status=notice['detail'], notice=notice, robots={})
        try:
            snapshots = {'amr01': db.read_snapshot(
                expected_fingerprint=calibration_fingerprint(c)
            )}
            calibrations = {'amr01': c}
            snapshot = snapshots['amr01']
            age = snapshot.get('age_s')
            status = ('Stored sensor data · ' + quality_display(snapshot)['label']
                      + ('' if age is None else f' · last received {age:.1f} s ago'))
        except Exception:
            notice = dict(label='Stored readings unavailable', tone='warning',
                          detail='Stored readings could not be read. Open Database to check connection and schema status.')
            return dict(mode=mode, status=notice['detail'], notice=notice, robots={})
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
