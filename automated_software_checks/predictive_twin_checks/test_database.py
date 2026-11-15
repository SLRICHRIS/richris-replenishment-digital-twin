"""Offline relational integration checks; never requires a real broker or robot."""
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

import pytest

from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase, CalibrationRecord, SensorSample, TwinState, PipelineEvent, DatabaseVersion, WorkerCheckpoint
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


def test_database_browser_is_bounded_allowlisted_and_select_only(tmp_path):
    from backend_streamlit_and_telemetry.predictive_twin.database import DATABASE_DATASETS
    from backend_streamlit_and_telemetry.predictive_twin.database_inspection import attributes
    db = SensorDatabase('sqlite+pysqlite:///' + str(tmp_path / 'browse.sqlite3'), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    for seq in range(3):
        assert fleet.ingest(asdict(packet(seq, seq * .05, seq * 10)), 'robot/amr01/state', received=seq * .05)
    # Reject every write at the database level while browsing all nine objects.
    with db.engine.connect() as conn:
        conn.execute(text('PRAGMA query_only=ON'))
    db.assert_schema_ready()
    for dataset in DATABASE_DATASETS:
        assert isinstance(db.read_records(dataset, limit=2), list)
        assert attributes(dataset)
    rows = db.read_records('amr_encoder_readings', limit=2)
    assert [row['seq'] for row in rows] == [2, 1]
    assert rows[0]['encoder_left_count'] == 20
    for name, limit in [('amr_sensor_samples; DROP TABLE amr_sensor_samples', 50),
                        ('amr_sensor_samples', 201), ('amr_sensor_samples', True)]:
        with pytest.raises(ValueError):
            db.read_records(name, limit)
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
        assert session.get(DatabaseVersion, 1).schema_version == 3
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


def test_checkpoint_survives_receive_clock_regression(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "clock.sqlite3"), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    topic = "robot/amr01/state"
    now = datetime.now(timezone.utc)
    assert fleet.ingest(asdict(packet(0, 0, 0)), topic, received=0,
                        received_at=now + timedelta(minutes=5))
    assert db.read_snapshot()["quality"] == "CLOCK_SKEW"
    assert db.read_snapshot()["stale"]
    assert fleet.ingest(asdict(packet(1, .05, 10)), topic, received=.05, received_at=now)
    assert db.read_snapshot()["raw"]["seq"] == 1
    restarted = FleetTwin(example_calibrations(), database=db)
    assert restarted.robots["amr01"].last_seq == 1
    assert restarted.robots["amr01"].pose == fleet.robots["amr01"].pose
    with Session(db.engine) as session:
        assert session.get(WorkerCheckpoint, "amr01").seq == 1
    db.engine.dispose()


def test_v2_provisioning_seeds_checkpoint_without_deleting_history(tmp_path):
    url = "sqlite+pysqlite:///" + str(tmp_path / "v2.sqlite3")
    db = SensorDatabase(url, initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    for seq in range(2):
        assert fleet.ingest(asdict(packet(seq, seq * .05, seq * 10)),
                            "robot/amr01/state", received=seq * .05)
    with Session(db.engine) as session, session.begin():
        session.get(DatabaseVersion, 1).schema_version = 2
        session.delete(session.get(WorkerCheckpoint, "amr01"))
    db.engine.dispose()
    # Simulate the pre-v3 schema, which has no checkpoint table.
    WorkerCheckpoint.__table__.drop(db.engine)
    admin = SensorDatabase(url, initialize=True)
    admin.assert_schema_ready()
    restored = FleetTwin(example_calibrations(), database=admin)
    assert restored.robots["amr01"].pose[0] > 0
    with Session(admin.engine) as session:
        assert session.get(DatabaseVersion, 1).schema_version == 3
        assert session.get(WorkerCheckpoint, "amr01").seq == 1
        assert len(session.execute(select(SensorSample)).all()) == 2
    admin.engine.dispose()


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


def test_delayed_persistence_keeps_original_receive_time_and_stale_status(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "latency.sqlite3"), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    topic = "robot/amr01/state"
    received_at = datetime.now(timezone.utc) - timedelta(seconds=30)
    assert fleet.ingest(asdict(packet(0, 0, 0)), topic, received=0, received_at=received_at)
    assert fleet.ingest(asdict(packet(1, .05, 10)), topic, received=.05,
                        received_at=received_at + timedelta(seconds=.05))
    snapshot = db.read_snapshot()
    assert snapshot["quality"] == "STALE"
    assert snapshot["age_s"] >= 29
    assert snapshot["raw"] is None
    assert snapshot["derived"] == {}
    with Session(db.engine) as session:
        sample = session.get(SensorSample, ("amr01", "test-boot", 1))
        state = session.get(TwinState, ("amr01", "test-boot", 1))
        assert sample.received_at == state.received_at
        assert sample.received_at.replace(tzinfo=timezone.utc) == received_at + timedelta(seconds=.05)
    # Rejection evidence also retains receive time rather than the flush time.
    assert not fleet.ingest(b"invalid", topic, received=.1, received_at=received_at)
    assert datetime.fromisoformat(db.recent_quality_events()[0]["observed_at"]) == received_at
    db.engine.dispose()


def test_restart_restores_committed_totals_and_does_not_integrate_downtime(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "totals.sqlite3"), initialize=True)
    topic = "robot/amr01/state"
    first = FleetTwin(example_calibrations(), database=db)
    assert first.ingest(asdict(packet(0, 0, 0)), topic, received=0)
    assert first.ingest(asdict(packet(1, .05, 10)), topic, received=.05)
    original = first.robots["amr01"]
    second = FleetTwin(example_calibrations(), database=db)
    recovered = second.robots["amr01"]
    assert recovered.pose == original.pose
    assert recovered.soc == original.soc
    assert recovered.energy_wh == original.energy_wh
    assert recovered.previous is None
    assert recovered.last_received is None
    assert recovered.detector.duration_s == 0
    assert recovered.continuity_lost
    assert not second.ingest(asdict(packet(1, .05, 999)), topic, received=10)
    # First observation after restart anchors without fabricating missing work.
    assert second.ingest(asdict(packet(4, .2, 100)), topic, received=10)
    anchored = second.robots["amr01"]
    assert anchored.pose == original.pose
    assert anchored.soc == original.soc
    assert anchored.energy_wh == original.energy_wh
    assert anchored.quality == "ANCHOR_UNCERTAIN"
    assert not anchored.last_result
    assert second.ingest(asdict(packet(5, .25, 110)), topic, received=10.05)
    resumed = second.robots["amr01"]
    assert resumed.pose[0] == pytest.approx(original.pose[0] * 2)
    assert resumed.energy_wh == pytest.approx(original.energy_wh * 2)
    assert resumed.quality == "CONTINUITY_LOST"
    events = db.recent_quality_events()
    restart = [e for e in events if e["event_type"] == "worker_restart"]
    assert len(restart) == 1
    assert restart[0]["seq"] == 4
    assert restart[0]["details"] == {
        "previous_boot_id": "test-boot", "previous_seq": 1,
        "unobserved_interval_integrated": False,
    }
    assert next(e for e in events if e["event_type"] == "sequence_gap")["details"]["missing_packets"] == 2
    db.engine.dispose()


def test_restart_rejects_unseen_sequences_from_retired_boot_and_changed_calibration(tmp_path):
    from dataclasses import replace

    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "boots.sqlite3"), initialize=True)
    topic = "robot/amr01/state"
    fleet = FleetTwin(example_calibrations(), database=db)
    assert fleet.ingest(asdict(packet(0, 0, 0)), topic, received=0)
    assert fleet.ingest(asdict(packet(0, 0, 0, boot="new-boot")), topic, received=.1)
    restarted = FleetTwin(example_calibrations(), database=db)
    # This key was never persisted, so a mere unique-key check cannot reject it.
    assert not restarted.ingest(asdict(packet(99, .5, 999)), topic, received=1)
    assert restarted.robots["amr01"].active_boot == "new-boot"
    assert restarted.ingest(asdict(packet(1, .05, 10, boot="new-boot")), topic, received=1.05)
    changed = {"amr01": replace(example_calibrations()["amr01"], capacity_ah=3.0)}
    with pytest.raises(RuntimeError, match="calibration differs"):
        FleetTwin(changed, database=db)
    db.engine.dispose()


def test_failed_commit_leaves_checkpoint_and_restart_event_pending(tmp_path, monkeypatch):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "atomic.sqlite3"), initialize=True)
    topic = "robot/amr01/state"
    first = FleetTwin(example_calibrations(), database=db)
    assert first.ingest(asdict(packet(0, 0, 0)), topic, received=0)
    restarted = FleetTwin(example_calibrations(), database=db)
    persist = db.persist
    def failed(*args, **kwargs):
        raise RuntimeError("Injected commit failure")
    monkeypatch.setattr(db, "persist", failed)
    with pytest.raises(RuntimeError, match="Injected"):
        restarted.ingest(asdict(packet(1, .05, 10)), topic, received=1)
    assert restarted.robots["amr01"].restart_pending
    assert restarted.robots["amr01"].last_seq == 0
    assert db.recent_quality_events() == []
    monkeypatch.setattr(db, "persist", persist)
    assert restarted.ingest(asdict(packet(1, .05, 10)), topic, received=1)
    assert len(db.recent_quality_events()) == 1
    assert not restarted.robots["amr01"].restart_pending
    db.engine.dispose()


def test_checkpoint_raw_state_and_events_rollback_together(tmp_path):
    from sqlalchemy import event

    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "rollback.sqlite3"), initialize=True)
    topic = "robot/amr01/state"
    fleet = FleetTwin(example_calibrations(), database=db)
    assert fleet.ingest(asdict(packet(0, 0, 0)), topic, received=0)
    restarted = FleetTwin(example_calibrations(), database=db)

    def refuse_commit(session):
        raise RuntimeError("Injected failure after checkpoint update")

    event.listen(Session, "before_commit", refuse_commit)
    try:
        with pytest.raises(RuntimeError, match="after checkpoint"):
            restarted.ingest(asdict(packet(1, .05, 10)), topic, received=1)
    finally:
        event.remove(Session, "before_commit", refuse_commit)
    with Session(db.engine) as session:
        assert session.get(WorkerCheckpoint, "amr01").seq == 0
        assert session.get(SensorSample, ("amr01", "test-boot", 1)) is None
        assert session.get(TwinState, ("amr01", "test-boot", 1)) is None
        assert session.execute(select(PipelineEvent)).first() is None
    assert restarted.robots["amr01"].last_seq == 0
    assert restarted.robots["amr01"].restart_pending
    assert restarted.ingest(asdict(packet(1, .05, 10)), topic, received=1)
    db.engine.dispose()


def test_missing_checkpoint_cannot_silently_start_a_new_trial(tmp_path):
    db = SensorDatabase("sqlite+pysqlite:///" + str(tmp_path / "missing.sqlite3"), initialize=True)
    fleet = FleetTwin(example_calibrations(), database=db)
    assert fleet.ingest(asdict(packet(0, 0, 0)), "robot/amr01/state", received=0)
    with Session(db.engine) as session, session.begin():
        session.delete(session.get(WorkerCheckpoint, "amr01"))
    with pytest.raises(RuntimeError, match="Missing committed"):
        FleetTwin(example_calibrations(), database=db)
    with pytest.raises(RuntimeError, match="Missing committed"):
        db.read_snapshot()
    db.engine.dispose()
