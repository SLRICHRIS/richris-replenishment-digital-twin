"""Session-isolated rehearsal and a read-only physical review monitor."""
from copy import deepcopy
import uuid
import streamlit as st
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool
from .human_review import ReviewCoordinator, metadata, reviews, panel


@st.cache_resource(scope='session', show_spinner=False)
def demo_coordinator(trial):
    engine = create_engine('sqlite+pysqlite://', connect_args={'check_same_thread':False}, poolclass=StaticPool)
    metadata.create_all(engine)
    return ReviewCoordinator(engine, publisher=lambda *_:None, commands_enabled=True, source='demo', response_timeout_s=60)


def active_key(payload):
    return 'warehouse_review_'+payload.get('demo_trial', {}).get('id', 'baseline')


@st.cache_data(ttl=3, max_entries=16, show_spinner=False)
def physical_review(url):
    from .workspace_payload import database_reader
    engine = database_reader(url).engine
    with engine.connect() as c:
        row = c.execute(select(reviews).order_by(reviews.c.created_at.desc()).limit(1)).mappings().first()
    if not row:
        return None
    # Operator identifiers and free-text reasons stay in the protected audit.
    value = dict(row)
    if value['decision']:
        value['decision'] = {k:value['decision'][k] for k in ('decision','action')}
    return value


def review_workspace(payload):
    feedback = st.session_state.get('warehouse_review_feedback', '') if payload['mode'] == 'demo' else ''
    row = None
    if payload['mode'] == 'demo':
        coordinator = demo_coordinator(payload.get('demo_trial', {}).get('id','baseline'))
        rid = st.session_state.get(active_key(payload))
        if rid:
            row = coordinator.get(rid)
    else:
        from .workspace_payload import database_url
        url = database_url()
        if url:
            try:
                row = physical_review(url)
            except Exception:
                feedback = 'The LabVIEW review service has not been commissioned for this database.'
        else:
            feedback = 'Connect the sensor database before monitoring physical reviews.'
    return panel(payload, row, feedback)


def handle_demo_action(payload, result):
    if payload.get('mode') != 'demo':
        return  # The browser can never authorize physical control.
    coordinator = demo_coordinator(payload.get('demo_trial', {}).get('id','baseline'))
    key = active_key(payload)
    try:
        command = result.get('command')
        rid = st.session_state.get(key)
        if command == 'create':
            row = coordinator.create(payload, uuid.uuid4().hex)
            st.session_state[key] = row['review_id']
        elif command == 'decide' and rid and result.get('review_id') == rid:
            coordinator.decide(rid, decision=result.get('decision'), action=result.get('intervention'),
                               operator='demo_operator', reason=result.get('reason'), payload=payload)
        elif command == 'response' and rid and result.get('review_id') == rid:
            row = coordinator.get(rid)
            if row['state'] not in {'sent','acknowledged'}:
                raise ValueError('An approved request must be awaiting a controller response or sensor verification')
            cmd = row['command']
            if row['state'] == 'sent':
                coordinator.acknowledge(dict(command_id=rid, robot_id='amr01', boot_id=cmd['target_boot_id'],
                action=cmd['action'], source_seq=cmd['source_seq'], status='applied',
                    applied_sample_time_s=cmd['source_sample_time_s']))
                st.session_state.warehouse_review_feedback = 'Simulated acknowledgement only. New sensor observations are still required.'
                return
            for i in range(1,4):
                sample = deepcopy(payload)
                r = sample['robots']['amr01']
                r['raw']['seq'] = cmd['source_seq']+i
                if cmd['action'] == 'pause':
                    r['raw']['robot_state'] = 'paused'
                r['raw']['sample_time_s'] = cmd['source_sample_time_s']+.05*i
                r['derived']['v_left_m_s'] = r['derived']['v_right_m_s'] = 0 if cmd['action']=='pause' else row['evidence']['dispatch_speed_m_s']*.5
                coordinator.observe(sample)
        else:
            raise ValueError('Choose a current demo review action')
        st.session_state.warehouse_review_feedback = 'Demo evidence only. No physical command was sent.'
    except (ValueError, TypeError) as error:
        st.session_state.warehouse_review_feedback = str(error)
