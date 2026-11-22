"""Front-reference arrival using synthetic observations; never real motor IO."""
import copy
import json
import math

import pytest

from backend_streamlit_and_telemetry.vision_control.contracts import (
    Follower, digest, front_goal, goal_reached, plan, radius, seal,
)
from backend_streamlit_and_telemetry.vision_control.agent import Agent
from test_vision_execution import G, SECRET, coordinator, sample
from test_local_station_missions import mission_rig, start, approve, obstacle_preview, settle


EDGES = dict(A=dict(x=210, y=210), B=dict(x=240, y=430), E=dict(x=300, y=270))
HEADINGS = dict(A=90, B=0, E=-90)


@pytest.mark.parametrize("edge,heading,expected", [
    ((630, 350), 0, (545, 350)),
    ((205, 430), math.pi/2, (205, 345)),
    ((290, 75), -math.pi/2, (290, 160)),
])
def test_reported_170_mm_body_converts_front_points_without_moving_edges(edge, heading, expected):
    config = dict(G, robot_length_mm=170, robot_width_mm=155, robot_height_mm=150)
    target = dict(x=edge[0], y=edge[1], heading=heading)
    centre, actual, offset = front_goal(target, config)
    assert centre == pytest.approx(expected)
    assert offset == 85 and (actual['x'], actual['y']) == edge
    assert actual['heading'] == pytest.approx(heading)


def test_front_reference_preserves_clearance_and_rejects_inconsistent_goals():
    s = sample()
    with pytest.raises(ValueError, match="clearance"):
        plan(s, [30, 30], front_target=dict(x=60, y=30, heading=0))
    with pytest.raises(ValueError, match="disagree"):
        plan(s, [210, 430], front_target=dict(x=240, y=430, heading=math.pi/2))
    for target in (dict(x=240, y=430), dict(x=240, y=430, heading=True),
                   dict(x=240, y=430, heading=math.nan), dict(x=761, y=430, heading=0)):
        with pytest.raises(ValueError):
            plan(s, [210, 430], front_target=target)
    route = plan(s, [210, 430], front_target=dict(x=240, y=430, heading=0))
    assert route['clearance_radius_mm'] == radius(G)
    assert route['goal_tolerance_mm'] == 10 and route['front_tolerance_mm'] == 15


def test_follower_aligns_even_for_one_point_route_and_front_must_be_near_edge():
    s = sample(x=210, y=430)
    route = plan(s, [210, 430], front_target=dict(x=240, y=430, heading=0))
    assert route['points'] == [[210, 430]]
    follower = Follower(route, G, 10000)
    left, right, done = follower.update(s, 10000)
    assert not done and left > 0 > right
    assert not goal_reached(route, s['pose'])
    s['pose']['heading'] = 0
    assert follower.update(s, 10000) == (0, 0, True)
    s['pose']['x'] += 11
    assert not goal_reached(route, s['pose'])


def test_yaw_tolerance_accounts_for_longer_front_offset():
    g = dict(G, robot_length_mm=400, robot_width_mm=20, clearance_mm=10,
             uncertainty_mm=2, stopping_distance_mm=1, tracking_tolerance_mm=3, max_speed_mm_s=5,
             left_pwm_per_mm_s=8, right_pwm_per_mm_s=8)
    centre, target, offset = front_goal(dict(x=580, y=280, heading=0), g)
    assert centre == [380, 280] and offset == 200
    s = sample(x=380, y=280); s['geometry'] = g
    route = plan(s, centre, front_target=target)
    assert route['goal_heading_tolerance_rad'] == .025
    assert goal_reached(route, dict(x=380, y=280, heading=.024))
    assert not goal_reached(route, dict(x=380, y=280, heading=.026))


@pytest.mark.parametrize('final_yaw', [0, math.pi/2, -math.pi/2, math.pi])
def test_closed_loop_front_alignment_after_travel(final_yaw):
    x, y, yaw = 210., 180., math.pi/2
    target = dict(x=210+30*math.cos(final_yaw), y=430+30*math.sin(final_yaw), heading=final_yaw)
    route = plan(sample(), [210, 430], front_target=target)
    follower = Follower(route, G, 10000)
    for step in range(550):
        now = 10000+100*step
        s = sample(now, step+1, x, y, yaw)
        left, right, done = follower.update(s, now)
        if done:
            break
        vl, vr = left/4, right/4
        yaw += (vr-vl)/100*.1
        speed = (vl+vr)/2
        x += speed*math.cos(yaw)*.1
        y += speed*math.sin(yaw)*.1
    assert done and (left, right) == (0, 0)
    assert goal_reached(route, dict(x=x, y=y, heading=yaw))


def test_front_station_persistence_keeps_measured_points_and_calibration_binding(mission_rig):
    twin, clock, transport, frame = mission_rig
    twin.mission.configure(dict(stations=EDGES, reference="front", headings_deg=HEADINGS, verified=True))
    saved = json.loads(twin.mission.station_path.read_text())
    public = twin.mission.stations()
    assert saved['stations'] == EDGES and public['measured_points'] == EDGES
    assert public['reference'] == 'front' and public['front_offset_mm'] == 30
    assert public['stations']['B'] == dict(x=210, y=430, front_target=dict(x=240, y=430, heading=0))
    assert public['verified'] and not transport.sent
    twin.config_id = 'a' * 64
    assert not twin.mission.stations()['verified']


def test_invalid_front_station_cannot_replace_existing_measurements(mission_rig):
    twin, clock, transport, frame = mission_rig
    previous = copy.deepcopy(twin.mission.station_data)
    for headings in (None, dict(A=0), dict(HEADINGS, E=True), dict(HEADINGS, B=math.inf)):
        with pytest.raises(ValueError):
            twin.mission.configure(dict(stations=EDGES, reference='front', headings_deg=headings, verified=True))
    too_close = dict(EDGES, E=dict(x=290, y=1))
    with pytest.raises(ValueError, match="clearance"):
        twin.mission.configure(dict(stations=too_close, reference='front', headings_deg=HEADINGS, verified=True))
    assert twin.mission.station_data == previous and not transport.sent


def test_front_arrival_requires_final_heading_fresh_frames_and_applied_stop(mission_rig):
    twin, clock, transport, frame = mission_rig
    twin.mission.configure(dict(stations=EDGES, reference='front', headings_deg=HEADINGS, verified=True))
    start(twin); rid = approve(twin)
    route = twin.coordinator.row['route']
    assert route['front_target'] == dict(x=240, y=430, heading=0)
    frame(10100, state='armed')
    frame(10200, x=210, y=430, state='moving')
    assert twin.agent.state == 'running' and transport.sent[-1][3] == 'drive'
    assert transport.sent[-1][4] > 0 > transport.sent[-1][5]
    frame(10300, x=210, y=430, heading=0, state='moving')
    assert twin.agent.state == 'stopping' and transport.sent[-1][3] == 'stop'
    stop_seq = twin.agent.stop_command_seq
    for stamp in (10400, 10600, 10800):
        frame(stamp, x=210, y=430, heading=0, ack=stop_seq-1)
    assert twin.agent.state == 'stopping'  # A visual stop is insufficient.
    for stamp in (10900, 11100, 11300):
        frame(stamp, x=210, y=430, heading=math.pi/2, ack=stop_seq)
    assert twin.agent.state == 'stopping' and not twin.agent.stop_samples
    for stamp in (11400, 11600, 11800, 12000, 12200):
        frame(stamp, x=210, y=430, heading=0, ack=stop_seq)
    assert twin.agent.state == 'verified'
    assert twin.coordinator.row['state'] == 'verified'
    assert twin.mission.row['outcome'] == 'destination_reached'
    assert twin.mission.row['original_destination']['front_target'] == route['front_target']


def test_front_target_survives_obstacle_replan_but_return_keeps_observed_origin(mission_rig):
    twin, clock, transport, frame = mission_rig
    twin.mission.configure(dict(stations=EDGES, reference='front', headings_deg=HEADINGS, verified=True))
    value = obstacle_preview(twin, frame)
    assert value['review']['state'] == 'pending'
    assert value['review']['route']['front_target'] == dict(x=240, y=430, heading=0)
    original = copy.deepcopy(value['mission']['original_start'])
    twin.mutate('decision', dict(review_id=value['review']['review_id'], decision='reject', reason='Return to observed start'))
    twin.mutate('return-start', dict(reason='Return after rejection'))
    value = settle(frame, clock[0])
    assert value['mission']['original_start'] == original
    assert value['review']['route']['goal'] == [original['x'], original['y']]
    assert 'front_target' not in value['review']['route']
    assert value['mission']['original_destination']['front_target'] == dict(x=240, y=430, heading=0)


def test_signed_route_cannot_change_front_reference_or_offset():
    c, clock, packets = coordinator()
    try:
        c.capture('1'*32, 'operator', [210, 430], front_target=dict(x=240, y=430, heading=0))
        c.decide('1'*32, c.row['review_id'], 'approve', 'Offline front-edge fixture')
        for field, value in [('front_offset_mm', 1), ('goal_heading_tolerance_rad', 4),
                             ('front_target', dict(x=240, y=430, heading=math.pi/2))]:
            body = copy.deepcopy(packets[-1]['body'])
            body['route'][field] = value
            body['route_hash'] = digest(body['route'])
            a = Agent(SECRET, lambda *args: pytest.fail('Invalid route sent a motor command'))
            a.scene = c.current
            with pytest.raises(ValueError):
                a.request(seal('request', body, SECRET), clock[0])
    finally:
        c.engine.dispose()


def test_coordinator_independently_rejects_verified_wrong_facing():
    c, clock, packets = coordinator()
    try:
        c.capture('1'*32, 'operator', [210, 430], front_target=dict(x=240, y=430, heading=0))
        c.decide('1'*32, c.row['review_id'], 'approve', 'Offline fixture')
        for index, stamp in enumerate((10100, 10300, 10500), 1):
            clock[0] = stamp
            c.observe(seal('scene', sample(stamp, stamp, x=210, y=430), SECRET))
            c.status(seal('status', dict(review_id=c.row['review_id'], agent_boot_id=c.current['agent_boot_id'],
                state='verified', reason='Claimed arrival', seq=index, issued_at_ms=stamp), SECRET))
        assert c.row['state'] != 'verified' and not c.verification
    finally:
        c.engine.dispose()
