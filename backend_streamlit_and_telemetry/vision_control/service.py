"""Single PostgreSQL lease owns protected website MQTT execution transport."""
import json
import threading
import time
import uuid
from sqlalchemy import create_engine,text
from sqlalchemy.engine import make_url
from .coordinator import Coordinator
from .contracts import SCENE_TOPIC,STATUS_TOPIC,REQUEST_TOPIC,canonical


class Service:
    def __init__(self,p):
        import paho.mqtt.client as mqtt
        self.stop=threading.Event(); self.connected=False; self.guard=threading.RLock()
        u=make_url(p['audit_url'])
        if not u.drivername.startswith('postgresql') or '-pooler' in (u.host or ''): raise ValueError('Use a direct PostgreSQL audit connection')
        self.engine=create_engine(u,pool_pre_ping=True,connect_args={'connect_timeout':5})
        self.lease=self.engine.connect()
        if not self.lease.execute(text('SELECT pg_try_advisory_lock(707010318)')).scalar_one():
            self.lease.close(); self.engine.dispose(); raise ValueError('Another route coordinator owns this robot')
        self.pid=self.lease.execute(text('SELECT pg_backend_pid()')).scalar_one(); self.lease.commit()
        try:
            self.coordinator=Coordinator(self.engine,p['control_key'],self.publish,lambda:int(time.time()*1000))
        except Exception:
            self.lease.close(); self.engine.dispose(); raise
        self.client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id='amr01-vision-website-'+uuid.uuid4().hex[:8])
        self.client.username_pw_set(p['mqtt_username'],p['mqtt_password']); self.client.tls_set()
        self.client.on_connect=self.on_connect; self.client.on_subscribe=self.on_subscribe
        self.client.on_disconnect=lambda *_:self.disconnected()
        self.client.on_message=self.message
        self.client.connect_async(p['mqtt_host'],8883,10); self.client.loop_start()
        self.thread=threading.Thread(target=self.monitor,daemon=True,name='amr01-vision-grants'); self.thread.start()

    def assert_owner(self):
        if self.stop.is_set() or self.lease.invalidated: raise RuntimeError('Route coordinator ownership lost')
        owned=self.lease.execute(text("SELECT pg_backend_pid()=:pid AND EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=707010318 AND objsubid=1 AND granted)"),dict(pid=self.pid)).scalar_one()
        self.lease.commit()
        if not owned: raise RuntimeError('Route coordinator ownership changed')

    def disconnected(self):
        self.connected=False; self.coordinator.connected=False

    def on_connect(self,client,userdata,flags,reason,properties):
        self.disconnected()
        if not reason.is_failure: client.subscribe([(SCENE_TOPIC,0),(STATUS_TOPIC,0)])

    def on_subscribe(self,client,userdata,mid,reasons,properties):
        if reasons and len(reasons)==2 and all(not r.is_failure for r in reasons):
            self.connected=True; self.coordinator.connected=True

    def message(self,client,userdata,m):
        try:
            if m.topic==SCENE_TOPIC: self.coordinator.observe(m.payload,m.retain)
            elif m.topic==STATUS_TOPIC: self.coordinator.status(m.payload,m.retain)
        except (ValueError,TypeError,KeyError,json.JSONDecodeError): pass
        except Exception: self.close_transport()

    def publish(self,packet):
        with self.guard:
            self.assert_owner()
            if not self.connected: raise RuntimeError('Protected route transport unavailable')
            result=self.client.publish(REQUEST_TOPIC,canonical(packet),qos=0,retain=False)
            if result.rc!=0: raise RuntimeError('Route transport did not accept the request')

    def monitor(self):
        while not self.stop.wait(.15):
            try: self.coordinator.tick()
            except Exception: self.close_transport(); return

    def close_transport(self):
        self.stop.set(); self.disconnected()

    def close(self):
        self.close_transport()
        self.client.disconnect(); self.client.loop_stop()
        self.lease.close(); self.engine.dispose()
