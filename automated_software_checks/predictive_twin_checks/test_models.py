import math

import pytest

from backend_streamlit_and_telemetry.predictive_twin.models import (
    Calibration, ResidualDetector, battery_step, midpoint_pose, motion_forecast,
    runtime_hours, stationary_gyro_bias, wheel_distance, stock_step, task_step,
)
from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations


def test_encoder_gearing_and_sign():
    assert wheel_distance(150, .04, 600) == pytest.approx(math.pi * .02)
    assert wheel_distance(-600, .04, 600) == pytest.approx(-2 * math.pi * .04)


def test_midpoint_straight_turn_and_curve():
    assert midpoint_pose(1, 2, 0, .5, .5, .2) == pytest.approx((1.5, 2, 0))
    assert midpoint_pose(0, 0, 0, -.1, .1, .2) == pytest.approx((0, 0, 1))
    assert midpoint_pose(0, 0, 0, .1, .3, .2) == pytest.approx((.2 * math.cos(.5), .2 * math.sin(.5), 1))


def test_battery_units_charge_sign_and_unclipped_diagnostic():
    assert battery_step(1, 0, 8, 2, 3600, 2) == pytest.approx((16, 16, 0))
    assert battery_step(.99, 0, 8, -1, 3600, 2) == pytest.approx((-8, -8, 1.49))


def test_gyro_calibration_and_detector_hold_reset():
    assert stationary_gyro_bias([.01, .03]) == pytest.approx(.02)
    d = ResidualDetector()
    assert not d.update(.2, 0, 0, 0, .2, .2, .04, .5)[1]
    assert not d.update(.2, 0, 0, 0, .2, .2, .04, .5)[1]
    assert not d.update(.2, 0, 0, 0, .2, .1, .04, .5)[1]
    assert d.update(.2, 0, 0, 0, .2, .2, .04, .5)[1]
    assert not d.update(0, 0, 0, 0, .2, .1, .04, .5)[1]
    assert d.duration_s == 0
    with pytest.raises(ValueError): stationary_gyro_bias([])


def test_forecasts_boundaries_and_noninteger_horizon():
    assert len(motion_forecast((0, 0, 0), .1, .2, .2)) == 21
    path = motion_forecast((0, 0, 0), .2, .2, .2, 1.05, .1)
    assert path[-1] == pytest.approx((.21, 0, 0))
    assert runtime_hours(.8, .2, 2, .6) == pytest.approx(2)
    assert runtime_hours(.8, .2, 2, 0) is None
    assert runtime_hours(.8, .2, 2, -.5) is None
    assert runtime_hours(1.2, .2, 2, .5) is None
    assert runtime_hours(.1, .2, 2, .5) == 0


@pytest.mark.parametrize('bad', [0, -1, float('nan'), float('inf'), True])
def test_bad_geometry_rejected(bad):
    with pytest.raises(ValueError): wheel_distance(1, bad, 600)
    c = vars(example_calibrations()['amr01']).copy()
    c['track_m'] = bad
    with pytest.raises(ValueError): Calibration(**c)


def test_slide13_timer_starts_at_first_abnormal_sample():
    detector = ResidualDetector()
    since = None
    previous = 0
    for now, gyro in [(1.0, .2), (1.3, .2), (1.49, .2), (1.5, .2), (1.6, 0), (2.0, .2)]:
        # Independent reference: the timestamp rule printed on slide 13.
        if abs(gyro) <= .04:
            expected, since = False, None
        else:
            since = now if since is None else since
            expected = now - since >= .5
        assert detector.update(gyro, 0, 0, 0, .2, now - previous, .04, .5)[1] == expected
        previous = now
    detector.reset()
    assert not detector.update(.2, 0, 0, 0, .2, 1, .04, .5)[1]


def test_slide15_stock_and_task_events():
    assert stock_step(100, 30, 25) == 105
    assert stock_step(0, 5, 5) == 0
    for values in [(0, 0, 1), (1, -1, 0), (1, 1.5, 0), (1, True, 0)]:
        with pytest.raises(ValueError): stock_step(*values)
    state = 'idle'
    assert task_step(state, 'start') == 'idle'
    for event, expected in [('assign', 'assigned'), ('start', 'travelling'), ('arrive', 'servicing'), ('complete', 'idle')]:
        state = task_step(state, event)
        assert state == expected
    assert task_step('idle', 'fault') == 'fault'
    assert task_step('fault', 'complete') == 'fault'
