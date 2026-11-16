"""Read-only EMQX Cloud smoke test, with no physical database writes.

Usage (all values private environment variables):
  python -m project_maintenance_scripts.probe_emqx_connection --timeout 15
  python -m project_maintenance_scripts.probe_emqx_connection --timeout 30 --require-packet

Do not confuse an MQTT subscription with validated sensor calibration.
"""
import argparse
import os
import sys
import time

from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
from backend_streamlit_and_telemetry.predictive_twin.mqtt_service import MQTTService


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError("Missing private environment setting " + name)
    return value


def probe(timeout=15, require_packet=False):
    # Example calibration is used only to construct an ephemeral in-memory parser.
    # Results are deliberately not shown and never stored in physical-trial tables.
    service = MQTTService(
        required("AMR_MQTT_HOST"),
        required("AMR_MQTT_USERNAME"),
        required("AMR_MQTT_PASSWORD"),
        example_calibrations(),
        ca_file=os.environ.get("AMR_EMQX_CA_FILE") or None,
        client_id="amr01-probe",
    )
    try:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if service.fatal_error:
                print("FAIL: " + service.status, file=sys.stderr)
                return 2
            if service.subscription_confirmed:
                if not require_packet:
                    print("PASS: TLS authentication and EMQX SUBACK for robot/amr01/state.")
                    print("No hardware or database ingestion was validated.")
                    return 0
                with service.fleet.lock:
                    received = service.fleet.robots["amr01"].last_received
                if received is not None:
                    print("PASS: EMQX delivered a valid AMR-01 sensor packet.")
                    print("Model calibration and physical sensor accuracy are unverified.")
                    return 0
            time.sleep(0.1)
        print("FAIL: " + ("No valid sensor packet received." if require_packet
                          else "EMQX TLS/subscription handshake not confirmed."), file=sys.stderr)
        return 1
    finally:
        service.close()


def main():
    parser = argparse.ArgumentParser(description="Probe read-only EMQX connection for AMR-01.")
    parser.add_argument("--timeout", type=int, default=15)
    parser.add_argument("--require-packet", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.timeout <= 300:
        parser.error("timeout must be between 1 and 300 seconds")
    try:
        return probe(args.timeout, args.require_packet)
    except (OSError, ValueError, RuntimeError) as error:
        # Do not print secret strings or full connection URLs.
        print("FAIL: EMQX settings, certificate or network initialization error (" +
              type(error).__name__ + ")", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
