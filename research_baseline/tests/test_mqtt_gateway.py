import pytest
from warehouse_twin.mqtt_gateway import normalize_packet


def test_accepts_existing_firmware_key():
    event=normalize_packet({'robot_id':'amr-01','seq':4,'ts':'2026-10-23T00:00:00+00:00',
                            'firmware':'richris-esp32-1.0.0','position':{'x':3.1,'y':2.0}},'warehouse/amr-01/telemetry')
    assert event['firmware']=='richris-esp32-1.0.0'
    assert event['device_id']=='amr-01'
    assert event['x']==3.1


def test_never_invents_sequence_or_timestamp():
    with pytest.raises(ValueError):normalize_packet({'robot_id':'amr-01','timestamp':'test'},'x')
    with pytest.raises(ValueError):normalize_packet({'robot_id':'amr-01','seq':1},'x')
