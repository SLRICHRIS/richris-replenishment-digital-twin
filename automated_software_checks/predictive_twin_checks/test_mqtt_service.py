from types import SimpleNamespace
from unittest.mock import patch

from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
from backend_streamlit_and_telemetry.predictive_twin.mqtt_service import MQTTService


def test_server_tls_subscriptions_and_no_command_publish():
    with patch('backend_streamlit_and_telemetry.predictive_twin.mqtt_service.mqtt.Client') as client_type:
        client = client_type.return_value
        service = MQTTService('broker.example.com', 'subscriber', 'private', example_calibrations())
        client.tls_set_context.assert_called_once()
        context = client.tls_set_context.call_args.args[0]
        assert context.check_hostname
        client.connect_async.assert_called_once_with('broker.example.com', 8883, keepalive=30)
        service._connected(client, None, None, SimpleNamespace(is_failure=False), None)
        assert service.status == 'Connected'
        assert [call.args[0] for call in client.subscribe.call_args_list] == ['robot/amr01/state']
        service._message(client, None, SimpleNamespace(payload=b'invalid', topic='robot/amr01/state', retain=False))
        assert service.fleet.rejected_packets == 1
        service._disconnected(client, None, None, None, None)
        assert service.fleet.robots['amr01'].continuity_lost
        client.publish.assert_not_called()
        service.close()
        client.loop_stop.assert_called_once()
