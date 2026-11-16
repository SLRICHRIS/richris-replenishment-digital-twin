"""Local authenticated LabVIEW API. Physical transport is explicit opt-in.

Run on the LabVIEW/control workstation. Bind only to loopback. The website has
no approval credential or command publisher. Database DDL is a separate step.
"""
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .database import SensorDatabase, calibration_fingerprint
from sqlalchemy import text
from .human_review import ReviewCoordinator, metadata, COMMAND_TOPIC, ACK_TOPIC, valid_id
from .models import Calibration


class MQTTTransport:
    def __init__(self, coordinator):
        import paho.mqtt.client as mqtt
        self.mqtt, self.coordinator = mqtt, coordinator
        self.ready = threading.Event()
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                  client_id='amr01-human-review-gateway')
        self.client.username_pw_set(required('AMR_HITL_MQTT_USERNAME'), required('AMR_HITL_MQTT_PASSWORD'))
        self.client.tls_set(ca_certs=os.environ.get('AMR_EMQX_CA_FILE') or None)
        self.client.on_connect = self.on_connect
        self.client.on_subscribe = self.on_subscribe
        self.client.on_disconnect = lambda *_: self.ready.clear()
        self.client.on_message = self.on_message
        self.client.connect_async(required('AMR_MQTT_HOST'), 8883, 30)
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


def required(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise RuntimeError('Missing private setting: '+name)
    return value


def context_provider(store, calibration):
    def read():
        snapshot = store.read_snapshot(expected_fingerprint=calibration_fingerprint(calibration), include_history=False)
        snapshot['calibration_fingerprint'] = calibration_fingerprint(calibration)
        return dict(mode='live', observed_at=time.time(), robots={'amr01':snapshot})
    return read


def handler_for(coordinator, context, api_key):
    if not isinstance(api_key, str) or len(api_key) < 32:
        raise ValueError('LabVIEW API key must contain at least 32 characters')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Do not log authentication headers, reasons or request bodies.

        def reply(self, code, value):
            body = json.dumps(value, allow_nan=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            candidate = self.headers.get('Authorization', '')
            if len(candidate) > 512 or not hmac.compare_digest(candidate.encode(), ('Bearer '+api_key).encode()):
                self.reply(401, {'error':'LabVIEW authorization required'})
                return False
            return True

        def do_GET(self):
            if not self.authorized():
                return
            try:
                if self.path == '/context':
                    from .insights import predictive_insights
                    payload = context()
                    self.reply(200, dict(insights=predictive_insights(payload), context=payload,
                                        commands_enabled=coordinator.commands_enabled))
                elif self.path == '/reviews':
                    self.reply(200, {'reviews':coordinator.history()})
                elif self.path.startswith('/reviews/') and valid_id(self.path.split('/')[-1]):
                    self.reply(200, coordinator.get(self.path.split('/')[-1]))
                else:
                    self.reply(404, {'error':'Unknown endpoint'})
            except ValueError as error:
                self.reply(409, {'error':str(error)})
            except Exception:
                self.reply(503, {'error':'Review storage or sensor context is unavailable'})

        def do_POST(self):
            if not self.authorized():
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 1 <= length <= 2048 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    self.reply(400, {'error':'A JSON body of at most 2 KB is required'})
                    return
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('JSON object required')
                if self.path == '/reviews' and set(body) == {'review_id'}:
                    result = coordinator.create(context(), body['review_id'])
                else:
                    parts = self.path.split('/')
                    if (len(parts) != 4 or parts[1] != 'reviews' or parts[3] != 'decision'
                            or not valid_id(parts[2]) or set(body) != {'decision','action','operator','reason'}):
                        self.reply(404, {'error':'Unknown endpoint or request fields'})
                        return
                    result = coordinator.decide(parts[2], payload=context(), **body)
                self.reply(200, result)
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self.reply(409, {'error':str(error)})
            except Exception:
                self.reply(503, {'error':'Review storage or sensor context is unavailable'})
    return Handler


def main():
    if os.environ.get('AMR_MEASURED_CALIBRATION_CONFIRMED') != 'true':
        raise RuntimeError('Measured calibration must be confirmed before physical human review')
    values = json.loads(required('AMR_CALIBRATION_JSON'))
    if set(values) != {'amr01'}:
        raise ValueError('Only AMR-01 is supported')
    calibration = Calibration(**values['amr01'])
    store = SensorDatabase(required('AMR_HITL_DATABASE_URL'), initialize=False)
    store.assert_schema_ready()
    if store.engine.dialect.name != 'postgresql':
        raise RuntimeError('Physical review requires the shared PostgreSQL trial database')
    lease = store.engine.connect()
    if not lease.execute(text('SELECT pg_try_advisory_lock(707010317)')).scalar():
        lease.close()
        raise RuntimeError('Another LabVIEW review gateway already owns this trial')
    coordinator = ReviewCoordinator(store.engine)
    coordinator.recover()
    read = context_provider(store, calibration)
    transport = None
    enabled = os.environ.get('AMR_HITL_COMMANDS_ENABLED') == 'true'
    if enabled:
        if os.environ.get('AMR_HITL_CONTROLLER_READY') != 'true':
            raise RuntimeError('Commission the command receiver before enabling delivery')
        transport = MQTTTransport(coordinator)
        coordinator.publisher, coordinator.commands_enabled = transport.publish, True
    server = ThreadingHTTPServer(('127.0.0.1', 8766), handler_for(coordinator, read, required('AMR_LABVIEW_API_KEY')))
    server.daemon_threads = True
    stopping = threading.Event()

    def monitor():
        while not stopping.wait(.5):
            try:
                coordinator.observe(read())
            except Exception:
                # Expire pending delivery even when sensor reads fail.
                try:
                    for row in coordinator.history():
                        coordinator.get(row['review_id'])
                except Exception:
                    pass  # A storage outage cannot be reported as a verified outcome.
    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    print('AMR-01 LabVIEW review API: loopback port 8766. Command delivery '+('enabled' if enabled else 'disabled')+'.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stopping.set()
        server.server_close()
        thread.join(timeout=2)
        if transport:
            transport.close()
        lease.execute(text('SELECT pg_advisory_unlock(707010317)'))
        lease.close()
        store.engine.dispose()


if __name__ == '__main__':
    main()
