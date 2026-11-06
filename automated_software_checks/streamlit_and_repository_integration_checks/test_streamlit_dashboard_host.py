from pathlib import Path
import unittest
from streamlit.testing.v1 import AppTest

ROOT = Path(__file__).resolve().parents[2]


class StreamlitHostTests(unittest.TestCase):
    def test_model_inspection_and_inventory_events(self):
        app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
        self.assertFalse(app.exception)
        app.sidebar.radio[0].set_value('Model inspection').run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.title[0].value, 'Warehouse Robot Digital Twin')
        self.assertEqual(len(app.get('component_instance')), 0)
        next(n for n in app.number_input if n.label == 'Delivered units').set_value(30)
        next(n for n in app.number_input if n.label == 'Consumed units').set_value(10)
        next(b for b in app.button if b.label == 'Apply stock event').click().run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.session_state.slide15_state['stock'], 120)
        next(b for b in app.button if b.label == 'Apply task event').click().run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.session_state.slide15_state['task'], 'assigned')
        next(n for n in app.number_input if n.label == 'Consumed units').set_value(999)
        next(b for b in app.button if b.label == 'Apply stock event').click().run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.session_state.slide15_state['stock'], 120)
        self.assertTrue(any('Invalid stock event' in item.value for item in app.error))
        next(r for r in app.radio if r.label == 'Data source').set_value('Live MQTT sensors').run(timeout=30)
        self.assertFalse(app.exception)
        self.assertTrue(any('not configured' in item.value for item in app.warning))

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

    def test_component_can_open_model_inspection_without_mutating_an_existing_widget(self):
        from unittest.mock import patch
        from backend_streamlit_and_telemetry import streamlit_dashboard_host as host
        action = dict(action='model_inspection', nonce='test-inspection-1')
        with patch.object(host, 'WAREHOUSE_WORKSPACE', return_value=action):
            app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.title[0].value, 'Warehouse Robot Digital Twin')
        self.assertEqual(app.sidebar.radio[0].value, 'Model inspection')
