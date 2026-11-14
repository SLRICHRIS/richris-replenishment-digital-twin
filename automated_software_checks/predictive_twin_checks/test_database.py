"""Offline relational integration checks; never requires a real broker or robot."""
from dataclasses import asdict

from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase, CalibrationRecord, SensorSample, TwinState
from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
from backend_streamlit_and_telemetry.predictive_twin.telemetry import FleetTwin, Packet
from sqlalchemy import select
from sqlalchemy.orm import Session


def packet(seq, t, count, boot="test-boot", gyro=.01):
    return Packet("amr01", boot, seq, t, count, count, gyro, 7.4, .6, "standby")


def test_structured_raw_to_model_to_database_pipeline(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "twin.sqlite3"), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    assert fleet.ingest(asdict(packet(0, 0, 0)), "robot/amr01/state", received=0)
    assert fleet.ingest(asdict(packet(1, .05, 10)), "robot/amr01/state", received=.05)
    assert not fleet.ingest(asdict(packet(1, .05, 10)), "robot/amr01/state", received=.05)
    # The latest model state was computed from admitted typed sensor readings.
    with Session(db.engine) as session:
        assert len(session.execute(select(SensorSample)).scalars().all()) == 2
        assert len(session.execute(select(TwinState)).scalars().all()) == 2
        assert len(session.execute(select(CalibrationRecord)).scalars().all()) == 1
    reading = db.read_snapshot(stale_after_s=999999999)
    assert reading["quality"] == "OK"
    assert reading["derived"]["v_left_m_s"] > 0
    assert reading["soc"] < .9
    assert reading["raw"]["encoder_left_count"] == 10
    assert len(reading["history"]) == 1
    db.engine.dispose()


def test_persistent_deduplication_across_process_restart(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "restart.sqlite3"), initialize=True)
    topic = "robot/amr01/state"
    first = FleetTwin(example_calibrations(), database=db)
    assert first.ingest(asdict(packet(0, 0, 0)), topic, received=0)
    second = FleetTwin(example_calibrations(), database=db)
    assert not second.ingest(asdict(packet(0, 0, 0)), topic, received=0)
    assert second.robots["amr01"].previous is None
    # A new sample becomes a fresh local anchor; no historical position is fabricated.
    assert second.ingest(asdict(packet(1, .05, 10)), topic, received=.05)
    assert second.robots["amr01"].pose == (0., 0., 0.)
    db.engine.dispose()


def test_calibration_mismatch_blocks_live_estimates(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "mismatch.sqlite3"), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    assert fleet.ingest(asdict(packet(0, 0, 0)), "robot/amr01/state", received=0)
    result = db.read_snapshot(stale_after_s=999999999, expected_fingerprint="f" * 64)
    assert result["stale"] is True
    assert result["quality"] == "CALIBRATION_MISMATCH"
    assert result["derived"] == {}
    db.engine.dispose()


def test_demo_does_not_write_to_physical_tables(tmp_path):
    from backend_streamlit_and_telemetry.predictive_twin.demo import demo_fleet
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "demo.sqlite3"), initialize=True)
    demo = demo_fleet()
    assert demo.snapshots(now=6)["amr01"]["history"]
    with Session(db.engine) as session:
        assert session.execute(select(SensorSample)).first() is None
    db.engine.dispose()
