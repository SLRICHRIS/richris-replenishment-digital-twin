"""Verified TLS subscriber for AMR-01 via EMQX MQTT, never a motor publisher.

The sole production consumer is the independent ingestion worker. Persisted
readings reach Streamlit through PostgreSQL, not through browser MQTT.
"""
import logging
from datetime import datetime, timezone
import queue
import re
import ssl
import threading
import time

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
        # The Paho networking callback must not wait for a remote database.
        # This bounded, ordered queue is volatile; it is NOT a durable event log.
        self._ingest_queue = queue.Queue(maxsize=256) if database is not None else None
        self._worker_stop = threading.Event()
        self._worker = None
        self._metrics = {
            "received": 0,
            "persisted": 0,
            "rejected": 0,
            "queue_overflows": 0,
            "processing_last_ms": None,
        }
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
        if self._ingest_queue is not None:
            self._worker = threading.Thread(
                target=self._drain_samples, name="amr01-pg-writer", daemon=True
            )
            self._worker.start()
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

    @property
    def metrics(self):
        with self._lock:
            result = dict(self._metrics)
        result["queue_depth"] = (
            self._ingest_queue.qsize() if self._ingest_queue is not None else 0
        )
        result["subscription_confirmed"] = self.subscription_confirmed
        return result

    def _drain_samples(self):
        """Single ordered consumer. DB updates never block the Paho socket loop."""
        while True:
            if self._worker_stop.is_set() and self._ingest_queue.empty():
                return
            try:
                kind, payload, topic, retained, received, received_at = self._ingest_queue.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                if self.fatal_error:
                    continue
                if kind == "disconnect":
                    with self.fleet.lock:
                        for robot in self.fleet.robots.values():
                            robot.invalidate()
                    continue
                started = time.monotonic()
                accepted = self.fleet.ingest(
                    payload, topic, received=received, retained=retained,
                    received_at=received_at,
                )
                elapsed_ms = (time.monotonic() - started) * 1000
                with self._lock:
                    self._metrics["persisted" if accepted else "rejected"] += 1
                    self._metrics["processing_last_ms"] = elapsed_ms
            except Exception:
                LOGGER.exception("Persisted AMR-01 telemetry processing failed")
                self._fail(self.client, "Database/ingestion failure; worker stopping")
            finally:
                self._ingest_queue.task_done()

    def _enqueue(self, item):
        try:
            self._ingest_queue.put_nowait(item)
        except queue.Full:
            LOGGER.error("AMR-01 ingestion buffer overflow; stopping to prevent silent loss")
            with self._lock:
                self._metrics["queue_overflows"] += 1
            self._fail(self.client, "Ingestion queue overflow; worker stopping")

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
        # Preserve delivery order: queued records are processed before the
        # disconnect invalidates the model anchor. No unknown interval is joined.
        if self._ingest_queue is not None:
            if not self.fatal_error:
                self._enqueue(("disconnect", b"", TOPIC, False, time.monotonic(),
                               datetime.now(timezone.utc)))
        else:
            with self.fleet.lock:
                for robot in self.fleet.robots.values():
                    robot.invalidate()

    def _message(self, client, userdata, message):
        if self.fatal_error:
            return
        if message.topic != TOPIC:
            LOGGER.warning("Ignoring unexpected MQTT topic")
            return
        received = time.monotonic()
        received_at = datetime.now(timezone.utc)
        # Enforce the byte bound before retaining a payload in the queue.
        # An oversized body becomes an ordinary invalid-schema audit event.
        payload = bytes(message.payload) if len(message.payload) <= 4096 else b""
        # Queue the sample immediately. Capture receive time on the MQTT thread,
        # NOT after PostgreSQL latency. A full queue is a fatal observable error.
        if self._ingest_queue is not None:
            with self._lock:
                self._metrics["received"] += 1
            self._enqueue(("sample", payload, message.topic,
                           message.retain, received, received_at))
            return
        try:
            accepted = self.fleet.ingest(payload, message.topic, retained=message.retain,
                                         received=received, received_at=received_at)
            with self._lock:
                self._metrics["received"] += 1
                self._metrics["persisted" if accepted else "rejected"] += 1
        except Exception:
            LOGGER.exception("AMR telemetry modelling/storage failure")
            self._fail(client, "Database/ingestion failure; worker stopping")

    def close(self):
        # Stop receiving new MQTT packets, drain the bounded volatile queue,
        # and only then allow the application to dispose of the DB connection.
        self.client.disconnect()
        self.client.loop_stop()
        if self._worker is not None:
            self._worker_stop.set()
            self._worker.join(timeout=15)
            if self._worker.is_alive():
                raise RuntimeError("Timed out draining the sensor-to-PostgreSQL queue")
