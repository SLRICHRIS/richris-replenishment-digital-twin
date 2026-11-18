"""Offline fixtures only. Nothing in this file contacts EMQX or real motors."""
import copy
import math
import json
import subprocess
from pathlib import Path
import pytest
from sqlalchemy import create_engine,select
from backend_streamlit_and_telemetry.vision_control.contracts import *
from backend_streamlit_and_telemetry.vision_control.protocol import drive,hardware,signed
from backend_streamlit_and_telemetry.vision_control.coordinator import Coordinator,metadata,reviews
from backend_streamlit_and_telemetry.vision_control.agent import Agent

SECRET='a'*64; DRIVE_KEY='b'*64; BOOT='c'*32; EPOCH='d'*32
G=dict(robot_length_mm=60,robot_width_mm=40,robot_height_mm=50,wheel_track_mm=100,clearance_mm=10,
       uncertainty_mm=2,stopping_distance_mm=5,tracking_tolerance_mm=20,max_speed_mm_s=10,
       max_angular_rad_s=.6,max_pwm=40,left_pwm_per_mm_s=4,right_pwm_per_mm_s=4,
       minimum_drive_pwm=0,min_pack_voltage_v=6.6,left_polarity=1,right_polarity=1)


def sample(t=10000,seq=1,x=210,y=180,heading=math.pi/2):
    return scene(dict(version=SCENE_VERSION,floor_width_mm=WIDTH,floor_length_mm=HEIGHT,robot_id='amr01',agent_boot_id='e'*32,config_id='f'*64,seq=seq,
        captured_at_ms=t,valid=True,reason='',geometry=G,pose=dict(x=x,y=y,heading=heading),obstacles=[],
        hardware=dict(boot_id=BOOT,epoch_id=EPOCH,ready=True,age_ms=0,battery_voltage_v=7.4,left_duty=0,right_duty=0,route_id='0'*32,state='idle',command_seq=0)))


def coordinator():
    engine=create_engine('sqlite://');metadata.create_all(engine);clock=[10000];out=[]
    c=Coordinator(engine,SECRET,out.append,lambda:clock[0]);c.connected=True
    for t in (9400,9700,10000):
        clock[0]=t;c.observe(seal('scene',sample(t,t),SECRET))
    return c,clock,out


def test_authenticated_protocol_and_bad_boundaries():
    p=seal('scene',sample(),SECRET);assert unseal('scene',p,SECRET)==sample()
    p['body']['seq']=99
    with pytest.raises(ValueError):unseal('scene',p,SECRET)
    for raw in ('not json',json.dumps({'body':{},'signature':'0'*64})):
        with pytest.raises((ValueError,json.JSONDecodeError)):unseal('scene',raw,SECRET)
    wire=signed(('H1',BOOT,EPOCH,1,'0'*32,0,'idle',0,0,7400,1,10000),DRIVE_KEY)
    assert hardware(wire,DRIVE_KEY,10000)['battery_voltage_v']==7.4
    with pytest.raises(ValueError): hardware(wire,DRIVE_KEY,10501)
    with pytest.raises(ValueError): hardware(wire+'|x',DRIVE_KEY,10000)
    with pytest.raises(ValueError):drive(BOOT,EPOCH,'1'*32,1,'drive',81,0,10000,DRIVE_KEY)
    for bad in (math.nan,math.inf,True):
        v=dict(G,max_speed_mm_s=bad)
        with pytest.raises(ValueError):geometry(v)


def test_continuous_collision_and_detour():
    obs=[dict(x=200,y=200,width=40,height=100)]
    assert not segment_clear((120,250),(320,250),obs,20)
    assert segment_clear((120,350),(320,350),obs,20)
    assert not segment_clear((5,5),(5,10),[],20)
    s=sample(x=100,y=180)
    s['geometry']=dict(G,robot_length_mm=40,robot_width_mm=30,tracking_tolerance_mm=3,max_speed_mm_s=5,max_pwm=20)
    s['obstacles']=[dict(x=180,y=280,width=40,height=40)]
    r=plan(s,[320,450]);assert r['length_mm']>math.dist((100,180),(320,450))
    assert all(segment_clear(a,b,s['obstacles'],radius(s['geometry'])) for a,b in zip(r['points'],r['points'][1:]))


def test_measured_floor_rejects_legacy_scenes_and_keeps_clearance():
    assert (WIDTH,HEIGHT)==(425,630)
    legacy=sample();legacy['version']=1
    with pytest.raises(ValueError,match='Unsupported'):scene(legacy)
    legacy=sample();legacy['floor_width_mm']=841;legacy['floor_length_mm']=1189
    with pytest.raises(ValueError,match='does not match'):scene(legacy)
    too_large=sample();too_large['geometry']=dict(G,robot_length_mm=180,robot_width_mm=140,max_speed_mm_s=20,left_pwm_per_mm_s=2,right_pwm_per_mm_s=2)
    assert radius(too_large['geometry'])>WIDTH/2
    with pytest.raises(ValueError,match='clearance'):plan(too_large,[210,450])


def test_approve_durable_before_dispatch_and_no_duplicate_or_retained():
    c,clock,out=coordinator();c.capture('1'*32,'operator',[210,450]);rid=c.row['review_id']
    assert not out
    c.decide('1'*32,rid,'approve','Clear floor inspected')
    with c.engine.connect() as db: assert db.execute(select(reviews.c.state)).scalar_one()=='sent'
    assert unseal('request',out[0],SECRET)['operation']=='execute'
    with pytest.raises(ValueError):c.decide('1'*32,rid,'approve','again')
    agent=Agent(SECRET,lambda *args:None);agent.scene=c.current
    with pytest.raises(ValueError):agent.request(out[0],clock[0],True)
    agent.request(out[0],clock[0]);assert agent.state=='arming'
    with pytest.raises(ValueError):agent.request(out[0],clock[0])
    clock[0]+=801;agent.tick(sample(clock[0],10001),clock[0]);assert agent.state=='blocked'


def test_owner_map_change_stale_and_transport_failure():
    c,clock,out=coordinator();c.capture('1'*32,'operator',[210,450]);rid=c.row['review_id']
    with pytest.raises(ValueError):c.decide('2'*32,rid,'approve','No ownership')
    changed=sample(10001,10001);changed['obstacles']=[dict(x=330,y=500,width=20,height=20)]
    clock[0]=10001;c.observe(seal('scene',changed,SECRET))
    with pytest.raises(ValueError):c.decide('1'*32,rid,'approve','map changed')
    assert not out
    c,clock,out=coordinator();c.capture('1'*32,'operator',[210,450]);clock[0]=11000
    with pytest.raises(ValueError):c.decide('1'*32,c.row['review_id'],'approve','stale')
    c,clock,out=coordinator();c.capture('1'*32,'operator',[210,450])
    def fail(_):raise RuntimeError('private transport')
    c.publish=fail
    with pytest.raises(ValueError,match='no automatic retry'):c.decide('1'*32,c.row['review_id'],'approve','Clear floor')
    assert c.row['state']=='uncertain'


def test_leave_page_stops_grants_and_recovery_never_replays():
    c,clock,out=coordinator();owner='1'*32;c.capture(owner,'operator',[210,450]);c.decide(owner,c.row['review_id'],'approve','Clear floor')
    clock[0]+=100;c.tick();assert unseal('request',out[-1],SECRET)['operation']=='lease'
    c.cancel(owner);assert c.row['state']=='cancelled';n=len(out);c.tick();assert len(out)==n
    assert unseal('request',out[-1],SECRET)['operation']=='cancel'
    c,clock,out=coordinator();c.capture(owner,'operator',[210,450]);c.decide(owner,c.row['review_id'],'approve','Clear floor')
    recovery=Coordinator(c.engine,SECRET,out.append,lambda:clock[0]);assert recovery.row is None
    with c.engine.connect() as db:assert db.execute(select(reviews.c.state)).scalar_one()=='uncertain'


def test_closed_loop_motion_and_camera_verified_arrival():
    # Numerical robot only: exercise real approval/lease/agent and PWM conversion.
    c,clock,queue=coordinator();owner='1'*32;c.capture(owner,'operator',[210,450]);c.decide(owner,c.row['review_id'],'approve','Simulated test floor')
    commands=[];agent=Agent(SECRET,lambda *args:commands.append(args));agent.scene=c.current
    agent.request(queue.pop(0),clock[0]);hw=dict(c.current['hardware']);x,y,heading=210.,180.,math.pi/2
    for i in range(1,1000):
        clock[0]+=100;t=clock[0]
        for h,rid,seq,op,left,right,stamp in commands:
            hw.update(route_id=rid,command_seq=seq,state='armed' if op=='arm' else 'stopped' if op=='stop' else 'moving',left_duty=left,right_duty=right)
        commands.clear()
        vl=hw['left_duty']/4;vr=hw['right_duty']/4
        w=(vr-vl)/100;heading=angle(heading+w*.1);v=(vl+vr)/2
        x+=v*math.cos(heading)*.1;y+=v*math.sin(heading)*.1
        s=sample(t,10000+i,x,y,heading);s['hardware']=copy.deepcopy(hw)
        c.observe(seal('scene',s,SECRET));c.touch(owner);c.tick()
        for p in queue:agent.request(p,t)
        queue.clear();agent.tick(s,t);c.status(agent.status(t))
        if c.row['state']=='verified':break
    assert c.row['state']=='verified',(c.row,agent.state,agent.reason,x,y)
    assert math.dist((x,y),(210,450))<=15
    assert hw['left_duty']==hw['right_duty']==0


def test_ack_without_camera_never_verifies_and_camera_loss_stops():
    c,clock,out=coordinator();owner='1'*32;c.capture(owner,'operator',[210,450]);c.decide(owner,c.row['review_id'],'approve','Clear floor')
    rid=c.row['review_id']
    c.status(seal('status',dict(review_id=rid,agent_boot_id=c.current['agent_boot_id'],state='verified',reason='unproven',seq=1,issued_at_ms=clock[0]),SECRET))
    assert c.row['state']=='sent'
    commands=[];agent=Agent(SECRET,lambda *a:commands.append(a));agent.scene=c.current;agent.request(out[0],clock[0])
    s=sample(10100,10100);s['valid']=False;s['pose']=None
    agent.tick(s,10100);assert agent.state=='blocked';assert commands[-1][3]=='stop'
