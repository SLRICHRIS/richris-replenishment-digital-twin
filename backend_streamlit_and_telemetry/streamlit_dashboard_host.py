"""Host the warehouse dashboard and Python sensor-model readouts."""
from pathlib import Path

import streamlit as st
from streamlit.components.v1 import declare_component

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIRECTORY = REPOSITORY_ROOT / 'frontend_warehouse_dashboard'
APPLICATION_VERSION = '3.2.0'
WAREHOUSE_WORKSPACE = declare_component('replenish_workspace', path=str(FRONTEND_DIRECTORY))


@st.fragment(run_every='1s')
def render_warehouse_workspace():
    from .predictive_twin.workspace_payload import workspace_payload
    mode = st.session_state.get('warehouse_sensor_mode', 'demo')
    payload = workspace_payload(mode)
    if st.session_state.get('warehouse_database_requested'):
        from .predictive_twin.database_inspection import database_preview
        payload['database'] = database_preview(
            st.session_state.get('warehouse_database_dataset', 'amr_sensor_samples'),
            st.session_state.get('warehouse_database_refresh', ''))
    result = WAREHOUSE_WORKSPACE(key='warehouse-workspace', default=None, python_twin=payload)
    if not isinstance(result, dict) or result.get('action') not in ('sensor_source', 'model_inspection', 'database_inspection', 'database_browse'):
        return
    choice = result.get('mode')
    nonce = result.get('nonce')
    if not isinstance(nonce, str) or len(nonce) > 80:
        return
    if result['action'] == 'sensor_source' and choice not in ('demo', 'live'):
        return
    if result['action'] == 'database_browse':
        from .predictive_twin.database_inspection import DATASET_LABELS
        if result.get('dataset') not in DATASET_LABELS or type(result.get('active')) is not bool:
            return
    if nonce == st.session_state.get('warehouse_sensor_action'):
        return
    st.session_state.warehouse_sensor_action = nonce
    if result['action'] == 'database_browse':
        st.session_state.warehouse_database_requested = result['active']
        st.session_state.warehouse_database_dataset = result['dataset']
        st.session_state.warehouse_database_refresh = nonce
    elif result['action'] in ('model_inspection', 'database_inspection'):
        st.session_state.pending_workspace_view = ('Database' if result['action'] == 'database_inspection' else 'Model inspection')
    else:
        st.session_state.warehouse_sensor_mode = choice
    st.rerun()


def render_dashboard():
    st.set_page_config(page_title='Replenish | S L RICHRIS',
        page_icon=str(FRONTEND_DIRECTORY / 'dashboard_images_and_fonts/warehouse_dashboard_application_icon.svg'),
        layout='wide', initial_sidebar_state='collapsed',
        menu_items={'About': f'Replenish {APPLICATION_VERSION}: warehouse dashboard and single-AMR Python sensor twin. © 2026 S L RICHRIS.'})
    pending = st.session_state.pop('pending_workspace_view', None)
    if pending in ('Warehouse dashboard', 'Model inspection', 'Database'):
        st.session_state.workspace_view = pending
    view = st.sidebar.radio('Workspace', ('Warehouse dashboard', 'Model inspection', 'Database'),
                            format_func=lambda name: 'Detailed readings' if name == 'Model inspection' else name,
                            key='workspace_view')
    if view != 'Warehouse dashboard':
        st.html('''<style>
            [data-testid="stHeader"] { display: none; }
            [data-testid="stMainBlockContainer"] { padding: 2rem; max-width: 1280px; }
            [data-testid="stMainBlockContainer"] h1 { font-size: 1.75rem; font-weight: 600; }
            [data-testid="stCaptionContainer"], [data-testid="stCaptionContainer"] p { color: inherit; }
        </style>''')
    if view == 'Database':
        from .predictive_twin.database_inspection import render_database_inspection
        render_database_inspection()
        return
    if view == 'Model inspection':
        from .predictive_twin.dashboard import render_sensor_dashboard
        render_sensor_dashboard()
        return
    st.html('''<style>
        [data-testid="stHeader"] { display: none; }
        [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: none !important; }
        [data-testid="stVerticalBlock"] { gap: 0; }
        [data-testid="stAppViewContainer"] { overflow-x: hidden; overflow-y: auto; }
        /* Keep the persistent workspace readable during background reruns.
           Sensor freshness and database loading are reported inside the component. */
        [data-testid="stElementContainer"].st-key-warehouse-workspace {
            opacity: 1 !important;
            transition: none !important;
        }
        iframe[title*="replenish_workspace"] { display: block; width: 100%; border: 0; }
    </style>''')
    if not (FRONTEND_DIRECTORY / 'index.html').is_file():
        st.error('Deploy the complete repository: the warehouse dashboard files are missing.')
        st.stop()
    render_warehouse_workspace()
