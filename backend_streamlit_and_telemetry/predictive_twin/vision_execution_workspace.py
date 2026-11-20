"""Private Streamlit operator session for server-owned physical route approval."""
import hashlib
import hmac
import re
import time
import uuid
from collections.abc import Mapping
import streamlit as st
from ..vision_control.contracts import key,identifier


def profile():
    try:
        settings = st.secrets.get('vision_control')
        operator = st.secrets.get('amr_connection', {})
    except FileNotFoundError:
        settings, operator = None, {}
    if not isinstance(settings, Mapping):
        return None, ['Add [vision_control] to the Streamlit app secrets for physical routes.']
    p = dict(settings)
    missing = []
    if p.get('enabled') is not True:
        missing.append('Enable the route connection in [vision_control].')
    for name in ('mqtt_host', 'mqtt_username', 'mqtt_password', 'audit_url'):
        if not isinstance(p.get(name), str) or not p[name].strip():
            missing.append(f'Set [vision_control].{name} in Streamlit app secrets.')
    try:
        key(p.get('control_key'))
    except ValueError:
        missing.append('Set a private 64-character route signing key in [vision_control].control_key.')
    p['access_code'] = operator.get('access_code') if isinstance(operator, Mapping) else None
    if not isinstance(p['access_code'], str) or not 12 <= len(p['access_code']) <= 256:
        missing.append('Set the operator access code in [amr_connection].')
    if missing:
        return None, missing
    if p.get('commissioned') is not True:
        missing.append('Connection checks only. Complete attended camera and motor commissioning before enabling routes.')
    return p, missing


@st.cache_resource(max_entries=1,show_spinner=False,on_release=lambda s:s.close())
def service(p):
    from ..vision_control.service import Service
    return Service(p)


def tag(p): return hashlib.sha256(('vision:'+str(p.get('commissioned') is True)+':'+p['access_code']+p['control_key']).encode()).hexdigest()
def authorized(p): return bool(p and st.session_state.get('vision_auth')==tag(p))
def owner():
    if 'vision_owner' not in st.session_state: st.session_state.vision_owner=uuid.uuid4().hex
    return st.session_state.vision_owner


def workspace(mode):
    p,missing=profile(); auth=authorized(p); value=dict(scene=None,ready=False,review=None)
    available=False
    if auth and st.session_state.get('vision_view') and mode=='live':
        try:
            s=service(p)
            if s.stop.is_set():
                service.clear(); s=service(p)
            st.session_state.vision_service=s
            s.coordinator.touch(owner())
            value=s.coordinator.public(owner())
            value['transport'] = s.public_transport()
            available = s.connected and not s.stop.is_set()
        except Exception: missing.append('Protected route audit or transport unavailable')
    else:
        s=st.session_state.get('vision_service')
        if s and not s.stop.is_set(): s.coordinator.cancel(owner())
    commissioned = bool(p and p.get('commissioned') is True)
    if not commissioned:
        value['ready'] = False
    value.update(authorized=auth,can_unlock=p is not None,available=available,commissioned=commissioned,missing=missing,
        feedback=st.session_state.get('vision_feedback',''),physical_mode=mode=='live',
        feedback_nonce=st.session_state.get('vision_feedback_nonce',''))
    return value


def handle(result,mode):
    cmd=result.get('command')
    if cmd not in ('view','login','logout','capture','decide','battery_decision','stop'): return
    p,_=profile()
    if cmd=='view':
        if 'control_mode' in result: return  # Host already synchronized both control views.
        if type(result.get('active')) is bool:
            st.session_state.vision_view=result['active']
            if not result['active'] and authorized(p):
                try:
                    s=st.session_state.get('vision_service')
                    if s and not s.stop.is_set(): s.coordinator.cancel(owner())
                except Exception: pass
        return
    if cmd=='logout':
        if authorized(p):
            try:
                s=st.session_state.get('vision_service')
                if s and not s.stop.is_set(): s.coordinator.cancel(owner())
            except Exception: pass
        st.session_state.pop('vision_auth',None)
        st.session_state.vision_feedback='Operator session locked; active route stop requested'
        return
    if mode!='live':
        st.session_state.vision_feedback='Select Physical sensor mode before using physical route execution'; return
    if not p:
        st.session_state.vision_feedback='Complete the private route setup and physical commissioning first'; return
    if cmd=='login':
        now=time.monotonic()
        if now-st.session_state.get('vision_attempt',-2)<1: return
        st.session_state.vision_attempt=now
        code=result.get('access_code'); alias=result.get('operator')
        if not isinstance(code,str) or len(code)>256 or not hmac.compare_digest(code,p['access_code']) or not isinstance(alias,str) or re.fullmatch(r'[A-Za-z0-9_-]{1,40}',alias) is None:
            st.session_state.vision_feedback='Operator code or alias was not accepted'; return
        st.session_state.vision_auth=tag(p); st.session_state.vision_operator=alias
        st.session_state.vision_feedback = ('Operator session unlocked.' if p.get('commissioned') is True
            else 'Operator session unlocked for connection checks. Route execution is disabled.')
        return
    if not authorized(p): return
    if cmd != 'stop' and p.get('commissioned') is not True:
        st.session_state.vision_feedback='Connection checks only. Physical routes require completed camera and motor commissioning.'
        return
    try:
        s=service(p)
        if s.stop.is_set(): raise ValueError('Route coordinator unavailable; no movement is enabled')
        if cmd=='stop': s.coordinator.cancel(owner())
        elif not st.session_state.get('vision_view'): raise ValueError('Open the physical route page before reviewing')
        elif cmd=='capture': s.coordinator.capture(owner(),st.session_state.vision_operator,[result.get('goal_x'),result.get('goal_y')])
        elif cmd=='decide':
            rid=identifier(result.get('review_id'))
            s.coordinator.decide(owner(),rid,result.get('decision'),result.get('reason'))
        elif cmd=='battery_decision':
            rid=identifier(result.get('review_id'))
            s.coordinator.battery_decide(owner(),rid,result.get('choice'),result.get('reason'))
        st.session_state.vision_feedback='Route workflow updated. Check execution status and camera evidence below'
    except ValueError as e: st.session_state.vision_feedback=str(e)
    except Exception: st.session_state.vision_feedback='Protected route audit or transport unavailable; no retry is queued'
    st.session_state.vision_feedback_nonce=result.get('nonce','')
