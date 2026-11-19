"""Read-only local odometry and gyro comparison from commissioning evidence.

Single-channel wheel direction is inferred by the ESP32 motor command. These
display estimates do not enter calibrated model storage or authorize movement.
"""
from math import isfinite, pi
import threading
from weakref import WeakKeyDictionary

from sqlalchemy import select

from .commissioning_profile import (WHEEL_DIAMETER_M, WHEEL_TRACK_M,
    PULSES_PER_WHEEL_REVOLUTION, gyro_bias_correction)
from .models import midpoint_pose, motion_forecast

READ_BATCH = 1000
MAX_INTERVAL_S = 2.0
DISTANCE_PER_PULSE_M = pi*WHEEL_DIAMETER_M/PULSES_PER_WHEEL_REVOLUTION
_monitors = WeakKeyDictionary()
_monitors_lock = threading.Lock()


def number(value):
    return type(value) in (int, float) and isfinite(value)


def count(value):
    return type(value) is int and abs(value) <= 9007199254740991


def interval_motion(previous, row):
    dt = row['sample_time_s']-previous['sample_time_s']
    interval = row['interval_s']
    if (row['seq'] != previous['seq']+1 or not number(dt) or not 0 < dt <= MAX_INTERVAL_S
            or not number(interval) or abs(dt-interval) > .0001):
        raise ValueError('recording_gap')
    payload = row.get('payload')
    payload = payload if isinstance(payload, dict) else {}
    before = previous.get('payload')
    before = before if isinstance(before, dict) else {}
    inferred = (payload.get('encoder_direction_source') == 'motor_command_estimate'
                and payload.get('encoder_direction_measured') is False)
    distances = []
    for side in ('left', 'right'):
        total, old = row[side+'_pulses_total'], previous[side+'_pulses_total']
        rate = row[side+'_pulse_hz']
        if not count(total) or not count(old) or total < old or not number(rate) or rate < 0:
            raise ValueError('invalid_wheel_evidence')
        unsigned = total-old
        if abs(unsigned-rate*interval) > max(.0001, unsigned*.000001):
            raise ValueError('invalid_wheel_evidence')
        if unsigned == 0:
            signed = 0
            if payload.get(side+'_pulses_delta_signed', 0) != 0:
                raise ValueError('invalid_wheel_evidence')
        else:
            signed = payload.get(side+'_pulses_delta_signed')
            reported = payload.get(side+'_pulses_delta')
            if not inferred or not count(signed) or not count(reported) or reported != unsigned:
                raise ValueError('direction_evidence_missing')
            if abs(signed) != unsigned:
                raise ValueError('mixed_or_unknown_direction')
            current_signed = payload.get(side+'_encoder_count_signed')
            previous_signed = before.get(side+'_encoder_count_signed')
            if (not count(current_signed) or not count(previous_signed)
                    or current_signed-previous_signed != signed):
                raise ValueError('invalid_wheel_evidence')
        distances.append(signed*DISTANCE_PER_PULSE_M)
    left, right = distances
    return left, right, (right-left)/(WHEEL_TRACK_M*dt)


class MotionAccumulator:
    def __init__(self, boot_id):
        self.boot_id = boot_id
        self.last_seq = -1
        self.previous = None
        self.pose = (0.0, 0.0, 0.0)
        self.origin_seq = self.origin_time_s = None
        self.state = 'anchoring'
        self.reason = ''
        self.residual = self.encoder_yaw_rate = None
        self.wheel_speeds = None
        self.history = []
        self.resets = 0

    def anchor(self, row, reason=''):
        self.pose = (0.0, 0.0, 0.0)
        self.origin_seq, self.origin_time_s = row['seq'], row['sample_time_s']
        self.reason = reason
        self.state = 'reanchoring' if reason else 'anchoring'
        self.residual = self.encoder_yaw_rate = None
        self.wheel_speeds = None
        if reason: self.resets += 1

    def extend(self, rows):
        for row in rows:
            if row['boot_id'] != self.boot_id or row['seq'] <= self.last_seq:
                continue
            self.last_seq = row['seq']
            self.residual = self.encoder_yaw_rate = None
            self.wheel_speeds = None
            if not number(row['sample_time_s']) or row['sample_time_s'] < 0:
                self.previous = None
                self.state, self.reason = 'unavailable', 'invalid_sample_time'
                continue
            if self.previous is None:
                self.anchor(row)
            else:
                try:
                    left, right, self.encoder_yaw_rate = interval_motion(self.previous, row)
                    dt = row['sample_time_s']-self.previous['sample_time_s']
                    self.wheel_speeds = (left/dt, right/dt)
                    self.pose = midpoint_pose(*self.pose, left, right, WHEEL_TRACK_M)
                    correction = gyro_bias_correction(row)
                    if correction:
                        self.residual = correction['corrected_gyro_rad_s']-self.encoder_yaw_rate
                    self.state = 'tracking'
                except (ValueError, TypeError, KeyError, OverflowError) as exc:
                    self.anchor(row, str(exc))
            self.previous = dict(row)
            self.history.append(dict(sample_time_s=row['sample_time_s'],
                residual_rad_s=self.residual, plot_break_before=self.state != 'tracking'))
            self.history = self.history[-120:]

    def public(self, target_seq):
        complete = self.last_seq == target_seq
        usable = complete and self.state in ('anchoring', 'tracking')
        projected = (motion_forecast(self.pose, *self.wheel_speeds, WHEEL_TRACK_M)[-1]
                     if complete and self.state == 'tracking' and self.wheel_speeds is not None else None)
        return dict(state=self.state if complete else 'loading',
            pose=list(self.pose) if usable else None,
            forecast_pose=list(projected) if projected is not None else None,
            forecast_horizon_s=5.0,
            residual_rad_s=self.residual if complete else None,
            encoder_yaw_rate_rad_s=self.encoder_yaw_rate if complete else None,
            origin_seq=self.origin_seq, origin_time_s=self.origin_time_s,
            resets=self.resets, reason=self.reason,
            direction_source='motor_command_estimate',
            scope='local_recorded_segment',
            history=[dict(point) for point in self.history] if complete else [])


class MotionMonitor:
    def __init__(self):
        self.lock = threading.Lock()
        self.accumulator = None

    def read(self, connection, table, latest):
        with self.lock:
            if self.accumulator is None or self.accumulator.boot_id != latest['boot_id']:
                self.accumulator = MotionAccumulator(latest['boot_id'])
            accumulator = self.accumulator
            if accumulator.last_seq < latest['seq']:
                fields = ('boot_id', 'seq', 'sample_time_s', 'interval_s',
                    'left_pulses_total', 'right_pulses_total', 'left_pulse_hz', 'right_pulse_hz',
                    'gyro_available', 'gyro_z_rad_s', 'payload')
                query = select(*(table.c[name] for name in fields)).where(
                    table.c.robot_id == 'amr01', table.c.boot_id == latest['boot_id'],
                    table.c.seq > accumulator.last_seq, table.c.seq <= latest['seq'],
                ).order_by(table.c.seq).limit(READ_BATCH)
                accumulator.extend(connection.execute(query).mappings().all())
            return accumulator.public(latest['seq'])


def observed_motion(connection, table, latest):
    with _monitors_lock:
        monitor = _monitors.setdefault(connection.engine, MotionMonitor())
    return monitor.read(connection, table, latest)
