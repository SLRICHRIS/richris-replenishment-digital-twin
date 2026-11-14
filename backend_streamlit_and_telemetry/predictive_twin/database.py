"""Durable, structured AMR-01 sensor observations and derived states.

The ingestion worker is the only writer. The Streamlit app opens read-only
connections. No synthetic data are ever written into the physical trial tables.
"""
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, Float, ForeignKeyConstraint,
    Index, Integer, JSON, String, create_engine, inspect, select, text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.exc import SQLAlchemyError


class Base(DeclarativeBase):
    pass


class CalibrationRecord(Base):
    __tablename__ = "amr_calibrations"

    fingerprint: Mapped[str] = mapped_column(String(64), primary_key=True)
    robot_id: Mapped[str] = mapped_column(String(16), nullable=False)
    parameters: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SensorSample(Base):
    __tablename__ = "amr_sensor_samples"

    robot_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    boot_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sample_time_s: Mapped[float] = mapped_column(Float, nullable=False)
    encoder_left_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    encoder_right_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    gyro_z_rad_s: Mapped[float] = mapped_column(Float, nullable=False)
    battery_voltage_v: Mapped[float] = mapped_column(Float, nullable=False)
    battery_current_a: Mapped[float] = mapped_column(Float, nullable=False)
    robot_state: Mapped[str] = mapped_column(String(64), nullable=False)
    calibration_fingerprint: Mapped[str] = mapped_column(
        String(64), nullable=False
    )

    __table_args__ = (
        ForeignKeyConstraint(["calibration_fingerprint"], ["amr_calibrations.fingerprint"]),
        Index("ix_amr_samples_received", "robot_id", "received_at"),
        CheckConstraint("schema_version = 2", name="ck_amr_schema_v2"),
        CheckConstraint("sample_time_s >= 0", name="ck_amr_nonnegative_sample_time"),
        CheckConstraint("battery_voltage_v > 0", name="ck_amr_positive_battery_voltage"),
    )


class TwinState(Base):
    __tablename__ = "amr_twin_states"

    robot_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    boot_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sample_time_s: Mapped[float] = mapped_column(Float, nullable=False)
    quality: Mapped[str] = mapped_column(String(32), nullable=False)
    continuity_lost: Mapped[bool] = mapped_column(Boolean, nullable=False)
    x_m: Mapped[float] = mapped_column(Float, nullable=False)
    y_m: Mapped[float] = mapped_column(Float, nullable=False)
    theta_rad: Mapped[float] = mapped_column(Float, nullable=False)
    soc_fraction: Mapped[float] = mapped_column(Float, nullable=False)
    energy_wh: Mapped[float] = mapped_column(Float, nullable=False)
    derived: Mapped[dict] = mapped_column(JSON, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["robot_id", "boot_id", "seq"],
            ["amr_sensor_samples.robot_id", "amr_sensor_samples.boot_id", "amr_sensor_samples.seq"],
        ),
        Index("ix_amr_states_received", "robot_id", "received_at"),
    )



class PipelineEvent(Base):
    """Sparse quality-event ledger; no duplicate raw sensor observations."""
    __tablename__ = "amr_pipeline_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    robot_id: Mapped[str] = mapped_column(String(16), nullable=False)
    boot_id: Mapped[str] = mapped_column(String(64), nullable=False)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, nullable=False)

    __table_args__ = (
        Index("ix_amr_pipeline_events_robot_time", "robot_id", "observed_at"),
    )


# Views show individual sensor attributes but require no extra writes at 20 Hz.
# There is one authoritative append-only measurement table with typed columns.
SENSOR_VIEWS = {
    "amr_encoder_readings": (
        "SELECT robot_id, boot_id, seq, sample_time_s, received_at, "
        "encoder_left_count, encoder_right_count, calibration_fingerprint "
        "FROM amr_sensor_samples"
    ),
    "amr_imu_readings": (
        "SELECT robot_id, boot_id, seq, sample_time_s, received_at, "
        "gyro_z_rad_s, calibration_fingerprint FROM amr_sensor_samples"
    ),
    "amr_ina219_readings": (
        "SELECT robot_id, boot_id, seq, sample_time_s, received_at, "
        "battery_voltage_v, battery_current_a, calibration_fingerprint "
        "FROM amr_sensor_samples"
    ),
}

class DatabaseVersion(Base):
    __tablename__ = "amr_database_version"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)


def calibration_fingerprint(calibration):
    data = json.dumps(asdict(calibration), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def utc_aware(value):
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)  # SQLite returns naive UTC
    return value.astimezone(timezone.utc)


class SensorDatabase:
    """SQLAlchemy store: PostgreSQL in deployment; SQLite for isolated tests.

    initialize=True is reserved for the ingestion worker/provisioning.
    The Streamlit read path must set initialize=False.
    """

    def __init__(self, url, initialize=False):
        if not isinstance(url, str) or not url:
            raise ValueError("Database URL must be configured privately")
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        if not url.startswith(("postgresql+psycopg://", "sqlite+pysqlite://", "sqlite://")):
            raise ValueError("Only PostgreSQL and local test SQLite URLs are supported")
        self.engine = create_engine(url, pool_pre_ping=True)
        if initialize:
            Base.metadata.create_all(self.engine)
            # Additive migration: never delete or rewrite older physical samples.
            with self.engine.begin() as connection:
                existing_views = set(inspect(connection).get_view_names())
                for name, query in SENSOR_VIEWS.items():
                    if name not in existing_views:
                        connection.execute(text(f"CREATE VIEW {name} AS {query}"))
            with Session(self.engine) as session, session.begin():
                version = session.get(DatabaseVersion, 1)
                if version is None:
                    session.add(DatabaseVersion(id=1, schema_version=2))
                elif version.schema_version == 1:
                    version.schema_version = 2
                elif version.schema_version != 2:
                    raise RuntimeError("Unknown database schema version; apply a reviewed migration")
        self.healthcheck()

    def assert_schema_ready(self):
        """Worker-side read-only schema check, never DDL at runtime."""
        try:
            with Session(self.engine) as session:
                version = session.get(DatabaseVersion, 1)
                if version is None or version.schema_version != 2:
                    raise RuntimeError(
                        "Sensor database schema v2 not provisioned; run admin provisioning first"
                    )
            available_views = set(inspect(self.engine).get_view_names())
        except SQLAlchemyError as error:
            # Database URLs and SQL driver diagnostics are never returned to UI.
            raise RuntimeError("Physical sensor schema is not provisioned or readable") from error
        if set(SENSOR_VIEWS).difference(available_views):
            raise RuntimeError("Missing required physical-sensor database views")

    def acquire_worker_lease(self):
        """Hold one PostgreSQL advisory lock for the sole AMR-01 writer.

        The lock connection must stay checked out while ingesting telemetry.
        Reader clients should never acquire this lock.
        """
        if hasattr(self, "_lease_conn") and self._lease_conn is not None:
            raise RuntimeError("Worker lease already acquired")
        if self.engine.dialect.name != "postgresql":
            # Test-only SQLite has no PostgreSQL advisory locks.
            return
        conn = self.engine.connect()
        try:
            acquired = conn.execute(
                text("SELECT pg_try_advisory_lock(:id)"), {"id": 19031901}
            ).scalar_one()
            if not acquired:
                raise RuntimeError("Another AMR-01 ingestion worker holds the PostgreSQL lease")
        except Exception:
            conn.close()
            raise
        self._lease_conn = conn

    def release_worker_lease(self):
        conn = getattr(self, "_lease_conn", None)
        if conn is not None:
            try:
                conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": 19031901})
            finally:
                conn.close()
                self._lease_conn = None

    def healthcheck(self):
        with self.engine.connect() as conn:
            conn.execute(text("SELECT 1"))

    def persist(self, packet, robot, quality_events=()):
        """Atomically store one admitted packet plus the state produced from it.

        A duplicate (robot, boot, seq) returns False and is never integrated.
        SQL/database failures propagate; caller must not publish the candidate.
        """
        stamp = datetime.now(timezone.utc)
        fp = calibration_fingerprint(robot.calibration)
        data = asdict(packet)
        with Session(self.engine) as session, session.begin():
            key = (packet.robot_id, packet.boot_id, packet.seq)
            if session.get(SensorSample, key) is not None:
                return False
            if session.get(CalibrationRecord, fp) is None:
                session.add(CalibrationRecord(
                    fingerprint=fp, robot_id=packet.robot_id,
                    parameters=asdict(robot.calibration), created_at=stamp
                ))
                session.flush()
            session.add(SensorSample(
                **data, received_at=stamp, calibration_fingerprint=fp
            ))
            for event in quality_events:
                if event["event_type"] not in {"sequence_gap", "time_gap", "reboot"}:
                    raise ValueError("Invalid quality event")
                session.add(PipelineEvent(
                    robot_id=packet.robot_id, boot_id=packet.boot_id,
                    seq=packet.seq, observed_at=stamp,
                    event_type=event["event_type"], details=event["details"],
                ))
            session.add(TwinState(
                robot_id=packet.robot_id, boot_id=packet.boot_id,
                seq=packet.seq, received_at=stamp,
                sample_time_s=packet.sample_time_s,
                quality=robot.quality, continuity_lost=robot.continuity_lost,
                x_m=robot.pose[0], y_m=robot.pose[1], theta_rad=robot.pose[2],
                soc_fraction=robot.soc, energy_wh=robot.energy_wh,
                derived=dict(robot.last_result),
            ))
        return True

    def record_rejected_packet(self, reason, topic):
        """Audit rejected AMR-01 source data without storing untrusted payloads."""
        if reason not in {"invalid_schema", "retained_message"}:
            raise ValueError("Unknown packet rejection category")
        if topic != "robot/amr01/state":
            return
        with Session(self.engine) as session, session.begin():
            session.add(PipelineEvent(
                robot_id="amr01", boot_id="", seq=-1,
                observed_at=datetime.now(timezone.utc),
                event_type=reason, details={"topic": topic},
            ))

    def recent_quality_events(self, robot_id="amr01", limit=20):
        """Read bounded, durable evidence of gaps/reboots for operators."""
        if robot_id != "amr01" or not 1 <= limit <= 100:
            raise ValueError("Only AMR-01 and bounded event history are supported")
        with Session(self.engine) as session:
            events = session.execute(
                select(PipelineEvent)
                .where(PipelineEvent.robot_id == robot_id)
                .order_by(PipelineEvent.id.desc()).limit(limit)
            ).scalars().all()
            return [
                dict(event_type=e.event_type, boot_id=e.boot_id, seq=e.seq,
                     observed_at=utc_aware(e.observed_at).isoformat(),
                     details=e.details)
                for e in events
            ]

    def read_snapshot(self, robot_id="amr01", stale_after_s=2.0, expected_fingerprint=None):
        """Read a complete stored snapshot. No robot state is inferred in browser."""
        if robot_id != "amr01" or stale_after_s <= 0:
            raise ValueError("Only AMR-01 and positive freshness windows are supported")
        with Session(self.engine) as session:
            latest = session.execute(
                select(SensorSample, TwinState).join(
                    TwinState,
                    (SensorSample.robot_id == TwinState.robot_id)
                    & (SensorSample.boot_id == TwinState.boot_id)
                    & (SensorSample.seq == TwinState.seq),
                ).where(SensorSample.robot_id == robot_id)
                .order_by(SensorSample.received_at.desc(), SensorSample.seq.desc()).limit(1)
            ).first()
            if latest is None:
                return dict(
                    pose=(0., 0., 0.), soc=None, energy_wh=None, quality="NO_DATA",
                    age_s=None, stale=True, continuity_lost=False,
                    invalid_packets=0, ignored_packets=0, raw=None, derived={},
                    history=[], calibration_match=None, pipeline_events=[],
                )
            sample, state = latest
            age_s = max(0.0, (datetime.now(timezone.utc) - utc_aware(sample.received_at)).total_seconds())
            calibration_match = (
                expected_fingerprint is None or
                expected_fingerprint == sample.calibration_fingerprint
            )
            stale = age_s > stale_after_s
            result = session.execute(
                select(TwinState).where(
                    TwinState.robot_id == robot_id,
                    TwinState.boot_id == sample.boot_id,
                ).order_by(TwinState.received_at.desc(), TwinState.seq.desc()).limit(1200)
            ).scalars().all()
            history = [
                dict(sample_time_s=s.sample_time_s, x_m=s.x_m, y_m=s.y_m,
                     theta_rad=s.theta_rad, soc=s.soc_fraction, energy_wh=s.energy_wh,
                     **s.derived)
                for s in reversed(result) if s.derived
            ]
            events = session.execute(
                select(PipelineEvent)
                .where(PipelineEvent.robot_id == robot_id)
                .order_by(PipelineEvent.id.desc())
                .limit(10)
            ).scalars().all()
            pipeline_events = [
                dict(event_type=e.event_type, boot_id=e.boot_id, seq=e.seq,
                     observed_at=utc_aware(e.observed_at).isoformat(), details=e.details)
                for e in events
            ]
            raw = {
                field: getattr(sample, field) for field in (
                    "robot_id", "boot_id", "seq", "schema_version", "sample_time_s",
                    "encoder_left_count", "encoder_right_count", "gyro_z_rad_s",
                    "battery_voltage_v", "battery_current_a", "robot_state"
                )
            } if not stale else None
            return dict(
                pose=(state.x_m, state.y_m, state.theta_rad), soc=state.soc_fraction,
                energy_wh=state.energy_wh,
                quality=("STALE" if stale else
                         "CALIBRATION_MISMATCH" if not calibration_match else state.quality),
                age_s=age_s, stale=stale or not calibration_match,
                continuity_lost=state.continuity_lost,
                invalid_packets=0, ignored_packets=0, raw=raw,
                derived={} if stale or not calibration_match else dict(state.derived),
                history=history, calibration_match=calibration_match,
                pipeline_events=pipeline_events,
            )
