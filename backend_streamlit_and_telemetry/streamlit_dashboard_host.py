"""Host the warehouse dashboard and Python sensor-model readouts."""
from pathlib import Path
import time

import streamlit as st
from streamlit.components.v1 import declare_component

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIRECTORY = REPOSITORY_ROOT / 'frontend_warehouse_dashboard'
WAREHOUSE_WORKSPACE = declare_component('replenish_workspace', path=str(FRONTEND_DIRECTORY))


@st.fragment(run_every='1s')
def render_warehouse_workspace():
    from .predictive_twin.workspace_payload import workspace_payload, database_url
    mode = st.session_state.get('warehouse_sensor_mode')
    if mode is None:
        mode = 'live' if database_url() else 'demo'
    payload = workspace_payload(mode, st.session_state.get('warehouse_demo_trial', 'baseline'))
    if st.session_state.get('warehouse_connection_requested'):
        from .predictive_twin.amr_connection import connection_payload, connection_profile, session_connector
        profile, missing = connection_profile(st.secrets)
        payload['amr_connection'] = connection_payload(session_connector(), profile, missing,
            authorized=st.session_state.get('warehouse_connection_authorized', False),
            live_payload=payload if mode == 'live' else None)
        payload['amr_connection']['feedback'] = st.session_state.get('warehouse_connection_feedback', '')
        payload['amr_connection']['request_id'] = st.session_state.get('warehouse_sensor_action', '')
    if st.session_state.get('warehouse_database_requested'):
        from .predictive_twin.database_inspection import database_preview
        payload['database'] = database_preview(
            st.session_state.get('warehouse_database_dataset', 'amr_commissioning_samples'),
            st.session_state.get('warehouse_database_refresh', ''))
    from .predictive_twin.human_review_workspace import review_workspace
    payload['human_review'] = review_workspace(payload)
    from .predictive_twin.vision_execution_workspace import workspace as vision_workspace
    payload['vision_execution'] = vision_workspace(mode)
    from .predictive_twin.manual_control_workspace import workspace as manual_workspace
    payload['manual_control'] = manual_workspace(mode)
    payload['camera_panel_open'] = bool(st.session_state.get('warehouse_browser_camera_open'))
    result = WAREHOUSE_WORKSPACE(key='warehouse-workspace', default=None, python_twin=payload)
    if not isinstance(result, dict) or result.get('action') not in ('sensor_source', 'demo_trial', 'model_inspection', 'database_inspection', 'database_browse', 'connection_view', 'connection_control', 'human_review', 'vision_execution', 'manual_control', 'camera_panel'):
        return
    choice = result.get('mode')
    nonce = result.get('nonce')
    if not isinstance(nonce, str) or len(nonce) > 80:
        return
    if result['action'] == 'camera_panel':
        if type(result.get('open')) is not bool:
            return
    if result['action'] == 'human_review':
        permitted = ('create','decide','response') if mode == 'demo' else ('login','logout','create','decide')
        code = result.get('access_code', '')
        if result.get('command') not in permitted or not isinstance(code, str) or len(code) > 256:
            return
    if result['action'] == 'sensor_source' and choice not in ('demo', 'live'):
        return
    if result['action'] == 'demo_trial':
        from .predictive_twin.demo import DEMO_TRIALS
        if mode != 'demo' or not isinstance(result.get('trial'), str) or result['trial'] not in DEMO_TRIALS:
            return
    if result['action'] == 'database_browse':
        from .predictive_twin.database_inspection import DATASET_LABELS
        if result.get('dataset') not in DATASET_LABELS or type(result.get('active')) is not bool:
            return
    if result['action'] == 'connection_view' and type(result.get('active')) is not bool:
        return
    if result['action'] == 'connection_control' and (
            result.get('command') not in ('connect', 'disconnect') or
            not isinstance(result.get('access_code', ''), str) or len(result.get('access_code', '')) > 256):
        return
    if nonce == st.session_state.get('warehouse_sensor_action'):
        return
    st.session_state.warehouse_sensor_action = nonce
    if result['action'] in ('manual_control', 'vision_execution') and 'control_mode' in result:
        from .predictive_twin.control_presence import synchronize_control_view
        if not synchronize_control_view(st.session_state, result['control_mode']):
            return
    if result['action'] == 'camera_panel':
        st.session_state.warehouse_browser_camera_open = result['open']
        # Open the native WebRTC panel in the parent app, not just this fragment.
        st.rerun(scope='app')
    elif result['action'] == 'manual_control':
        from .predictive_twin.manual_control_workspace import handle
        handle(result, mode)
    elif result['action'] == 'vision_execution':
        from .predictive_twin.vision_execution_workspace import handle
        handle(result, mode)
    elif result['action'] == 'human_review':
        from .predictive_twin.human_review_workspace import handle_demo_action, handle_website_action
        if mode == 'demo':
            handle_demo_action(payload, result)
        else:
            handle_website_action(result)
    elif result['action'] == 'demo_trial':
        st.session_state.warehouse_demo_trial = result['trial']
        st.session_state.warehouse_review_feedback = ''
        st.session_state.warehouse_database_requested = False
        st.session_state.warehouse_connection_requested = False
    elif result['action'] == 'connection_view':
        st.session_state.warehouse_connection_requested = result['active']
        if result['active']:
            st.session_state.warehouse_database_requested = False
    elif result['action'] == 'connection_control':
        from .predictive_twin.amr_connection import authorize, connection_profile, session_connector
        profile, missing = connection_profile(st.secrets)
        if profile is None:
            st.session_state.warehouse_connection_feedback = 'Complete the private connection setup before connecting.'
            return
        if not st.session_state.get('warehouse_connection_authorized'):
            now = time.monotonic()
            if now - st.session_state.get('warehouse_connection_attempt', -2) < 1:
                return
            st.session_state.warehouse_connection_attempt = now
            if not authorize(profile, result.get('access_code', '')):
                st.session_state.warehouse_connection_feedback = 'Operator access code was not accepted.'
                return
            st.session_state.warehouse_connection_authorized = True
        st.session_state.warehouse_connection_feedback = ''
        controller = session_connector()
        if result['command'] == 'connect':
            controller.start(profile)
            st.session_state.warehouse_sensor_mode = 'live'
        else:
            controller.disconnect()
    elif result['action'] == 'database_browse':
        st.session_state.warehouse_database_requested = result['active']
        if result['active']:
            st.session_state.warehouse_connection_requested = False
        st.session_state.warehouse_database_dataset = result['dataset']
        st.session_state.warehouse_database_refresh = nonce
    elif result['action'] in ('model_inspection', 'database_inspection'):
        st.session_state.warehouse_database_requested = False
        st.session_state.warehouse_connection_requested = False
        st.session_state.pending_workspace_view = ('Database' if result['action'] == 'database_inspection' else 'Model inspection')
        st.rerun()
    else:
        st.session_state.warehouse_sensor_mode = choice
        st.session_state.warehouse_review_feedback = ''
        st.session_state.warehouse_database_requested = False
        st.session_state.warehouse_connection_requested = False
    # The next scheduled fragment tick delivers source/archive changes without
    # remounting the iframe or resetting its page, focus and scroll position.


def render_dashboard():
    st.set_page_config(page_title='Replenish | S L RICHRIS',
        page_icon=str(FRONTEND_DIRECTORY / 'dashboard_images_and_fonts/warehouse_dashboard_application_icon.svg'),
        layout='wide', initial_sidebar_state='collapsed',
        menu_items={'About': 'Replenish: warehouse dashboard and single-AMR Python sensor twin. © 2026 S L RICHRIS.'})
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
    if st.sidebar.checkbox(
        'Logitech camera tracking (browser)', value=False,
        key='warehouse_browser_camera_open',
        help='Use webcam directly in Chrome through WebRTC. Local Python is not needed.',
    ):
        from .vision_control.browser_streamlit_workspace import render_browser_camera
        render_browser_camera()
    else:
        # Unmounting a physical camera page must not leave a signed motor
        # controller running in the Streamlit process.
        gateway = st.session_state.pop('amr_browser_vision_gateway', None)
        if gateway is not None:
            gateway.close()
        feed = st.session_state.get('amr_browser_camera_feed')
        if feed is not None:
            feed.disconnect()
    render_warehouse_workspace()
