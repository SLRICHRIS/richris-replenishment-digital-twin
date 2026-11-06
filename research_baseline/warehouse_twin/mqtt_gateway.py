"""Optional MQTT -> HTTP telemetry adapter. No physical motor-command publication.

Environment:
MQTT_HOST, MQTT_PORT, MQTT_TOPIC, MQTT_USERNAME, MQTT_PASSWORD,
TWIN_API_URL, TWIN_INGEST_TOKEN. Install paho-mqtt to use this adapter.
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone


def normalize_packet(packet: dict, topic: str) -> dict:
    """Accept firmware and firmware_version aliases without conflating with device identity."""
    packet = dict(packet)
    device_id = packet.get('device_id') or packet.get('robot_id') or topic.rsplit('/',1)[-1]
    if not device_id:
        raise ValueError('device_id missing')
    seq = packet.get('seq')
    if seq is None:
        raise ValueError('Missing packet sequence for deduplication')
    timestamp = packet.get('timestamp') or packet.get('ts')
    if timestamp is None:
        raise ValueError('Missing device timestamp')
    result = {
        'device_id':str(device_id), 'seq':int(seq), 'timestamp':str(timestamp),
        'firmware':packet.get('firmware') or packet.get('firmware_version'),
    }
    for key in ('x','y','battery_pct'):
        if key in packet:
            result[key] = packet[key]
    if isinstance(packet.get('position'),dict):
        for key in ('x','y'):
            if key in packet['position'] and key not in result:
                result[key] = packet['position'][key]
    return result


def forward_packet(packet: dict, topic: str, api_url: str, token: str = '') -> dict:
    payload=json.dumps(normalize_packet(packet,topic)).encode('utf-8')
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    request=urllib.request.Request(api_url.rstrip('/')+'/api/telemetry',payload,headers,method='POST')
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode())


def main() -> None:
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        sys.exit('Install paho-mqtt first: pip install paho-mqtt')
    host=os.getenv('MQTT_HOST')
    if not host:
        sys.exit('MQTT_HOST is required')
    port=int(os.getenv('MQTT_PORT','1883'))
    topic=os.getenv('MQTT_TOPIC','warehouse/+/telemetry')
    url=os.getenv('TWIN_API_URL','http://127.0.0.1:8000')
    token=os.getenv('TWIN_INGEST_TOKEN','')
    client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    username=os.getenv('MQTT_USERNAME')
    if username:client.username_pw_set(username,os.getenv('MQTT_PASSWORD',''))
    if port == 8883: client.tls_set()
    def on_connect(client,userdata,flags,reason_code,properties):
        if reason_code==0:
            client.subscribe(topic,qos=1)
            print('Subscribed',topic,flush=True)
        else:
            print('MQTT connection refused',reason_code,flush=True)
    def on_message(client,userdata,message):
        try:
            packet=json.loads(message.payload.decode())
            result=forward_packet(packet,message.topic,url,token)
            print('stored',packet.get('seq'),result['disposition'],flush=True)
        except Exception as exc:
            print('Rejected MQTT observation:',str(exc),file=sys.stderr,flush=True)
    client.on_connect=on_connect
    client.on_message=on_message
    client.connect(host,port,keepalive=60)
    client.loop_forever()

if __name__=='__main__':main()
