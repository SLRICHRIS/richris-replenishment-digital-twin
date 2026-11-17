"""Operator-supplied geometry; incomplete commissioning never enables models.

2026-11-18: 60 mm wheels, 100 mm wheel-centre spacing, and 20 pulses per
wheel turn. The operator confirmed ESP32-counted PPR. IMU axes were reported
as X forward / Y left / Z up. All-zero gyro bias was explicitly a default,
not a measured stationary mean. Battery and direction evidence are pending.
"""
from math import isfinite, pi

WHEEL_DIAMETER_M = 0.060
WHEEL_TRACK_M = 0.100
PULSES_PER_WHEEL_REVOLUTION = 20
PROFILE_ID = 'amr01-geometry-20261118'


def profile_payload():
    return dict(
        profile_id=PROFILE_ID, provided_date='2026-11-18',
        wheel_diameter_m=WHEEL_DIAMETER_M, wheel_radius_m=WHEEL_DIAMETER_M / 2,
        track_m=WHEEL_TRACK_M, pulses_per_wheel_revolution=PULSES_PER_WHEEL_REVOLUTION,
        geometry_source='operator_reported', ppr_count_test_confirmed=True,
        ppr_evidence='Operator confirmed ESP32-counted pulses per wheel revolution',
        distance_per_pulse_m=pi * WHEEL_DIAMETER_M / PULSES_PER_WHEEL_REVOLUTION,
        imu_axes=dict(x='forward', y='left', z='up'),
        reported_gyro_bias_rad_s=dict(x=0.0, y=0.0, z=0.0),
        gyro_bias_measured=False, direction_measured=False,
        battery_capacity_ah=None, initial_soc=None, models_ready=False,
        wheel_detail='60 mm wheels · 100 mm wheel-centre spacing · 20 counted pulses per wheel turn. RPM and rim-speed magnitudes use operator-supplied geometry; direction and ground motion are not measured.',
        imu_detail='Reported axes: X forward, Y left, Z up. Zero gyro bias is a default; a stationary bias test is still required.',
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
