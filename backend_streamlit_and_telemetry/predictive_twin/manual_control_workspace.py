"""Private server session for attended, one-shot motor control."""
import hashlib
import hmac
import re
import time
import uuid
import streamlit as st
from ..vision_control.contracts import key, identifier


def profile():
    try:
        p = dict(st.secrets['manual_control'])
        missing = []
        if p.get('enabled') is not True:
            missing.append('Manual motor control enabled in private settings')
        for name in ('mqtt_host', 'mqtt_username', 'mqtt_password', 'control_key', 'audit_url'):
            if not isinstance(p.get(name), str) or not p[name]:
                missing.append('Private manual ' + name.replace('_', ' '))
        try: key(p.get('control_key'))
        except ValueError: missing.append('Shared ESP32 manual signing key')
        p['access_code'] = st.secrets['amr_connection']['access_code']
        if not isinstance(p['access_code'], str) or len(p['access_code']) < 12:
            missing.append('Existing private operator access code')
        return (None if missing else p), missing
    except (KeyError, FileNotFoundError):
        return None, ['Private website MQTT command profile', 'Restricted PostgreSQL approval audit connection', 'Updated ESP32 command receiver upload']


@st.cache_resource(max_entries=1, show_spinner=False)
def service(p):
    from ..vision_control.service import ManualService
    return ManualService(p)


def live_service(p):
    s = service(p)
    if s.stop.is_set():
        service.clear()
        s = service(p)
    st.session_state.manual_service = s
    return s


def owner():
    if 'manual_owner' not in st.session_state:
        st.session_state.manual_owner = uuid.uuid4().hex
    return st.session_state.manual_owner


def tag(p): return hashlib.sha256(('manual:' + p['access_code'] + p['control_key']).encode()).hexdigest()
def authorized(p): return bool(p and st.session_state.get('manual_auth') == tag(p))


def cancel_existing():
    s = st.session_state.get('manual_service')
    if s and not s.stop.is_set():
        try: s.coordinator.cancel(owner())
        except Exception: pass


def workspace(mode):
    p, missing = profile()
    auth = authorized(p)
    value = dict(ready=False, hardware=None, review=None, busy=False)
    if auth and st.session_state.get('manual_view') and mode == 'live':
        try:
            s = live_service(p)
            s.coordinator.touch(owner())
            value = s.coordinator.public(owner())
            value['transport'] = s.public_transport()
        except Exception:
            missing.append('Manual transport unavailable or another controller owns AMR-01')
    else:
        cancel_existing()
    value.update(authorized=auth, can_unlock=p is not None, missing=missing,
                 physical_mode=mode == 'live', feedback=st.session_state.get('manual_feedback', ''))
    return value


def handle(result, mode):
    cmd = result.get('command')
    if cmd not in ('view', 'login', 'logout', 'prepare', 'approve', 'stop'):
        return
    p, _ = profile()
    if cmd == 'view':
        if type(result.get('active')) is bool:
            st.session_state.manual_view = result['active']
            if not result['active']: cancel_existing()
        return
    if cmd == 'logout':
        cancel_existing()
        st.session_state.pop('manual_auth', None)
        return
    if mode != 'live' or not p:
        st.session_state.manual_feedback = 'Select the physical source and complete the private manual connection setup'
        return
    if cmd == 'login':
        now = time.monotonic()
        if now - st.session_state.get('manual_attempt', -2) < 1: return
        st.session_state.manual_attempt = now
        code, alias = result.get('access_code'), result.get('operator')
        if not isinstance(code, str) or len(code) > 256 or not hmac.compare_digest(code, p['access_code']) or not isinstance(alias, str) or re.fullmatch(r'[A-Za-z0-9_-]{1,40}', alias) is None:
            st.session_state.manual_feedback = 'Operator code or alias was not accepted'
            return
        st.session_state.manual_auth = tag(p)
        st.session_state.manual_operator = alias
        st.session_state.manual_feedback = 'Session enabled. Wait for fresh ESP32 feedback before preparing a move.'
        return
    if not authorized(p): return
    try:
        if not st.session_state.get('manual_view'): raise ValueError('Open the manual control page first')
        s = live_service(p)
        if cmd == 'stop': s.coordinator.cancel(owner())
        elif cmd == 'prepare': s.coordinator.capture(owner(), st.session_state.manual_operator, result.get('direction'), result.get('pwm'))
        elif cmd == 'approve': s.coordinator.approve(owner(), identifier(result.get('review_id')), result.get('reason'))
        st.session_state.manual_feedback = 'Check the controller status below. No automatic repeat is enabled.'
    except ValueError as exc: st.session_state.manual_feedback = str(exc)
    except Exception: st.session_state.manual_feedback = 'Private transport unavailable or another controller owns AMR-01; no retry is queued'
