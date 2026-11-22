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


def test_colocated_browser_uses_only_the_receiver_link_and_audited_owner(monkeypatch):
    import threading
    from types import SimpleNamespace
    from unittest.mock import Mock
    from backend_streamlit_and_telemetry.vision_control import browser_receiver_service as link
    from backend_streamlit_and_telemetry.vision_control.browser_camera import Observation
    from backend_streamlit_and_telemetry.vision_control.protocol import verified
    from backend_streamlit_and_telemetry.vision_control.service import Service

    clock = [10000]
    def init_online(service, profile):
        service.engine = create_engine('sqlite://')
        metadata.create_all(service.engine)
        service.guard, service.stop = threading.RLock(), threading.Event()
        service.coordinator = Coordinator(service.engine, SECRET, service.publish, lambda: clock[0])
        service.coordinator.connected = service.connected = True
        service.transport_state, service.transport_reason = 'subscribed', ''
        service.assert_owner = Mock()
        service.client = Mock()
        service.client.publish.return_value.rc = 0

    monkeypatch.setattr(Service, '__init__', init_online)
    monkeypatch.setattr(link, 'time', SimpleNamespace(time=lambda: clock[0] / 1000))
    monkeypatch.setattr(link._ReceiverCamera, '_now', staticmethod(lambda: clock[0]))
    settings = dict(control_key=SECRET, drive_key=DRIVE_KEY, commissioned=False)
    service = link.BrowserReceiverService(settings)
    config = dict(geometry=G, config_id='f' * 64)
    owner = '1' * 32

    def heartbeat(seq, protocol='H1', mv=7400, secret=DRIVE_KEY, retained=False, rid='0'*32, ack=0, state='idle'):
        fields = [protocol, BOOT, EPOCH, seq, rid, ack, state, 0, 0, mv, int(mv > 6600), clock[0]]
        if protocol == 'H2':
            fields.append(255)
        service.message(None, None, SimpleNamespace(topic=HARDWARE_TOPIC, retain=retained, payload=signed(fields, secret)))

    heartbeat(1, retained=True)
    heartbeat(2, secret=SECRET)
    assert service.public_transport()['receiver'] is None
    heartbeat(3, protocol='H2')
    assert service.public_transport()['receiver']['protocol'] == 'H2' and service.route_hardware() is None
    public_receiver=service.public_transport()['receiver']
    assert (public_receiver['boot_id'],public_receiver['epoch_id'],public_receiver['seq'],public_receiver['issued_at_ms']) == (BOOT,EPOCH,3,clock[0])
    assert set(public_receiver)=={'protocol','ready','state','battery_voltage_v','boot_id','epoch_id','seq','issued_at_ms','fresh','age_ms'}
    with pytest.raises(ValueError, match='commissioning'):
        service.attach_camera(config, owner)
    heartbeat(4, mv=4890)
    heartbeat(3)
    assert service.route_hardware()['ready'] is False
    clock[0] += 501
    assert not service.public_transport()['receiver']['fresh'] and service.route_hardware() is None
    service.client.publish.assert_not_called()

    settings['commissioned'] = True
    cam = service.attach_camera(config, owner)
    try:
        with pytest.raises(ValueError, match='already owns'):
            service.attach_camera(config, '2' * 32)
        assert not service.camera_owned_by('2' * 32)
        def frame(seq):
            pose = dict(x=210, y=180, heading=math.pi/2)
            cam.submit(Observation(clock[0], (0, 1, 2, 3, 4), True, '', pose, (), seq))
        for seq in range(5, 12):
            clock[0] += 100
            heartbeat(seq)
            frame(seq)
        c = service.coordinator
        c.capture(owner, 'tester', [210, 450])
        rid = c.row['review_id']
        service.client.publish.assert_not_called()
        c.decide(owner, rid, 'approve', 'Clear fixture floor')
        topic, raw = service.client.publish.call_args.args
        assert topic == DRIVE_TOPIC and service.client.publish.call_args.kwargs == dict(qos=0, retain=False)
        assert verified(raw, DRIVE_KEY, 10)[5:8] == ['arm', '0', '0']
        with c.engine.connect() as db:
            assert db.execute(select(reviews.c.state)).scalar_one() == 'sent'
        clock[0] += 100
        heartbeat(12, rid=rid, ack=1, state='armed')
        frame(12)
        assert c.row['state'] == 'running'
        c.cancel(owner)
        assert verified(service.client.publish.call_args.args[1], DRIVE_KEY, 10)[5:8] == ['stop','0','0']
        assert all(call.args[0] == DRIVE_TOPIC for call in service.client.publish.call_args_list)
        service.disconnected()
        assert not service.camera_owned_by(owner) and service.route_hardware() is None
        service.connected = True
        assert not service.camera_owned_by(owner)
    finally:
        cam.close()


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


def test_exact_measured_goal_connector_length_and_agent_replanning():
    c,clock,out=coordinator()
    destination=[334.9,300.3]
    c.capture('1'*32,'operator',destination)
    route=c.row['route']
    assert route['goal']==destination and route['points'][-1]==destination
    assert route==plan(c.current,route['goal'])
    assert route['length_mm']==pytest.approx(sum(math.dist(a,b) for a,b in zip(route['points'],route['points'][1:])))
    assert all(segment_clear(a,b,c.current['obstacles'],route['clearance_radius_mm'])
               for a,b in zip(route['points'],route['points'][1:]))
    c.decide('1'*32,c.row['review_id'],'approve','Exact measured destination')
    commands=[]; agent=Agent(SECRET,lambda *args:commands.append(args)); agent.scene=c.current
    agent.request(out[0],clock[0])
    assert agent.job['route']['goal']==destination and commands[-1][3:6]==('arm',0,0)


def test_arrival_uses_measured_destination_not_nearby_rounded_grid_point():
    s=sample(x=319.8,y=300,heading=0)
    route=plan(s,[334.9,300])
    assert math.dist((319.8,300),(330,300))<15
    assert math.dist((319.8,300),route['goal'])>15
    assert Follower(route,s['geometry'],10000).update(s,10000)[2] is False


def test_offgrid_start_and_goal_in_same_cell_use_the_checked_exact_segment():
    s=sample(x=301.1,y=300.2)
    destination=[304.4,303.9]
    route=plan(s,destination)
    assert route['points']==[[301.1,300.2],destination]
    assert route['length_mm']==pytest.approx(math.dist(route['points'][0],destination))
    assert plan(s,[301.1,300.2])['points']==[[301.1,300.2]]
    assert plan(s,[301.1,300.2])['length_mm']==0


def test_unsafe_exact_goal_cannot_be_replaced_by_safe_rounded_goal():
    s=sample(x=100,y=180)
    s['geometry']=dict(G,robot_length_mm=40,robot_width_mm=30,tracking_tolerance_mm=3,max_speed_mm_s=5,max_pwm=20)
    s['obstacles']=[dict(x=396,y=250,width=10,height=40)]
    r=radius(s['geometry'])
    assert segment_clear((330,300),(330,300),s['obstacles'],r)
    assert not segment_clear((334.9,300),(334.9,300),s['obstacles'],r)
    with pytest.raises(ValueError,match='clearance'): plan(s,[334.9,300])


def test_safe_exact_goal_uses_visible_neighbour_when_rounded_node_is_unsafe():
    s=sample(x=100.1,y=180.2)
    s['geometry']=dict(G,robot_length_mm=40,robot_width_mm=30,tracking_tolerance_mm=3,max_speed_mm_s=5,max_pwm=20)
    assert radius(s['geometry'])==64
    destination=[65,300.4]
    assert not segment_clear((60,300),(60,300),[],64)
    route=plan(s,destination)
    assert route['points'][0]==[100.1,180.2]
    assert route['goal']==route['points'][-1]==destination
    assert all(segment_clear(a,b,[],64) for a,b in zip(route['points'],route['points'][1:]))
    assert route['length_mm']==pytest.approx(sum(math.dist(a,b) for a,b in zip(route['points'],route['points'][1:])))
    assert plan(s,route['goal'])==route


def test_measured_floor_rejects_legacy_scenes_and_keeps_clearance():
    assert (WIDTH,HEIGHT)==(610,630)
    legacy=sample();legacy['version']=1
    with pytest.raises(ValueError,match='Unsupported'):scene(legacy)
    legacy=sample();legacy['floor_width_mm']=841;legacy['floor_length_mm']=1189
    with pytest.raises(ValueError,match='does not match'):scene(legacy)
    too_large=sample();too_large['geometry']=dict(G,robot_length_mm=600,robot_width_mm=600,max_speed_mm_s=20,left_pwm_per_mm_s=2,right_pwm_per_mm_s=2)
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
