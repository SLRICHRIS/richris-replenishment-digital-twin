"""Independent synthetic timelines; no inserted production samples or actuations."""
from copy import deepcopy
import math

import pytest
from backend_streamlit_and_telemetry.predictive_twin.sensor_recommendations import live_sensor_insights


def stream(count=12):
    points=[]
    for i in range(count):
        t=10+i*.5
        points.append(dict(robot_id='amr01',boot_id='boot-a',seq=i,sample_time_s=t,interval_s=.5,
            battery_available=True,battery_sample_time_s=t,battery_voltage_v=7.2,battery_current_a=.001,battery_power_w=.0072,
            gyro_available=True,imu_sample_time_s=t,gyro_x_dps=0.,gyro_y_dps=0.,gyro_z_dps=0.,gyro_z_rad_s=0.,
            accel_x_g=0.,accel_y_g=0.,accel_z_g=1.,gyro_bias_estimate_rad_s=0.,battery_continuity=True,
            motor_output='stopped',commanded_motion='stopped',pwm_duty=0,left_pulse_hz=0.,right_pulse_hz=0.))
    return dict(fresh=True,age_s=.1,measurements=deepcopy(points[-1]),history=points,
        gyro_estimates=dict(corrected_gyro_rad_s=0.,bias_rad_s=0.),commissioning={},motion_observation={})


def change(p, **fields):
    for row in p['history']:row.update(fields)
    p['measurements'].update(fields)
    return p


def codes(p):return {r['code'] for r in live_sensor_insights(p)['recommendations']}


def test_valid_rest_is_not_misdiagnosed_as_stall_or_low_battery():
    p=stream();r=live_sensor_insights(p)
    assert codes(p)=={'monitor'} and r['summary']['covered']==6
    assert r['scope']=='physical_observation' and r['ready']
    assert {a['id'] for a in r['actions']} >= {'inspect_wheels','calibrate_imu','stop_and_inspect','lower_power'}


def test_stale_future_and_invalid_packets_withhold_current_findings():
    p=change(stream(),battery_voltage_v=5.7)
    for age in (6.,-2.,float('nan'),True):
        p['age_s']=age;r=live_sensor_insights(p)
        assert not r['ready'] and not r['metrics'] and codes(p)=={'feed_unavailable'}
    p['age_s']=.1;p['measurements']['robot_id']='other'
    assert codes(p)=={'waiting_sample'}


def test_voltage_drop_persists_after_idle_recovery_and_uses_pre_load_baseline():
    p=stream();rows=p['history']
    rows[6].update(battery_voltage_v=5.72,battery_current_a=.84,motor_output='forward',commanded_motion='forward',pwm_duty=160)
    r=live_sensor_insights(p)
    alert=next(x for x in r['recommendations'] if x['code']=='voltage_sag')
    assert alert['priority']=='stop' and '5.72' in alert['detail'] and '1.48' in alert['evidence'][0]
    # A low voltage that happened BEFORE the idle baseline is not a loaded sag comparison.
    rows[0].update(rows[6]);rows[0].update(seq=0,sample_time_s=10.,battery_sample_time_s=10.,imu_sample_time_s=10.)
    rows[6].update(motor_output='stopped',pwm_duty=0,battery_voltage_v=7.2)
    assert 'voltage_sag' not in codes(p)


def test_controller_stall_check_waits_for_continuous_duration_and_combines_current():
    p=change(stream(),commanded_motion='forward',motor_output='forward',pwm_duty=76)
    assert {'drive_no_pulses','drive_no_current'} <= codes(p)
    p['history']=p['history'][-3:]
    assert 'drive_no_pulses' not in codes(p)
    p=change(stream(),commanded_motion='forward',motor_output='stopped',pwm_duty=0)
    assert 'command_not_applied' in codes(p)


def test_turning_does_not_expect_both_wheels_to_turn():
    p=change(stream(),motor_output='left',commanded_motion='left',pwm_duty=80,right_pulse_hz=10.)
    assert not {'drive_no_pulses','left_feedback_missing','right_feedback_missing','wheel_imbalance'} & codes(p)
    change(p,motor_output='right',commanded_motion='right',left_pulse_hz=10.,right_pulse_hz=0.)
    assert not {'drive_no_pulses','left_feedback_missing','right_feedback_missing','wheel_imbalance'} & codes(p)


def test_one_side_missing_and_uneven_both_sides_have_distinct_guidance():
    p=change(stream(),motor_output='forward',commanded_motion='forward',pwm_duty=80,left_pulse_hz=20.,battery_current_a=.2)
    assert 'right_feedback_missing' in codes(p) and 'drive_no_pulses' not in codes(p)
    change(p,right_pulse_hz=5.)
    assert 'wheel_imbalance' in codes(p)
    change(p,left_pulse_hz=.2,right_pulse_hz=.05)
    assert 'wheel_imbalance' not in codes(p), 'Quantized low counts cannot establish imbalance'


def test_idle_pulses_are_not_called_motor_motion():
    p=change(stream(),left_pulse_hz=40.)
    r=next(r for r in live_sensor_insights(p)['recommendations'] if r['code']=='pulses_while_stopped')
    assert 'hand movement' in r['detail'] and 'noise' in r['detail']
    assert 'drive_no_pulses' not in codes(p)


def test_boot_sequence_gaps_duplicates_and_future_history_cannot_build_sustained_evidence():
    p=change(stream(),commanded_motion='forward',motor_output='forward',pwm_duty=80)
    for row in p['history'][:-2]:row['boot_id']='previous-boot'
    assert 'drive_no_pulses' not in codes(p)
    p=change(stream(),commanded_motion='forward',motor_output='forward',pwm_duty=80)
    p['history']=p['history'][:8]+p['history'][-2:]
    assert 'packet_gap' in codes(p) and 'drive_no_pulses' not in codes(p)
    p['history']=[deepcopy(p['history'][-1]) for _ in range(20)]
    assert 'drive_no_pulses' not in codes(p)
    future=deepcopy(p['measurements']);future.update(sample_time_s=999.,seq=999)
    p['history'] += [future]*20
    assert live_sensor_insights(p)['window']['samples']==1


def test_current_polarity_ignores_small_zero_offset():
    p=change(stream(),motor_output='forward',commanded_motion='forward',pwm_duty=80,left_pulse_hz=10.,right_pulse_hz=10.,battery_current_a=-.001)
    assert 'current_polarity' not in codes(p)
    change(p,battery_current_a=-.2)
    assert 'current_polarity' in codes(p)


def test_gyro_and_tilt_screening_require_appropriate_stable_inputs():
    p=change(stream(),gyro_bias_estimate_rad_s=None)
    assert 'gyro_startup' in codes(p)
    change(p,gyro_z_rad_s=math.radians(8),gyro_z_dps=8.)
    assert 'gyro_when_stopped' in codes(p)
    change(p,gyro_z_rad_s=0.,gyro_z_dps=0.,accel_x_g=.5,accel_z_g=math.sqrt(.75))
    assert 'apparent_tilt' in codes(p)
    change(p,accel_z_g=2.)
    assert 'apparent_tilt' not in codes(p) and 'acceleration_change' in codes(p)
    change(p,gyro_available=False)
    assert not {'apparent_tilt','acceleration_change','gyro_when_stopped'} & codes(p)


def test_stale_sensor_clocks_cannot_support_voltage_or_imu_inferences():
    p=change(stream(),battery_sample_time_s=0.,imu_sample_time_s=0.,battery_voltage_v=5.7,accel_z_g=2.)
    assert {'battery_input','imu_input'} <= codes(p)
    assert not {'battery_low','voltage_sag','acceleration_change'} & codes(p)


def test_charge_assumption_and_current_limit_are_not_invented():
    p=stream();p['energy_observation']=dict(soc_scenario=dict(percent=15.,outside_physical_range=False))
    r=live_sensor_insights(p)
    assert 'battery_low' not in codes(p)
    assert any('Actual remaining charge is unknown' in m['detail'] for m in r['metrics'])
    change(p,battery_current_a=10.)
    assert not any('overcurrent' in r['code'] for r in live_sensor_insights(p)['recommendations'])
    assert any('limits are not configured' in c['detail'] for c in r['coverage'])
