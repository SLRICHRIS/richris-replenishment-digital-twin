"""Offline command lifecycle; no broker connections or physical outputs."""
from sqlalchemy import create_engine, select
import pytest
from backend_streamlit_and_telemetry.vision_control.coordinator import metadata, reviews
from backend_streamlit_and_telemetry.vision_control.manual import ManualCoordinator
from backend_streamlit_and_telemetry.vision_control.protocol import signed, verified, drive

KEY='a'*64; BOOT='b'*32; EPOCH='c'*32; OWNER='d'*32


def fixture():
    engine=create_engine('sqlite://'); metadata.create_all(engine)
    clock=[10000]; out=[]
    c=ManualCoordinator(engine,KEY,out.append,lambda:clock[0]); c.connected=True
    beat(c,clock,1,stamp=9850); beat(c,clock,2)
    return c,clock,out


def beat(c,clock,seq,route='0'*32,command=0,state='idle',left=0,right=0,stamp=None,epoch=EPOCH,retained=False,ready=1,mv=7400):
    c.observe(signed(('H1',BOOT,epoch,seq,route,command,state,left,right,mv,ready,stamp or clock[0]),KEY),retained)


def prepare(c):
    c.capture(OWNER,'operator','F',40)
    return c.row['review_id']


def test_one_approval_one_burst_durable_and_feedback_is_not_travel():
    c,t,out=fixture(); rid=prepare(c); assert not out
    def publish(packet):
        with c.engine.connect() as db:
            assert db.execute(select(reviews.c.state)).scalar_one() in ('manual_arming','manual_sent')
        out.append(packet)
    c.publish=publish
    c.approve(OWNER,rid,'Clear floor observed'); assert len(out)==1
    assert verified(out[0],KEY,10)[6:8]==['0','0']
    t[0]+=100; beat(c,t,3,rid,1,'armed'); assert len(out)==2
    fields=verified(out[-1],KEY,10)
    assert fields[5:8]==['drive','40','40'] and int(fields[9])-int(fields[8])==250
    for i in range(4,7):
        t[0]+=50; beat(c,t,i,rid,1,'armed'); c.tick()
    assert len(out)==2, 'No automatic repeat even after duplicate armed status'
    t[0]+=50; beat(c,t,7,rid,2,'moving',40,40)
    assert c.row['state']=='manual_acknowledged'
    for seq in range(8,11):
        t[0]+=150; beat(c,t,seq,rid,2,'expired')
    assert c.row['state']=='manual_stopped'
    assert 'zero motor outputs' in c.row['reason']
    assert 'verified' not in c.row['state']
    with pytest.raises(ValueError): c.approve(OWNER,rid,'Repeated click')
    assert len(out)==2


def test_stale_replay_retained_changed_epoch_and_other_owner():
    c,t,out=fixture(); rid=prepare(c)
    with pytest.raises(ValueError): c.approve('e'*32,rid,'Other owner')
    t[0]+=501
    with pytest.raises(ValueError): c.approve(OWNER,rid,'Stale')
    assert not out
    c,t,out=fixture(); rid=prepare(c); c.approve(OWNER,rid,'Clear')
    beat(c,t,3,rid,1,'armed',retained=True); assert len(out)==1
    beat(c,t,1,rid,1,'armed'); assert len(out)==1
    t[0]+=100; beat(c,t,3,epoch='e'*32)
    assert c.row['state']=='manual_uncertain'
    beat(c,t,99,rid,1,'armed'); assert len(out)==1
    assert c.current['epoch_id']=='e'*32


def test_limits_expiry_failure_cancel_and_restart_do_not_replay():
    c,t,out=fixture()
    for direction,pwm in [('X',40),('F',True),('F',161),('F',0)]:
        with pytest.raises(ValueError): c.capture(OWNER,'operator',direction,pwm)
    rid=prepare(c); t[0]+=10000; c.tick(); assert c.row['state']=='manual_cancelled' and not out
    c,t,out=fixture(); rid=prepare(c)
    def fail(_): raise RuntimeError('transport failed')
    c.publish=fail
    with pytest.raises(ValueError,match='no command retry'): c.approve(OWNER,rid,'Clear')
    assert c.row['state']=='manual_uncertain'
    c,t,out=fixture(); rid=prepare(c); c.approve(OWNER,rid,'Clear'); c.cancel(OWNER)
    assert verified(out[-1],KEY,10)[5]=='stop'
    n=len(out); c.tick(); assert len(out)==n
    recovery=ManualCoordinator(c.engine,KEY,out.append,lambda:t[0])
    assert recovery.row is None and len(out)==n
    with c.engine.connect() as db: assert db.execute(select(reviews.c.state)).scalar_one()=='manual_uncertain'
    for lease in (0,501,True):
        with pytest.raises(ValueError): drive(BOOT,EPOCH,rid,1,'drive',40,40,t[0],KEY,lease_ms=lease)


def test_disconnected_presence_loss_and_zero_without_matching_command():
    c,t,out=fixture(); rid=prepare(c); c.approve(OWNER,rid,'Clear')
    t[0]+=100; beat(c,t,3,rid,1,'armed')
    for seq in range(4,8):
        t[0]+=150; beat(c,t,seq,rid,1,'expired')
    assert c.row['state']=='manual_sent', 'An arm-only zero does not acknowledge a drive'
    t[0]+=1500; c.tick(); assert c.row['state']=='manual_uncertain'
    c,t,out=fixture(); rid=prepare(c); c.approve(OWNER,rid,'Clear'); c.connected=False;c.tick()
    assert c.row['state']=='manual_stopping'
    assert verified(out[-1],KEY,10)[5]=='stop'


def test_working_sketch_public_template_and_shared_output_writer():
    from pathlib import Path
    root=Path(__file__).resolve().parents[2]
    s=(root/'esp32_telemetry_firmware/AMR01_Manual_WiFi/AMR01_Manual_WiFi.ino').read_text()
    assert 'LOCAL_COMMAND_TIMEOUT_US = 700000' in s
    assert 'signedTotal = signedTotal + directionSign;' in s
    assert 'else applyDrive(drive)' in s and 'applyWheelDrive(l,r)' in s
    assert 'visionReady=pwmReady && amr_ir::finiteBattery(sensors)' in s
    assert 'visionReady=pwmReady && startupReady' not in s
    assert 'visionGuard.tick(now,visionReady&&visionLinked)' in s
    assert 'leftPulses.directionSign=(left>0)-(left<0)' in s
    assert 'static Motion previous' not in s
    example=(root/'esp32_telemetry_firmware/AMR01_Manual_WiFi/example_esp32_wifi_and_mqtt_settings.h').read_text()
    for name in ('WIFI_SSID','WIFI_PASSWORD','MQTT_HOST','MQTT_USERNAME','MQTT_PASSWORD'):
        assert name+'[] = "REPLACE"' in example


def test_working_160_pwm_is_manual_only_and_hardware_ack_supports_it():
    c,t,out=fixture()
    c.capture(OWNER,'operator','F',160);rid=c.row['review_id']
    c.approve(OWNER,rid,'Clear area inspected')
    t[0]+=100;beat(c,t,3,rid,1,'armed')
    assert verified(out[-1],KEY,10)[6:8]==['160','160']
    t[0]+=100;beat(c,t,4,rid,2,'moving',160,160)
    assert c.row['state']=='manual_acknowledged'
    # Camera route protocol retains its original lower default cap.
    with pytest.raises(ValueError):drive(BOOT,EPOCH,rid,3,'drive',160,160,t[0],KEY)


def test_embedded_manual_guard_parses_160_and_expires_without_network(tmp_path):
    from pathlib import Path
    import subprocess
    source=(Path(__file__).resolve().parents[2]/'esp32_telemetry_firmware/AMR01_Manual_WiFi/AMR01_Manual_WiFi.ino').read_text()
    guard=source[source.index('namespace amr_vision {'):source.index('#ifndef AMR_VISION_DRIVE_ENABLED')]
    code='#include <cstdint>\n#include <cstring>\n#include <cstdlib>\n#include <climits>\n#include <cassert>\n'+guard+r'''
int main() {
  using namespace amr_vision;
  Guard g;g.connection("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  char arm[]="V1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccccccccccc|1|arm|0|0|1000|1500";
  Command c;assert(parse(arm,c));assert(g.accept(c,1000,0,true,160));
  char drive[]="V1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccccccccccc|2|drive|160|160|1100|1350";
  assert(parse(drive,c));assert(g.accept(c,1100,100000,true,160));
  g.tick(100000,true);assert(g.active&&g.left==160&&g.right==160);
  g.tick(350000,true);assert(!g.active&&g.left==0&&g.right==0);
  assert(!g.accept(c,1350,350000,true,160));
}
'''
    exe=tmp_path/'manual_guard'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-pedantic','-x','c++','-','-o',str(exe)],input=code,text=True,check=True)
    subprocess.run([str(exe)],check=True)


def test_second_burst_and_server_recovery_continue_controller_sequence():
    c,t,out=fixture();rid=prepare(c);c.approve(OWNER,rid,'Clear first move')
    t[0]+=100;beat(c,t,3,rid,1,'armed')
    for seq in range(4,8):
        t[0]+=150;beat(c,t,seq,rid,2,'expired')
    assert c.row['state']=='manual_stopped'
    rid2=prepare(c);c.approve(OWNER,rid2,'Clear second move')
    assert verified(out[-1],KEY,10)[4:6]==['3','arm']
    t[0]+=100;beat(c,t,8,rid2,3,'armed')
    assert verified(out[-1],KEY,10)[4:6]==['4','drive']
    for seq in range(9,13):
        t[0]+=150;beat(c,t,seq,rid2,4,'expired')
    assert c.row['state']=='manual_stopped'
    recovered=ManualCoordinator(c.engine,KEY,out.append,lambda:t[0]);recovered.connected=True
    beat(recovered,t,13,rid2,4,'expired',stamp=t[0]-150)
    beat(recovered,t,14,rid2,4,'expired')
    rid3=prepare(recovered);recovered.approve(OWNER,rid3,'Fresh approval after server restart')
    assert verified(out[-1],KEY,10)[4:6]==['5','arm']


def test_changed_controller_sequence_invalidates_a_pending_review():
    c,t,out=fixture();rid=prepare(c)
    t[0]+=150;beat(c,t,3,command=9)
    with pytest.raises(ValueError,match='feedback changed'):c.approve(OWNER,rid,'Old review')
    assert not out


@pytest.mark.parametrize('delay_ms', [0, 230, 400, 500])
def test_delayed_fresh_zero_feedback_can_prepare_but_stale_approval_cannot_move(delay_ms):
    c,t,out=fixture(); c.history=[]; c.current=None
    for seq in range(1,7):
        t[0]+=150; beat(c,t,seq,stamp=t[0]-delay_ms)
    value=c.public(OWNER)
    assert value['ready'] and value['readiness']['code']=='ready'
    assert value['readiness']['zero_span_ms']>=150
    assert value['diagnostics']['accepted_count']==8
    rid=prepare(c)
    assert not out, 'Zero-output readiness alone never sends a motor command'
    t[0]+=501-delay_ms
    assert c.public(OWNER)['readiness']['code']=='feedback_stale'
    with pytest.raises(ValueError,match='feedback changed'): c.approve(OWNER,rid,'Stale review')
    assert not out


@pytest.mark.parametrize('fields,code', [
    ({'ready':0},'controller_not_ready'),
    ({'left':40},'outputs_active'),
    ({'right':-40},'outputs_active'),
    ({'mv':6599},'battery_low'),
])
def test_each_controller_interlock_resets_consecutive_zero_evidence(fields,code):
    c,t,out=fixture(); t[0]+=150; beat(c,t,3,**fields)
    value=c.public(OWNER)
    assert not value['ready'] and value['readiness']['code']==code
    assert value['readiness']['zero_samples']==0
    with pytest.raises(ValueError,match='Fresh, ready'): prepare(c)
    t[0]+=150; beat(c,t,4)
    assert c.public(OWNER)['readiness']['code']=='collecting_zero_outputs'
    t[0]+=150; beat(c,t,5)
    assert c.stationary() and not out


def test_feedback_gap_or_connection_change_requires_new_zero_evidence():
    c,t,out=fixture(); t[0]+=501; beat(c,t,3)
    assert c.public(OWNER)['readiness']['code']=='collecting_zero_outputs'
    t[0]+=150; beat(c,t,4)
    assert c.stationary()
    t[0]+=150; beat(c,t,5,epoch='e'*32)
    assert c.public(OWNER)['readiness']['zero_samples']==1 and not c.stationary()
    c.connected=False
    assert c.public(OWNER)['readiness']['code']=='transport_disconnected' and not out


def test_feedback_diagnostics_never_accept_bad_or_stale_packets():
    import json
    c,t,out=fixture();t[0]+=600
    future=signed(('H1',BOOT,EPOCH,3,'0'*32,0,'idle',0,0,7400,1,t[0]+2000),KEY)
    with pytest.raises(ValueError):c.observe(future)
    value=c.public(OWNER)
    assert not value['ready'] and value['hardware'] is None
    assert value['diagnostics']['last_issue']=='clock_ahead'
    assert value['diagnostics']['clock_age_ms']==-2000
    old=signed(('H1',BOOT,EPOCH,4,'0'*32,0,'idle',0,0,7400,1,t[0]-2000),KEY)
    with pytest.raises(ValueError):c.observe(old)
    assert c.public(OWNER)['diagnostics']['last_issue']=='packet_too_old'
    invalid=signed(('H1',BOOT,EPOCH,5,'0'*32,0,'idle',0,0,7400,1,t[0]),'f'*64)
    with pytest.raises(ValueError):c.observe(invalid)
    value=c.public(OWNER)
    assert not value['ready'] and value['diagnostics']['clock_age_ms'] is None
    assert value['diagnostics']['last_issue']=='authentication_failed'
    c.observe(future,retained=True)
    assert c.public(OWNER)['diagnostics']['last_issue']=='retained_packet'
    assert KEY not in json.dumps(value) and invalid not in json.dumps(value)
    assert not out
    t[0]+=150;beat(c,t,6);t[0]+=150;beat(c,t,7)
    value=c.public(OWNER)
    assert value['ready'] and value['diagnostics']['last_issue']==''
    assert value['diagnostics']['accepted_count']==4


def test_broker_diagnostics_distinguish_login_and_topic_rejection():
    from types import SimpleNamespace
    from backend_streamlit_and_telemetry.vision_control.service import Service
    class Reason:
        def __init__(self,failure):self.is_failure=failure
        def __str__(self):return 'Not authorized' if self.is_failure else 'Success'
    service=object.__new__(Service)
    service.connected=False;service.coordinator=SimpleNamespace(connected=False)
    service.transport_state='connecting';service.transport_reason=''
    subscribed=[];client=SimpleNamespace(subscribe=subscribed.append)
    service.on_connect(client,None,None,Reason(True),None)
    assert service.public_transport()['state']=='login_rejected' and not service.connected
    service.disconnected()
    assert service.public_transport()['state']=='login_rejected'
    service.on_connect(client,None,None,Reason(False),None)
    assert service.public_transport()['state']=='subscribing' and subscribed
    service.on_subscribe(client,None,1,[Reason(False),Reason(False)],None)
    assert service.public_transport()['state']=='subscribed' and service.connected
    service.on_subscribe(client,None,2,[Reason(True)],None)
    assert service.public_transport()['state']=='subscription_rejected' and not service.connected
    assert not service.coordinator.connected


def test_coalesced_page_events_restore_manual_presence_and_cancel_only_departing_owner():
    from types import SimpleNamespace
    import threading
    from backend_streamlit_and_telemetry.predictive_twin.control_presence import synchronize_control_view
    cancelled=[]
    def service(name):return SimpleNamespace(stop=threading.Event(),coordinator=SimpleNamespace(cancel=lambda owner:cancelled.append((name,owner))))
    state={'manual_view':False,'vision_view':True,'manual_service':service('manual'),'vision_service':service('vision'),'manual_owner':OWNER,'vision_owner':'e'*32}
    # Selecting Manual emitted manual:true followed by vision:false. Either last
    # Streamlit component value must carry the full selected control mode.
    for last_action in ('manual_control','vision_execution'):
        state['manual_view']=False;state['vision_view']=True
        assert synchronize_control_view(state,'manual')
        assert state['manual_view'] and not state['vision_view'],last_action
    assert all(name=='vision' and owner=='e'*32 for name,owner in cancelled)
    assert synchronize_control_view(state,None)
    assert not state['manual_view'] and not state['vision_view']
    assert ('manual',OWNER) in cancelled
    assert not synchronize_control_view(state,'untrusted')


def test_authenticated_connect_starts_listener_even_if_initial_view_event_was_lost(monkeypatch):
    import threading
    from types import SimpleNamespace
    from backend_streamlit_and_telemetry.predictive_twin import manual_control_workspace as workspace
    class State(dict):
        def __getattr__(self,name):return self[name]
        def __setattr__(self,name,value):self[name]=value
    state=State(manual_view=False)
    code='private-test-access-code'
    config=dict(enabled=True,mqtt_host='example.invalid',mqtt_username='test-only',mqtt_password='test-only',control_key=KEY,audit_url='postgresql+psycopg://test@example.invalid/test')
    monkeypatch.setattr(workspace,'st',SimpleNamespace(session_state=state,secrets={'manual_control':config,'amr_connection':{'access_code':code}}))
    touched=[];cancelled=[];started=[]
    coordinator=SimpleNamespace(touch=touched.append,cancel=cancelled.append,public=lambda owner:dict(ready=False,hardware=None,review=None))
    service=SimpleNamespace(stop=threading.Event(),coordinator=coordinator,public_transport=lambda:dict(state='connecting',connected=False,reason=''))
    def start(profile):
        started.append(profile);state['manual_service']=service;return service
    monkeypatch.setattr(workspace,'live_service',start)
    workspace.handle(dict(command='login',access_code=code,operator='Richris'),'live')
    assert state['manual_view'] and workspace.authorized(workspace.profile()[0])
    result=workspace.workspace('live')
    assert result['view_active'] and result['transport']['state']=='connecting'
    assert len(started)==1 and touched==[state['manual_owner']]
    # The host has applied the canonical mode; a sibling panel's legacy flag
    # must not overwrite that full state when handling the same component value.
    workspace.handle(dict(command='view',active=False,control_mode='manual'),'live')
    assert state['manual_view']
    workspace.handle(dict(command='logout'),'live')
    assert not state['manual_view'] and not workspace.authorized(workspace.profile()[0])
    assert cancelled==[state['manual_owner']]


def test_bad_operator_code_cannot_activate_the_manual_page(monkeypatch):
    from types import SimpleNamespace
    from backend_streamlit_and_telemetry.predictive_twin import manual_control_workspace as workspace
    class State(dict):
        def __getattr__(self,name):return self[name]
        def __setattr__(self,name,value):self[name]=value
    state=State(manual_view=False)
    config=dict(enabled=True,mqtt_host='example.invalid',mqtt_username='test',mqtt_password='test',control_key=KEY,audit_url='postgresql+psycopg://test@example.invalid/test')
    monkeypatch.setattr(workspace,'st',SimpleNamespace(session_state=state,secrets={'manual_control':config,'amr_connection':{'access_code':'private-test-access-code'}}))
    workspace.handle(dict(command='login',access_code='incorrect-code',operator='Richris'),'live')
    assert not state['manual_view'] and not workspace.authorized(workspace.profile()[0])
