"""Read-only physical storage inspection; no calibration or ingestion required."""
import csv
from io import StringIO
import json

import streamlit as st
from sqlalchemy.dialects import postgresql

from .database import DATABASE_DATASETS as MODEL_DATASETS, SENSOR_VIEWS, SensorSample
from .physical_telemetry import samples as physical_samples, read_records as read_physical_records
from .workspace_payload import database_connection

DATABASE_DATASETS = {**MODEL_DATASETS, physical_samples.name: physical_samples}

DESCRIPTIONS = {
    'amr_commissioning_samples': 'Stored unsigned wheel pulses, IMU and battery observations from the installed ESP32 hardware; model readiness remains false',
    'amr_sensor_samples': 'Inputs for calibrated models; installed ESP32 observations are stored in Device telemetry',
    'amr_twin_states': 'Calculated pose, state of charge, energy and quality',
    'amr_pipeline_events': 'Recorded packet rejections, gaps and restarts',
    'amr_calibrations': 'Calibration parameters linked to sensor samples',
    'amr_worker_checkpoints': 'Pointer to the last atomically committed state',
    'amr_database_version': 'Database compatibility record',
    'amr_encoder_readings': 'Encoder columns from the canonical measurement table',
    'amr_imu_readings': 'Gyroscope columns from the canonical measurement table',
    'amr_ina219_readings': 'Voltage and current columns from the canonical measurement table',
}
DATASET_LABELS = {
    'amr_commissioning_samples': 'Device telemetry',
    'amr_sensor_samples': 'Calibrated sensor samples',
    'amr_encoder_readings': 'Wheel encoders',
    'amr_imu_readings': 'Gyroscope',
    'amr_ina219_readings': 'Battery voltage and current',
    'amr_twin_states': 'Model estimates',
    'amr_pipeline_events': 'Packet quality events',
    'amr_calibrations': 'Calibration records',
}
STATUS = {
    'not_configured': ('Database not connected', 'No database URL is configured for this app. The definitions below describe the expected schema; they do not establish that a hosted database exists.'),
    'unreachable': ('Database connection failed', 'The configured database could not be reached. Check its availability, TLS settings and the private reader credentials.'),
    'schema_not_ready': ('Connected; database setup needs attention', 'PostgreSQL responded, but the required tables or read permissions could not be verified. Complete administrator provisioning and reader grants.'),
    'ready': ('Connected; storage verified', 'Physical AMR-01 records. Demo values are not stored here.'),
}


def attributes(dataset):
    source = DATABASE_DATASETS[dataset]
    result = []
    for col in source.c:
        origin = SensorSample.__table__.c[col.name] if dataset in SENSOR_VIEWS else col
        result.append({
            'Attribute': col.name,
            'PostgreSQL type': str(origin.type.compile(dialect=postgresql.dialect())),
            'Required': not origin.nullable,
            'Key': ('Source packet key' if dataset in SENSOR_VIEWS and origin.primary_key else
                    'Primary key' if origin.primary_key else
                    'Foreign key' if origin.foreign_keys else ''),
        })
    return result


@st.cache_data(ttl=5, max_entries=32, show_spinner=False)
def database_preview(dataset='amr_commissioning_samples', refresh_token=''):
    """Sanitized, bounded SELECT results for the shared dashboard shell."""
    if dataset not in DATASET_LABELS:
        raise ValueError('Choose a known sensor dataset')
    db, state = database_connection()
    label, detail = STATUS[state]
    # The request ID also changes component args when identical rows are re-requested.
    # Otherwise Streamlit can memoize A → B → A and leave the browser's loading state stuck.
    result = dict(state=state, label=label, detail=detail, dataset=dataset, request_id=refresh_token,
                  title=DATASET_LABELS[dataset], description=DESCRIPTIONS[dataset],
                  attributes=attributes(dataset), columns=list(DATABASE_DATASETS[dataset].c.keys()),
                  kind='View' if dataset in SENSOR_VIEWS else 'Table',
                  limit=50, rows=[], rows_state='unavailable')
    if db is not None:
        try:
            rows = (read_physical_records(db, limit=50) if dataset == physical_samples.name
                    else db.read_records(dataset, limit=50))
            # SQL timestamps stay explicit ISO strings; no driver or engine objects cross the bridge.
            result['rows'] = json.loads(json.dumps(rows, default=lambda value:
                value.isoformat() if hasattr(value, 'isoformat') else str(value)))
            result['rows_state'] = 'ready'
        except Exception:
            result['rows_state'] = 'error'
    return result


def render_database_inspection():
    if st.button('Back to dashboard'):
        st.session_state.pending_workspace_view = 'Warehouse dashboard'
        st.rerun()
    st.title('Sensor database')
    st.button('Refresh records')  # A normal rerun rechecks the cached engine.
    with st.spinner('Checking database'):
        db, state = database_connection()
    label, detail = STATUS[state]
    (st.success if state == 'ready' else st.warning)(label + '. ' + detail)

    if 'warehouse_database_dataset' not in st.session_state:
        st.session_state.warehouse_database_dataset = physical_samples.name
    dataset = st.selectbox('Sensor records', list(DATASET_LABELS), format_func=DATASET_LABELS.get,
                           key='warehouse_database_dataset')
    st.write(DESCRIPTIONS[dataset])
    records_tab, attributes_tab = st.tabs(['Stored records', 'Table attributes'])
    with records_tab:
        limit = st.selectbox('Maximum rows', [50, 100, 200])
        st.caption('Latest saved records. Historical rows do not indicate current robot health.')
        if db is None:
            st.info('Stored records are unavailable until a database with the required schema is connected.')
        else:
            try:
                rows = (read_physical_records(db, limit=limit) if dataset == physical_samples.name
                        else db.read_records(dataset, limit=limit))
            except Exception:
                st.error('Records could not be read. Check connection and SELECT permissions for this dataset.')
            else:
                if not rows:
                    st.info(f'No stored records in {DATASET_LABELS[dataset]} yet.')
                    if dataset != physical_samples.name:
                        st.caption('Choose Device telemetry for the installed ESP32 wheel pulses, IMU and battery observations. Calibrated model datasets remain separate.')
                else:
                    # JSON objects stay exact in the export; render consistently in the grid.
                    display = [{key: json.dumps(value, sort_keys=True) if isinstance(value, (dict, list)) else value
                                for key, value in row.items()} for row in rows]
                    st.dataframe(display, hide_index=True, width='stretch')
                    st.caption(f'{len(rows)} rows shown; maximum {limit}. This is not a total row count.')
                    output = StringIO()
                    writer = csv.DictWriter(output, fieldnames=list(rows[0]))
                    writer.writeheader()
                    writer.writerows(display)
                    st.download_button('Download displayed rows', output.getvalue(),
                                       file_name=dataset + '.csv', mime='text/csv')
    with attributes_tab:
        st.caption(f'{dataset} · ' + ('sensor view' if dataset in SENSOR_VIEWS else 'table'))
        st.dataframe(attributes(dataset), hide_index=True, width='stretch')
        with st.expander('Storage schema and field guide'):
            st.write('Packet key: robot_id + boot_id + seq. sample_time_s is seconds since device boot; received_at is broker UTC for Device telemetry and worker UTC for calibrated samples.')
            st.caption('Device telemetry stores raw sensor observations. device_soc_estimate_percent is an unverified device claim; calibrated model SOC uses a fraction from 0 to 1.')
            st.caption('Schema definitions come from the application models. Sensor views inherit source column constraints and have no independent primary key.')
            st.dataframe([{'Dataset': name, 'Kind': 'View' if name in SENSOR_VIEWS else 'Table',
                           'Purpose': DESCRIPTIONS[name]} for name in DATABASE_DATASETS],
                         hide_index=True, width='stretch')
