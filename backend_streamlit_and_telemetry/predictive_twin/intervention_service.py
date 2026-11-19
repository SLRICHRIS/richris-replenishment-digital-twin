"""Server-owned website review service and explicitly commissioned MQTT transport.

No desktop process or browser MQTT client is required. Runtime uses existing
schema only; production privileges are provisioned separately. One PostgreSQL
session lease owns recovery, decisions and response monitoring across sessions.
"""
from dataclasses import dataclass, field
import json
import threading
import time
from sqlalchemy import text
from sqlalchemy.engine import make_url
from .database import SensorDatabase, calibration_fingerprint
from .human_review import ReviewCoordinator, COMMAND_TOPIC, ACK_TOPIC, TERMINAL


@dataclass(frozen=True, repr=False)
class ObservationReviewProfile:
    writer_url: str = field(repr=False)
    access_code: str = field(repr=False)
    host: str = ''
    calibration: object = None


def observation_profile(secrets):
    """Audit-only setup reuses existing private access, without model calibration."""
    try:
        settings=secrets['amr_connection']
        url,code=settings['writer_url'],settings['access_code']
        if settings['enabled'] is not True:raise ValueError()
        if not isinstance(url,str) or not url.strip():raise ValueError()
        if not isinstance(code,str) or not 16<=len(code)<=256:raise ValueError()
        return ObservationReviewProfile(url.strip(),code),[]
    except (KeyError,FileNotFoundError,ValueError,TypeError):
        return None,['Private review writer and operator access setup']


@dataclass(frozen=True, repr=False)
class TransportProfile:
    host: str
    username: str
    password: str = field(repr=False)


def transport_profile(secrets, host):
    """Missing or incomplete opt-in always means audit-only operation."""
    try:
        settings = secrets['intervention']
        if settings['enabled'] is not True or settings['controller_ready'] is not True:
            return None
        username, password = settings['mqtt_username'], settings['mqtt_password']
        if not isinstance(username, str) or not username.strip() or not isinstance(password, str) or not password:
            return None
        return TransportProfile(host, username.strip(), password)
    except (KeyError, FileNotFoundError):
        return None


class MQTTTransport:
    def __init__(self, coordinator, profile):
        import paho.mqtt.client as mqtt
        self.mqtt, self.coordinator = mqtt, coordinator
        self.ready = threading.Event()
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='amr01-website-review')
        self.client.username_pw_set(profile.username, profile.password)
        self.client.tls_set()
        self.client.on_connect = self.on_connect
        self.client.on_subscribe = self.on_subscribe
        self.client.on_disconnect = lambda *_: self.ready.clear()
        self.client.on_message = self.on_message
        self.client.connect_async(profile.host, 8883, 30)
        self.client.loop_start()

    def on_connect(self, client, userdata, flags, reason, properties):
        self.ready.clear()
        if not reason.is_failure:
            client.subscribe(ACK_TOPIC, qos=1)

    def on_subscribe(self, client, userdata, mid, reasons, properties):
        if reasons and all(not reason.is_failure for reason in reasons):
            self.ready.set()

    def on_message(self, client, userdata, message):
        if message.topic != ACK_TOPIC or message.retain or len(message.payload) > 2048:
            return
        try:
            self.coordinator.acknowledge(json.loads(message.payload), retained=message.retain)
        except (ValueError, TypeError, json.JSONDecodeError):
            return
        except Exception:
            self.ready.clear()

    def publish(self, topic, packet):
        if topic != COMMAND_TOPIC or not self.ready.is_set():
            raise RuntimeError('Protected command transport is unavailable')
        result = self.client.publish(topic, json.dumps(packet, allow_nan=False), qos=0, retain=False)
        if result.rc != self.mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError('Command transport did not accept the request')

    def close(self):
        self.ready.clear()
        self.client.disconnect()
        self.client.loop_stop()


def context_provider(store, calibration):
    def read():
        if calibration is None:
            from .physical_telemetry import display_payload
            physical = display_payload(store)
            return dict(mode='live',observed_at=time.time(),robots={},physical_telemetry=physical)
        snapshot = store.read_snapshot(expected_fingerprint=calibration_fingerprint(calibration), include_history=False)
        snapshot['calibration_fingerprint'] = calibration_fingerprint(calibration)
        return dict(mode='live', observed_at=time.time(), robots={'amr01':snapshot})
    return read


class WebsiteReviewService:
    def __init__(self, profile, transport=None):
        if profile.calibration is None and transport is not None:
            raise ValueError('Observation reviews cannot enable motor delivery')
        url = make_url(profile.writer_url)
        if not url.drivername.startswith('postgresql') or '-pooler' in (url.host or ''):
            raise ValueError('Website review requires the direct PostgreSQL writer connection')
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.store, self.lease, self.transport, self.thread = None, None, None, None
        try:
            self.store = SensorDatabase(profile.writer_url, initialize=False)
            self.store.assert_schema_ready()
            self.lease = self.store.engine.connect()
            allowed = self.lease.execute(text("SELECT has_table_privilege(current_user, 'public.amr_operator_reviews', 'SELECT') AND has_table_privilege(current_user, 'public.amr_operator_reviews', 'INSERT') AND has_table_privilege(current_user, 'public.amr_operator_reviews', 'UPDATE')")).scalar_one()
            if not allowed:
                raise RuntimeError('Website review audit permissions have not been provisioned')
            if not self.lease.execute(text('SELECT pg_try_advisory_lock(707010317)')).scalar_one():
                raise RuntimeError('Another website review service owns this trial')
            self.pid = self.lease.execute(text('SELECT pg_backend_pid()')).scalar_one()
            self.lease.commit()
            self.coordinator = ReviewCoordinator(self.store.engine)
            self.read = context_provider(self.store, profile.calibration)
            self.coordinator.recover()
            if transport is not None:
                self.transport = MQTTTransport(self, transport)
                self.coordinator.publisher = self.publish
                self.coordinator.commands_enabled = True
            self.thread = threading.Thread(target=self._monitor, name='amr01-website-review', daemon=True)
            self.thread.start()
        except Exception:
            self.close()
            raise

    def _assert_owner(self):
        if self.stop.is_set() or self.lease is None or self.lease.invalidated:
            raise RuntimeError('Review service ownership is unavailable')
        try:
            owned = self.lease.execute(text('SELECT pg_backend_pid() = :pid AND EXISTS (SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = \'advisory\' AND classid = 0 AND objid = 707010317 AND objsubid = 1 AND granted)'), {'pid':self.pid}).scalar_one()
            self.lease.commit()
            if not owned:
                raise RuntimeError('Review service ownership changed')
        except Exception:
            self.stop.set()
            raise

    def publish(self, topic, packet):
        with self.lock:
            self._assert_owner()
            if self.transport is None:
                raise RuntimeError('Physical transport is disabled')
            self.transport.publish(topic, packet)

    def create(self, rid):
        with self.lock:
            self._assert_owner()
            return self.coordinator.create(self.read(), rid)

    def decide(self, rid, **choice):
        with self.lock:
            self._assert_owner()
            self.coordinator.commands_enabled = self.delivery_ready
            return self.coordinator.decide(rid, payload=self.read(), **choice)

    @property
    def delivery_ready(self):
        return bool(not self.stop.is_set() and self.transport and self.transport.ready.is_set())

    def get(self, rid):
        with self.lock:
            self._assert_owner()
            return self.coordinator.get(rid)

    def acknowledge(self, packet, **options):
        with self.lock:
            self._assert_owner()
            return self.coordinator.acknowledge(packet, **options)

    def _monitor(self):
        while not self.stop.wait(.5):
            try:
                with self.lock:
                    self._assert_owner()
                    active = [r for r in self.coordinator.history(20) if r['state'] not in TERMINAL]
                    if active:
                        try:
                            self.coordinator.observe(self.read())
                        except Exception:
                            for row in active:
                                self.coordinator.get(row['review_id'])
            except Exception:
                self.stop.set()  # Never resume delivery after losing the process lease.

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=3)
        if self.transport:
            self.transport.close()
        if self.lease:
            try:
                if not self.lease.invalidated:
                    self.lease.execute(text('SELECT pg_advisory_unlock(707010317)'))
                    self.lease.commit()
            except Exception:
                self.lease.invalidate()
            finally:
                self.lease.close()
                self.lease = None
        if self.store:
            self.store.engine.dispose()
