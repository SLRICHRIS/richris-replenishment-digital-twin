"""Read-only observations from the installed unsigned MH-IR hardware.

These records never enter the signed-odometry model or arm remote actions.
Provisioning is separate: this module performs no DDL or writes.
"""
from datetime import datetime, timezone
from math import isfinite

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Float, Integer, JSON, MetaData, String, Table, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from .commissioning_profile import profile_payload, wheel_magnitude_estimates, gyro_bias_correction, pack_discharge_scenario
from .observed_energy import observed_energy
from .observed_motion import observed_motion

FRESH_SECONDS = 5.0
metadata = MetaData()
_key = [Column('robot_id', String(16), primary_key=True), Column('boot_id', String(64), primary_key=True), Column('seq', BigInteger, primary_key=True)]
_required = [Column('schema_version', Integer, nullable=False), Column('message_type', String(32), nullable=False), Column('received_at', DateTime(timezone=True), nullable=False), Column('stored_at', DateTime(timezone=True), nullable=False), Column('client_id', String(64), nullable=False), Column('topic', String(128), nullable=False)]
_floats = 'sample_time_s interval_s left_pulse_hz right_pulse_hz left_rpm right_rpm imu_sample_time_s accel_x_g accel_y_g accel_z_g gyro_x_dps gyro_y_dps gyro_z_dps gyro_z_rad_s gyro_bias_estimate_rad_s yaw_estimate_deg battery_sample_time_s battery_bus_voltage_v battery_shunt_voltage_mv battery_voltage_v battery_current_a battery_power_w device_soc_estimate_percent'.split()
_required_floats = {'sample_time_s', 'interval_s', 'left_pulse_hz', 'right_pulse_hz'}
_bools = 'rpm_calibration_confirmed direction_measured gyro_available battery_available battery_continuity predictive_models_ready'.split()
samples = Table('amr_commissioning_samples', metadata, *_key, *_required,
    *[Column(name, Float, nullable=name not in _required_floats) for name in _floats],
    Column('left_pulses_total', BigInteger, nullable=False), Column('right_pulses_total', BigInteger, nullable=False),
    Column('commanded_motion', String(16), nullable=False), Column('motor_output', String(16), nullable=False),
    Column('pwm_duty', Integer, nullable=False), Column('imu_who_am_i', Integer, nullable=False),
    *[Column(name, Boolean, nullable=False) for name in _bools],
    Column('payload_sha256', String(64), nullable=False), Column('payload', JSON, nullable=False), Column('quality_notes', JSON, nullable=False))
PUBLIC_FIELDS = [name for name in samples.c.keys() if name not in ('payload', 'payload_sha256', 'client_id', 'topic', 'schema_version', 'message_type', 'device_soc_estimate_percent')]


def read_records(db, limit=50):
    if type(limit) is not int or not 1 <= limit <= 200:
        raise ValueError('Choose a row limit from 1 to 200')
    with db.engine.connect() as connection:
        query = select(samples).where(samples.c.robot_id == 'amr01').order_by(samples.c.received_at.desc(), samples.c.boot_id.desc(), samples.c.seq.desc()).limit(limit)
        return [dict(row) for row in connection.execute(query).mappings()]


def display_payload(db, now=None):
    empty = dict(state='unavailable', label='Telemetry storage unavailable', age_s=None, fresh=False,
                 measurements={}, history=[], recommendations=['Complete the protected EMQX forwarding connection to store physical readings.'],
                 commissioning=profile_payload(), wheel_estimates={}, gyro_estimates={}, energy_observation={}, motion_observation={}, runtime_scenario={},
                 models_ready=False, model_detail='Wheel geometry and reported stationary Z bias are recorded. Direction evidence, battery calibration and motion validation are required before pose and runtime predictions.')
    if db is None or not isinstance(getattr(db, 'engine', None), Engine):
        return empty
    try:
        with db.engine.connect() as connection:
            query = select(*(samples.c[name] for name in PUBLIC_FIELDS)).where(samples.c.robot_id == 'amr01').order_by(samples.c.received_at.desc(), samples.c.boot_id.desc(), samples.c.seq.desc()).limit(1)
            row = connection.execute(query).mappings().first()
            if row is None:
                return {**empty, 'state': 'waiting', 'label': 'Waiting for the first stored packet'}
            row = dict(row)
            history = connection.execute(select(*(samples.c[name] for name in ('boot_id', 'seq', 'sample_time_s', 'received_at', 'battery_voltage_v', 'battery_current_a', 'left_pulse_hz', 'right_pulse_hz'))).where(samples.c.robot_id == 'amr01').order_by(samples.c.received_at.desc(), samples.c.boot_id.desc(), samples.c.seq.desc()).limit(60)).mappings().all()
            try:
                energy = observed_energy(connection, samples, row)
            except (SQLAlchemyError, AttributeError, TypeError, ValueError):
                energy = dict(state='unavailable', net_wh=None)
            try:
                motion = observed_motion(connection, samples, row)
            except (SQLAlchemyError, AttributeError, TypeError, ValueError):
                motion = dict(state='unavailable', pose=None, residual_rad_s=None, history=[])
    except (SQLAlchemyError, AttributeError, TypeError):
        return empty
    received = row['received_at']
    if received.tzinfo is None:
        received = received.replace(tzinfo=timezone.utc)
    age = ((now or datetime.now(timezone.utc)) - received).total_seconds()
    fresh = isfinite(age) and -1 <= age <= FRESH_SECONDS
    if age < -1:
        state, label = 'clock_skew', 'Broker clock needs checking'
    elif not fresh:
        state, label = 'stale', 'Telemetry out of date'
    else:
        state, label = 'receiving', 'Receiving physical telemetry'
    recommendations = []
    if not fresh:
        recommendations.append('No current packet is available. Check ESP32 power, hotspot internet and the EMQX forwarding action.')
    else:
        if not row['gyro_available']:
            recommendations.append('IMU readings are unavailable. Check I2C wiring and sensor startup.')
        else:
            recommendations.append('Z yaw rate is corrected using the recorded stationary bias of +0.02°/s (+0.000349066 rad/s).')
        if not row['battery_available']:
            recommendations.append('Battery readings are unavailable. Check INA219 wiring and its supply.')
        elif row['battery_voltage_v'] < 1:
            recommendations.append('Battery voltage is below 1 V. Check battery power and INA219 VIN connections before interpreting battery estimates.')
        recommendations.append('Wheel estimates use the confirmed 20 counted pulses per wheel turn and reported 65 mm diameter. Wheel direction remains unmeasured.')
        if not row['battery_continuity']:
            recommendations.append('A battery measurement gap occurred. Accumulated charge needs a new measured starting point.')
        recommendations.append('A 2,200 mAh pack, 100% starting charge and discharge-positive current are reported. Battery percentage and runtime still need verified usable capacity, starting-charge reference and current calibration; INA219 measures only the motor branch.')
    for key, value in row.items():
        if isinstance(value, datetime): row[key] = value.isoformat()
    recent = []
    for point in reversed(history):
        recent.append({key: value.isoformat() if isinstance(value, datetime) else value for key, value in point.items()})
    # Stale records remain inspectable in the archive; never display them as live values.
    return {**empty, 'state': state, 'label': label, 'age_s': age, 'fresh': fresh,
            'received_at': received.isoformat(), 'boot_id': row['boot_id'], 'seq': row['seq'],
            'measurements': row if fresh else {},
            'wheel_estimates': wheel_magnitude_estimates(row) if fresh else {},
            'gyro_estimates': gyro_bias_correction(row) if fresh else {},
            'energy_observation': {**energy, 'received_at':received.isoformat(), 'fresh':fresh},
            'motion_observation': motion if fresh else {},
            'runtime_scenario': pack_discharge_scenario(row) if fresh else {},
            'history': recent, 'recommendations': recommendations}
