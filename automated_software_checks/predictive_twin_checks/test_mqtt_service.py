"""EMQX subscription contract, TLS, ACL, and fail-closed ingestion tests."""
from types import SimpleNamespace
from unittest.mock import patch

import paho.mqtt.client as mqtt
import pytest

from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
from backend_streamlit_and_telemetry.predictive_twin.mqtt_service import MQTTService, TOPIC


def _connect(service, client):
    client.subscribe.return_value = (mqtt.MQTT_ERR_SUCCESS, 17)
    service._connected(client, None, None, SimpleNamespace(is_failure=False), None)


def _suback(service, client, failed=False):
    service._subscribed(client, None, 17, [SimpleNamespace(is_failure=failed)], None)


def test_emqx_cloud_tls_suback_and_no_command_publish():
    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client') as client_type:
        client = client_type.return_value
        service = MQTTService("broker.example.com", "subscriber", "private", example_calibrations())
        args, kwargs = client_type.call_args
        assert args[0] == mqtt.CallbackAPIVersion.VERSION2
        assert kwargs["client_id"] == "amr01-db-ingester"
        client.tls_set_context.assert_called_once()
        context = client.tls_set_context.call_args.args[0]
        assert context.check_hostname
        assert context.verify_mode != 0
        client.connect_async.assert_called_once_with("broker.example.com", 8883, keepalive=30)
        _connect(service, client)
        assert service.status == "Connected; awaiting EMQX subscription"
        assert not service.subscription_confirmed
        client.subscribe.assert_called_once_with(TOPIC, qos=1)
        _suback(service, client)
        assert service.subscription_confirmed
        assert service.status == "Subscribed to " + TOPIC
        service._message(client, None, SimpleNamespace(payload=b'invalid', topic=TOPIC, retain=False))
        assert service.fleet.rejected_packets == 1
        service._disconnected(client, None, None, None, None)
        assert not service.subscription_confirmed
        assert service.fleet.robots['amr01'].continuity_lost
        client.publish.assert_not_called()
        service.close()
        client.loop_stop.assert_called_once()


def test_authentication_refusal_and_suback_denial_are_fatal():
    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client') as factory:
        client = factory.return_value
        service = MQTTService("broker.example.com", "reader", "secret", example_calibrations())
        service._connected(client, None, None, SimpleNamespace(is_failure=True), None)
        assert service.fatal_error
        assert "rejected" in service.status
        client.subscribe.assert_not_called()
        client.disconnect.assert_called()
    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client') as factory:
        client = factory.return_value
        service = MQTTService("broker.example.com", "reader", "secret", example_calibrations())
        _connect(service, client)
        _suback(service, client, failed=True)
        assert service.fatal_error
        assert not service.subscription_confirmed
        assert service.status == "EMQX topic subscription denied"
        client.disconnect.assert_called()


def test_database_error_fails_closed_without_motor_publish():
    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client') as factory:
        client = factory.return_value
        service = MQTTService("broker.example.com", "reader", "secret", example_calibrations())
        with patch.object(service.fleet, "ingest", side_effect=RuntimeError("DB unavailable")):
            service._message(client, None, SimpleNamespace(payload=b"{}", topic=TOPIC, retain=False))
        assert service.fatal_error
        assert service.status == "Database/ingestion failure; worker stopping"
        client.disconnect.assert_called()
        client.publish.assert_not_called()


@pytest.mark.parametrize("bad_host", ["mqtts://cloud.example", "cloud.example:8883", "cloud.example/topic", ""])
def test_invalid_emqx_host_is_rejected(bad_host):
    with pytest.raises(ValueError):
        MQTTService(bad_host, "reader", "secret", example_calibrations())


def test_unencrypted_port_is_rejected():
    with pytest.raises(ValueError):
        MQTTService("cloud.example", "reader", "secret", example_calibrations(), port=1883)


def test_bounded_queue_processes_samples_in_order_without_motor_control():
    import json
    import time
    from dataclasses import asdict
    from backend_streamlit_and_telemetry.predictive_twin.telemetry import Packet

    class DatabaseRecorder:
        def __init__(self):
            self.sequences = []
        def read_resume_state(self, robot_id, calibration):
            return None
        def persist(self, packet, robot, quality_events=(), received_at=None):
            self.sequences.append(packet.seq)
            return True

    store = DatabaseRecorder()
    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client') as factory:
        client = factory.return_value
        service = MQTTService("broker.example.com", "reader", "password",
                              example_calibrations(), database=store)
        try:
            for seq in range(20):
                packet = asdict(Packet("amr01", "ci-boot", seq, seq * .05,
                                      seq * 10, seq * 10, .01, 7.4, .6, "standby"))
                service._message(client, None, SimpleNamespace(
                    topic=TOPIC, payload=json.dumps(packet).encode(), retain=False
                ))
            stop = time.monotonic() + 5
            while service.metrics["persisted"] < 20 and time.monotonic() < stop:
                time.sleep(.01)
            assert store.sequences == list(range(20))
            assert service.metrics["received"] == 20
            assert service.metrics["rejected"] == 0
            assert service.metrics["queue_depth"] == 0
            assert not service.fatal_error
            client.publish.assert_not_called()
        finally:
            service.close()


def test_backpressure_is_explicit_when_database_stalls():
    import json
    import threading
    from dataclasses import asdict
    from backend_streamlit_and_telemetry.predictive_twin.telemetry import Packet

    entered, release = threading.Event(), threading.Event()

    class SlowDatabase:
        def read_resume_state(self, robot_id, calibration):
            return None
        def persist(self, packet, robot, quality_events=(), received_at=None):
            entered.set()
            release.wait(timeout=4)
            return True

    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client') as factory:
        client = factory.return_value
        service = MQTTService("broker.example.com", "reader", "password",
                              example_calibrations(), database=SlowDatabase())
        def msg(seq):
            packet = asdict(Packet("amr01", "ci-boot", seq, seq * .05,
                                  seq * 10, seq * 10, .01, 7.4, .6, "standby"))
            return SimpleNamespace(topic=TOPIC, payload=json.dumps(packet).encode(),
                                   retain=False)
        try:
            service._message(client, None, msg(0))
            assert entered.wait(timeout=2)
            for seq in range(1, 270):
                service._message(client, None, msg(seq))
            assert service.fatal_error
            assert service.metrics["queue_overflows"] >= 1
            assert service.status == "Ingestion queue overflow; worker stopping"
            client.publish.assert_not_called()
        finally:
            release.set()
            service.close()


def test_callback_receive_time_survives_writer_backlog():
    import json
    import threading
    from dataclasses import asdict
    from datetime import datetime, timezone
    from backend_streamlit_and_telemetry.predictive_twin.telemetry import Packet

    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    stamps = []

    class SlowDatabase:
        def read_resume_state(self, robot_id, calibration):
            return None
        def persist(self, packet, robot, quality_events=(), received_at=None):
            if packet.seq == 0:
                entered.set()
                assert release.wait(timeout=5)
            stamps.append(received_at)
            if packet.seq == 1:
                finished.set()
            return True

    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client'):
        service = MQTTService("broker.example.com", "reader", "password",
                              example_calibrations(), database=SlowDatabase())
        try:
            before = datetime.now(timezone.utc)
            for seq in range(2):
                data = asdict(Packet("amr01", "ci-boot", seq, seq * .05,
                                     seq * 10, seq * 10, .01, 7.4, .6, "standby"))
                service._message(service.client, None, SimpleNamespace(
                    topic=TOPIC, payload=json.dumps(data).encode(), retain=False
                ))
                if seq == 0:
                    assert entered.wait(timeout=3)
            after = datetime.now(timezone.utc)
            # Both receives precede the release, including the queued packet.
            release.set()
            assert finished.wait(timeout=3)
            assert len(stamps) == 2
            assert all(before <= stamp <= after for stamp in stamps)
            assert not service.fatal_error
        finally:
            release.set()
            service.close()


def test_oversized_payload_is_bounded_before_queueing():
    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client'):
        service = MQTTService("broker.example.com", "reader", "password", example_calibrations())
        try:
            with patch.object(service.fleet, "ingest", return_value=False) as ingest:
                service._message(service.client, None, SimpleNamespace(
                    topic=TOPIC, payload=b"x" * 8192, retain=False
                ))
            assert ingest.call_args.args[0] == b""
            assert service.metrics["rejected"] == 1
        finally:
            service.close()
