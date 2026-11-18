"""Run on the Windows laptop physically connected to the overhead USB webcam."""
import argparse
import json
import os
import threading
import time
import uuid
import ssl
import getpass
from pathlib import Path
from .contracts import (canonical,seal,scene,SCENE_VERSION,WIDTH,HEIGHT,SCENE_TOPIC,STATUS_TOPIC,REQUEST_TOPIC,DRIVE_TOPIC,HARDWARE_TOPIC)
from .protocol import drive,hardware
from .agent import Agent


def main():
    import cv2
    import paho.mqtt.client as mqtt
    from .camera import Camera,load_config
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True); parser.add_argument('--background',required=True)
    parser.add_argument('--camera',type=int,default=0)
    parser.add_argument('--interactive',action='store_true',help='Prompt locally for missing private connection values')
    args=parser.parse_args()
    p=load_config(args.config); tracker=Camera(p,args.background)
    secrets={n:os.environ.get('AMR_'+n,'') for n in ('MQTT_HOST','MQTT_USERNAME','MQTT_PASSWORD','CONTROL_KEY','DRIVE_KEY')}
    if args.interactive:
        for n in secrets:
            if not secrets[n]: secrets[n]=(input('Existing EMQX '+n.lower()+': ') if n in ('MQTT_HOST','MQTT_USERNAME') else getpass.getpass('Private '+n.lower()+' (hidden): ')).strip()
    if not all(secrets.values()): raise SystemExit('Configure private AMR environment variables or use --interactive locally')
    from .contracts import key
    key(secrets['CONTROL_KEY']); key(secrets['DRIVE_KEY'])
    lock=threading.RLock(); hw=None; linked=False; boot=uuid.uuid4().hex
    client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='amr01-camera-'+boot[:8])
    client.username_pw_set(secrets['MQTT_USERNAME'],secrets['MQTT_PASSWORD']); client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
    now=lambda:int(time.time()*1000)
    def output(h,rid,seq,op,left,right,stamp):
        if not linked: raise ValueError('Camera MQTT connection lost')
        wire=drive(h['boot_id'],h['epoch_id'],rid,seq,op,left,right,stamp,secrets['DRIVE_KEY'])
        if client.publish(DRIVE_TOPIC,wire,qos=0,retain=False).rc!=0: raise ValueError('Motor request transport unavailable')
    agent=Agent(secrets['CONTROL_KEY'],output)
    def disconnected(*_):
        nonlocal linked
        with lock:
            linked=False
            # Local output is no longer reachable; the MCU deadline remains authoritative.
            agent.state='blocked'; agent.reason='MQTT disconnected; a new approval is required'; agent.lease_until=0
    def connected(c,u,f,r,props):
        if not r.is_failure: c.subscribe([(REQUEST_TOPIC,0),(HARDWARE_TOPIC,0)])
    def subscribed(c,u,mid,reasons,props):
        nonlocal linked
        linked=bool(len(reasons)==2 and all(not r.is_failure for r in reasons))
    def message(c,u,m):
        nonlocal hw
        if m.retain: return
        try:
            with lock:
                if m.topic==HARDWARE_TOPIC:
                    value=hardware(m.payload,secrets['DRIVE_KEY'],now())
                    if hw and value['boot_id']==hw['boot_id'] and value['epoch_id']==hw['epoch_id'] and value['seq']<=hw['seq']: return
                    hw=value
                elif m.topic==REQUEST_TOPIC: agent.request(m.payload,now(),m.retain)
        except (ValueError,TypeError,KeyError): pass
        except Exception:
            disconnected()
    client.on_connect=connected; client.on_disconnect=disconnected; client.on_subscribe=subscribed; client.on_message=message
    client.connect(secrets['MQTT_HOST'],8883,10); client.loop_start()
    cap=cv2.VideoCapture(args.camera,cv2.CAP_DSHOW if os.name=='nt' else cv2.CAP_ANY)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,p['resolution'][0]); cap.set(cv2.CAP_PROP_FRAME_HEIGHT,p['resolution'][1]); cap.set(cv2.CAP_PROP_BUFFERSIZE,1)
    # Drain the USB driver continuously; inference must not accumulate old frames.
    capture_lock=threading.Lock(); capture_stop=threading.Event(); latest=[None]
    def capture():
        frame_seq=0
        while not capture_stop.is_set():
            ok,image=cap.read(); stamp=now(); frame_seq+=1
            with capture_lock: latest[0]=(frame_seq,stamp,image if ok else None)
            if not ok: capture_stop.wait(.02)
    capture_thread=threading.Thread(target=capture,daemon=True,name='amr01-usb-latest-frame'); capture_thread.start()
    seq=0; used_frame=-1
    try:
        while True:
            started=now(); valid=False; pose=None; rects=[]; reason='Camera frame unavailable'
            with capture_lock: captured=latest[0]
            frame_seq,captured_at,frame=captured if captured else (-1,started,None)
            try:
                if frame is None or frame_seq==used_frame or started-captured_at>150: raise ValueError(reason)
                used_frame=frame_seq
                pose,rects=tracker.observe(frame,captured_at)
                if now()-started>250 or now()-captured_at>400: raise ValueError('Camera processing exceeded the latency envelope')
                valid=True; reason='Measured camera tracking active'
            except ValueError as e: reason=str(e)
            with lock:
                stamp=now(); seq+=1
                value=dict(hw) if hw else dict(boot_id='0'*32,epoch_id='0'*32,ready=False,age_ms=600000,battery_voltage_v=0,left_duty=0,right_duty=0)
                value['age_ms']=min(600000,max(0,stamp-value.get('issued_at_ms',0)))
                if not linked: value['ready']=False
                s=scene(dict(version=SCENE_VERSION,floor_width_mm=WIDTH,floor_length_mm=HEIGHT,robot_id='amr01',agent_boot_id=boot,config_id=tracker.config_id,seq=seq,
                    captured_at_ms=captured_at,valid=valid,reason=reason,pose=pose,obstacles=rects,geometry=p['geometry'],hardware=value))
                try: agent.tick(s,stamp)
                except Exception:
                    agent.state='blocked'; agent.reason='Execution transport failed; approve a new route'; agent.lease_until=0
                if linked:
                    client.publish(SCENE_TOPIC,canonical(seal('scene',s,secrets['CONTROL_KEY'])),qos=0,retain=False)
                    client.publish(STATUS_TOPIC,canonical(agent.status(stamp)),qos=0,retain=False)
            elapsed=now()-started
            if elapsed<80: time.sleep((80-elapsed)/1000)
    except KeyboardInterrupt: pass
    finally:
        with lock:
            try: agent.halt('Camera controller closed',now())
            except Exception: pass
        capture_stop.set(); cap.release(); capture_thread.join(timeout=1)
        client.disconnect(); client.loop_stop()


if __name__=='__main__': main()
