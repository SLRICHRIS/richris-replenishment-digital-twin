"""Read-only physical storage inspection; no calibration or ingestion required."""
import csv
from io import StringIO
import json

import streamlit as st
from sqlalchemy.dialects import postgresql

from .database import DATABASE_DATASETS, SENSOR_VIEWS, SensorSample
from .workspace_payload import database_connection


DESCRIPTIONS = {
    'amr_sensor_samples': 'Received encoder, gyro and battery measurements',
    'amr_twin_states': 'Calculated pose, state of charge, energy and quality',
    'amr_pipeline_events': 'Recorded packet rejections, gaps and restarts',
    'amr_calibrations': 'Calibration parameters linked to sensor samples',
    'amr_worker_checkpoints': 'Pointer to the last atomically committed state',
    'amr_database_version': 'Installed schema version',
    'amr_encoder_readings': 'Encoder columns from the canonical measurement table',
    'amr_imu_readings': 'Gyroscope columns from the canonical measurement table',
    'amr_ina219_readings': 'Voltage and current columns from the canonical measurement table',
}
STATUS = {
    'not_configured': ('Database not connected', 'No database URL is configured for this app. The definitions below describe the expected schema; they do not establish that a hosted database exists.'),
    'unreachable': ('Database connection failed', 'The configured database could not be reached. Check its availability, TLS settings and the private reader credentials.'),
    'schema_not_ready': ('Connected; schema needs attention', 'PostgreSQL responded, but the required schema v3 or read permissions could not be verified. Complete administrator provisioning and reader grants.'),
    'ready': ('Connected; schema v3 verified', 'Stored records are available through SELECT queries. Calibration confirmation is only required for live model interpretation.'),
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


def render_database_inspection():
    if st.button('Back to dashboard'):
        st.session_state.pending_workspace_view = 'Warehouse dashboard'
        st.rerun()
    st.title('Sensor database')
    st.write('Inspect physical AMR-01 records, table attributes and storage connectivity.')
    st.button('Refresh connection and records')  # A normal rerun rechecks the cached engine.
    with st.spinner('Checking database'):
        db, state = database_connection()
    label, detail = STATUS[state]
    (st.success if state == 'ready' else st.warning)(label + '. ' + detail)
    st.caption('Demonstration data are never written into these physical-trial tables. This page performs no database writes.')

    dataset = st.selectbox('Table or sensor view', list(DATABASE_DATASETS),
                           format_func=lambda name: name + ' · ' + ('view' if name in SENSOR_VIEWS else 'table'))
    st.write(DESCRIPTIONS[dataset])
    records_tab, attributes_tab, schema_tab, setup_tab = st.tabs([
        'Stored records', 'Attributes', 'Schema overview', 'Connection setup',
    ])
    with records_tab:
        limit = st.selectbox('Maximum rows', [50, 100, 200])
        st.caption('Recent stored rows for AMR-01. Historical records may be stale; this is not a live health indicator.')
        if db is None:
            st.info('Stored records are unavailable until a database with the required schema is connected.')
        else:
            try:
                rows = db.read_records(dataset, limit=limit)
            except Exception:
                st.error('Records could not be read. Check connection and SELECT permissions for this dataset.')
            else:
                if not rows:
                    st.info('Connected, but this dataset has no stored records. The ingestion worker writes records when it receives validated physical packets.')
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
        st.caption('Expected schema from the application models. Sensor views inherit their source column constraints; views have no independent primary key.')
        st.dataframe(attributes(dataset), hide_index=True, width='stretch')
        st.write('Packet identity: robot_id + boot_id + seq. Device sample_time_s is seconds since boot; received_at is server UTC receive time. SOC is stored as a fraction from 0 to 1.')
    with schema_tab:
        st.dataframe([{'Dataset': name, 'Kind': 'View' if name in SENSOR_VIEWS else 'Table',
                       'Purpose': DESCRIPTIONS[name]} for name in DATABASE_DATASETS],
                     hide_index=True, width='stretch')
    with setup_tab:
        st.write('Create the hosted PostgreSQL database, provision schema v3 with the administrator account, then configure a separate SELECT-only reader in the app’s private Streamlit secrets.')
        st.code('[database]\nurl = "postgresql+psycopg://<reader>:<password>@<host>/<database>?sslmode=require"', language='toml')
        st.write('The independent MQTT worker uses a separate writer account. Connecting storage does not connect the robot or confirm measured calibration.')
        st.link_button('Database deployment instructions', 'https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/postgresql_sensor_pipeline.md')
