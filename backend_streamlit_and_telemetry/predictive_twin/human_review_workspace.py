"""Session-isolated rehearsal and authenticated website operator decisions."""
from copy import deepcopy
import uuid
import hashlib
import re
import time
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
    return public_review(row)


def public_review(row):
    if row is None:
        return None
    value = deepcopy(dict(row))
    if value['decision']:
        value['decision'] = {k:value['decision'][k] for k in ('decision','action')}
    return value


@st.cache_resource(max_entries=1, show_spinner=False, on_release=lambda resource: resource.close())
def website_service(profile, transport):
    from .intervention_service import WebsiteReviewService
    return WebsiteReviewService(profile, transport)


def auth_tag(profile):
    return hashlib.sha256(('website-review:'+profile.access_code).encode()).hexdigest() if profile else None


def is_authorized(profile):
    return bool(profile and st.session_state.get('warehouse_review_auth') == auth_tag(profile))


def review_workspace(payload):
    feedback = st.session_state.get('warehouse_review_feedback', '')
    row, service, authorized, owned, profile = None, None, False, False, None
    missing = []
    if payload['mode'] == 'demo':
        coordinator = demo_coordinator(payload.get('demo_trial', {}).get('id','baseline'))
        rid = st.session_state.get(active_key(payload))
        if rid:
            try:
                row = coordinator.get(rid)
            except ValueError:
                st.session_state.pop(active_key(payload), None)
                feedback = 'The rehearsal session reset. Capture a new recommendation to continue.'
    else:
        from .amr_connection import connection_profile
        from .intervention_service import transport_profile, observation_profile
        from .workspace_payload import database_url
        profile, missing = connection_profile(st.secrets)
        if profile is None:
            profile,missing=observation_profile(st.secrets)
        authorized = is_authorized(profile)
        if profile:
            try:
                service = website_service(profile, None if profile.calibration is None else transport_profile(st.secrets, profile.host))
                rid = st.session_state.get('warehouse_physical_review') if authorized else None
                if rid:
                    row = service.get(rid)
                    owned = True
            except Exception:
                missing.append('Website review audit permissions or service availability')
        url = database_url()
        if row is None and url:
            try:
                row = physical_review(url)
            except Exception:
                missing.append('Readable operator review audit')
        if not url:
            missing.append('Sensor database connection')
    result = panel(payload, public_review(row), feedback)
    result.update(authorized=authorized, owns_review=owned, can_unlock=profile is not None,
                  can_review=payload['mode']=='demo' or bool(service and not service.stop.is_set()),
                  missing=missing,
                  commands_enabled=bool(service and service.delivery_ready))
    return result


def handle_website_action(result):
    """Ignore browser evidence/identity. Recapture physical context on the server."""
    from .amr_connection import connection_profile, authorize
    from .intervention_service import transport_profile, observation_profile
    command = result.get('command')
    # There is deliberately no physical simulation/ACK endpoint.
    if command not in {'login','logout','create','decide'}:
        st.session_state.warehouse_review_feedback = 'Choose a permitted website review action.'
        return
    if command == 'logout':
        for key in ('warehouse_review_auth','warehouse_review_operator','warehouse_physical_review'):
            st.session_state.pop(key, None)
        st.session_state.warehouse_review_feedback = 'Operator session locked.'
        return
    profile, missing = connection_profile(st.secrets)
    if profile is None:
        profile,missing=observation_profile(st.secrets)
    if profile is None:
        st.session_state.warehouse_review_feedback = 'Complete the private review writer and operator access setup.'
        return
    if command == 'login':
        now = time.monotonic()
        if now-st.session_state.get('warehouse_review_attempt', -2) < 1:
            return
        st.session_state.warehouse_review_attempt = now
        operator = result.get('operator')
        if (not authorize(profile, result.get('access_code')) or not isinstance(operator, str)
                or re.fullmatch(r'[A-Za-z0-9_-]{1,40}', operator) is None):
            st.session_state.warehouse_review_feedback = 'Enter the private operator code and an alias using letters, numbers, underscore or hyphen.'
            return
        st.session_state.warehouse_review_auth = auth_tag(profile)
        st.session_state.warehouse_review_operator = operator
        st.session_state.warehouse_review_feedback = 'Operator session unlocked. Capture a recommendation to review.'
        return
    if not is_authorized(profile):
        st.session_state.warehouse_review_feedback = 'Unlock the operator session before recording a physical decision.'
        return
    try:
        service = website_service(profile, None if profile.calibration is None else transport_profile(st.secrets, profile.host))
        if command == 'create':
            row = service.create(uuid.uuid4().hex)
            st.session_state.warehouse_physical_review = row['review_id']
        else:
            rid = st.session_state.get('warehouse_physical_review')
            if not rid or result.get('review_id') != rid:
                raise ValueError('Capture a review in this operator session before deciding')
            service.decide(rid, decision=result.get('decision'), action=result.get('intervention'),
                           operator=st.session_state['warehouse_review_operator'], reason=result.get('reason'))
        physical_review.clear()
        st.session_state.warehouse_review_feedback = 'Decision workflow updated in the physical audit. Check the outcome below.'
    except (ValueError, TypeError) as error:
        st.session_state.warehouse_review_feedback = str(error)
    except Exception:
        st.session_state.warehouse_review_feedback = 'Website review is unavailable. Check audit permissions, service ownership and current sensor evidence.'


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
