"""One-time AMR-01 PostgreSQL schema provisioning with a DDL-capable admin role.

Run before starting the live MQTT worker. Never run this from Streamlit or
embed provisioning credentials in the Git repository.
"""
import os

from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase


def main():
    url = os.environ.get("AMR_DATABASE_ADMIN_URL", "").strip()
    if not url:
        raise RuntimeError("Missing private AMR_DATABASE_ADMIN_URL")
    if not url.startswith(("postgresql+psycopg://", "postgresql://", "postgres://")):
        raise RuntimeError("Provision physical sensor tables only on PostgreSQL")
    db = SensorDatabase(url, initialize=True)
    try:
        db.assert_schema_ready()
        print("AMR-01 sensor database v2 ready: canonical measurements, typed "
              "sensor views, derived states and pipeline-quality events.")
    finally:
        db.engine.dispose()


if __name__ == "__main__":
    main()
