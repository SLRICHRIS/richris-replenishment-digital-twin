"""Host the previously designed warehouse UI, with Python sensor-model readouts."""
from pathlib import Path

import streamlit as st
from streamlit.components.v1 import declare_component

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIRECTORY = REPOSITORY_ROOT / 'frontend_warehouse_dashboard'
APPLICATION_VERSION = '3.1.0'
WAREHOUSE_WORKSPACE = declare_component('replenish_workspace', path=str(FRONTEND_DIRECTORY))


@st.fragment(run_every='1s')
def render_warehouse_workspace():
    from .predictive_twin.workspace_payload import workspace_payload
    mode = st.session_state.get('warehouse_sensor_mode', 'demo')
    result = WAREHOUSE_WORKSPACE(key='warehouse-workspace', default=None,
                                 python_twin=workspace_payload(mode))
    if not isinstance(result, dict) or result.get('action') not in ('sensor_source', 'model_inspection'):
        return
    choice = result.get('mode')
    nonce = result.get('nonce')
    if not isinstance(nonce, str) or len(nonce) > 80:
        return
    if result['action'] == 'sensor_source' and choice not in ('demo', 'live'):
        return
    if nonce == st.session_state.get('warehouse_sensor_action'):
        return
    st.session_state.warehouse_sensor_action = nonce
    if result['action'] == 'model_inspection':
        st.session_state.pending_workspace_view = 'Model inspection'
    else:
        st.session_state.warehouse_sensor_mode = choice
    st.rerun()


def render_dashboard():
    st.set_page_config(page_title='Replenish | S L RICHRIS',
        page_icon=str(FRONTEND_DIRECTORY / 'dashboard_images_and_fonts/warehouse_dashboard_application_icon.svg'),
        layout='wide', initial_sidebar_state='collapsed',
        menu_items={'About': f'Replenish {APPLICATION_VERSION}: warehouse dashboard and two-robot Python sensor twin. © 2026 S L RICHRIS.'})
    pending = st.session_state.pop('pending_workspace_view', None)
    if pending in ('Warehouse dashboard', 'Model inspection'):
        st.session_state.workspace_view = pending
    view = st.sidebar.radio('Workspace', ('Warehouse dashboard', 'Model inspection'), key='workspace_view')
    if view == 'Model inspection':
        from .predictive_twin.dashboard import render_sensor_dashboard
        render_sensor_dashboard()
        return
    st.html('''<style>
        [data-testid="stHeader"] { display: none; }
        [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: none !important; }
        [data-testid="stVerticalBlock"] { gap: 0; }
        [data-testid="stAppViewContainer"] { overflow-x: hidden; overflow-y: auto; }
        iframe[title*="replenish_workspace"] { display: block; width: 100%; border: 0; }
    </style>''')
    if not (FRONTEND_DIRECTORY / 'index.html').is_file():
        st.error('Deploy the complete repository: the warehouse dashboard files are missing.')
        st.stop()
    render_warehouse_workspace()
