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


def beat(c,clock,seq,route='0'*32,command=0,state='idle',left=0,right=0,stamp=None,epoch=EPOCH,retained=False):
    c.observe(signed(('H1',BOOT,epoch,seq,route,command,state,left,right,7400,1,stamp or clock[0]),KEY),retained)


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
    assert 'LOCAL_COMMAND_TIMEOUT_US = 0' in s
    assert 'signedTotal = signedTotal + directionSign;' in s
    assert 'else applyDrive(drive)' in s and 'applyWheelDrive(l,r)' in s
    assert 'visionReady=pwmReady && startupReady && sensorsFresh' in s
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
