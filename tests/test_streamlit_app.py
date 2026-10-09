"""Python host integration check. Run: python -m unittest discover -s tests."""

from pathlib import Path
import unittest

from streamlit.testing.v1 import AppTest


ROOT = Path(__file__).resolve().parents[1]


class StreamlitHostTests(unittest.TestCase):
    def test_workspace_registers_and_keeps_its_identity_on_rerun(self):
        app = AppTest.from_file(str(ROOT / "streamlit_app.py")).run(timeout=20)
        self.assertFalse(app.exception)
        components = app.get("component_instance")
        self.assertEqual(len(components), 1)
        first = components[0].proto.id
        self.assertEqual(components[0].proto.component_name, "streamlit_app.replenish_workspace")
        app.run(timeout=20)
        self.assertFalse(app.exception)
        self.assertEqual(app.get("component_instance")[0].proto.id, first)


if __name__ == "__main__":
    unittest.main()
