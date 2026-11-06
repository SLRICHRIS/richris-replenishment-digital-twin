"""SQLite state snapshots and immutable per-run event audit trail."""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Callable
from . import simulation as engine

DB_PATH = os.getenv("TWIN_DB_PATH", str(Path(__file__).resolve().parent.parent / "data" / "twin.sqlite3"))


class ManagedConnection(sqlite3.Connection):
    """Commit/rollback and close the SQLite connection on exiting a with-block."""
    def __exit__(self, exception_type, exception, traceback):
        try:
            return super().__exit__(exception_type, exception, traceback)
        finally:
            self.close()


def connection() -> sqlite3.Connection:
    path = Path(DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=15, isolation_level=None, factory=ManagedConnection)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=15000")
    con.execute("PRAGMA journal_mode=WAL")
    return con


def initialize() -> None:
    with connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS active_run (
          id INTEGER PRIMARY KEY CHECK (id=1), run_id TEXT NOT NULL,
          revision INTEGER NOT NULL, snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
          seq INTEGER NOT NULL, simulation_time REAL NOT NULL,
          event_type TEXT NOT NULL, message TEXT NOT NULL, payload TEXT NOT NULL,
          logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(run_id,seq));
        CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id,seq);
        CREATE TABLE IF NOT EXISTS archived_runs (
          run_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, snapshot TEXT NOT NULL,
          archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS measured_task_times (
          id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
          task_id TEXT NOT NULL, observed_seconds REAL NOT NULL,
          source TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(run_id,task_id));
        CREATE TABLE IF NOT EXISTS telemetry (
          id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
          device_id TEXT NOT NULL, device_seq INTEGER NOT NULL,
          reported_at TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          firmware TEXT, payload TEXT NOT NULL, disposition TEXT NOT NULL,
          UNIQUE(run_id,device_id,device_seq));
        """)
        row = db.execute("SELECT id FROM active_run WHERE id=1").fetchone()
        if row is None:
            state, logs = engine.new_state()
            run_id = uuid.uuid4().hex
            db.execute("INSERT INTO active_run(id,run_id,revision,snapshot) VALUES (1,?,?,?)", (run_id, 1, json.dumps(state)))
            _insert_events(db, run_id, logs)


def _insert_events(db: sqlite3.Connection, run_id: str, logs: list[dict]) -> None:
    prev = db.execute("SELECT COALESCE(MAX(seq),0) FROM events WHERE run_id=?", (run_id,)).fetchone()[0]
    for offset, log in enumerate(logs, start=1):
        db.execute("INSERT INTO events(run_id,seq,simulation_time,event_type,message,payload) VALUES (?,?,?,?,?,?)",
                   (run_id, prev + offset, log["time"], log["kind"], log["message"], json.dumps(log["details"])))


def read_state() -> dict:
    initialize()
    with connection() as db:
        row = db.execute("SELECT run_id,revision,snapshot FROM active_run WHERE id=1").fetchone()
        state = json.loads(row["snapshot"])
        return {"run_id": row["run_id"], "revision": row["revision"], "state": state,
                "metrics": engine.metrics(state), "conservation": engine.conservation(state)}


def mutate(func: Callable[[dict], list[dict]]) -> dict:
    initialize()
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            row = db.execute("SELECT run_id,revision,snapshot FROM active_run WHERE id=1").fetchone()
            state = json.loads(row["snapshot"])
            logs = func(state)
            engine.assert_invariants(state)
            revision = row["revision"] + 1
            db.execute("UPDATE active_run SET revision=?,snapshot=? WHERE id=1", (revision, json.dumps(state)))
            _insert_events(db, row["run_id"], logs)
            db.execute("COMMIT")
            return {"run_id": row["run_id"], "revision": revision, "state": state,
                    "metrics": engine.metrics(state), "conservation": engine.conservation(state), "new_events": logs}
        except Exception:
            db.execute("ROLLBACK")
            raise


def reset(policy: str = "fifo", blocked: list[str] | None = None, parameters: dict | None = None) -> dict:
    state, logs = engine.new_state(policy, blocked, parameters)
    initialize()
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            old = db.execute("SELECT run_id,revision,snapshot FROM active_run WHERE id=1").fetchone()
            db.execute("INSERT OR IGNORE INTO archived_runs(run_id,revision,snapshot) VALUES (?,?,?)",
                       (old["run_id"], old["revision"], old["snapshot"]))
            run_id = uuid.uuid4().hex
            db.execute("UPDATE active_run SET run_id=?,revision=1,snapshot=? WHERE id=1", (run_id, json.dumps(state)))
            _insert_events(db, run_id, logs)
            db.execute("COMMIT")
            return {"run_id": run_id, "revision": 1, "state": state,
                    "metrics": engine.metrics(state), "conservation": engine.conservation(state), "new_events": logs}
        except Exception:
            db.execute("ROLLBACK")
            raise


def get_events(limit: int = 200) -> list[dict]:
    initialize()
    with connection() as db:
        run_id = db.execute("SELECT run_id FROM active_run WHERE id=1").fetchone()[0]
        rows = db.execute("SELECT seq,simulation_time,event_type,message,payload,logged_at FROM events WHERE run_id=? ORDER BY seq DESC LIMIT ?", (run_id, limit)).fetchall()
        return [{"seq": r["seq"], "time": r["simulation_time"], "kind": r["event_type"],
                 "message": r["message"], "details": json.loads(r["payload"]), "recorded_at": r["logged_at"]} for r in reversed(rows)]


def save_telemetry(payload: dict) -> dict:
    initialize()
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            run_id = db.execute("SELECT run_id FROM active_run WHERE id=1").fetchone()[0]
            firmware = payload.get("firmware") or payload.get("firmware_version")
            cur = db.execute("INSERT OR IGNORE INTO telemetry(run_id,device_id,device_seq,reported_at,firmware,payload,disposition) VALUES (?,?,?,?,?,?,?)",
                             (run_id, payload["device_id"], payload["seq"], payload["timestamp"], firmware, json.dumps(payload), "QUARANTINED_UNCALIBRATED"))
            created = cur.rowcount == 1
            db.execute("COMMIT")
            return {"accepted": True, "duplicate": not created, "disposition": "QUARANTINED_UNCALIBRATED",
                    "explanation": "Persisted separately. Does not change simulated robot position or inventory."}
        except Exception:
            db.execute("ROLLBACK")
            raise


def recent_telemetry(limit: int = 50) -> list[dict]:
    initialize()
    with connection() as db:
        run_id = db.execute("SELECT run_id FROM active_run WHERE id=1").fetchone()[0]
        rows = db.execute("SELECT id,device_id,device_seq,reported_at,received_at,firmware,payload,disposition FROM telemetry WHERE run_id=? ORDER BY id DESC LIMIT ?", (run_id,limit)).fetchall()
        return [{"id": r["id"], "device_id": r["device_id"], "seq": r["device_seq"],
                 "timestamp": r["reported_at"], "received_at": r["received_at"], "firmware": r["firmware"],
                 "disposition": r["disposition"], "payload": json.loads(r["payload"])} for r in rows]


def save_measurement(task_id: str, observed_seconds: float, source: str) -> dict:
    initialize()
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            row = db.execute("SELECT run_id,snapshot FROM active_run WHERE id=1").fetchone()
            state = json.loads(row["snapshot"])
            task = state["tasks"].get(task_id)
            if not task or task["status"] != "completed":
                raise ValueError("A completed task from the active run is required")
            simulated = task["delivered_at"] - task["assigned_at"]
            db.execute("INSERT INTO measured_task_times(run_id,task_id,observed_seconds,source) VALUES (?,?,?,?) "
                       "ON CONFLICT(run_id,task_id) DO UPDATE SET observed_seconds=excluded.observed_seconds,source=excluded.source",
                       (row["run_id"],task_id,observed_seconds,source))
            db.execute("COMMIT")
            return {"task_id":task_id,"simulated_seconds":round(simulated,3),"observed_seconds":observed_seconds,
                    "absolute_error_seconds":round(abs(observed_seconds-simulated),3),
                    "status":"SELF_REPORTED_OBSERVATION_NOT_INDEPENDENTLY_VERIFIED"}
        except Exception:
            db.execute("ROLLBACK")
            raise


def measurement_report() -> dict:
    initialize()
    with connection() as db:
        row = db.execute("SELECT run_id,snapshot FROM active_run WHERE id=1").fetchone()
        state = json.loads(row["snapshot"])
        rows = db.execute("SELECT task_id,observed_seconds,source FROM measured_task_times WHERE run_id=? ORDER BY task_id",(row["run_id"],)).fetchall()
        pairs = []
        for r in rows:
            task = state["tasks"].get(r["task_id"])
            if not task or task["status"]!="completed":
                continue
            predicted = task["delivered_at"]-task["assigned_at"]
            pairs.append({"task_id":r["task_id"],"simulated_seconds":round(predicted,3),
                          "observed_seconds":r["observed_seconds"],"source":r["source"],
                          "absolute_error_seconds":round(abs(predicted-r["observed_seconds"]),3)})
        n=len(pairs)
        mae=sum(x["absolute_error_seconds"] for x in pairs)/n if n else None
        rmse=(sum((x["simulated_seconds"]-x["observed_seconds"])**2 for x in pairs)/n)**.5 if n else None
        return {"count":n,"mae_seconds":round(mae,3) if mae is not None else None,
                "rmse_seconds":round(rmse,3) if rmse is not None else None,"pairs":pairs,
                "warning":"Entries are self-reported. An externally controlled held-out experiment is required for credible physical validation."}
