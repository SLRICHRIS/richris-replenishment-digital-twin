"""Verified TLS subscriber for AMR-01 via EMQX MQTT, never a motor publisher.

The sole production consumer is the independent ingestion worker. Persisted
readings reach Streamlit through PostgreSQL, not through browser MQTT.
"""
import logging
import re
import ssl
import threading

import paho.mqtt.client as mqtt

from .telemetry import FleetTwin, ROBOT_IDS

LOGGER = logging.getLogger(__name__)
TOPIC = "robot/amr01/state"
DEFAULT_CLIENT_ID = "amr01-db-ingester"


class MQTTService:
    def __init__(
        self, host, username, password, calibrations, port=8883, database=None,
        ca_file=None, client_id=DEFAULT_CLIENT_ID,
    ):
        if not isinstance(host, str) or not host or "://" in host or "/" in host or ":" in host:
            raise ValueError("Provide the EMQX deployment hostname, without scheme or port")
        if not isinstance(username, str) or not username or not isinstance(password, str) or not password:
            raise ValueError("Configure the independent EMQX subscriber username and password")
        if port != 8883:
            raise ValueError("EMQX Cloud Serverless requires MQTT/TLS on port 8883")
        if not isinstance(client_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,48}", client_id):
            raise ValueError("Provide a valid, stable MQTT client ID")
        if tuple(ROBOT_IDS) != ("amr01",):
            raise ValueError("Only the AMR-01 telemetry topic is supported")
        self.fleet = FleetTwin(calibrations, database=database)
        self._lock = threading.Lock()
        self._status = "Connecting"
        self._fatal = threading.Event()
        self._subscription_confirmed = threading.Event()
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id=client_id,
            protocol=mqtt.MQTTv311, clean_session=True,
        )
        self.client.username_pw_set(username, password)
        tls_context = ssl.create_default_context(cafile=ca_file or None)
        tls_context.check_hostname = True
        tls_context.verify_mode = ssl.CERT_REQUIRED
        self.client.tls_set_context(tls_context)
        self.client.reconnect_delay_set(min_delay=2, max_delay=30)
        self.client.on_connect = self._connected
        self.client.on_subscribe = self._subscribed
        self.client.on_disconnect = self._disconnected
        self.client.on_message = self._message
        self.client.connect_async(host, port, keepalive=30)
        self.client.loop_start()

    @property
    def status(self):
        with self._lock:
            return self._status

    @property
    def fatal_error(self):
        return self._fatal.is_set()

    @property
    def subscription_confirmed(self):
        return self._subscription_confirmed.is_set()

    def _fail(self, client, status):
        self._subscription_confirmed.clear()
        self._fatal.set()
        with self._lock:
            self._status = status
        client.disconnect()

    def _connected(self, client, userdata, flags, reason_code, properties):
        if self.fatal_error:
            client.disconnect()
            return
        if reason_code.is_failure:
            self._fail(client, "EMQX authentication/connection rejected")
            return
        # A TCP/TLS connection does not prove authorization. Wait for SUBACK.
        self._subscription_confirmed.clear()
        with self._lock:
            self._status = "Connected; awaiting EMQX subscription"
        response = client.subscribe(TOPIC, qos=1)
        if isinstance(response, tuple) and response[0] != mqtt.MQTT_ERR_SUCCESS:
            self._fail(client, "EMQX subscribe request failed")

    def _subscribed(self, client, userdata, mid, reason_codes, properties):
        if self.fatal_error:
            return
        if not reason_codes or any(getattr(code, "is_failure", isinstance(code, int) and code >= 128) for code in reason_codes):
            self._fail(client, "EMQX topic subscription denied")
            return
        self._subscription_confirmed.set()
        with self._lock:
            self._status = "Subscribed to " + TOPIC

    def _disconnected(self, client, userdata, flags, reason_code, properties):
        self._subscription_confirmed.clear()
        if not self.fatal_error:
            with self._lock:
                self._status = "Disconnected; reconnecting"
        # Network interruption invalidates the integrals; never bridge unknown dt.
        with self.fleet.lock:
            for robot in self.fleet.robots.values():
                robot.invalidate()

    def _message(self, client, userdata, message):
        if self.fatal_error:
            return
        if message.topic != TOPIC:
            LOGGER.warning("Ignoring unexpected MQTT topic")
            return
        try:
            self.fleet.ingest(message.payload, message.topic, retained=message.retain)
        except Exception:
            LOGGER.exception("AMR telemetry modelling/storage failure")
            # Fail closed. The supervisor will terminate this worker instead
            # of repeatedly reconnecting and silently discarding samples.
            self._fail(client, "Database/ingestion failure; worker stopping")

    def close(self):
        self.client.disconnect()
        self.client.loop_stop()
