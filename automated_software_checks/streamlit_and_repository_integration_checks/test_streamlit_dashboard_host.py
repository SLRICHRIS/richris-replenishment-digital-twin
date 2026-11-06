from pathlib import Path
import unittest
from streamlit.testing.v1 import AppTest

ROOT = Path(__file__).resolve().parents[2]


class StreamlitHostTests(unittest.TestCase):
    def test_default_python_twin_and_inventory_events(self):
        app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.title[0].value, 'Warehouse Robot Digital Twin')
        self.assertEqual(len(app.get('component_instance')), 0)
        next(b for b in app.button if b.label == 'Next warehouse event').click().run(timeout=30)
        self.assertFalse(app.exception)
        self.assertTrue(app.session_state.inventory_experiment['time'] > 0)
        next(b for b in app.button if b.label == 'Run to 120 s').click().run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.session_state.inventory_experiment['time'], 120)
        next(r for r in app.radio if r.label == 'Data source').set_value('Live MQTT sensors').run(timeout=30)
        self.assertFalse(app.exception)
        self.assertTrue(any('not configured' in item.value for item in app.warning))

    def test_legacy_workspace_identity_on_rerun(self):
        app = AppTest.from_file(str(ROOT / 'streamlit_app.py')).run(timeout=30)
        app.sidebar.radio[0].set_value('Legacy 3D reference').run(timeout=30)
        self.assertFalse(app.exception)
        components = app.get('component_instance')
        self.assertEqual(len(components), 1)
        first = components[0].proto.id
        self.assertEqual(components[0].proto.component_name,
                         'backend_streamlit_and_telemetry.streamlit_dashboard_host.replenish_workspace')
        app.run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.get('component_instance')[0].proto.id, first)
