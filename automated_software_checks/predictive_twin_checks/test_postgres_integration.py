"""Exercise actual PostgreSQL 16 wire protocol and relational DDL in CI."""
import os
from dataclasses import asdict

import pytest
from sqlalchemy import select

from backend_streamlit_and_telemetry.predictive_twin.database import (
    CalibrationRecord, SensorDatabase, SensorSample, TwinState,
)
from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
from backend_streamlit_and_telemetry.predictive_twin.telemetry import FleetTwin, Packet


@pytest.mark.skipif(not os.getenv("TEST_POSTGRES_URL"), reason="PostgreSQL test service not configured")
def test_real_postgres_raw_and_derived_roundtrip():
    url = os.environ["TEST_POSTGRES_URL"]
    db = SensorDatabase(url, initialize=True)
    with db.engine.begin() as conn:
        # Dedicated isolated database from GitHub Actions; no production credentials.
        conn.execute(TwinState.__table__.delete())
        conn.execute(SensorSample.__table__.delete())
        conn.execute(CalibrationRecord.__table__.delete())
    fleet = FleetTwin(example_calibrations(), database=db)
    topic = "robot/amr01/state"
    first = asdict(Packet("amr01", "ci-postgres", 0, 0.0, 0, 0, .01, 7.4, .6, "standby"))
    second = asdict(Packet("amr01", "ci-postgres", 1, .05, 10, 10, .01, 7.4, .6, "standby"))
    assert fleet.ingest(first, topic, received=0)
    assert fleet.ingest(second, topic, received=.05)
    assert not fleet.ingest(second, topic, received=.05)
    snapshot = db.read_snapshot(stale_after_s=10)
    assert snapshot["quality"] == "OK"
    assert snapshot["raw"]["encoder_left_count"] == 10
    assert snapshot["derived"]["v_left_m_s"] > 0
    assert snapshot["soc"] < .9
    with db.engine.connect() as conn:
        assert len(conn.execute(select(SensorSample.robot_id)).all()) == 2
        assert len(conn.execute(select(TwinState.robot_id)).all()) == 2
    db.engine.dispose()

def test_postgresql_single_writer_lease():
    url = os.environ["TEST_POSTGRES_URL"]
    writer1 = SensorDatabase(url, initialize=True)
    writer2 = SensorDatabase(url, initialize=False)
    try:
        writer1.acquire_worker_lease()
        with pytest.raises(RuntimeError, match="Another AMR-01"):
            writer2.acquire_worker_lease()
        writer1.release_worker_lease()
        writer2.acquire_worker_lease()
    finally:
        writer2.release_worker_lease()
        writer1.release_worker_lease()
        writer1.engine.dispose()
        writer2.engine.dispose()
