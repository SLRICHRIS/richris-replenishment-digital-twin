"""Operator-controlled, session-bound EMQX -> PostgreSQL connection.

The always-on worker remains available for unattended recording. This optional
connector reuses the same TLS subscriber, database lease and model pipeline.
No Streamlit APIs are called from a background thread.
"""
from dataclasses import dataclass, field
import hmac
import threading
import time

import streamlit as st

from .database import SensorDatabase
from .models import Calibration
from .mqtt_service import MQTTService, TOPIC


@dataclass(frozen=True, repr=False)
class ConnectionProfile:
    host: str
    username: str
    password: str = field(repr=False)
    writer_url: str = field(repr=False)
    access_code: str = field(repr=False)
    calibration: Calibration


def connection_profile(secrets):
    """Read private configuration; expose only missing category labels."""
    missing = []
    def value(section, key):
        try:
            v = secrets[section][key]
            return (v if key in ('password', 'access_code') else v.strip()) if isinstance(v, str) else ''
        except (KeyError, FileNotFoundError):
            return ''
    host, username, password = (value('mqtt', k) for k in ('host', 'username', 'password'))
    writer_url = value('amr_connection', 'writer_url')
    access_code = value('amr_connection', 'access_code')
    if not host or not username or not password:
        missing.append('EMQX subscriber credentials')
    if not writer_url:
        missing.append('Dedicated database writer')
    if len(access_code) < 16:
        missing.append('Operator access code (at least 16 characters)')
    try:
        if secrets['amr_connection']['enabled'] is not True:
            missing.append('On-demand connection enabled')
    except (KeyError, FileNotFoundError):
        missing.append('On-demand connection enabled')
    calibration = None
    try:
        if secrets['commissioning']['measured_calibration_confirmed'] is not True:
            raise ValueError('Unconfirmed')
        values = dict(secrets['calibration'])
        if set(values) != {'amr01'}:
            raise ValueError('Single AMR only')
        calibration = Calibration(**dict(values['amr01']))
    except Exception:
        missing.append('Measured AMR-01 calibration')
    if missing:
        return None, missing
    return ConnectionProfile(host, username, password, writer_url, access_code, calibration), []


def authorize(profile, supplied):
    return (profile is not None and isinstance(supplied, str) and len(supplied) <= 256
            and hmac.compare_digest(supplied.encode(), profile.access_code.encode()))


class ConnectionController:
    """One nonblocking connector per owner session; PostgreSQL enforces one writer."""
    def __init__(self, database_factory=SensorDatabase, service_factory=MQTTService, timeout_s=20):
        self._database_factory = database_factory
        self._service_factory = service_factory
        self._timeout = timeout_s
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread = None
        self._service = None
        self._state = 'disconnected'
        self._detail = 'Connect when AMR-01 is powered and publishing to EMQX.'

    def start(self, profile):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return False
            self._stop.clear()
            self._state, self._detail = 'connecting', 'Opening the protected sensor pipeline.'
            self._thread = threading.Thread(target=self._run, args=(profile,),
                                            name='amr01-on-demand-link', daemon=True)
            self._thread.start()
            return True

    def disconnect(self):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                if self._state != 'error':
                    self._state, self._detail = 'disconnecting', 'Finishing queued writes before disconnecting.'
                self._stop.set()

    def close(self):
        self.disconnect()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=25)

    def snapshot(self):
        with self._lock:
            service = self._service
            return dict(state=self._state, detail=self._detail,
                        running=bool(self._thread and self._thread.is_alive()),
                        subscribed=bool(service and service.subscription_confirmed and not service.fatal_error),
                        metrics=service.metrics if service else {})

    def _run(self, profile):
        store, service, leased = None, None, False
        failed = False
        try:
            store = self._database_factory(profile.writer_url, initialize=False)
            store.assert_schema_ready()
            try:
                store.acquire_worker_lease()
                leased = True
            except RuntimeError:
                with self._lock:
                    self._state, self._detail = 'error', 'Another recorder owns this trial. Use its stored readings or stop it before connecting here.'
                failed = True
                return
            if self._stop.is_set():
                return
            service = self._service_factory(profile.host, profile.username, profile.password,
                {'amr01': profile.calibration}, database=store, client_id='amr01-site-ingester')
            with self._lock:
                self._service = service
            deadline = time.monotonic() + self._timeout
            while not self._stop.wait(.2):
                if service.fatal_error:
                    with self._lock:
                        self._state, self._detail = 'error', service.status
                    failed = True
                    break
                subscribed = service.subscription_confirmed
                with self._lock:
                    self._state = 'subscribed' if subscribed else 'connecting'
                    self._detail = ('EMQX subscription confirmed. Waiting for validated device samples.'
                                    if subscribed else 'Waiting for EMQX to confirm the topic subscription.')
                if subscribed:
                    deadline = time.monotonic() + self._timeout
                elif time.monotonic() >= deadline:
                    with self._lock:
                        self._state, self._detail = 'error', 'EMQX did not confirm the subscription. Check broker, TLS, credentials and topic permissions.'
                    failed = True
                    break
        except Exception:
            failed = True
            with self._lock:
                self._state, self._detail = 'error', 'Connection could not start. Check the private broker, writer permissions, schema and measured calibration.'
        finally:
            if service is not None:
                # Never release the single-writer lease while queued writes may
                # still be running. A stalled drain keeps this connector busy.
                while True:
                    try:
                        service.close()
                        break
                    except Exception:
                        failed = True
                        with self._lock:
                            self._state, self._detail = 'error', 'Waiting for recorder shutdown. The writer lease remains held until queued writes finish.'
                        time.sleep(.25)
            try:
                if store is not None:
                    try:
                        if leased:
                            store.release_worker_lease()
                    finally:
                        store.engine.dispose()
            except Exception:
                failed = True
                with self._lock:
                    self._state, self._detail = 'error', 'Recorder resource cleanup needs attention. Check the server configuration before reconnecting.'
            finally:
                with self._lock:
                    self._service = None
                    if not failed:
                        self._state, self._detail = 'disconnected', 'Disconnected. Committed sensor records remain in the database.'


@st.cache_resource(scope='session', show_spinner=False, on_release=lambda resource: resource.close())
def session_connector():
    return ConnectionController()


def connection_payload(controller, profile, missing, authorized=False, live_payload=None):
    from .workspace_payload import database_connection, workspace_payload
    from .insights import predictive_insights
    link = controller.snapshot()
    _, storage_state = database_connection()
    live = live_payload if live_payload is not None else workspace_payload('live')
    insights = predictive_insights(live)
    robot = live.get('robots', {}).get('amr01')
    fresh = bool(robot and not robot.get('stale'))
    link.update(configured=profile is not None, missing=missing, authorized=authorized,
                topic=TOPIC, insights=insights, sample_age_s=robot.get('age_s') if robot else None,
                stages=[
                    dict(label='ESP32 over Wi-Fi', state='ready' if fresh else 'waiting',
                         detail='Fresh device sample stored' if fresh else 'Waiting for physical samples'),
                    dict(label='EMQX', state='ready' if link['subscribed'] else 'waiting',
                         detail='Topic subscription verified' if link['subscribed'] else 'Subscription not verified in this session'),
                    dict(label='Sensor database', state='ready' if storage_state == 'ready' else 'blocked',
                         detail='Connected · schema v3' if storage_state == 'ready' else 'Connection or schema needs attention'),
                    dict(label='Predictive insights', state='ready' if insights['ready'] else 'waiting',
                         detail='Fresh model results available' if insights['ready'] else 'Needs calibrated, continuous readings'),
                ])
    return link
