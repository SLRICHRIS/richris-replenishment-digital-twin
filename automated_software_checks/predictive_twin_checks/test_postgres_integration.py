"""Exercise actual PostgreSQL 16 wire protocol and relational DDL in CI."""
import os
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from backend_streamlit_and_telemetry.predictive_twin.database import (
    CalibrationRecord, SensorDatabase, SensorSample, TwinState, WorkerCheckpoint,
)
from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
from backend_streamlit_and_telemetry.predictive_twin.telemetry import FleetTwin, Packet


@pytest.mark.skipif(not os.getenv("TEST_POSTGRES_URL"), reason="PostgreSQL test service not configured")
def test_real_postgres_raw_and_derived_roundtrip():
    url = os.environ["TEST_POSTGRES_URL"]
    db = SensorDatabase(url, initialize=True)
    with db.engine.begin() as conn:
        # Dedicated isolated database from GitHub Actions; no production credentials.
        conn.execute(WorkerCheckpoint.__table__.delete())
        conn.execute(TwinState.__table__.delete())
        conn.execute(SensorSample.__table__.delete())
        conn.execute(CalibrationRecord.__table__.delete())
    fleet = FleetTwin(example_calibrations(), database=db)
    topic = "robot/amr01/state"
    first = asdict(Packet("amr01", "ci-postgres", 0, 0.0, 0, 0, .01, 7.4, .6, "standby"))
    second = asdict(Packet("amr01", "ci-postgres", 1, .05, 10, 10, .01, 7.4, .6, "standby"))
    stamp = datetime.now(timezone.utc) - timedelta(seconds=30)
    assert fleet.ingest(first, topic, received=0, received_at=stamp)
    assert fleet.ingest(second, topic, received=.05, received_at=stamp + timedelta(seconds=.05))
    assert not fleet.ingest(second, topic, received=.05)
    snapshot = db.read_snapshot(stale_after_s=60)
    assert snapshot["quality"] == "OK"
    assert snapshot["raw"]["encoder_left_count"] == 10
    assert snapshot["derived"]["v_left_m_s"] > 0
    assert snapshot["soc"] < .9
    # The operator's bounded table browser reads PostgreSQL views and JSON
    # without depending on calibration confirmation or a fresh live snapshot.
    db.assert_schema_ready()
    records = db.read_records('amr_encoder_readings', limit=1)
    assert len(records) == 1
    assert records[0]['seq'] == 1
    assert records[0]['encoder_left_count'] == 10
    assert db.read_records('amr_twin_states', limit=1)[0]['derived']['v_left_m_s'] > 0
    with db.engine.connect() as conn:
        encoder = conn.execute(
            select(SensorSample.encoder_left_count).where(SensorSample.seq == 1)
        ).scalar_one()
        view_encoder = conn.exec_driver_sql(
            "SELECT encoder_left_count FROM amr_encoder_readings "
            "WHERE robot_id='amr01' AND boot_id='ci-postgres' AND seq=1"
        ).scalar_one()
        gyro = conn.exec_driver_sql(
            "SELECT gyro_z_rad_s FROM amr_imu_readings "
            "WHERE robot_id='amr01' AND boot_id='ci-postgres' AND seq=1"
        ).scalar_one()
        current = conn.exec_driver_sql(
            "SELECT battery_current_a FROM amr_ina219_readings "
            "WHERE robot_id='amr01' AND boot_id='ci-postgres' AND seq=1"
        ).scalar_one()
        assert encoder == view_encoder == 10
        assert gyro == pytest.approx(.01)
        assert current == pytest.approx(.6)
        assert len(conn.execute(select(SensorSample.robot_id)).all()) == 2
        assert len(conn.execute(select(TwinState.robot_id)).all()) == 2
        assert conn.execute(select(WorkerCheckpoint.seq)).scalar_one() == 1
    assert db.read_snapshot()["quality"] == "STALE"
    restarted = FleetTwin(example_calibrations(), database=db)
    assert restarted.robots["amr01"].pose == fleet.robots["amr01"].pose
    assert restarted.robots["amr01"].soc == fleet.robots["amr01"].soc
    assert not restarted.ingest(second, topic, received=1)
    third = dict(second, seq=2, sample_time_s=.1, encoder_left_count=100, encoder_right_count=100)
    assert restarted.ingest(third, topic, received=1.05,
                            received_at=stamp + timedelta(seconds=.1))
    assert restarted.robots["amr01"].pose == fleet.robots["amr01"].pose
    assert restarted.robots["amr01"].quality == "ANCHOR_UNCERTAIN"
    assert any(e["event_type"] == "worker_restart" for e in db.recent_quality_events())
    db.engine.dispose()

@pytest.mark.skipif(not os.getenv("TEST_POSTGRES_URL"), reason="PostgreSQL test service not configured")
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


@pytest.mark.skipif(not os.getenv('TEST_POSTGRES_URL'), reason='PostgreSQL test service not configured')
def test_postgresql_review_serializes_competing_operators():
    from concurrent.futures import ThreadPoolExecutor
    from backend_streamlit_and_telemetry.predictive_twin.human_review import metadata, reviews, ReviewCoordinator
    from backend_streamlit_and_telemetry.predictive_twin.workspace_payload import workspace_payload
    db=SensorDatabase(os.environ['TEST_POSTGRES_URL'], initialize=False)
    metadata.create_all(db.engine)
    with db.engine.begin() as c:
        c.execute(reviews.delete())  # Dedicated CI database only.
    first=ReviewCoordinator(db.engine, source='demo')
    second=ReviewCoordinator(db.engine, source='demo')
    payload=workspace_payload('demo','turning')
    def create(args):
        service,rid=args
        try:
            return service.create(payload,rid)['state']
        except ValueError:
            return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes=list(pool.map(create,[(first,'a'*32),(second,'b'*32)]))
    assert sorted(outcomes)==['conflict','pending']
    assert len(first.history())==1
    db.engine.dispose()


@pytest.mark.skipif(not os.getenv('TEST_POSTGRES_URL'), reason='PostgreSQL test service not configured')
def test_website_service_owns_and_releases_review_process_lease():
    from backend_streamlit_and_telemetry.predictive_twin.human_review import metadata
    from backend_streamlit_and_telemetry.predictive_twin.intervention_service import WebsiteReviewService
    from backend_streamlit_and_telemetry.predictive_twin.amr_connection import ConnectionProfile
    db=SensorDatabase(os.environ['TEST_POSTGRES_URL'], initialize=True)
    metadata.create_all(db.engine)
    profile=ConnectionProfile('unused-broker','subscriber','unused',os.environ['TEST_POSTGRES_URL'],'private-ci-code'*3,example_calibrations()['amr01'])
    first=WebsiteReviewService(profile)
    try:
        first._assert_owner()
        assert first.transport is None and not first.coordinator.commands_enabled
        with pytest.raises(RuntimeError,match='Another website review service'):
            WebsiteReviewService(profile)
        # A competing constructor's cleanup must not release the first owner.
        first._assert_owner()
    finally:
        first.close()
    second=WebsiteReviewService(profile)
    try:
        second._assert_owner()
        with pytest.raises(RuntimeError):first.create('c'*32)
    finally:
        second.close()
        db.engine.dispose()


@pytest.mark.skipif(not os.getenv('TEST_POSTGRES_URL'), reason='PostgreSQL test service not configured')
def test_route_audit_does_not_inherit_sensor_read_access():
    """Dedicated CI database: exercise exact SQL, privileges and runtime role gate."""
    from pathlib import Path
    from unittest.mock import patch
    from sqlalchemy import create_engine, text
    from backend_streamlit_and_telemetry.vision_control.service import Service
    from sqlalchemy.engine import make_url
    engine=create_engine(os.environ['TEST_POSTGRES_URL'])
    migration=(Path(__file__).resolve().parents[2]/'backend_streamlit_and_telemetry/vision_control/route_audit.sql').read_text()
    try:
        with engine.begin() as c:
            for role in ('amr_reader','amr_worker'):
                if not c.exec_driver_sql("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='"+role+"')").scalar_one():
                    c.exec_driver_sql('CREATE ROLE '+role+' NOLOGIN')
            # Reproduce this account's real defaults: newly created tables would
            # otherwise expose free-text operator reasons to both sensor roles.
            c.exec_driver_sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO amr_reader,amr_worker')
            c.exec_driver_sql(migration)
            c.exec_driver_sql(migration)  # Re-running preserves the restriction.
            for role in ('amr_reader','amr_worker'):
                assert not c.execute(text("SELECT has_table_privilege(:role,'public.amr_route_reviews','SELECT')"),dict(role=role)).scalar_one()
            can_login=c.exec_driver_sql("SELECT rolcanlogin FROM pg_roles WHERE rolname='amr_route_coordinator'").scalar_one()
            assert can_login is False
            for privilege in ('SELECT','INSERT','UPDATE'):
                assert c.execute(text("SELECT has_table_privilege('amr_route_coordinator','public.amr_route_reviews',:p)"),dict(p=privilege)).scalar_one()
            for privilege in ('DELETE','TRUNCATE','REFERENCES','TRIGGER'):
                assert not c.execute(text("SELECT has_table_privilege('amr_route_coordinator','public.amr_route_reviews',:p)"),dict(p=privilege)).scalar_one()
        # Reject the broad CI administrator before any broker client is created.
        with patch('paho.mqtt.client.Client') as client:
            with pytest.raises(ValueError,match='restricted route audit role'):
                Service(dict(audit_url=os.environ['TEST_POSTGRES_URL']))
            client.assert_not_called()
        # Activate only inside this disposable CI database, using a test-only
        # password. Production provisioning never creates or activates a login.
        with engine.begin() as c:
            c.exec_driver_sql("ALTER ROLE amr_route_coordinator LOGIN PASSWORD 'route-ci-only'")
        url=make_url(os.environ['TEST_POSTGRES_URL']).set(username='amr_route_coordinator',password='route-ci-only').render_as_string(hide_password=False)
        profile=dict(audit_url=url,mqtt_username='ci-only',mqtt_password='ci-only',mqtt_host='example.invalid',control_key='a'*64)
        with patch('paho.mqtt.client.Client') as client:
            service=Service(profile)
            try:
                service.assert_owner()
                client.return_value.connect_async.assert_called_once()
                assert not service.coordinator.connected
            finally:
                service.close()
    finally:
        with engine.begin() as c:
            c.exec_driver_sql('ALTER ROLE amr_route_coordinator NOLOGIN PASSWORD NULL')
        engine.dispose()
