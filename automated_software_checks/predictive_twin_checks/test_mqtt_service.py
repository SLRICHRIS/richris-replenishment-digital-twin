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
