"""Offline held-input/lease tests; never connect to a broker or hardware."""
import pytest
from sqlalchemy import create_engine, select
from backend_streamlit_and_telemetry.vision_control.coordinator import metadata, reviews
from backend_streamlit_and_telemetry.vision_control.held_manual import HeldManualCoordinator
from backend_streamlit_and_telemetry.vision_control.protocol import signed, verified, hardware

KEY='a'*64;BOOT='b'*32;EPOCH='c'*32;OWNER='d'*32;HOLD='e'*32

def fixture(updated=True):
    engine=create_engine('sqlite://');metadata.create_all(engine)
    now=[10000];out=[]
    c=HeldManualCoordinator(engine,KEY,out.append,lambda:now[0]);c.connected=True
    beat(c,now,1,updated=updated)
    return c,now,out

def beat(c,now,seq,route='0'*32,command=0,state='idle',left=0,right=0,ready=1,mv=7400,epoch=EPOCH,updated=True):
    fields=('H2' if updated else 'H1',BOOT,epoch,seq,route,command,state,left,right,mv,ready,now[0])
    c.observe(signed(fields+((255,) if updated else ()),KEY))

def hold(c,now,seq=1,direction='F',pwm=160,owner=OWNER,identity=HOLD,issued=None):
    c.hold(owner,'Richris',identity,seq,now[0] if issued is None else issued,direction,pwm)

def test_hold_is_recorded_before_zero_arming_then_live_input_renews_bounded_output():
    c,t,out=fixture()
    def publish(packet):
        with c.engine.connect() as db:assert db.execute(select(reviews.c.state)).scalar_one() in ('hold_arming','hold_driving')
        out.append(packet)
    c.publish=publish;hold(c,t,pwm=255)
    assert verified(out[-1],KEY,10)[5:8]==['arm','0','0']
    t[0]+=150;hold(c,t,2,pwm=255);c.tick()
    assert verified(out[-1],KEY,10)[5:8]==['drive','0','0']
    t[0]+=100;beat(c,t,2,HOLD,2,'interlock')
    assert verified(out[-1],KEY,10)[5:8]==['drive','255','255']
    assert c.row['state']=='hold_driving'
    for seq in range(3,7):
        t[0]+=150;hold(c,t,seq,pwm=255);beat(c,t,seq,HOLD,c.row['next_seq']-1,'moving',255,255);c.tick()
        fields=verified(out[-1],KEY,10)
        assert int(fields[9])<=c.row['input_issued_ms']+700
        assert 0<int(fields[9])-int(fields[8])<=500
    assert c.public(OWNER)['max_pwm']==255 and c.public(OWNER)['receiver_updated']

def test_release_fences_late_heartbeats_and_stop_sequence_is_newer_than_every_drive():
    c,t,out=fixture();hold(c,t)
    t[0]+=100;beat(c,t,2,HOLD,1,'armed')
    for seq in range(2,6):
        t[0]+=150;hold(c,t,seq);beat(c,t,seq+1,HOLD,c.row['next_seq']-1,'moving',160,160);c.tick()
    c.end_hold(OWNER,HOLD,6)
    fields=verified(out[-1],KEY,10);assert fields[5]=='stop'
    assert int(fields[4])>max(int(verified(p,KEY,10)[4]) for p in out[:-1])
    count=len(out)
    with pytest.raises(ValueError):hold(c,t,7)
    c.tick();assert len(out)==count
    t[0]+=150;beat(c,t,9,HOLD,int(fields[4]),'stopped')
    assert c.row['state']=='hold_stopped'
    with pytest.raises(ValueError):hold(c,t,8)

@pytest.mark.parametrize('cause',['input_gap','feedback_gap','disconnect','low_battery','not_ready','new_epoch'])
def test_each_loss_ends_the_hold_without_automatic_restart(cause):
    c,t,out=fixture();hold(c,t)
    t[0]+=100;beat(c,t,2,HOLD,1,'armed')
    if cause=='input_gap':
        t[0]+=701;beat(c,t,3,HOLD,2,'moving',160,160)
    elif cause=='feedback_gap':t[0]+=501
    elif cause=='disconnect':c.connected=False
    elif cause=='low_battery':beat(c,t,3,HOLD,2,'moving',160,160,mv=6500)
    elif cause=='not_ready':beat(c,t,3,HOLD,2,'moving',160,160,ready=0)
    else:beat(c,t,3,epoch='f'*32)
    c.tick();assert c.row['state'] in ('hold_stopping','manual_uncertain')
    count=len(out)
    with pytest.raises(ValueError):hold(c,t,9)
    c.tick();assert len(out)==count

def test_legacy_receiver_caps_pwm_and_one_wheel_left_right_match_attachment():
    c,t,out=fixture(updated=False)
    with pytest.raises(ValueError):hold(c,t,pwm=255)
    hold(c,t,direction='L')
    t[0]+=100;beat(c,t,2,HOLD,1,'armed',updated=False)
    assert verified(out[-1],KEY,10)[6:8]==['0','160']
    assert c.public(OWNER)['max_pwm']==160 and not c.public(OWNER)['receiver_updated']
    hold(c,t,2,direction='R');t[0]+=150
    beat(c,t,3,HOLD,c.row['next_seq']-1,'moving',0,160,updated=False);c.tick()
    assert verified(out[-1],KEY,10)[6:8]==['160','0']

def test_other_owner_replay_restart_and_old_inputs_cannot_create_another_move():
    c,t,out=fixture();hold(c,t)
    with pytest.raises(ValueError):hold(c,t,2,owner='f'*32)
    with pytest.raises(ValueError):hold(c,t,1,identity='f'*32,owner='f'*32)
    count=len(out);hold(c,t,1);assert len(out)==count
    recovered=HeldManualCoordinator(c.engine,KEY,out.append,lambda:t[0]);recovered.connected=True;beat(recovered,t,2)
    with pytest.raises(ValueError):hold(recovered,t)
    assert len(out)==count
    with pytest.raises(ValueError):hold(recovered,t,identity='1'*32,issued=t[0]-501)
    with pytest.raises(ValueError):hold(recovered,t,identity='1'*32,issued=t[0]+101)
    assert len(out)==count

def test_input_renewal_never_uses_a_view_touch_as_human_held_input():
    c,t,out=fixture();hold(c,t);t[0]+=100;beat(c,t,2,HOLD,1,'armed')
    t[0]+=650;c.touch(OWNER);beat(c,t,3,HOLD,2,'moving',160,160);c.tick()
    assert verified(out[-1],KEY,10)[5]=='stop'
    assert c.row['state']=='hold_stopping'

def test_h2_authentication_and_capability_validation_keep_camera_default_limit():
    c,t,out=fixture();raw=signed(('H2',BOOT,EPOCH,1,'0'*32,0,'moving',255,255,7400,1,t[0],255),KEY)
    assert hardware(raw,KEY,t[0],max_pwm=255,allow_manual=True)['max_pwm']==255
    with pytest.raises(ValueError):hardware(raw,KEY,t[0])
    invalid=signed(('H2',BOOT,EPOCH,1,'0'*32,0,'idle',0,0,7400,1,t[0],256),KEY)
    with pytest.raises(ValueError):hardware(invalid,KEY,t[0],max_pwm=255,allow_manual=True)
    zero=signed(('H2',BOOT,EPOCH,1,'0'*32,0,'idle',0,0,7400,1,t[0],255),KEY)
    with pytest.raises(ValueError,match='camera-route readiness'):hardware(zero,KEY,t[0])


def test_full_pwm_firmware_guard_reversal_replay_and_expiry_without_hardware(tmp_path):
    from pathlib import Path
    import subprocess
    source=(Path(__file__).resolve().parents[2]/'esp32_telemetry_firmware/AMR01_Manual_WiFi/AMR01_Manual_WiFi.ino').read_text()
    guard=source[source.index('namespace amr_vision {'):source.index('#ifndef AMR_VISION_DRIVE_ENABLED')]
    code='#include <cstdint>\n#include <cstring>\n#include <cstdlib>\n#include <climits>\n#include <cassert>\n'+guard+r'''
int main() {
  using namespace amr_vision;Command c;Guard g;
  g.connection("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  char arm[]="V1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccccccccccc|1|arm|0|0|1000|1500";
  assert(parse(arm,c)&&g.accept(c,1000,0,true,255));
  char move[]="V1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccccccccccc|2|drive|255|255|1100|1500";
  assert(parse(move,c));assert(!g.accept(c,1100,100000,true,160));
  assert(g.accept(c,1100,100000,true,255));g.tick(100000,true);assert(g.left==255&&g.right==255);
  assert(!g.accept(c,1100,100000,true,255));
  char reverse[]="V1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccccccccccc|3|drive|-255|-255|1200|1500";
  assert(parse(reverse,c)&&g.accept(c,1200,200000,true,255));g.tick(200000,true);assert(!g.left&&!g.right);
  g.tick(349999,true);assert(!g.left&&!g.right);g.tick(350000,true);assert(g.left==-255&&g.right==-255);
  g.tick(500000,true);assert(!g.active&&!g.left&&!g.right);
  char tooFast[]="V1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccccccccccc|4|drive|256|0|1300|1500";
  assert(!parse(tooFast,c));
}
'''
    exe=tmp_path/'held_guard'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-pedantic','-x','c++','-','-o',str(exe)],input=code,text=True,check=True)
    subprocess.run([str(exe)],check=True)


def test_workspace_only_forwards_held_input_from_an_authenticated_active_page(monkeypatch):
    from types import SimpleNamespace
    from backend_streamlit_and_telemetry.predictive_twin import manual_control_workspace as workspace
    class State(dict):
        def __getattr__(self,name):return self[name]
        def __setattr__(self,name,value):self[name]=value
    config=dict(access_code='private-test-only-code',control_key=KEY)
    state=State(manual_auth=workspace.tag(config),manual_view=True,manual_operator='Richris',manual_owner=OWNER)
    calls=[]
    coordinator=SimpleNamespace(hold=lambda *args:calls.append(('hold',args)),
                                end_hold=lambda *args:calls.append(('release',args)))
    monkeypatch.setattr(workspace,'st',SimpleNamespace(session_state=state))
    monkeypatch.setattr(workspace,'profile',lambda:(config,[]))
    monkeypatch.setattr(workspace,'live_service',lambda p:SimpleNamespace(coordinator=coordinator))
    action=dict(command='hold',hold_id=HOLD,input_seq=4,issued_at_ms=10000,direction='L',pwm=255)
    workspace.handle(action,'live')
    assert calls==[('hold',(OWNER,'Richris',HOLD,4,10000,'L',255))]
    workspace.handle(dict(command='release',hold_id=HOLD,input_seq=5),'live')
    assert calls[-1]==('release',(OWNER,HOLD,5))
    count=len(calls);state.manual_view=False;workspace.handle(action,'live')
    assert len(calls)==count
    state.manual_view=True;state.manual_auth='invalid';workspace.handle(action,'live')
    assert len(calls)==count
