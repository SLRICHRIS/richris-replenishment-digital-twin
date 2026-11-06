from datetime import datetime, timezone
from fastapi.testclient import TestClient
import pytest
from warehouse_twin import database as store
from warehouse_twin.api import app

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB_PATH',str(tmp_path/'testing.sqlite3'))
    with TestClient(app) as tc:
        yield tc


def test_routes_and_frontend(client):
    assert client.get('/').status_code==200
    assert 'REPLENISHMENT LAB' in client.get('/').text
    assert client.get('/api/health').json()['physical_validation'] is False
    assert len(client.get('/api/architecture').json()['nodes'])>=8


def test_simulation_persistence_and_event_history(client):
    old=client.get('/api/state').json()
    reset=client.post('/api/reset',json={'policy':'fifo','blocked':['B']})
    assert reset.status_code==200
    assert reset.json()['state']['blocked']==['B']
    run=client.post('/api/run',json={'until':120}).json()
    assert run['metrics']['requested']==71
    assert run['revision']>1
    same=client.get('/api/state').json()
    assert same['run_id']==run['run_id']
    assert same['state']==run['state']
    logs=client.get('/api/events').json()['events']
    assert logs and all(logs[i]['seq']<logs[i+1]['seq'] for i in range(len(logs)-1))
    assert all(x['valid'] for x in client.get('/api/validation').json()['conservation'])


def test_reject_mutation_without_losing_state(client):
    pre=client.get('/api/state').json()
    invalid=client.post('/api/block',json={'node':'B','blocked':True})
    assert invalid.status_code==409
    post=client.get('/api/state').json()
    assert pre==post


def test_telemetry_idempotency_and_quarantine(client):
    packet={'device_id':'amr-01','seq':11,'timestamp':'2026-10-23T00:00:00+00:00','firmware':'richris-esp32-1.0.0','x':1.2,'y':2.1,'battery_pct':75}
    before=client.get('/api/state').json()['state']
    result=client.post('/api/telemetry',json=packet)
    assert result.status_code==202
    assert result.json()['disposition']=='QUARANTINED_UNCALIBRATED'
    assert client.post('/api/telemetry',json=packet).json()['duplicate'] is True
    assert client.get('/api/state').json()['state']==before
    assert len(client.get('/api/telemetry').json()['observations'])==1
    bad=dict(packet,timestamp='2026-10-23T00:00:00')
    assert client.post('/api/telemetry',json=bad).status_code==422


def test_external_task_measurement(client):
    run=client.post('/api/run',json={'until':120}).json()
    done=[t for t in run['state']['tasks'].values() if t['status']=='completed']
    assert done
    measurement=client.post('/api/measurements',json={'task_id':done[0]['id'],'observed_seconds':55.0,'source':'stopwatch repeat 1'})
    assert measurement.status_code==200
    report=client.get('/api/measurements').json()
    assert report['count']==1 and report['mae_seconds'] is not None
    assert report['warning']
    assert client.post('/api/measurements',json={'task_id':'does-not-exist','observed_seconds':4,'source':'manual'}).status_code==422


def test_repeated_reset_archives_previous_run(client):
    state1=client.get('/api/state').json()
    state2=client.post('/api/reset',json={'policy':'urgency'}).json()
    assert state2['run_id']!=state1['run_id']
    with store.connection() as con:
        row=con.execute('SELECT * FROM archived_runs WHERE run_id=?',(state1['run_id'],)).fetchone()
        assert row is not None


def test_websocket_broadcast(client):
    with client.websocket_connect('/ws/events') as ws:
        assert ws.receive_json()['type']=='connected'
        response=client.post('/api/step')
        assert response.status_code==200
        assert ws.receive_json()['type']=='state_changed'


def test_reset_validation(client):
    assert client.post('/api/reset',json={'blocked':['P1']}).status_code==422
    assert client.post('/api/reset',json={'policy':'unknown'}).status_code==422
    assert client.post('/api/reset',json={'load_seconds':-2}).status_code==422
