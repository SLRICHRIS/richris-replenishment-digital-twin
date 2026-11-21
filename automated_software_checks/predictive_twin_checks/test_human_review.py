from copy import deepcopy
import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from backend_streamlit_and_telemetry.predictive_twin.workspace_payload import workspace_payload
from backend_streamlit_and_telemetry.predictive_twin.human_review import ReviewCoordinator, metadata, COMMAND_TOPIC

ID = 'a'*32


@pytest.fixture
def setup():
    engine = create_engine('sqlite+pysqlite://', connect_args={'check_same_thread':False}, poolclass=StaticPool)
    metadata.create_all(engine)
    sent, now = [], [1000.]
    coordinator = ReviewCoordinator(engine, publisher=lambda topic,packet:sent.append((topic,packet)),
                                    commands_enabled=True, clock=lambda:now[0], source='demo')
    payload = workspace_payload('demo', 'turning')
    yield coordinator, payload, sent, now
    engine.dispose()


def approve(c,p,action='pause',rid=ID):
    return c.decide(rid, decision='approve', action=action, operator='operator01', reason='Inspect motion before continuing', payload=p)


def ack(row, status='applied', **change):
    cmd = row['command']
    return dict(command_id=row['review_id'], robot_id='amr01', boot_id=cmd['target_boot_id'],
                action=cmd['action'], source_seq=cmd['source_seq'], status=status,
                applied_sample_time_s=cmd['source_sample_time_s'], **change)


def follow(p,i,speed=0):
    q=deepcopy(p);r=q['robots']['amr01']
    if speed == 0:r['raw']['robot_state']='paused'
    r['raw']['seq']+=i;r['raw']['sample_time_s']+=i*.05
    r['derived']['v_left_m_s']=r['derived']['v_right_m_s']=speed
    return q


def test_no_intervention_and_rejection_never_publish(setup):
    c,p,sent,now=setup
    c.create(p,ID)
    assert approve(c,p,'no_action')['state']=='reviewed'
    rid='b'*32;c.create(p,rid)
    assert c.decide(rid,decision='reject',action='pause',operator='op',reason='No intervention',payload=p)['state']=='rejected'
    assert not sent


def test_approval_transport_ack_and_observed_effect_are_distinct(setup):
    c,p,sent,now=setup;c.create(p,ID)
    row=approve(c,p)
    assert row['state']=='sent' and sent[0][0]==COMMAND_TOPIC
    c.observe(follow(p,1));assert c.get(ID)['state']=='sent'
    c.acknowledge(ack(row,'accepted'));assert c.get(ID)['state']=='sent'
    c.acknowledge(ack(row));assert c.get(ID)['state']=='acknowledged'
    c.observe(follow(p,1));c.observe(follow(p,1))
    assert c.get(ID)['verified_samples']==1
    c.observe(follow(p,2));assert c.get(ID)['state']=='acknowledged'
    c.observe(follow(p,3));assert c.get(ID)['state']=='verified'
    assert len(sent)==1


def test_retry_cannot_change_or_republish_an_approved_action(setup):
    c,p,sent,now=setup;c.create(p,ID);approve(c,p)
    assert c.create(p,ID)['state']=='sent'
    assert approve(c,p)['state']=='sent' and len(sent)==1
    with pytest.raises(ValueError):approve(c,p,'reduce_speed')
    with pytest.raises(ValueError):c.create(p,'b'*32)


@pytest.mark.parametrize('change',[{'stale':True},{'continuity_lost':True},{'age_s':3},{'quality':'STALE'}])
def test_stale_or_partial_context_cannot_authorize(setup,change):
    c,p,sent,now=setup;c.create(p,ID)
    p['robots']['amr01'].update(change)
    with pytest.raises(ValueError):approve(c,p)
    assert not sent


def test_changed_alert_or_boot_requires_a_new_review(setup):
    c,p,sent,now=setup;c.create(p,ID)
    p['robots']['amr01']['raw']['boot_id']='different'
    assert approve(c,p)['state']=='expired' and not sent


def test_expired_or_late_ack_does_not_revive_delivery(setup):
    c,p,sent,now=setup;c.create(p,ID);row=approve(c,p)
    now[0]+=6
    assert c.acknowledge(ack(row))['state']=='uncertain'
    assert c.get(ID)['state']=='uncertain'


def test_retain_wrong_boot_wrong_action_and_pre_application_readings_fail(setup):
    c,p,sent,now=setup;c.create(p,ID);row=approve(c,p)
    with pytest.raises(ValueError):c.acknowledge(ack(row),retained=True)
    for key,value in [('boot_id','wrong'),('action','reduce_speed'),('source_seq',999)]:
        bad=ack(row);bad[key]=value
        with pytest.raises(ValueError):c.acknowledge(bad)
    applied=ack(row);applied['applied_sample_time_s']+=.1
    c.acknowledge(applied)
    c.observe(follow(p,1));assert c.get(ID)['verified_samples']==0
    c.acknowledge(ack(row,'accepted'));assert c.get(ID)['state']=='acknowledged'


def test_disabled_transport_and_restart_do_not_execute(setup):
    c,p,sent,now=setup;c.commands_enabled=False;c.create(p,ID)
    assert approve(c,p)['state']=='blocked' and not sent
    c.commands_enabled=True;c.create(p,'b'*32);approve(c,p,rid='b'*32)
    c.recover();assert c.get('b'*32)['state']=='uncertain'
    assert len(sent)==1


def test_verification_needs_three_fresh_samples_within_limit(setup):
    c,p,sent,now=setup;c.create(p,ID);row=approve(c,p,'reduce_speed');c.acknowledge(ack(row))
    c.observe(follow(p,1));c.observe(follow(p,2,10))
    assert c.get(ID)['verified_samples']==0
    for i in range(3,6):c.observe(follow(p,i))
    assert c.get(ID)['state']=='verified'




def test_default_physical_coordinator_rejects_generated_evidence(setup):
    c,p,sent,now=setup
    physical=ReviewCoordinator(c.engine)
    with pytest.raises(ValueError,match='boundary'):physical.create(p,ID)
    assert not physical.history()


def test_reported_motion_blocks_pause_verification(setup):
    c,p,sent,now=setup;c.create(p,ID);row=approve(c,p);c.acknowledge(ack(row))
    for i in range(1,4):
        q=follow(p,i);q['robots']['amr01']['raw']['robot_state']='moving';c.observe(q)
    assert c.get(ID)['state']=='acknowledged'
    assert c.get(ID)['verified_samples']==0


def test_review_creation_retry_keeps_original_evidence_after_stream_advances(setup):
    c,p,sent,now=setup;c.create(p,ID)
    newer=follow(p,3)
    assert c.create(newer,ID)['evidence']['seq']==p['robots']['amr01']['raw']['seq']
    assert len(c.history())==1


def test_physical_freshness_includes_elapsed_time_after_context_read(setup):
    c,p,sent,now=setup
    physical=ReviewCoordinator(c.engine,clock=lambda:now[0])
    p['mode']='live';p['observed_at']=now[0]
    now[0]+=3
    with pytest.raises(ValueError,match='Fresh'):physical.create(p,ID)
    assert not physical.history()


@pytest.fixture
def observation(setup):
    from automated_software_checks.predictive_twin_checks.test_insights import observation_data
    old,_,sent,now=setup
    c=ReviewCoordinator(old.engine,publisher=lambda *args:sent.append(args),commands_enabled=True,clock=lambda:now[0])
    return c,observation_data(),sent,now


def test_observation_choice_records_follow_up_without_any_command_or_ack(observation):
    c,p,sent,now=observation;c.create(p,ID)
    # The decision captures the newest sequence, rather than counting already-seen evidence.
    raw=p['physical_telemetry']['measurements'];raw['seq']+=1;raw['sample_time_s']+=.1
    row=approve(c,p,'inspect');assert row['state']=='observing'
    c.observe(p);assert c.get(ID)['verified_samples']==0
    for i in range(3):
        raw['seq']+=2;raw['sample_time_s']+=.2
        raw['battery_voltage_v']+=.001
        c.observe(p);c.observe(p)
        assert c.get(ID)['verified_samples']==i+1
    row=c.get(ID)
    assert row['state']=='observed' and not row['command'] and not row['ack'] and not sent
    assert row['events'][-1]['observation']['measurements']['battery_voltage_v']>7.2
    assert 'not independently confirmed' in row['events'][-1]['detail']


@pytest.mark.parametrize('action',['pause','reduce_speed'])
def test_observation_scope_cannot_dispatch_even_with_enabled_publisher(observation,action):
    c,p,sent,now=observation;c.create(p,ID)
    with pytest.raises(ValueError,match='Drive control'):approve(c,p,action)
    assert c.get(ID)['state']=='pending' and not sent


def test_observation_categories_not_voltage_jitter_determine_evidence_change(observation):
    c,p,sent,now=observation
    p['physical_telemetry']['measurements']['battery_voltage_v']=6.2;c.create(p,ID)
    p['physical_telemetry']['measurements']['battery_voltage_v']=6.21
    assert approve(c,p,'recharge')['state']=='observing'
    c.recover();assert c.get(ID)['state']=='expired'
    c.create(p,'b'*32);p['physical_telemetry']['measurements']['battery_voltage_v']=7.2
    assert approve(c,p,'recharge',rid='b'*32)['state']=='expired' and not sent


def test_observation_follow_up_stale_boot_and_settings_boundaries(observation):
    c,p,sent,now=observation;c.create(p,ID);approve(c,p,'no_action')
    raw=p['physical_telemetry']['measurements'];raw['seq']+=1;raw['sample_time_s']+=.1
    c.observe(p);assert c.get(ID)['verified_samples']==1
    now[0]+=6;c.observe(p)
    assert c.get(ID)['verified_samples']==0
    with pytest.raises(ValueError,match='Fresh'):c._evidence(p)
    p['observed_at']=now[0];raw['boot_id']='new-boot';c.observe(p)
    assert c.get(ID)['state']=='uncertain'
    c.create(p,'b'*32);approve(c,p,'no_action',rid='b'*32)
    p['physical_telemetry']['commissioning']['profile_id']='changed';c.observe(p)
    assert c.get('b'*32)['state']=='uncertain' and not sent


def test_observation_deadline_does_not_replay_old_decision(observation):
    c,p,sent,now=observation;c.create(p,ID);approve(c,p,'no_action')
    now[0]+=31
    assert c.get(ID)['state']=='expired'
    p['observed_at']=now[0];p['physical_telemetry']['measurements']['seq']+=50
    c.observe(p);assert c.get(ID)['state']=='expired' and not sent


@pytest.mark.parametrize('action', ['stop_and_inspect','lower_power','inspect_power','inspect_wheels','calibrate_imu','check_feed'])
def test_specific_observation_actions_are_recorded_without_enabling_motor_transport(observation,action):
    c,p,sent,now=observation;c.create(p,ID)
    row=approve(c,p,action)
    assert row['state']=='observing' and row['decision']['action']==action
    assert row['command'] is None and row['ack'] is None and not sent


def test_changed_screening_policy_requires_a_fresh_human_decision(observation,monkeypatch):
    from backend_streamlit_and_telemetry.predictive_twin.sensor_recommendations import POLICY
    c,p,sent,now=observation;c.create(p,ID)
    monkeypatch.setitem(POLICY,'drive_cutoff_v',6.7)
    assert approve(c,p,'inspect_power')['state']=='expired' and not sent


def test_priority_escalation_with_same_recommendation_code_requires_new_review(observation,monkeypatch):
    from backend_streamlit_and_telemetry.predictive_twin import human_review
    original=human_review.predictive_insights
    priority=['check']
    def guidance(payload):
        result=original(payload)
        result['recommendations']=[dict(code='voltage_sag',tone='warning',priority=priority[0],action='inspect_power')]
        return result
    monkeypatch.setattr(human_review,'predictive_insights',guidance)
    c,p,sent,now=observation;c.create(p,ID)
    priority[0]='stop'
    assert approve(c,p,'inspect_power')['state']=='expired' and not sent
