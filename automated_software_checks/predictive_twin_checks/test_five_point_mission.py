import unittest
from backend_streamlit_and_telemetry.vision_control.five_point_mission import FivePointMission, validate_stations

STATIONS = {"A": [100, 150], "B": [300, 150], "C": [100, 480], "D": [300, 480], "E": [210, 315]}


class FivePointMissionTests(unittest.TestCase):
    def test_stations_are_separate(self):
        self.assertEqual(len(validate_stations(STATIONS)), 5)
        with self.assertRaises(ValueError):
            validate_stations({**STATIONS, "E": STATIONS["A"]})

    def test_select_racks_only(self):
        with self.assertRaises(ValueError):
            FivePointMission(STATIONS, "A", "E")
        with self.assertRaises(ValueError):
            FivePointMission(STATIONS, "B", "B")

    def test_low_battery_is_advisory(self):
        m = FivePointMission(STATIONS, "A", "D")
        m.status = "navigating"
        # A forecast does not independently disable the motor driver.
        self.assertIsNone(m.battery_warning(None, 0, 0.8, 0.2))
        self.assertEqual(m.status, "navigating")

    def test_arrival_needs_camera_and_stopped_motors(self):
        m = FivePointMission(STATIONS, "A", "D")
        m.status = "navigating"
        self.assertFalse(m.arrived(False, True))
        self.assertFalse(m.arrived(True, False))
        self.assertTrue(m.arrived(True, True))
        self.assertEqual(m.status, "completed")


if __name__ == "__main__":
    unittest.main()
