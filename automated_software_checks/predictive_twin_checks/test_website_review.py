"""Website authorization, session isolation and server-context boundaries."""
from copy import deepcopy
from unittest.mock import Mock
import pytest
from backend_streamlit_and_telemetry.predictive_twin import human_review_workspace as web
from backend_streamlit_and_telemetry.predictive_twin import intervention_service as service
from backend_streamlit_and_telemetry.predictive_twin.amr_connection import ConnectionProfile
from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations


@pytest.fixture
def browser(monkeypatch):
    class State(dict):
        __getattr__ = dict.__getitem__
        __setattr__ = dict.__setitem__
    state = State()
    profile = ConnectionProfile('broker','subscriber','secret','postgresql+psycopg://worker:password@direct/amr','k'*32,example_calibrations()['amr01'])
    monkeypatch.setattr(web.st, 'session_state', state)
    monkeypatch.setattr(web.st, 'secrets', {})
    import backend_streamlit_and_telemetry.predictive_twin.amr_connection as connection
    monkeypatch.setattr(connection, 'connection_profile', lambda _: (profile, []))
    instance = Mock()
    instance.create.return_value = {'review_id':'a'*32}
    factory = Mock(return_value=instance)
    monkeypatch.setattr(web, 'website_service', factory)
    return state, profile, instance, factory


def login(state, profile):
    web.handle_website_action(dict(command='login',access_code=profile.access_code,operator='operator01'))
    assert state['warehouse_review_auth'] == web.auth_tag(profile)
    assert profile.access_code not in str(state)


def test_authorization_required_and_code_change_revokes_session(browser):
    state,profile,instance,factory=browser
    web.handle_website_action(dict(command='create',access_code=profile.access_code))
    assert not factory.called  # A supplied code is accepted only by the login action.
    web.handle_website_action(dict(command='login',access_code='wrong',operator='op'))
    assert not web.is_authorized(profile)
    state.pop('warehouse_review_attempt')
    login(state,profile)
    from dataclasses import replace
    assert not web.is_authorized(replace(profile,access_code='new-code'*8))
    web.handle_website_action(dict(command='create',evidence={'mode':'demo'},operator='forged'))
    instance.create.assert_called_once()
    # Browser evidence and identity never enter the service call.
    assert len(instance.create.call_args.args)==1 and not instance.create.call_args.kwargs


def test_decisions_require_review_owned_by_this_session(browser):
    state,profile,instance,factory=browser;login(state,profile)
    request=dict(command='decide',review_id='b'*32,decision='approve',intervention='pause',reason='Inspect',operator='forged',payload={'mode':'demo'})
    web.handle_website_action(request)
    assert not instance.decide.called
    state['warehouse_physical_review']='a'*32
    web.handle_website_action(request)
    assert not instance.decide.called
    request['review_id']='a'*32
    web.handle_website_action(request)
    instance.decide.assert_called_once_with('a'*32,decision='approve',action='pause',operator='operator01',reason='Inspect')
    web.handle_website_action(dict(command='logout'))
    assert not web.is_authorized(profile) and 'warehouse_physical_review' not in state


def test_physical_simulation_and_ack_injection_are_rejected(browser):
    state,profile,instance,factory=browser;login(state,profile)
    for command in ('response','acknowledge','observe'):
        web.handle_website_action(dict(command=command,review_id='a'*32))
    assert not factory.called


def test_public_panel_removes_operator_alias_and_reason():
    original={'decision':dict(decision='approve',action='pause',operator='private-name',reason='private note')}
    public=web.public_review(original)
    assert public=={'decision':dict(decision='approve',action='pause')}
    assert original['decision']['operator']=='private-name'


def test_transport_requires_all_explicit_private_opt_ins():
    config=dict(enabled=True,controller_ready=True,mqtt_username='reviewer',mqtt_password='secret')
    assert service.transport_profile({'intervention':config},'broker') is not None
    for key in config:
        missing=deepcopy(config);missing.pop(key)
        assert service.transport_profile({'intervention':missing},'broker') is None
    assert service.transport_profile({},'broker') is None


def test_service_recaptures_server_context_for_each_action():
    worker=service.WebsiteReviewService.__new__(service.WebsiteReviewService)
    import threading
    worker.lock=threading.RLock();worker._assert_owner=Mock();worker.coordinator=Mock()
    worker.stop=threading.Event();worker.transport=None
    first,second={'mode':'live','sequence':10},{'mode':'live','sequence':11}
    worker.read=Mock(side_effect=[first,second])
    worker.create('a'*32)
    worker.decide('a'*32,decision='approve',action='pause',operator='op',reason='Inspect')
    worker.coordinator.create.assert_called_once_with(first,'a'*32)
    assert worker.coordinator.decide.call_args.kwargs['payload']==second
    worker._assert_owner.side_effect=RuntimeError('lost lease')
    with pytest.raises(RuntimeError):worker.create('b'*32)
    assert worker.coordinator.create.call_count==1


def test_rehearsal_resource_reset_does_not_crash_the_dashboard(browser, monkeypatch):
    state,profile,instance,factory=browser
    state['warehouse_review_baseline']='old-review'
    coordinator=Mock();coordinator.get.side_effect=ValueError('Unknown review')
    monkeypatch.setattr(web,'demo_coordinator',lambda _:coordinator)
    from backend_streamlit_and_telemetry.predictive_twin.workspace_payload import workspace_payload
    payload=web.review_workspace(workspace_payload('demo'))
    assert payload['review'] is None and payload['can_review']
    assert 'reset' in payload['feedback'] and 'warehouse_review_baseline' not in state


def test_observation_profile_needs_existing_private_writer_and_code_only():
    private=dict(enabled=True,writer_url='postgresql+psycopg://worker:secret@direct/amr',access_code='x'*32)
    profile,missing=service.observation_profile(dict(amr_connection=private))
    assert profile.calibration is None and not missing
    assert 'secret' not in repr(profile) and profile.access_code not in repr(profile)
    for key in private:
        incomplete=deepcopy(private);incomplete.pop(key)
        assert service.observation_profile(dict(amr_connection=incomplete))[0] is None
    with pytest.raises(ValueError,match='cannot enable motor'):
        service.WebsiteReviewService(profile,transport=object())


def test_observation_website_action_uses_server_context_without_calibration(browser,monkeypatch):
    state,old,instance,factory=browser
    import backend_streamlit_and_telemetry.predictive_twin.amr_connection as connection
    monkeypatch.setattr(connection,'connection_profile',lambda _: (None,['Measured calibration']))
    monkeypatch.setattr(web.st,'secrets',dict(amr_connection=dict(enabled=True,writer_url=old.writer_url,access_code=old.access_code)))
    profile,_=service.observation_profile(web.st.secrets)
    login(state,profile)
    web.handle_website_action(dict(command='create',evidence={'forged':'sensor'}))
    factory.assert_called_once_with(profile,None)
    assert len(instance.create.call_args.args)==1 and not instance.create.call_args.kwargs
