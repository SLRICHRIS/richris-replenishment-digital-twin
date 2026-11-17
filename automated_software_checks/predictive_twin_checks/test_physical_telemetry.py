"""Read-only display checks using synthetic rows in isolated SQLite only."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select

from backend_streamlit_and_telemetry.predictive_twin.physical_telemetry import metadata, samples, display_payload, read_records

ROOT = Path(__file__).resolve().parents[2]


def synthetic_record():
    program = "import {envelope} from './backend_streamlit_and_telemetry/commissioning_webhook/tests/fixture.mjs';import{validateEnvelope}from'./backend_streamlit_and_telemetry/commissioning_webhook/contract.mjs';const record=validateEnvelope(envelope());console.log(JSON.stringify(record));"
    result = subprocess.run(['node', '--input-type=module', '-e', program], cwd=ROOT, capture_output=True, text=True, check=True)
    row = json.loads(result.stdout)
    row['received_at'] = datetime.fromisoformat(row['received_at'].replace('Z', '+00:00'))
    row['stored_at'] = row['received_at']
    return row


@pytest.fixture
def physical_db(tmp_path):
    engine = create_engine('sqlite+pysqlite:///' + str(tmp_path / 'synthetic.sqlite3'))
    metadata.create_all(engine)
    yield SimpleNamespace(engine=engine)
    engine.dispose()


def test_live_raw_values_are_visible_without_authorizing_models_or_showing_device_soc(physical_db):
    row = synthetic_record()
    row['battery_voltage_v'] = .82
    row['device_soc_estimate_percent'] = 100
    with physical_db.engine.begin() as connection:
        connection.execute(samples.insert(), row)
    result = display_payload(physical_db, now=row['received_at'] + timedelta(seconds=1))
    assert result['fresh'] and result['state'] == 'receiving'
    assert result['measurements']['left_pulses_total'] == 3
    assert result['models_ready'] is False
    assert any('below 1 V' in line for line in result['recommendations'])
    assert 'payload' not in result['measurements']
    assert 'payload_sha256' not in result['measurements']
    assert 'client_id' not in result['measurements']


def test_retry_store_time_cannot_make_an_old_broker_packet_fresh(physical_db):
    row = synthetic_record()
    now = row['received_at'] + timedelta(hours=1)
    row['stored_at'] = now
    with physical_db.engine.begin() as connection:
        connection.execute(samples.insert(), row)
    result = display_payload(physical_db, now=now)
    assert result['state'] == 'stale' and not result['fresh']
    assert result['measurements'] == {} and result['models_ready'] is False
    assert len(result['history']) == 1


def test_future_broker_clock_is_not_live_and_archive_is_bounded(physical_db):
    row = synthetic_record()
    with physical_db.engine.begin() as connection:
        connection.execute(samples.insert(), row)
    assert display_payload(physical_db, now=row['received_at'] - timedelta(seconds=2))['state'] == 'clock_skew'
    assert len(read_records(physical_db, limit=1)) == 1
    for limit in (True, 0, 201):
        with pytest.raises(ValueError): read_records(physical_db, limit=limit)


def test_optional_missing_table_and_empty_table_do_not_break_existing_model_storage(physical_db):
    assert display_payload(physical_db)['state'] == 'waiting'
    with physical_db.engine.begin() as connection:
        samples.drop(connection)
    assert display_payload(physical_db)['state'] == 'unavailable'
    assert display_payload(None)['measurements'] == {}


def test_physical_table_does_not_enter_signed_model_dataset_allowlist():
    from backend_streamlit_and_telemetry.predictive_twin.database import DATABASE_DATASETS
    from backend_streamlit_and_telemetry.predictive_twin.database_inspection import attributes, DATASET_LABELS
    assert samples.name not in DATABASE_DATASETS
    assert samples.name in DATASET_LABELS
    assert len(attributes(samples.name)) == len(samples.c)
