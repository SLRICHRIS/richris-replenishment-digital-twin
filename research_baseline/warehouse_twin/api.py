"""REST + WebSocket gateway for the replenishment research model.

Run locally. No production authorization is implemented for administrative commands.
"""
from __future__ import annotations
import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Header, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict, field_validator
from . import simulation as engine, database as store

ROOT = Path(__file__).resolve().parent.parent

@asynccontextmanager
async def lifespan(app: FastAPI):
    store.initialize()
    yield

app = FastAPI(title="Warehouse Replenishment Digital Model", version="1.0.0", lifespan=lifespan,
              description="Persistent, event-driven research prototype. Physical synchronization has not been validated.")
app.mount("/assets", StaticFiles(directory=ROOT / "web"), name="assets")

class ResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    policy: str = "fifo"
    blocked: list[str] = Field(default_factory=list)
    speed_units_per_second: float = Field(default=.42, ge=.05, le=10)
    load_seconds: float = Field(default=4, ge=0, le=60)
    unload_seconds: float = Field(default=3, ge=0, le=60)

class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    until: float = Field(default=120.0, ge=0, le=1440)
    max_steps: int = Field(default=250, ge=1, le=5000)

class BlockRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node: str
    blocked: bool

class TelemetryRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    device_id: str = Field(min_length=2, max_length=64)
    seq: int = Field(ge=0)
    timestamp: datetime
    firmware: str | None = Field(default=None, max_length=100)
    x: float | None = None
    y: float | None = None
    battery_pct: float | None = Field(default=None, ge=0, le=100)

    @field_validator("timestamp")
    @classmethod
    def timezone_required(cls, value: datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must include a UTC offset")
        return value

    @field_validator("device_id")
    @classmethod
    def no_whitespace(cls, value: str):
        if value.strip() != value or not value:
            raise ValueError("device_id must be non-empty and trimmed")
        return value

class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    blocked: list[str] | None = None
    until: float = Field(default=120.0, ge=0, le=1440)

class MeasurementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_id: str
    observed_seconds: float = Field(gt=0, le=36000)
    source: str = Field(min_length=3, max_length=200)

class LiveChannels:
    def __init__(self):
        self.connections: list[WebSocket] = []

    async def broadcast(self, payload: dict) -> None:
        for socket in list(self.connections):
            try:
                await socket.send_json(payload)
            except Exception:
                if socket in self.connections:
                    self.connections.remove(socket)

channels = LiveChannels()

async def publish(result: dict) -> dict:
    await channels.broadcast({"type": "state_changed", "run_id": result["run_id"], "revision": result["revision"], "time": result["state"]["time"]})
    return result

@app.get("/")
def index():
    return FileResponse(ROOT / "web" / "index.html")

@app.get("/api/health")
def health():
    return {"service": "up", "mode": "SYNTHETIC_SIMULATION", "physical_validation": False, "database": "sqlite"}

@app.get("/api/architecture")
def architecture():
    return {"nodes": engine.NODES, "edges": engine.EDGES, "blockable": sorted(engine.BLOCKABLE), "demand_schedule": engine.DEMAND,
            "source": "Ferrari et al. (2024) motivates explicit task/control modelling and physical validation; warehouse geometry and timings are original synthetic examples."}

@app.get("/api/state")
def state():
    return store.read_state()

@app.get("/api/events")
def events(limit: int = 200):
    if not 1 <= limit <= 1000:
        raise HTTPException(422, detail="limit must be 1..1000")
    return {"events": store.get_events(limit)}

@app.get("/api/validation")
def validation():
    view = store.read_state()
    return {"conservation": view["conservation"], "passes_stock_conservation": all(x["valid"] for x in view["conservation"]),
            "physical_accuracy": "NOT_MEASURED", "live_sync": "NOT_CONNECTED",
            "observed_task_times": store.measurement_report()["count"], "simulation_mode": "SYNTHETIC_UNCALIBRATED"}

@app.post("/api/reset")
async def reset(body: ResetRequest):
    try:
        return await publish(store.reset(body.policy, body.blocked, {"speed_units_per_second":body.speed_units_per_second,"load_seconds":body.load_seconds,"unload_seconds":body.unload_seconds}))
    except ValueError as error:
        raise HTTPException(422, detail=str(error)) from error

@app.post("/api/step")
async def step():
    return await publish(store.mutate(engine.step))

@app.post("/api/run")
async def run(body: RunRequest):
    try:
        return await publish(store.mutate(lambda st: engine.run_until(st, body.until, body.max_steps)))
    except ValueError as error:
        raise HTTPException(422, detail=str(error)) from error

@app.post("/api/block")
async def block(body: BlockRequest):
    try:
        return await publish(store.mutate(lambda st: engine.set_block(st, body.node, body.blocked)))
    except ValueError as error:
        raise HTTPException(409, detail=str(error)) from error

@app.post("/api/compare")
def compare(body: CompareRequest):
    try:
        active = store.read_state()["state"]
        return engine.comparison(
            active["blocked"] if body.blocked is None else body.blocked,
            body.until,
            parameters=active["parameters"]
        )
    except ValueError as error:
        raise HTTPException(422, detail=str(error)) from error

@app.post("/api/telemetry", status_code=202)
def ingest_telemetry(body: TelemetryRequest, authorization: str | None = Header(default=None)):
    token = os.getenv("TWIN_INGEST_TOKEN", "")
    if token and authorization != f"Bearer {token}":
        raise HTTPException(401, detail="Invalid telemetry ingestion token")
    data = body.model_dump(mode="json", exclude_none=True)
    return store.save_telemetry(data)

@app.get("/api/telemetry")
def get_telemetry(limit: int = 50):
    if not 1 <= limit <= 500:
        raise HTTPException(422, detail="limit must be 1..500")
    return {"observations": store.recent_telemetry(limit)}

@app.websocket("/ws/events")
async def websocket_events(socket: WebSocket):
    await socket.accept()
    channels.connections.append(socket)
    try:
        await socket.send_json({"type": "connected", "mode": "SYNTHETIC_SIMULATION"})
        while True:
            # Keep socket alive; clients may send a ping message.
            await socket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if socket in channels.connections:
            channels.connections.remove(socket)


@app.post("/api/measurements")
def record_measurement(body: MeasurementRequest):
    try:
        return store.save_measurement(body.task_id,body.observed_seconds,body.source)
    except ValueError as error:
        raise HTTPException(422,detail=str(error)) from error

@app.get("/api/measurements")
def measurements():
    return store.measurement_report()
