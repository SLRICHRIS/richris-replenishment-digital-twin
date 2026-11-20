"""Private Streamlit operator session for server-owned physical route approval."""
import hashlib
import hmac
import re
import time
import uuid
import streamlit as st
from ..vision_control.contracts import key,identifier


def profile():
    missing=[]
    try:
        p=dict(st.secrets['vision_control'])
        for n,label in (('enabled','Physical route control enabled'),('commissioned','Attended camera and motor commissioning')):
            if p.get(n) is not True: missing.append(label)
        for n in ('mqtt_host','mqtt_username','mqtt_password','control_key','audit_url'):
            if not isinstance(p.get(n),str) or not p[n]: missing.append('Private route '+n.replace('_',' '))
        try: key(p.get('control_key'))
        except ValueError: missing.append('New private route signing key')
        p['access_code']=st.secrets['amr_connection']['access_code']
        if not isinstance(p['access_code'],str) or len(p['access_code'])<12: missing.append('Private operator access code')
        return (None if missing else p),missing
    except (KeyError,FileNotFoundError):
        return None,['Private route transport and audit setup','Attended camera and motor commissioning','ESP32 vision receiver upload','Windows USB-camera controller']


@st.cache_resource(max_entries=1,show_spinner=False,on_release=lambda s:s.close())
def service(p):
    from ..vision_control.service import Service
    return Service(p)


def tag(p): return hashlib.sha256(('vision:'+p['access_code']+p['control_key']).encode()).hexdigest()
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
            available=not s.stop.is_set()
            s.coordinator.touch(owner())
            value=s.coordinator.public(owner())
        except Exception: missing.append('Protected route audit or transport unavailable')
    else:
        s=st.session_state.get('vision_service')
        if s and not s.stop.is_set(): s.coordinator.cancel(owner())
    value.update(authorized=auth,can_unlock=p is not None,available=available,missing=missing,
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
        st.session_state.vision_feedback='Unlocked. Keep the physical route page open during execution'; return
    if not authorized(p): return
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
