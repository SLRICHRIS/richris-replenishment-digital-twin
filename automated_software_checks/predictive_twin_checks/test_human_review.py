from copy import deepcopy
import json
import threading
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from backend_streamlit_and_telemetry.predictive_twin.workspace_payload import workspace_payload
from backend_streamlit_and_telemetry.predictive_twin.human_review import ReviewCoordinator, metadata, COMMAND_TOPIC
from backend_streamlit_and_telemetry.predictive_twin.labview_gateway import handler_for

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


def test_real_http_boundary_requires_auth_and_rejects_client_supplied_evidence(setup):
    c,p,sent,now=setup;key='k'*32
    server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(c,lambda:p,key))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base='http://127.0.0.1:'+str(server.server_port)
    def request(path,body=None,authorized=True):
        r=Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={
            'Content-Type':'application/json','Authorization':'Bearer '+(key if authorized else 'bad')})
        with urlopen(r,timeout=2) as response:return json.load(response)
    try:
        with pytest.raises(HTTPError) as e:request('/context',authorized=False)
        assert e.value.code==401
        with pytest.raises(HTTPError):request('/reviews',{'review_id':ID,'context':p})
        assert request('/reviews',{'review_id':ID})['state']=='pending'
        assert request('/reviews/'+ID+'/decision',{'decision':'approve','action':'no_action','operator':'op','reason':'Monitor only'})['state']=='reviewed'
        assert not sent
    finally:
        server.shutdown();server.server_close();thread.join(timeout=2)


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
