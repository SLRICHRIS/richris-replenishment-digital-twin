from pathlib import Path
import unittest
from streamlit.testing.v1 import AppTest

ROOT = Path(__file__).resolve().parents[2]


class StreamlitHostTests(unittest.TestCase):
    def test_legacy_drive_events_end_cloud_control_without_dispatching_a_hold(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        from backend_streamlit_and_telemetry.predictive_twin import manual_control_workspace as manual

        event = dict(action='manual_control', command='hold', control_mode='manual', nonce='one')
        state = {'warehouse-workspace': event, 'warehouse_sensor_mode': 'live',
                 'manual_view': True, 'manual_auth': 'previous-auth'}
        with patch.object(host, 'st', SimpleNamespace(session_state=state)), \
                patch.object(manual, 'handle') as handle, \
                patch.object(manual, 'cancel_existing') as cancel, \
                patch.object(manual, 'live_service') as start:
            host.handle_drive_input()
            host.handle_drive_input()
            cancel.assert_called_once_with()
            self.assertFalse(state['manual_view'])
            self.assertNotIn('manual_auth', state)
            for command in ('login', 'hold', 'release', 'stop'):
                state['warehouse-workspace'] = dict(event, nonce=command, command=command)
                host.handle_drive_input()
            self.assertEqual(cancel.call_count, 5)
            state['warehouse-workspace'] = dict(event, nonce='other', action='vision_execution')
            host.handle_drive_input()
            self.assertEqual(cancel.call_count, 5)
            handle.assert_not_called()
            start.assert_not_called()

    def test_direct_drive_frame_does_not_start_a_manual_mqtt_service(self):
        import json
        from unittest.mock import patch
        from backend_streamlit_and_telemetry.predictive_twin import manual_control_workspace as manual
        app = AppTest.from_file(str(ROOT / 'streamlit_app.py'))
        app.session_state['manual_view'] = True
        app.session_state['manual_auth'] = 'previous-auth'
        with patch.object(manual, 'workspace') as old_workspace, \
                patch.object(manual, 'live_service') as start:
            app.run(timeout=30)
            self.assertFalse(app.exception)
            payload = json.loads(app.get('component_instance')[0].proto.json_args)['python_twin']
            self.assertEqual(payload['manual_control'], {'transport': 'direct_wifi'})
            self.assertFalse(app.session_state['manual_view'])
            self.assertNotIn('manual_auth', app.session_state)
            old_workspace.assert_not_called()
            start.assert_not_called()

    def test_mission_camera_button_opens_sidebar_camera_and_preserves_source(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        from backend_streamlit_and_telemetry.vision_control import browser_streamlit_workspace as camera

        app = AppTest.from_file(str(ROOT / 'streamlit_app.py'))
        action = dict(action='camera_panel', open=True, nonce='open-camera')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', return_value=action), \
                patch.object(camera, 'render_browser_camera') as render:
            app.run(timeout=30)
            self.assertFalse(app.exception)
            self.assertTrue(app.sidebar.checkbox[0].value)
            self.assertEqual(app.session_state.warehouse_sensor_mode, 'demo')
            render.assert_called()
            app.sidebar.checkbox[0].uncheck().run(timeout=30)
            self.assertFalse(app.exception)
            self.assertFalse(app.sidebar.checkbox[0].value)

    def test_selected_trial_survives_tick_and_native_detailed_readings(self):
        from unittest.mock import patch
        import json
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        original = host.WAREHOUSE_WORKSPACE
        def dispatch(**kwargs):
            original(**kwargs)
            return dict(action='demo_trial', trial='disagreement', nonce='select-fault')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=dispatch):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
            app.run(timeout=30)
        self.assertFalse(app.exception)
        payload = json.loads(app.get('component_instance')[0].proto.json_args)['python_twin']
        self.assertEqual(payload['demo_trial']['id'], 'disagreement')
        self.assertTrue(payload['robots']['amr01']['derived']['advisory'])
        app.sidebar.radio[0].set_value('Model inspection').run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.selectbox[0].value, 'disagreement')
        self.assertTrue(any('Sustained model disagreement' in message.value for message in app.warning))

    def test_generated_trial_actions_cannot_override_live_source_or_admit_unknown_inputs(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        for mode, trial in [('live', 'disagreement'), ('demo', '../private'), ('demo', [])]:
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py'))
            app.session_state.warehouse_sensor_mode = mode
            with patch.object(host, 'WAREHOUSE_WORKSPACE', return_value=dict(action='demo_trial', trial=trial, nonce='invalid-live-trial')):
                app.run(timeout=30)
            self.assertFalse(app.exception)
            self.assertEqual(app.session_state.warehouse_sensor_mode, mode)
            self.assertNotIn('warehouse_demo_trial', app.session_state)

    def test_final_view_action_also_stops_previous_panel_polling_when_events_are_coalesced(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        app = AppTest.from_file(str(ROOT / 'streamlit_app.py'))
        app.session_state.warehouse_connection_requested = True
        action = dict(action='database_browse', dataset='amr_sensor_samples', active=True, nonce='to-archive')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', return_value=action):
            app.run(timeout=30)
        self.assertFalse(app.exception)
        self.assertTrue(app.session_state.warehouse_database_requested)
        self.assertFalse(app.session_state.warehouse_connection_requested)
        action = dict(action='connection_view', active=True, nonce='to-connection')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', return_value=action):
            app.run(timeout=30)
        self.assertFalse(app.exception)
        self.assertFalse(app.session_state.warehouse_database_requested)
        self.assertTrue(app.session_state.warehouse_connection_requested)
        action = dict(action='sensor_source', mode='demo', nonce='to-models')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', return_value=action):
            app.run(timeout=30)
        self.assertFalse(app.exception)
        self.assertFalse(app.session_state.warehouse_database_requested)
        self.assertFalse(app.session_state.warehouse_connection_requested)

    def test_unconfigured_connection_view_uses_the_real_session_resource_without_starting_a_recorder(self):
        from unittest.mock import patch
        import json
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        action = dict(action='connection_view', active=True, nonce='unconfigured-link')
        original_component = host.WAREHOUSE_WORKSPACE
        def dispatch(**kwargs):
            original_component(**kwargs)
            return action
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=dispatch):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
            app.run(timeout=30)
        self.assertFalse(app.exception)
        link = json.loads(app.get('component_instance')[0].proto.json_args)['python_twin']['amr_connection']
        self.assertFalse(link['configured'])
        self.assertFalse(link['running'])
        self.assertFalse(link['subscribed'])
        self.assertFalse(link['insights']['ready'])
        self.assertTrue(link['missing'])

    def test_connection_controls_require_authorization_and_never_export_private_configuration(self):
        from unittest.mock import patch, Mock
        import json
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        from backend_streamlit_and_telemetry.predictive_twin.amr_connection import ConnectionController, ConnectionProfile
        from backend_streamlit_and_telemetry.predictive_twin.demo import example_calibrations
        profile = ConnectionProfile('owner.emqxsl.com', 'private-reader', 'private-mqtt-password',
                                    'postgresql://private-writer-url', 'private-operator-access-code',
                                    example_calibrations()['amr01'])
        controller = Mock(spec=ConnectionController)
        controller.snapshot.return_value = dict(state='disconnected', detail='Waiting', subscribed=False, metrics={})
        action = dict(action='connection_view', active=True, nonce='open-link')
        original_component = host.WAREHOUSE_WORKSPACE
        def dispatch(**kwargs):
            original_component(**kwargs)
            return action
        module = 'backend_streamlit_and_telemetry.predictive_twin.amr_connection'
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=dispatch), \
                patch(module + '.session_connector', return_value=controller), \
                patch(module + '.connection_profile', return_value=(profile, [])):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
            app.run(timeout=30)
            self.assertFalse(app.exception)
            raw = app.get('component_instance')[0].proto.json_args
            for private in [profile.password, profile.writer_url, profile.access_code]:
                self.assertNotIn(private, raw)
            self.assertTrue(json.loads(raw)['python_twin']['amr_connection']['configured'])
            action.update(action='connection_control', command='connect', access_code='wrong', nonce='bad-code')
            app.run(timeout=30)
            controller.start.assert_not_called()
            app.session_state.warehouse_connection_attempt = -2
            action.update(access_code=profile.access_code, nonce='accepted-code')
            app.run(timeout=30)
            controller.start.assert_called_once_with(profile)
            self.assertEqual(app.session_state.warehouse_sensor_mode, 'live')
            action.update(command='disconnect', access_code='', nonce='stop-link')
            app.run(timeout=30)
            controller.disconnect.assert_called_once()
            self.assertFalse(app.exception)

    def test_human_review_rehearsal_keeps_approval_ack_and_observations_separate(self):
        import json
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        action = {'action':'human_review','command':'create','nonce':'review-create'}
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=lambda **kw:action):
            app=AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
            self.assertFalse(app.exception)
            rid=app.session_state['warehouse_review_baseline']
            action.update(command='decide',review_id=rid,decision='approve',intervention='pause',reason='Inspect the sensor alert',nonce='review-approve')
            app.run(timeout=30)
            action.update(command='response',nonce='review-ack')
            app.run(timeout=30)
            from backend_streamlit_and_telemetry.predictive_twin.human_review_workspace import demo_coordinator
            # Inspect the next emitted display snapshot, not an independent controller.
            snapshots=[]
            def capture(**kw):
                snapshots.append(kw['python_twin']['human_review'])
                return None
            with patch.object(host,'WAREHOUSE_WORKSPACE',side_effect=capture):app.run(timeout=30)
            self.assertEqual(snapshots[-1]['review']['state'],'acknowledged')
            action.update(nonce='review-observations')
            app.run(timeout=30)
            with patch.object(host,'WAREHOUSE_WORKSPACE',side_effect=capture):app.run(timeout=30)
            self.assertEqual(snapshots[-1]['review']['state'],'verified')
            self.assertEqual(snapshots[-1]['review']['evidence']['source'],'demo')
            self.assertFalse(app.exception)

    def test_sensor_details_and_source_switch_stay_within_sensor_scope(self):
        app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
        app.sidebar.radio[0].set_value('Model inspection').run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.title[0].value, 'Detailed sensor readings')
        self.assertEqual(len(app.get('component_instance')), 0)
        self.assertFalse(app.tabs)
        self.assertFalse(app.number_input)
        self.assertFalse(any('stock' in b.label.lower() or 'task event' in b.label.lower() for b in app.button))
        next(r for r in app.radio if r.label == 'Data source').set_value('live').run(timeout=30)
        self.assertFalse(app.exception)
        self.assertTrue(any('not configured' in item.value for item in app.warning))
        next(b for b in app.button if b.label == 'Back to dashboard').click().run(timeout=30)
        self.assertEqual(len(app.get('component_instance')), 1)

    def test_default_original_workspace_identity_and_python_payload(self):
        app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
        self.assertFalse(app.exception)
        components = app.get('component_instance')
        self.assertEqual(len(components), 1)
        first = components[0].proto.id
        import json
        args = json.loads(components[0].proto.json_args)
        self.assertEqual(args['python_twin']['mode'], 'demo')
        self.assertEqual(set(args['python_twin']['robots']), {'amr01'})
        self.assertNotIn('password', components[0].proto.json_args)
        self.assertEqual(components[0].proto.component_name,
                         'backend_streamlit_and_telemetry.streamlit_dashboard_host.replenish_workspace')
        app.run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.get('component_instance')[0].proto.id, first)

    def test_detailed_readings_distinguish_calibration_from_database_configuration(self):
        from unittest.mock import patch, Mock
        from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase
        module = 'backend_streamlit_and_telemetry.predictive_twin.workspace_payload'
        app = AppTest.from_file(str(ROOT / 'streamlit_app.py'))
        app.secrets['database'] = {'url': 'postgresql://private:secret@host/db'}
        with patch(module + '.database_reader', return_value=Mock(spec=SensorDatabase)):
            app.run(timeout=30)
            app.sidebar.radio[0].set_value('Model inspection').run(timeout=30)
            next(r for r in app.radio if r.label == 'Data source').set_value('live').run(timeout=30)
        self.assertFalse(app.exception)
        self.assertTrue(any('Measured calibration required' in item.value for item in app.warning))
        self.assertFalse(any('not configured or reachable' in item.value for item in app.warning))

    def test_uncalibrated_physical_readings_stale_suppression_and_archive_navigation(self):
        from unittest.mock import patch, Mock
        from backend_streamlit_and_telemetry.predictive_twin.database import SensorDatabase
        from backend_streamlit_and_telemetry.predictive_twin import dashboard, database_inspection
        module = 'backend_streamlit_and_telemetry.predictive_twin.workspace_payload'
        db = Mock(spec=SensorDatabase)
        data = dict(fresh=True, label='Receiving physical telemetry',
                    received_at='2026-11-17T16:01:46+00:00', seq=2660, age_s=.5,
                    measurements=dict(left_pulses_total=0, right_pulses_total=3,
                                      left_pulse_hz=0, right_pulse_hz=2,
                                      gyro_z_rad_s=.02, yaw_estimate_deg=2,
                                      battery_voltage_v=.82, battery_current_a=-.0003,
                                      battery_power_w=-.000246, device_soc_estimate_percent=100),
                    recommendations=['Battery voltage is below 1 V. Check battery power.'],
                    model_detail='Wheel direction and measured calibration are required before pose and runtime predictions.')
        app = AppTest.from_file(str(ROOT / 'streamlit_app.py'))
        app.secrets['database'] = {'url': 'postgresql://private:secret@host/db'}
        app.session_state.warehouse_sensor_mode = 'live'
        with patch(module + '.database_reader', return_value=db), \
                patch.object(dashboard, 'display_payload', return_value=data), \
                patch.object(database_inspection, 'database_connection', return_value=(db, 'ready')), \
                patch.object(database_inspection, 'read_physical_records', return_value=[dict(robot_id='amr01', seq=2660, battery_voltage_v=.82)]):
            app.run(timeout=30)
            app.sidebar.radio[0].set_value('Model inspection').run(timeout=30)
            self.assertFalse(app.exception)
            self.assertTrue(any(item.value == 'Receiving physical telemetry' for item in app.success))
            self.assertTrue(any('Measured calibration required' in item.value for item in app.warning))
            values = {item.label: item.value for item in app.metric}
            self.assertEqual(values['Input voltage'], '0.820 V')
            self.assertEqual(values['Left · total / rate'], '0 pulses / 0.00 Hz')
            self.assertEqual(values['Gyro Z'], '0.02000 rad/s')
            self.assertFalse(any('SOC' in label or 'runtime' in label.lower() for label in values))
            self.assertFalse(db.read_snapshot.called)
            data.update(fresh=False, label='Telemetry out of date')
            app.run(timeout=30)
            self.assertFalse(app.exception)
            self.assertTrue(all('Unavailable' in item.value for item in app.metric))
            next(button for button in app.button if button.label == 'Inspect stored packets').click().run(timeout=30)
            self.assertFalse(app.exception)
            self.assertEqual(app.sidebar.radio[0].value, 'Database')
            self.assertEqual(app.selectbox[0].value, 'amr_commissioning_samples')
            self.assertEqual(app.dataframe[0].value.iloc[0]['seq'], 2660)
            self.assertFalse(any('No stored records' in item.value for item in app.info))

    def test_component_can_open_model_inspection_without_mutating_an_existing_widget(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        action = dict(action='model_inspection', nonce='test-inspection-1')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', return_value=action):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.title[0].value, 'Detailed sensor readings')
        self.assertEqual(app.sidebar.radio[0].value, 'Model inspection')

    def test_database_is_visible_without_calibration_or_connection(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        action = dict(action='database_inspection', nonce='test-database-1')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', return_value=action):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.title[0].value, 'Sensor database')
        self.assertEqual(app.sidebar.radio[0].value, 'Database')
        self.assertTrue(any('Database not connected' in item.value for item in app.warning))
        self.assertEqual([tab.label for tab in app.tabs], ['Stored records', 'Table attributes'])
        self.assertEqual(app.selectbox[0].options[0], 'Device telemetry')
        self.assertEqual(app.selectbox[0].value, 'amr_commissioning_samples')
        self.assertFalse(app.code)

    def test_database_empty_and_read_failure_are_distinct(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        db = SimpleNamespace(read_records=lambda *args, **kwargs: [])
        module = 'backend_streamlit_and_telemetry.predictive_twin.database_inspection'
        with patch(module + '.database_connection', return_value=(db, 'ready')), \
                patch(module + '.read_physical_records', return_value=[]):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
            app.sidebar.radio[0].set_value('Database').run(timeout=30)
            self.assertFalse(app.exception)
            self.assertTrue(any('no stored records' in item.value.lower() for item in app.info))
            self.assertTrue(any('Device telemetry' in item.value for item in app.info))
            self.assertFalse(app.download_button)
            app.selectbox[0].set_value('amr_sensor_samples').run(timeout=30)
            self.assertTrue(any('Calibrated sensor samples' in item.value for item in app.info))
            self.assertTrue(any('Choose Device telemetry' in item.value for item in app.caption))
        with patch(module + '.database_connection', return_value=(None, 'schema_not_ready')):
            app.run(timeout=30)
            self.assertFalse(app.exception)
            self.assertTrue(any('database setup needs attention' in item.value for item in app.warning))

    def test_shared_archive_actions_preserve_the_workspace_and_stop_polling(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        from backend_streamlit_and_telemetry.predictive_twin.database_inspection import database_preview
        import json
        database_preview.clear()
        original_component = host.WAREHOUSE_WORKSPACE
        def dispatch(**kwargs):
            original_component(**kwargs)
            return action
        action = dict(action='database_browse', dataset='amr_encoder_readings', active=True, nonce='archive-open')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=dispatch):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
            first = app.get('component_instance')[0].proto.id
            initial_args = json.loads(app.get('component_instance')[0].proto.json_args)['python_twin']
            self.assertNotIn('database', initial_args)
            app.run(timeout=30)  # The next scheduled fragment tick reads the selected archive.
        self.assertFalse(app.exception)
        self.assertEqual(app.get('component_instance')[0].proto.id, first)
        args = json.loads(app.get('component_instance')[0].proto.json_args)['python_twin']
        self.assertEqual(app.sidebar.radio[0].value, 'Warehouse dashboard')
        self.assertEqual(args['database']['dataset'], 'amr_encoder_readings')
        self.assertEqual(args['database']['request_id'], 'archive-open')
        self.assertEqual(args['database']['rows_state'], 'unavailable')
        self.assertTrue(args['database']['attributes'])
        action.update(active=False, nonce='archive-close')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=dispatch):
            app.run(timeout=30)
            app.run(timeout=30)
        args = json.loads(app.get('component_instance')[0].proto.json_args)['python_twin']
        self.assertNotIn('database', args)
        action.update(dataset='pg_authid', active=True, nonce='bad-dataset')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=dispatch):
            app.run(timeout=30)
        self.assertFalse(app.exception)
        self.assertFalse(app.session_state.warehouse_database_requested)

    def test_source_changes_wait_for_the_next_tick_without_a_full_app_rerun(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        import json
        original_component = host.WAREHOUSE_WORKSPACE
        def dispatch(**kwargs):
            original_component(**kwargs)
            return dict(action='sensor_source', mode='live', nonce='source-live')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=dispatch):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
            component = app.get('component_instance')[0]
            first = component.proto.id
            self.assertEqual(json.loads(component.proto.json_args)['python_twin']['mode'], 'demo')
            app.run(timeout=30)
        self.assertFalse(app.exception)
        component = app.get('component_instance')[0]
        self.assertEqual(component.proto.id, first)
        self.assertEqual(json.loads(component.proto.json_args)['python_twin']['mode'], 'live')

    def test_archive_preview_limits_rows_and_does_not_expose_driver_errors(self):
        from unittest.mock import patch, Mock
        from datetime import datetime, timezone
        from backend_streamlit_and_telemetry.predictive_twin.database_inspection import database_preview
        module = 'backend_streamlit_and_telemetry.predictive_twin.database_inspection'
        db = Mock()
        db.read_records.return_value = [{'robot_id':'amr01', 'received_at':datetime(2026, 1, 1, tzinfo=timezone.utc)}]
        database_preview.clear()
        with patch(module + '.database_connection', return_value=(db, 'ready')):
            result = database_preview('amr_sensor_samples', 'read-ok')
            db.read_records.assert_called_once_with('amr_sensor_samples', limit=50)
            self.assertEqual(result['rows'][0]['received_at'], '2026-01-01T00:00:00+00:00')
            repeated = database_preview('amr_sensor_samples', 'read-again')
            self.assertEqual(result['rows'], repeated['rows'])
            self.assertNotEqual(result, repeated, 'identical re-requested rows must produce new component args')
            self.assertEqual(repeated['request_id'], 'read-again')
            db.read_records.side_effect = RuntimeError('postgresql://private:secret@host/db')
            failed = database_preview('amr_sensor_samples', 'read-failed')
            self.assertEqual(failed['state'], 'ready')
            self.assertEqual(failed['rows_state'], 'error')
            self.assertEqual(failed['rows'], [])
            self.assertNotIn('secret', str(failed))
            with self.assertRaises(ValueError):
                database_preview('pg_authid', 'not-allowed')
        database_preview.clear()


class VisionPhysicalWorkspaceTests(unittest.TestCase):
    def test_uncommissioned_profile_can_check_connections_but_cannot_capture_or_drive(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry.predictive_twin import vision_execution_workspace as v
        settings = dict(vision_control=dict(enabled=True, commissioned=False,
            mqtt_host='broker.test', mqtt_username='route', mqtt_password='fixture',
            audit_url='postgresql+psycopg://route@test/amr', control_key='1' * 64),
            amr_connection=dict(access_code='operator-fixture'))
        app = AppTest.from_function(self._run_route_preflight)
        app.secrets.update(settings)
        with patch.object(v, 'service') as transport:
            app.run(timeout=30)
            self.assertFalse(app.exception)
            self.assertTrue(app.session_state['login_available'])
            self.assertIn('Connection checks only', app.session_state['vision_feedback'])
            transport.assert_not_called()

    @staticmethod
    def _run_route_preflight():
        import streamlit as st
        from backend_streamlit_and_telemetry.predictive_twin import vision_execution_workspace as v
        profile, _ = v.profile()
        st.session_state.login_available = profile is not None
        v.handle(dict(command='login', operator='tester', access_code='operator-fixture'), 'live')
        assert v.authorized(profile)
        assert st.session_state.vision_view and not st.session_state.manual_view
        for cmd in ('capture', 'decide', 'battery_decision'):
            v.handle(dict(command=cmd), 'live')
            assert 'Connection checks only' in st.session_state.vision_feedback

    def test_missing_commissioning_never_starts_physical_transport_or_exports_secrets(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry.predictive_twin import vision_execution_workspace as v
        with patch.object(v.st, 'secrets', {}), patch.object(v, 'service') as transport:
            result=v.workspace('live')
            self.assertFalse(result['can_unlock'])
            self.assertFalse(result['authorized'])
            self.assertFalse(result['ready'])
            self.assertTrue(result['missing'])
            transport.assert_not_called()
            self.assertNotIn('control_key',result)
            self.assertNotIn('audit_url',result)

    def test_existing_receiver_unlocks_only_connection_checks_without_route_secrets(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry.predictive_twin import vision_execution_workspace as v
        settings = dict(manual_control=dict(enabled=True, mqtt_host='private.invalid',
            mqtt_username='test-receiver', mqtt_password='test-only', control_key='2' * 64,
            audit_url='postgresql+psycopg://route@test/amr'), amr_connection=dict(access_code='operator-fixture'))
        with patch.object(v.st, 'secrets', settings):
            profile, issues = v.profile()
            self.assertEqual(profile['transport'], 'browser_receiver')
            self.assertNotEqual(profile['control_key'], profile['drive_key'])
            self.assertFalse(profile['commissioned'])
            self.assertTrue(issues)
            settings['vision_control'] = dict(transport='browser_receiver', enabled=False)
            self.assertIsNone(v.profile()[0])
            settings['vision_control'].update(enabled=True, commissioned=True)
            self.assertFalse(v.profile()[0]['commissioned'])
            settings['vision_browser'] = dict(enabled=True, transport_latency_verified=True)
            self.assertTrue(v.profile()[0]['commissioned'])
            settings['vision_control'] = dict(enabled=False)
            self.assertIsNone(v.profile()[0])
        app = AppTest.from_function(self._run_route_preflight)
        app.secrets.update({k: settings[k] for k in ('manual_control', 'amr_connection')})
        with patch.object(v, 'service') as transport:
            app.run(timeout=30)
            self.assertFalse(app.exception)
            self.assertTrue(app.session_state['login_available'])
            transport.assert_not_called()
