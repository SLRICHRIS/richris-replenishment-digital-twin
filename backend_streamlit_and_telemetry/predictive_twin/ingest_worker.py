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
    store = SensorDatabase(required("AMR_DATABASE_URL"), initialize=True)
    service = MQTTService(
        required("AMR_MQTT_HOST"),
        required("AMR_MQTT_USERNAME"),
        required("AMR_MQTT_PASSWORD"),
        calibrations,
        database=store,
    )
    running = True

    def stop(_signum, _frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    logging.info("AMR-01 ingester started; broker topic robot/amr01/state")
    try:
        while running:
            time.sleep(1)
    finally:
        service.close()
        store.engine.dispose()
        logging.info("AMR-01 ingester stopped")


if __name__ == "__main__":
    main()
