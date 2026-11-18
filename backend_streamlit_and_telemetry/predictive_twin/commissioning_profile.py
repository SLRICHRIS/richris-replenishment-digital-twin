"""Operator-supplied geometry; incomplete commissioning never enables models.

2026-11-19: the operator corrected wheel diameter from 60 to 65 mm; track
and confirmed ESP32-counted PPR remain 100 mm and 20. Battery details and
a stationary gyro bias were supplied as reports, not a complete model
calibration. The gyro report's sign, axis and unit remain unspecified.
"""
from math import isfinite, pi

WHEEL_DIAMETER_M = 0.065
WHEEL_TRACK_M = 0.100
PULSES_PER_WHEEL_REVOLUTION = 20
PROFILE_ID = 'amr01-reported-setup-20261119'


def profile_payload():
    return dict(
        profile_id=PROFILE_ID, provided_date='2026-11-19',
        wheel_diameter_m=WHEEL_DIAMETER_M, wheel_radius_m=WHEEL_DIAMETER_M / 2,
        track_m=WHEEL_TRACK_M, pulses_per_wheel_revolution=PULSES_PER_WHEEL_REVOLUTION,
        geometry_source='operator_reported', ppr_count_test_confirmed=True,
        ppr_evidence='Operator confirmed ESP32-counted pulses per wheel revolution',
        distance_per_pulse_m=pi * WHEEL_DIAMETER_M / PULSES_PER_WHEEL_REVOLUTION,
        imu_axes=dict(x='forward', y='left', z='up'),
        reported_gyro_bias=dict(raw_report='Stationary gyro bias-0.02',
                                magnitude=0.02, sign=None, axis=None, unit=None),
        reported_gyro_bias_rad_s=dict(x=None, y=None, z=None),
        gyro_bias_measured=False, direction_measured=False,
        battery_capacity_ah=None, initial_soc=None, models_ready=False,
        reported_battery=dict(capacity_ah=2.2, initial_soc=1.0,
                              discharge_positive=True,
                              ina219_comparison='Operator reports no significant error',
                              usable_capacity_verified=False,
                              initial_soc_reference_verified=False,
                              measurement_scope='motor_branch_only'),
        wheel_detail='65 mm wheels · 100 mm wheel-centre spacing · 20 counted pulses per wheel turn. RPM and rim-speed magnitudes use operator-supplied geometry; direction and ground motion are not measured.',
        imu_detail='Reported axes: X forward, Y left, Z up. Stationary gyro bias was reported as 0.02; confirm its sign, axis and unit before applying correction.',
        battery_detail='Reported pack: 2,200 mAh; starting charge 100%; discharge current positive. INA219 comparison reported no significant error. Usable capacity and the starting-charge reference remain unverified; INA219 measures the motor branch only.',
    )


def wheel_magnitude_estimates(measurements):
    """Pulse frequency -> unsigned wheel RPM and rim speed; no pose integration."""
    result = {}
    for side in ('left', 'right'):
        rate = measurements.get(side + '_pulse_hz')
        valid = type(rate) in (int, float) and isfinite(rate) and rate >= 0
        result[side + '_rpm_magnitude'] = rate * 60 / PULSES_PER_WHEEL_REVOLUTION if valid else None
        result[side + '_rim_speed_m_s'] = rate * pi * WHEEL_DIAMETER_M / PULSES_PER_WHEEL_REVOLUTION if valid else None
    return result
