"""Server-side MQTT subscriber. No command publishing; credentials stay in Python."""
import ssl
import logging

LOGGER = logging.getLogger(__name__)
import threading

import paho.mqtt.client as mqtt

from .telemetry import FleetTwin, ROBOT_IDS


class MQTTService:
    def __init__(self, host, username, password, calibrations, port=8883, database=None):
        if not host or "://" in host or not username or not password:
            raise ValueError("Configure the broker host, subscriber username and password")
        if port != 8883:
            raise ValueError("This deployment requires verified MQTT/TLS on port 8883")
        self.fleet = FleetTwin(calibrations, database=database)
        self._lock = threading.Lock()
        self._status = "Connecting"
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.username_pw_set(username, password)
        self.client.tls_set_context(ssl.create_default_context())
        self.client.reconnect_delay_set(min_delay=1, max_delay=30)
        self.client.on_connect = self._connected
        self.client.on_disconnect = self._disconnected
        self.client.on_message = self._message
        self.client.connect_async(host, port, keepalive=30)
        self.client.loop_start()

    @property
    def status(self):
        with self._lock:
            return self._status

    def _connected(self, client, userdata, flags, reason_code, properties):
        with self._lock:
            self._status = "Connected" if not reason_code.is_failure else "Connection refused"
        if not reason_code.is_failure:
            for rid in ROBOT_IDS:
                client.subscribe(f"robot/{rid}/state", qos=1)

    def _disconnected(self, client, userdata, flags, reason_code, properties):
        with self._lock:
            self._status = "Disconnected; reconnecting"
        with self.fleet.lock:
            for robot in self.fleet.robots.values():
                robot.invalidate()

    def _message(self, client, userdata, message):
        try:
            self.fleet.ingest(message.payload, message.topic, retained=message.retain)
        except Exception:
            # Do not acknowledge a false successful model update to operators.
            LOGGER.exception("Failed to store or model AMR telemetry")
            with self._lock:
                self._status = "Database/ingestion error"
            # Halt subscription rather than silently lose writes.
            client.disconnect()

    def close(self):
        self.client.disconnect()
        self.client.loop_stop()
