"""Mission safety behavior with synthetic scenes and in-memory audit storage only."""
import copy

import pytest
from sqlalchemy import create_engine

from automated_software_checks.predictive_twin_checks.test_battery_policy import (
    KEY, OWNER, frame, running_workflow,
)
from backend_streamlit_and_telemetry.vision_control import contracts
from backend_streamlit_and_telemetry.vision_control.agent import Agent
from backend_streamlit_and_telemetry.vision_control.battery_policy import battery_action
from backend_streamlit_and_telemetry.vision_control.coordinator import Coordinator, metadata


@pytest.fixture
def workflow():
    engines = []

    def build(voltage=7.4, consent=False, consent_voltage=None):
        engine = create_engine('sqlite://')
        engines.append(engine)
        metadata.create_all(engine)
        clock, wire, commands = [10000], [], []
        coordinator = Coordinator(engine, KEY, wire.append, lambda: clock[0], battery_mode='mission')
        coordinator.connected = True
        for stamp in (9400, 9700, 10000):
            clock[0] = stamp
            coordinator.observe(contracts.seal('scene', frame(stamp, voltage, stamp), KEY))
        coordinator.capture(OWNER, 'operator', [210, 450], battery_consent=consent,
                            battery_consent_voltage=consent_voltage)
        rid = coordinator.row['review_id']
        coordinator.decide(OWNER, rid, 'approve', 'Measured clear floor')
        agent = Agent(KEY, lambda *args: commands.append(args), battery_mode='mission')
        agent.scene = coordinator.current
        agent.request(wire[-1], clock[0])
        return dict(c=coordinator, clock=clock, wire=wire, commands=commands, agent=agent, rid=rid)

    yield build
    for engine in engines:
        engine.dispose()


def advance(w, *, voltage=7.4, state='moving', delta=100, mutate=None):
    c, a, clock = w['c'], w['agent'], w['clock']
    clock[0] += delta
    c.touch(OWNER)
    a.request(c.packet('lease'), clock[0])
    current = frame(clock[0], voltage, clock[0], w['rid'], state, a.seq)
    if mutate:
        mutate(current)
    c.observe(contracts.seal('scene', current, KEY))
    a.tick(current, clock[0])
    c.status(a.status(clock[0]))
    return current


def acknowledge(w, voltage=7.4):
    advance(w, voltage=voltage, state='armed')
    assert w['agent'].state == 'running'


def continue_battery(w):
    c, a = w['c'], w['agent']
    # The next H1 observation acknowledges the first zero-output warning
    # command. A stationary camera coordinate alone cannot prove that stop.
    advance(w, voltage=c.current['hardware']['battery_voltage_v'], state='interlock')
    c.battery_decide(OWNER, w['rid'], 'continue', 'Continue the approved goal above cutoff',
                     battery_review_seq=a.battery_review_seq)
    packet = w['wire'][-1]
    body = contracts.unseal('request', packet, KEY)
    assert body['operation'] == 'battery_continue' and body['review_id'] == w['rid']
    assert type(body['battery_review_seq']) is int and body['battery_review_seq'] > 0
    a.request(packet, w['clock'][0])
    assert a.state == 'running'
    c.status(a.status(w['clock'][0]))
    return packet


@pytest.mark.parametrize('voltage,answer,expected', [
    (6.6, False, 'critical_stop'), (6.65, False, 'critical_stop'),
    (6.6999, True, 'critical_stop'), (6.7, None, 'ask_human'),
    (6.7, False, 'continue_goal'), (7.0, None, 'ask_human'),
    (7.0, True, 'divert_request'), (7.0001, None, 'normal'),
])
def test_mission_battery_boundaries(voltage, answer, expected):
    assert battery_action(voltage, 6.6, 7.0, answer, mode='mission') == expected


def test_legacy_workflow_retains_its_existing_thresholds():
    c, clock, wire, commands, agent, rid = running_workflow()
    try:
        clock[0] += 100
        agent.tick(frame(clock[0], 6.65, clock[0], rid, 'moving', 1), clock[0])
        assert agent.state == 'battery_review'
        assert commands[-1][3:6] == ('drive', 0, 0)
    finally:
        c.engine.dispose()


def test_mission_never_moves_before_matching_zero_output_arm_ack(workflow):
    w = workflow()
    assert w['agent'].state == 'arming'
    assert w['commands'][-1][3:6] == ('arm', 0, 0)
    variants = [
        lambda s: s['hardware'].update(route_id='9' * 32),
        lambda s: s['hardware'].update(state='idle'),
        lambda s: s['hardware'].update(command_seq=0),
        lambda s: s['hardware'].update(left_duty=1),
    ]
    for change in variants:
        advance(w, state='armed', mutate=change)
        assert w['agent'].state == 'arming'
        assert all(command[3:6] == ('arm', 0, 0) for command in w['commands'])
    acknowledge(w)
    assert len(w['commands']) == 1
    advance(w)
    assert w['commands'][-1][3] == 'drive'
    assert w['commands'][-1][4] or w['commands'][-1][5]


def changed_obstacles(s):
    s['obstacles'] = [dict(x=500, y=500, width=20, height=20)]


@pytest.mark.parametrize('change', [
    lambda s: s.update(valid=False, pose=None),
    lambda s: s.update(captured_at_ms=s['captured_at_ms'] - 501),
    lambda s: s.update(config_id='9' * 64),
    lambda s: s.update(agent_boot_id='9' * 32),
    lambda s: s.update(floor_width_mm=620),
    lambda s: s['geometry'].update(robot_width_mm=41),
    lambda s: s['hardware'].update(boot_id='9' * 32),
    lambda s: s['hardware'].update(epoch_id='9' * 32),
    lambda s: s['hardware'].update(ready=False),
    lambda s: s['hardware'].update(age_ms=501),
])
def test_only_fresh_same_identity_obstacle_changes_can_trigger_replanning(change):
    reference = frame()
    current = copy.deepcopy(reference)
    changed_obstacles(current)
    assert contracts.scene_stop_cause(reference, current, 10000) == 'obstacle_changed'
    change(current)
    cause = contracts.scene_stop_cause(reference, current, 10000)
    assert cause and cause != 'obstacle_changed'


def test_unchanged_scene_has_no_stop_cause():
    reference = frame()
    assert contracts.scene_stop_cause(reference, copy.deepcopy(reference), 10000) is None


@pytest.mark.parametrize('failure,obstacle', [
    ('obstacle', True), ('controller_epoch', False), ('invalid', False), ('stale', False),
])
def test_agent_stops_and_exposes_distinct_classified_cause(workflow, failure, obstacle):
    w = workflow()
    acknowledge(w)
    a, clock = w['agent'], w['clock']
    clock[0] += 100
    current = frame(clock[0], 7.4, clock[0], w['rid'], 'moving', a.seq)
    changed_obstacles(current)
    if failure == 'controller_epoch':
        current['hardware']['epoch_id'] = '9' * 32
    elif failure == 'invalid':
        current.update(valid=False, pose=None)
    elif failure == 'stale':
        current['captured_at_ms'] -= 501
    a.tick(current, clock[0])
    assert a.state == 'blocked'
    assert w['commands'][-1][3:6] == ('stop', 0, 0)
    assert (a.stop_cause == 'obstacle_changed') is obstacle
    assert a.stop_cause
    status = contracts.unseal('status', a.status(clock[0]), KEY)
    assert status['stop_cause'] == a.stop_cause
    assert status['stop_command_seq'] == w['commands'][-1][2] == a.stop_command_seq


def test_coordinator_obstacle_cause_survives_tick_cancellation(workflow):
    w = workflow()
    acknowledge(w)
    c, clock = w['c'], w['clock']
    clock[0] += 100
    current = frame(clock[0], 7.4, clock[0], w['rid'], 'moving', w['agent'].seq)
    changed_obstacles(current)
    c.observe(contracts.seal('scene', current, KEY))
    c.tick()
    review = c.public(OWNER)['review']
    assert review['stop_cause'] == 'obstacle_changed'
    c.tick()
    assert c.public(OWNER)['review']['stop_cause'] == 'obstacle_changed'


@pytest.mark.parametrize('change', [
    lambda s: s['hardware'].update(route_id='9' * 32),
    lambda s: s['hardware'].update(state='idle'),
    lambda s: s['hardware'].update(state='armed'),
    lambda s: s['hardware'].update(command_seq=4),
    lambda s: s['hardware'].update(left_duty=1),
    lambda s: s['hardware'].update(right_duty=-1),
    lambda s: s['hardware'].update(ready=False),
    lambda s: s['hardware'].update(age_ms=501),
    lambda s: s.update(captured_at_ms=9499),
    lambda s: s.update(valid=False, pose=None),
])
def test_stopped_confirmation_requires_current_matching_route_ack(change):
    rid = '1' * 32
    current = frame(route_id=rid, state='stopped', command_seq=5)
    assert contracts.stopped_for_route(current, 10000, rid, 5)
    change(current)
    assert not contracts.stopped_for_route(current, 10000, rid, 5)


def test_stopped_confirmation_accepts_a_newer_applied_stop_ack():
    rid = '1' * 32
    current = frame(route_id=rid, state='stopped', command_seq=6)
    assert contracts.stopped_for_route(current, 10000, rid, 5)


def test_mission_continue_below_6_7_is_blocked_by_coordinator_and_agent(workflow):
    w = workflow()
    acknowledge(w)
    advance(w, voltage=6.9)
    assert w['agent'].state == 'battery_review'
    advance(w, voltage=6.9, state='interlock')
    c, clock = w['c'], w['clock']
    clock[0] += 100
    critical = frame(clock[0], 6.65, clock[0], w['rid'], 'moving', w['agent'].seq)
    c.observe(contracts.seal('scene', critical, KEY))
    with pytest.raises(ValueError):
        c.battery_decide(OWNER, w['rid'], 'continue', 'Attempt below mission cutoff',
                         battery_review_seq=w['agent'].battery_review_seq)
    w['agent'].tick(critical, clock[0])
    assert w['agent'].state == 'blocked'
    assert w['commands'][-1][3:6] == ('stop', 0, 0)


def test_voltage_drop_realerts_and_old_continue_cannot_authorize_new_alert(workflow):
    w = workflow()
    acknowledge(w)
    advance(w, voltage=6.95)
    assert w['agent'].state == 'battery_review'
    old = continue_battery(w)
    old_seq = contracts.unseal('request', old, KEY)['battery_review_seq']
    advance(w, voltage=6.90)
    assert w['agent'].state == 'running'
    advance(w, voltage=6.85)
    assert w['agent'].state == 'battery_review'
    assert w['commands'][-1][3:6] == ('drive', 0, 0)
    with pytest.raises(ValueError):
        w['agent'].request(old, w['clock'][0])
    assert w['agent'].state == 'battery_review'
    new = continue_battery(w)
    assert contracts.unseal('request', new, KEY)['battery_review_seq'] > old_seq


def test_recovery_then_warning_band_reentry_requires_another_answer(workflow):
    w = workflow()
    acknowledge(w)
    advance(w, voltage=6.9)
    continue_battery(w)
    for _ in range(12):
        advance(w, voltage=7.1, mutate=lambda s: s['hardware'].update(left_duty=20, right_duty=20))
        assert w['agent'].state == 'running'
    advance(w, voltage=6.99)
    assert w['agent'].state == 'battery_review'
    assert w['commands'][-1][3:6] == ('drive', 0, 0)


def test_one_healthy_voltage_sample_after_continue_is_not_sustained_recovery(workflow):
    w = workflow()
    acknowledge(w)
    advance(w, voltage=6.95)
    continue_battery(w)
    advance(w, voltage=7.15, mutate=lambda s: s['hardware'].update(left_duty=20, right_duty=20))
    assert w['agent'].state == 'running'
    advance(w, voltage=6.95)
    assert w['agent'].state == 'running'


def test_sustained_zero_output_rebound_is_not_motion_recovery(workflow):
    w = workflow()
    acknowledge(w)
    advance(w, voltage=6.95)
    continue_battery(w)
    for _ in range(12):
        advance(w, voltage=7.15)
        assert w['agent'].state == 'running'
    advance(w, voltage=6.95)
    assert w['agent'].state == 'running'


def test_exact_tenth_volt_drop_realerts_at_inclusive_lower_warning_boundary(workflow):
    w = workflow()
    acknowledge(w)
    advance(w, voltage=6.8)
    continue_battery(w)
    advance(w, voltage=6.7)
    assert w['agent'].state == 'battery_review'
    assert w['commands'][-1][3:6] == ('drive', 0, 0)


def test_stopped_voltage_rebound_does_not_reset_latched_warning_baseline(workflow):
    w = workflow()
    acknowledge(w)
    advance(w, voltage=6.95)
    assert w['agent'].state == 'battery_review'
    advance(w, voltage=7.15)
    assert w['agent'].state == 'battery_review'
    assert w['commands'][-1][3:6] == ('drive', 0, 0)
    continue_battery(w)
    advance(w, voltage=6.95)
    assert w['agent'].state == 'running'
    advance(w, voltage=6.84)
    assert w['agent'].state == 'battery_review'
    advance(w, voltage=6.69)
    assert w['agent'].state == 'blocked'
    assert w['commands'][-1][3:6] == ('stop', 0, 0)


def test_coordinator_rejects_stale_or_missing_battery_prompt_sequence(workflow):
    w = workflow()
    acknowledge(w)
    advance(w, voltage=6.95)
    advance(w, voltage=6.95, state='interlock')
    c, a = w['c'], w['agent']
    before = len(w['wire'])
    for stale in (None, a.battery_review_seq - 1):
        with pytest.raises(ValueError):
            c.battery_decide(OWNER, w['rid'], 'continue', 'Stale displayed decision',
                             battery_review_seq=stale)
    assert len(w['wire']) == before
    assert c.public(OWNER)['review']['battery_review_seq'] == a.battery_review_seq
    assert c.public(OWNER)['review']['battery_prompt'] is True


def test_battery_decision_requires_ack_of_the_warning_zero_command(workflow):
    w = workflow()
    acknowledge(w)
    advance(w, voltage=6.95)
    c, a = w['c'], w['agent']
    assert a.state == 'battery_review'
    assert c.current['hardware']['left_duty'] == c.current['hardware']['right_duty'] == 0
    assert c.current['hardware']['command_seq'] < a.battery_stop_command_seq
    before = len(w['wire'])
    with pytest.raises(ValueError):
        c.battery_decide(OWNER, w['rid'], 'continue', 'Old zero-output observation',
                         battery_review_seq=a.battery_review_seq)
    with pytest.raises(ValueError):
        a.request(c.packet('battery_continue'), w['clock'][0])
    assert a.state == 'battery_review' and len(w['wire']) == before
    continue_battery(w)
    assert a.state == 'running'


def test_explicit_battery_destination_consent_is_only_for_that_route(workflow):
    w = workflow(voltage=6.9, consent=True)
    execute = contracts.unseal('request', w['wire'][-1], KEY)
    assert execute.get('battery_consent')
    acknowledge(w, voltage=6.9)
    advance(w, voltage=6.9)
    assert w['agent'].state == 'running'
    assert w['commands'][-1][3] == 'drive' and any(w['commands'][-1][4:6])
    a, c, clock = w['agent'], w['c'], w['clock']
    a.halt('First leg explicitly ended', clock[0])
    c.status(a.status(clock[0]))
    for delta in (200, 200, 200):
        clock[0] += delta
        current = frame(clock[0], 6.9, clock[0], w['rid'], 'stopped', a.seq)
        c.observe(contracts.seal('scene', current, KEY))
    c.capture(OWNER, 'operator', [210, 450])
    w['rid'] = c.row['review_id']
    c.decide(OWNER, w['rid'], 'approve', 'New leg without battery continuation consent')
    a.scene = c.current
    a.request(w['wire'][-1], clock[0])
    acknowledge(w, voltage=6.9)
    advance(w, voltage=6.9)
    assert a.state == 'battery_review'
    assert w['commands'][-1][3:6] == ('drive', 0, 0)


def test_battery_destination_consent_preserves_warning_minimum_across_rebound(workflow):
    w = workflow(voltage=7.15, consent=True, consent_voltage=6.95)
    acknowledge(w, voltage=7.15)
    advance(w, voltage=6.95)
    assert w['agent'].state == 'running'
    advance(w, voltage=6.84)
    assert w['agent'].state == 'battery_review'
    advance(w, voltage=6.69)
    assert w['agent'].state == 'blocked'
    assert w['commands'][-1][3:6] == ('stop', 0, 0)
