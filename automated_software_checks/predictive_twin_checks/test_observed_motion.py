"""Independent numerical cases for display-only command-inferred odometry."""
import math

import pytest

from backend_streamlit_and_telemetry.predictive_twin.observed_motion import MotionAccumulator

BOOT='a'*16
BIAS=.00034906585039886593
STEP=math.pi*.065/20


def records(steps, gyro=BIAS, boot=BOOT):
    rows=[]
    left=right=signed_left=signed_right=0
    for seq,(dl,dr) in enumerate([(0,0)]+list(steps)):
        left+=abs(dl); right+=abs(dr); signed_left+=dl; signed_right+=dr
        rows.append(dict(boot_id=boot,seq=seq,sample_time_s=1+seq*.5,interval_s=.5,
            left_pulses_total=left,right_pulses_total=right,
            left_pulse_hz=abs(dl)*2,right_pulse_hz=abs(dr)*2,
            gyro_available=True,gyro_z_rad_s=gyro,
            payload=dict(encoder_direction_source='motor_command_estimate',encoder_direction_measured=False,
                left_pulses_delta=abs(dl),right_pulses_delta=abs(dr),
                left_pulses_delta_signed=dl,right_pulses_delta_signed=dr,
                left_encoder_count_signed=signed_left,right_encoder_count_signed=signed_right)))
    return rows


def test_straight_reverse_and_repeated_refresh_preserve_local_frame():
    accumulator=MotionAccumulator(BOOT)
    rows=records([(20,20),(-20,-20)])
    accumulator.extend(rows[:2])
    first=accumulator.public(1)
    assert first['pose']==pytest.approx([math.pi*.065,0,0])
    assert first['residual_rad_s']==pytest.approx(0)
    accumulator.extend(rows)
    result=accumulator.public(2)
    assert result['pose']==pytest.approx([0,0,0])
    accumulator.extend(rows)
    assert accumulator.public(2)==result
    assert result['direction_source']=='motor_command_estimate'
    assert result['scope']=='local_recorded_segment'
    assert 'payload' not in result


def test_in_place_turn_and_forward_after_turn_have_expected_heading_and_residual():
    accumulator=MotionAccumulator(BOOT)
    accumulator.extend(records([(-5,5),(20,20)]))
    result=accumulator.public(2)
    heading=10*STEP/.1
    assert result['pose']==pytest.approx([math.pi*.065*math.cos(heading),math.pi*.065*math.sin(heading),heading])
    assert result['history'][1]['residual_rad_s']==pytest.approx(-heading/.5)
    assert result['residual_rad_s']==pytest.approx(0)


@pytest.mark.parametrize('corruption', ['direction','signed_total','mixed','frequency','counter'])
def test_unsupported_or_inconsistent_motion_cannot_create_position(corruption):
    rows=records([(10,10)])
    if corruption=='direction':rows[1]['payload'].pop('encoder_direction_source')
    elif corruption=='signed_total':rows[1]['payload']['left_encoder_count_signed']=999
    elif corruption=='mixed':rows[1]['payload']['left_pulses_delta_signed']=5
    elif corruption=='frequency':rows[1]['left_pulse_hz']=1
    else:rows[1]['left_pulses_total']=-1
    accumulator=MotionAccumulator(BOOT); accumulator.extend(rows)
    result=accumulator.public(1)
    assert result['state']=='reanchoring' and result['pose'] is None
    assert result['residual_rad_s'] is None and result['resets']==1


def test_recording_gap_reanchors_without_bridging_motion_and_restart_rebuilds():
    rows=records([(10,10),(10,10),(10,10)])
    observed=[rows[0],rows[2],rows[3]]
    accumulator=MotionAccumulator(BOOT); accumulator.extend(observed)
    result=accumulator.public(3)
    assert result['pose']==pytest.approx([10*STEP,0,0])
    assert result['origin_seq']==2 and result['resets']==1
    assert result['history'][1]['residual_rad_s'] is None
    recovered=MotionAccumulator(BOOT); recovered.extend(observed)
    assert recovered.public(3)==result
    assert recovered.public(4)['state']=='loading' and recovered.public(4)['pose'] is None
    reboot=MotionAccumulator('b'*16)
    reboot.extend(records([],boot='b'*16))
    assert reboot.public(0)['pose']==[0,0,0]
    assert reboot.public(0)['resets']==0


def test_stationary_zero_needs_no_direction_guess_and_missing_gyro_breaks_comparison():
    rows=records([(0,0),(0,0)],gyro=.02)
    for row in rows:row['payload']={}
    rows[-1]['gyro_available']=False
    accumulator=MotionAccumulator(BOOT);accumulator.extend(rows)
    result=accumulator.public(2)
    assert result['pose']==[0,0,0] and result['encoder_yaw_rate_rad_s']==0
    assert result['history'][1]['residual_rad_s']==pytest.approx(.02-BIAS)
    assert result['residual_rad_s'] is None
    assert result['history'][-1]['residual_rad_s'] is None


def test_backwards_clock_invalid_interval_and_nonfinite_gyro_are_bounded():
    rows=records([(0,0),(0,0)])
    rows[1]['interval_s']=0
    accumulator=MotionAccumulator(BOOT);accumulator.extend(rows[:2])
    assert accumulator.public(1)['pose'] is None
    rows[2]['gyro_z_rad_s']=float('nan')
    accumulator.extend(rows[2:])
    assert accumulator.public(2)['residual_rad_s'] is None
    long=MotionAccumulator(BOOT);long.extend(records([(0,0)]*150))
    assert len(long.public(150)['history'])==120
    assert long.public(150)['pose']==[0,0,0]


@pytest.mark.parametrize('pulses', [20, -20, 0])
def test_five_second_projection_holds_signed_wheel_speeds_without_needing_battery(pulses):
    accumulator=MotionAccumulator(BOOT)
    accumulator.extend(records([(pulses,pulses)],gyro=None))
    result=accumulator.public(1)
    assert result['forecast_pose']==pytest.approx([11*pulses*STEP,0,0])
    assert result['forecast_horizon_s']==5
    assert result['residual_rad_s'] is None


def test_turning_projection_and_unknown_intervals_do_not_create_routes():
    accumulator=MotionAccumulator(BOOT)
    rows=records([(-5,5),(0,0)])
    accumulator.extend(rows[:2])
    assert accumulator.public(1)['forecast_pose']==pytest.approx([0,0,11*10*STEP/.1])
    assert accumulator.public(2)['forecast_pose'] is None
    rows[2]['seq']=4
    accumulator.extend(rows[2:])
    assert accumulator.public(4)['forecast_pose'] is None
    anchored=MotionAccumulator(BOOT);anchored.extend(records([]))
    assert anchored.public(0)['forecast_pose'] is None
