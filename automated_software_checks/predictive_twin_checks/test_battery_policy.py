"""Offline battery/HITL tests: no real MQTT, motors or sensor traffic."""
import copy
import math

import pytest
from sqlalchemy import create_engine

from backend_streamlit_and_telemetry.vision_control.battery_policy import battery_action
from backend_streamlit_and_telemetry.vision_control.contracts import (
    WIDTH, HEIGHT, SCENE_VERSION, scene, seal, unseal, geometry,
)
from backend_streamlit_and_telemetry.vision_control.coordinator import (
    Coordinator, metadata,
)
from backend_streamlit_and_telemetry.vision_control.agent import Agent

KEY = "a" * 64
OWNER = "1" * 32
BOOT = "c" * 32
EPOCH = "d" * 32
GEOMETRY = dict(
    robot_length_mm=60,robot_width_mm=40,robot_height_mm=50,
    wheel_track_mm=100,clearance_mm=10,uncertainty_mm=2,
    stopping_distance_mm=5,tracking_tolerance_mm=20,max_speed_mm_s=10,
    max_angular_rad_s=.6,max_pwm=40,left_pwm_per_mm_s=4,
    right_pwm_per_mm_s=4,minimum_drive_pwm=0,min_pack_voltage_v=6.6,
    battery_advisory_voltage_v=7.0,left_polarity=1,right_polarity=1,
)


def frame(now=10000, voltage=7.4, seq=1, route_id=None, state="idle",
          command_seq=0, left=0, right=0):
    return scene(dict(
        version=SCENE_VERSION, floor_width_mm=WIDTH, floor_length_mm=HEIGHT,
        robot_id="amr01", agent_boot_id="e"*32, config_id="f"*64,
        captured_at_ms=now, valid=True, reason="", seq=seq,
        geometry=GEOMETRY,
        pose=dict(x=210.0,y=180.0,heading=math.pi/2), obstacles=[],
        hardware=dict(
            boot_id=BOOT, epoch_id=EPOCH, ready=True, age_ms=0,
            battery_voltage_v=voltage,left_duty=left,right_duty=right,
            route_id=route_id or "0"*32,state=state,command_seq=command_seq,
        ),
    ))


def running_workflow():
    engine=create_engine("sqlite://")
    metadata.create_all(engine)
    clock=[10000]
    wire=[]
    c=Coordinator(engine,KEY,wire.append,lambda:clock[0])
    c.connected=True
    for t in (9400,9700,10000):
        clock[0]=t
        c.observe(seal("scene",frame(now=t,seq=t),KEY))
    c.capture(OWNER,"operator",[210,450])
    rid=c.row["review_id"]
    c.decide(OWNER,rid,"approve","Measured clear floor")
    commands=[]
    agent=Agent(KEY,lambda *a:commands.append(a))
    agent.scene=c.current
    agent.request(wire[0],clock[0])
    clock[0]+=100
    s=frame(now=clock[0],seq=clock[0],route_id=rid,state="armed",command_seq=1)
    agent.tick(s,clock[0])
    assert agent.state=="running"
    return c,clock,wire,commands,agent,rid


@pytest.mark.parametrize("voltage,approval,expected", [
    (6.59,None,"critical_stop"),(6.6,False,"critical_stop"),
    (6.6,True,"critical_stop"),(6.9,None,"ask_human"),
    (6.9,False,"continue_goal"),(6.9,True,"divert_request"),
    (7.5,None,"normal")
])
def test_three_way_battery_condition_never_overrides_critical(voltage,approval,expected):
    assert battery_action(voltage,6.6,7.0,approval)==expected


def test_missing_advisory_never_guesses_a_low_battery_trigger():
    assert battery_action(6.9,6.6)== "normal"
    assert battery_action(6.6,6.6)== "critical_stop"
    assert "battery_advisory_voltage_v" not in geometry({
        k:v for k,v in GEOMETRY.items() if k!="battery_advisory_voltage_v"
    })


@pytest.mark.parametrize("voltage,cutoff,advisory,approval", [
    (float("nan"),6.6,7.0,None),(7,6.6,6.5,None),
    (7,6.6,6.6,False),(7,6.6,7.0,"yes"),
    (7,6.6,8.5,None)
])
def test_invalid_policy_configuration_denied(voltage,cutoff,advisory,approval):
    with pytest.raises(ValueError):
        battery_action(voltage,cutoff,advisory,approval)


def test_advisory_pauses_zero_pwm_then_explicit_decline_resumes_until_cutoff():
    c,clock,wire,commands,agent,rid=running_workflow()
    clock[0]+=100
    s=frame(now=clock[0],seq=clock[0],route_id=rid,state="moving",command_seq=1,voltage=6.9)
    agent.tick(s,clock[0])
    assert agent.state=="battery_review"
    assert commands[-1][3:6]==("drive",0,0)
    # Without a human response another tick still outputs zero power.
    clock[0]+=100
    s=frame(now=clock[0],seq=clock[0],route_id=rid,state="moving",command_seq=2,voltage=6.9)
    agent.tick(s,clock[0])
    assert agent.state=="battery_review"
    assert commands[-1][3:6]==("drive",0,0)
    c.observe(seal("scene",s,KEY))
    c.status(agent.status(clock[0]))
    assert c.row["state"]=="battery_review"
    assert c.public(OWNER)["review"]["battery_prompt"] is True

    c.battery_decide(OWNER,rid,"continue","Original destination, above hard cutoff")
    assert c.row["battery_choice"]=="continue"
    assert unseal("request",wire[-1],KEY)["operation"]=="battery_continue"
    agent.request(wire[-1],clock[0])
    assert agent.state=="running"
    clock[0]+=100
    s=frame(now=clock[0],seq=clock[0],route_id=rid,state="moving",command_seq=3,voltage=6.9)
    agent.tick(s,clock[0])
    assert agent.state=="running"  # One advisory cannot reprompt forever.

    clock[0]+=100
    s=frame(now=clock[0],seq=clock[0],route_id=rid,state="moving",command_seq=4,voltage=6.6)
    agent.tick(s,clock[0])
    assert agent.state=="blocked"
    assert "CRITICAL BATTERY" in agent.reason
    assert commands[-1][3:6]==("stop",0,0)


def test_diversion_approval_stops_old_mission_and_requires_new_route_to_E():
    c,clock,wire,commands,agent,rid=running_workflow()
    clock[0]+=100
    s=frame(now=clock[0],seq=clock[0],route_id=rid,state="moving",command_seq=1,voltage=6.9)
    agent.tick(s,clock[0])
    c.observe(seal("scene",s,KEY))
    c.status(agent.status(clock[0]))
    c.battery_decide(OWNER,rid,"divert","Charge at measured battery point E")
    assert c.row["battery_choice"]=="divert"
    assert unseal("request",wire[-1],KEY)["operation"]=="battery_divert"
    agent.request(wire[-1],clock[0])
    assert agent.state=="blocked"
    assert "route to E" in agent.reason
    assert commands[-1][3:6]==("stop",0,0)
    with pytest.raises(ValueError,match="No pending"):
        c.battery_decide(OWNER,rid,"continue","No duplicate")


def test_critical_voltage_blocks_human_continuation_even_when_declined():
    c,clock,wire,commands,agent,rid=running_workflow()
    clock[0]+=100
    advisory=frame(now=clock[0],seq=clock[0],route_id=rid,state="moving",command_seq=1,voltage=6.9)
    agent.tick(advisory,clock[0])
    c.observe(seal("scene",advisory,KEY))
    c.status(agent.status(clock[0]))
    clock[0]+=100
    critical=frame(now=clock[0],seq=clock[0],route_id=rid,state="moving",command_seq=2,voltage=6.5)
    c.observe(seal("scene",critical,KEY))
    with pytest.raises(ValueError,match="Unsafe battery"):
        c.battery_decide(OWNER,rid,"continue","Continue anyway")
    agent.tick(critical,clock[0])
    assert agent.state=="blocked"
    assert commands[-1][3]=="stop"
