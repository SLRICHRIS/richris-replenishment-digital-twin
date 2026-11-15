from pathlib import Path
import unittest
from streamlit.testing.v1 import AppTest

ROOT = Path(__file__).resolve().parents[2]


class StreamlitHostTests(unittest.TestCase):
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
        self.assertEqual(app.selectbox[0].options[0], 'All sensor measurements')
        self.assertFalse(app.code)

    def test_database_empty_and_read_failure_are_distinct(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        db = SimpleNamespace(read_records=lambda *args, **kwargs: [])
        module = 'backend_streamlit_and_telemetry.predictive_twin.database_inspection'
        with patch(module + '.database_connection', return_value=(db, 'ready')):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
            app.sidebar.radio[0].set_value('Database').run(timeout=30)
            self.assertFalse(app.exception)
            self.assertTrue(any('no stored records' in item.value.lower() for item in app.info))
            self.assertFalse(app.download_button)
        with patch(module + '.database_connection', return_value=(None, 'schema_not_ready')):
            app.run(timeout=30)
            self.assertFalse(app.exception)
            self.assertTrue(any('schema needs attention' in item.value for item in app.warning))

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
        self.assertFalse(app.exception)
        args = json.loads(app.get('component_instance')[0].proto.json_args)['python_twin']
        self.assertEqual(app.sidebar.radio[0].value, 'Warehouse dashboard')
        self.assertEqual(args['database']['dataset'], 'amr_encoder_readings')
        self.assertEqual(args['database']['rows_state'], 'unavailable')
        self.assertTrue(args['database']['attributes'])
        action.update(active=False, nonce='archive-close')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=dispatch):
            app.run(timeout=30)
        args = json.loads(app.get('component_instance')[0].proto.json_args)['python_twin']
        self.assertNotIn('database', args)
        action.update(dataset='pg_authid', active=True, nonce='bad-dataset')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', side_effect=dispatch):
            app.run(timeout=30)
        self.assertFalse(app.exception)
        self.assertFalse(app.session_state.warehouse_database_requested)

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
            db.read_records.side_effect = RuntimeError('postgresql://private:secret@host/db')
            failed = database_preview('amr_sensor_samples', 'read-failed')
            self.assertEqual(failed['state'], 'ready')
            self.assertEqual(failed['rows_state'], 'error')
            self.assertEqual(failed['rows'], [])
            self.assertNotIn('secret', str(failed))
            with self.assertRaises(ValueError):
                database_preview('pg_authid', 'not-allowed')
        database_preview.clear()
