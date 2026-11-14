"""Always-on, one-writer MQTT to PostgreSQL sensor-twin worker.

Deploy as a persistent worker/VM process, NOT as a Streamlit page callback.
Credentials and measured calibrations must be supplied using private variables.
"""
import json
import os
import signal
import time
import logging

from .database import SensorDatabase
from .models import Calibration
from .mqtt_service import MQTTService


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError("Missing private environment variable: " + name)
    return value


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if os.environ.get("AMR_MEASURED_CALIBRATION_CONFIRMED", "").lower() != "true":
        raise RuntimeError("Measured calibration must be explicitly confirmed")
    values = json.loads(required("AMR_CALIBRATION_JSON"))
    if set(values) != {"amr01"}:
        raise ValueError("Exactly one measured AMR-01 calibration is required")
    calibrations = {"amr01": Calibration(**values["amr01"])}
    # Schema creation is a separate one-time administrator operation.
    # The always-on worker requires only limited data-write privileges.
    store = SensorDatabase(required("AMR_DATABASE_URL"), initialize=False)
    store.assert_schema_ready()
    service = None
    try:
        store.acquire_worker_lease()
        service = MQTTService(
            required("AMR_MQTT_HOST"),
            required("AMR_MQTT_USERNAME"),
            required("AMR_MQTT_PASSWORD"),
            calibrations,
            database=store,
            ca_file=os.environ.get("AMR_EMQX_CA_FILE") or None,
            client_id=os.environ.get("AMR_MQTT_CLIENT_ID", "amr01-db-ingester"),
        )
        running = True

        def stop(_signum, _frame):
            nonlocal running
            running = False

        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        logging.info("AMR-01 ingester started; broker topic robot/amr01/state")
        next_metrics_log = time.monotonic() + 30
        while running:
            if service.fatal_error:
                raise RuntimeError("EMQX subscription or database ingestion failed: " + service.status)
            if time.monotonic() >= next_metrics_log:
                stats = service.metrics
                log = logging.warning if stats["queue_depth"] >= 128 else logging.info
                log(
                    "AMR-01 MQTT -> PostgreSQL status=%s "
                    "received=%d persisted=%d rejected=%d "
                    "queue_depth=%d overflows=%d last_processing_ms=%s",
                    service.status,
                    stats["received"], stats["persisted"], stats["rejected"],
                    stats["queue_depth"], stats["queue_overflows"],
                    (f'{stats["processing_last_ms"]:.2f}'
                     if stats["processing_last_ms"] is not None else "unknown"),
                )
                next_metrics_log = time.monotonic() + 30
            time.sleep(0.5)
    finally:
        if service is not None:
            service.close()
        store.release_worker_lease()
        store.engine.dispose()
        logging.info("AMR-01 ingester stopped")


if __name__ == "__main__":
    main()
