"""Operator authorization, exclusive writer ownership and real pipeline lifecycle."""
from dataclasses import asdict
import json
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch

from backend_streamlit_and_telemetry.predictive_twin.amr_connection import (
    ConnectionController, ConnectionProfile, authorize, connection_profile,
)
from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase
from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
from backend_streamlit_and_telemetry.predictive_twin.mqtt_service import MQTTService, TOPIC
from backend_streamlit_and_telemetry.predictive_twin.telemetry import Packet


def profile():
    return ConnectionProfile('private.emqxsl.com', 'subscriber', 'mqtt-private',
                             'postgresql://writer-private', 'operator-private-code',
                             example_calibrations()['amr01'])


def until(predicate, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.01)
    assert predicate()


def test_private_configuration_and_operator_gate():
    p, missing = connection_profile({})
    assert p is None
    assert len(missing) == 5
    p = profile()
    settings = dict(mqtt=dict(host=p.host, username=p.username, password=p.password),
                    amr_connection=dict(enabled=True, writer_url=p.writer_url, access_code=p.access_code),
                    commissioning=dict(measured_calibration_confirmed=True),
                    calibration=dict(amr01=asdict(p.calibration)))
    configured, missing = connection_profile(settings)
    assert not missing
    assert configured.calibration == p.calibration
    assert authorize(configured, p.access_code)
    assert not authorize(configured, 'wrong')
    assert not authorize(configured, None)
    assert not authorize(configured, 'a' * 257)
    assert not authorize(None, p.access_code)
    assert 'mqtt-private' not in repr(configured)
    settings['commissioning']['measured_calibration_confirmed'] = False
    assert connection_profile(settings)[0] is None


def test_subscription_timeout_releases_writer_and_does_not_claim_connected():
    store = Mock(spec=SensorDatabase)
    store.engine = Mock()
    service = SimpleNamespace(subscription_confirmed=False, fatal_error=False,
                              metrics={}, close=Mock())
    controller = ConnectionController(lambda *a, **k: store, lambda *a, **k: service, timeout_s=.05)
    controller.start(profile())
    until(lambda: controller.snapshot()['state'] == 'error')
    controller.close()
    assert not controller.snapshot()['subscribed']
    assert 'did not confirm' in controller.snapshot()['detail']
    service.close.assert_called_once()
    store.release_worker_lease.assert_called_once()
    store.engine.dispose.assert_called_once()


def test_duplicate_connect_and_orderly_disconnect():
    events = []
    store = Mock(spec=SensorDatabase)
    store.engine = Mock()
    store.release_worker_lease.side_effect = lambda: events.append('lease')
    store.engine.dispose.side_effect = lambda: events.append('dispose')
    service = SimpleNamespace(subscription_confirmed=True, fatal_error=False, metrics={'persisted':2},
                              close=lambda: events.append('drain'))
    factory = Mock(return_value=service)
    controller = ConnectionController(lambda *a, **k: store, factory)
    assert controller.start(profile())
    assert not controller.start(profile())
    until(lambda: controller.snapshot()['state'] == 'subscribed')
    assert controller.snapshot()['subscribed']
    controller.close()
    assert events == ['drain', 'lease', 'dispose']
    assert controller.snapshot()['state'] == 'disconnected'
    assert not controller.snapshot()['subscribed']
    assert factory.call_count == 1


def test_existing_writer_is_not_displaced_and_errors_are_sanitized():
    store = Mock(spec=SensorDatabase)
    store.engine = Mock()
    store.acquire_worker_lease.side_effect = RuntimeError('private database URL')
    factory = Mock()
    controller = ConnectionController(lambda *a, **k: store, factory)
    controller.start(profile())
    until(lambda: controller.snapshot()['state'] == 'error')
    controller.close()
    factory.assert_not_called()
    store.release_worker_lease.assert_not_called()
    store.engine.dispose.assert_called_once()
    assert 'private database' not in str(controller.snapshot())


def test_stalled_drain_keeps_the_lease_until_the_writer_stops():
    entered, release = threading.Event(), threading.Event()
    store = Mock(spec=SensorDatabase)
    store.engine = Mock()
    calls = []
    def drain():
        calls.append('close')
        if len(calls) == 1:
            raise RuntimeError('Drain timeout')
        entered.set()
        assert release.wait(timeout=3)
    service = SimpleNamespace(subscription_confirmed=True, fatal_error=False,
                              metrics={}, close=drain)
    controller = ConnectionController(lambda *a, **k: store, lambda *a, **k: service)
    controller.start(profile())
    until(lambda: controller.snapshot()['state'] == 'subscribed')
    controller.disconnect()
    assert entered.wait(timeout=2)
    store.release_worker_lease.assert_not_called()
    assert not controller.start(profile())
    release.set()
    controller.close()
    store.release_worker_lease.assert_called_once()
    store.engine.dispose.assert_called_once()


def test_connection_failure_does_not_leak_credentials():
    controller = ConnectionController(Mock(side_effect=RuntimeError('postgresql://secret:password@host')))
    controller.start(profile())
    until(lambda: controller.snapshot()['state'] == 'error')
    controller.close()
    assert 'password@host' not in str(controller.snapshot())


def test_on_demand_controller_uses_the_real_persisted_sensor_pipeline(tmp_path):
    url = 'sqlite:///' + str(tmp_path / 'trial.db')
    reader = SensorDatabase(url, initialize=True)
    p = profile()
    captured = []
    def service_factory(*args, **kwargs):
        service = MQTTService(*args, **kwargs)
        captured.append(service)
        service._subscribed(service.client, None, 1, [SimpleNamespace(is_failure=False)], None)
        return service
    controller = ConnectionController(lambda *a, **k: SensorDatabase(url, initialize=False), service_factory)
    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client') as client:
        try:
            controller.start(p)
            until(lambda: controller.snapshot()['state'] == 'subscribed')
            for seq in range(2):
                packet = Packet('amr01', 'test-boot', seq, seq * .05, seq * 10, seq * 10,
                                .01, 7.4, .6, 'standby')
                captured[0]._message(captured[0].client, None, SimpleNamespace(
                    topic=TOPIC, payload=json.dumps(asdict(packet)).encode(), retain=False))
            until(lambda: controller.snapshot()['metrics'].get('persisted') == 2)
            snapshot = reader.read_snapshot(stale_after_s=60)
            assert snapshot['quality'] == 'OK'
            assert snapshot['pose'][0] > 0
            assert snapshot['derived']['power_w'] == 4.44
            assert len(reader.read_records('amr_sensor_samples')) == 2
            client.return_value.publish.assert_not_called()
        finally:
            controller.close()
            reader.engine.dispose()
