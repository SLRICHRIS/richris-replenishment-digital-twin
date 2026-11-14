"""Offline relational integration checks; never requires a real broker or robot."""
from dataclasses import asdict

from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase, CalibrationRecord, SensorSample, TwinState, PipelineEvent, DatabaseVersion
from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
from backend_streamlit_and_telemetry.predictive_twin.telemetry import FleetTwin, Packet
from sqlalchemy import select, text, inspect
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



def test_real_sensor_views_use_single_canonical_packet_storage(tmp_path):
    """One physical observation -> three typed sensor-specific SQL views."""
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "views.sqlite3"), initialize=True)
    assert {"amr_encoder_readings", "amr_imu_readings", "amr_ina219_readings"}.issubset(
        set(inspect(db.engine).get_view_names())
    )
    fleet = FleetTwin(example_calibrations(), database=db)
    assert fleet.ingest(asdict(packet(0, 0, 0)), "robot/amr01/state", received=0)
    assert fleet.ingest(asdict(packet(1, .05, 10)), "robot/amr01/state", received=.05)
    with db.engine.connect() as connection:
        enc = connection.execute(text(
            "SELECT robot_id, boot_id, seq, encoder_left_count, encoder_right_count "
            "FROM amr_encoder_readings ORDER BY seq"
        )).all()
        imu = connection.execute(text(
            "SELECT seq, gyro_z_rad_s FROM amr_imu_readings ORDER BY seq"
        )).all()
        ina = connection.execute(text(
            "SELECT seq, battery_voltage_v, battery_current_a "
            "FROM amr_ina219_readings ORDER BY seq"
        )).all()
        assert enc[1] == ("amr01", "test-boot", 1, 10, 10)
        assert imu[1] == (1, .01)
        assert ina[1] == (1, 7.4, .6)
        assert len(connection.execute(select(SensorSample)).all()) == 2
    assert db.read_snapshot(stale_after_s=999999999)["pipeline_events"] == []
    db.engine.dispose()


def test_sequence_gap_reboot_and_long_gap_are_durable_and_linked(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "gaps.sqlite3"), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    topic = "robot/amr01/state"
    assert fleet.ingest(asdict(packet(0, 0, 0)), topic, received=0)
    assert fleet.ingest(asdict(packet(2, .10, 20)), topic, received=.10)
    assert fleet.ingest(asdict(packet(3, 2.20, 40)), topic, received=2.20)
    assert fleet.ingest(asdict(packet(0, 0, 0, boot="new-boot")), topic, received=2.25)
    assert not fleet.ingest(asdict(packet(0, 0, 0, boot="new-boot")), topic, received=2.25)
    events = db.recent_quality_events()
    assert {event["event_type"] for event in events} == {"sequence_gap", "time_gap", "reboot"}
    missing = next(event for event in events if event["event_type"] == "sequence_gap")
    assert missing["details"]["missing_packets"] == 1
    assert missing["boot_id"] == "test-boot"
    assert missing["seq"] == 2
    with Session(db.engine) as session:
        assert len(session.execute(select(SensorSample)).scalars().all()) == 4
        assert len(session.execute(select(PipelineEvent)).scalars().all()) == 3
    assert len(db.read_snapshot(stale_after_s=999999999)["pipeline_events"]) == 3
    db.engine.dispose()


def test_schema_migration_from_existing_v1_keeps_raw_history(tmp_path):
    path = "sqlite+pysqlite:///" + str(tmp_path / "migration.sqlite3")
    first = SensorDatabase(path, initialize=True)
    fleet = FleetTwin(example_calibrations(), database=first)
    assert fleet.ingest(asdict(packet(0, 0, 0)), "robot/amr01/state", received=0)
    with Session(first.engine) as session, session.begin():
        session.get(DatabaseVersion, 1).schema_version = 1
    first.engine.dispose()
    migrated = SensorDatabase(path, initialize=True)
    with Session(migrated.engine) as session:
        assert session.get(DatabaseVersion, 1).schema_version == 2
        assert len(session.execute(select(SensorSample)).all()) == 1
    assert "amr_encoder_readings" in inspect(migrated.engine).get_view_names()
    migrated.engine.dispose()



def test_bad_sensor_packets_are_audited_without_raw_payload_persistence(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "reject.sqlite3"), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    topic = "robot/amr01/state"
    assert not fleet.ingest(asdict(packet(0, 0, 0)), topic, received=0, retained=True)
    invalid = asdict(packet(0, 0, 0))
    invalid["gyro_z_rad_s"] = None
    assert not fleet.ingest(invalid, topic, received=0)
    with Session(db.engine) as session:
        assert len(session.execute(select(SensorSample)).scalars().all()) == 0
        events = session.execute(select(PipelineEvent)).scalars().all()
        assert {event.event_type for event in events} == {"invalid_schema", "retained_message"}
        assert all(event.details == {"topic": topic} for event in events)
    db.engine.dispose()


def test_sequence_gap_invalidates_cross_interval_gyro_residual(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "residual.sqlite3"), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    topic = "robot/amr01/state"
    assert fleet.ingest(asdict(packet(0, 0, 0)), topic, received=0)
    assert fleet.ingest(asdict(packet(2, .10, 20, gyro=.2)), topic, received=.1)
    state = db.read_snapshot(stale_after_s=999999999)
    assert state["quality"] == "SEQUENCE_GAP"
    assert state["derived"]["residual_rad_s"] is None
    assert state["derived"]["residual_valid"] is False
    assert not state["derived"]["advisory"]
    assert state["derived"]["sequence_gap_count"] == 1
    assert state["derived"]["v_left_m_s"] > 0
    assert fleet.ingest(asdict(packet(3, .15, 30, gyro=.01)), topic, received=.15)
    assert db.read_snapshot(stale_after_s=999999999)["derived"]["residual_valid"]
    db.engine.dispose()


def test_logical_20hz_sample_stream_is_append_only(tmp_path):
    """Functional volume test; not a claim of deployed 20 Hz timing performance."""
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "volume.sqlite3"), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    for seq in range(200):
        t = seq * .05
        assert fleet.ingest(
            asdict(packet(seq, t, seq * 10)), "robot/amr01/state", received=t
        )
    with Session(db.engine) as session:
        assert len(session.execute(select(SensorSample)).all()) == 200
        assert len(session.execute(select(TwinState)).all()) == 200
        assert len(session.execute(select(PipelineEvent)).all()) == 0
    db.engine.dispose()


def test_running_worker_requires_preprovisioned_schema(tmp_path):
    """DDL and worker responsibilities cannot accidentally be conflated."""
    import pytest

    url = "sqlite+pysqlite:///" + str(tmp_path / "provision.sqlite3")
    unprovisioned_worker = SensorDatabase(url, initialize=False)
    with pytest.raises(RuntimeError, match="schema"):
        unprovisioned_worker.assert_schema_ready()
    unprovisioned_worker.engine.dispose()

    admin = SensorDatabase(url, initialize=True)
    admin.assert_schema_ready()
    admin.engine.dispose()

    worker = SensorDatabase(url, initialize=False)
    worker.assert_schema_ready()
    assert "amr_encoder_readings" in inspect(worker.engine).get_view_names()
    worker.engine.dispose()
