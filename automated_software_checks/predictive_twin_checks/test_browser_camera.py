"""Offline WebRTC camera fixtures; no MQTT connection or motor output."""
import json
import math
from pathlib import Path

import pytest
cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from backend_streamlit_and_telemetry.vision_control.browser_camera import BrowserCameraFeed
from backend_streamlit_and_telemetry.vision_control.browser_gateway import (
    validate_browser_profile,
)
from backend_streamlit_and_telemetry.vision_control.camera import load_config


def frame_with_ids(ids=(1, 2, 3, 4)):
    image = np.full((720, 1280, 3), 255, np.uint8)
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    centers = {1: (90, 90), 2: (90, 640), 3: (1160, 640),
               4: (1160, 90), 0: (600, 400)}
    for mid in ids:
        x, y = centers[mid]
        pattern = cv2.aruco.generateImageMarker(dictionary, mid, 80)
        image[y-40:y+40, x-40:x+40] = cv2.cvtColor(pattern, cv2.COLOR_GRAY2BGR)
    return image


def test_browser_camera_detects_real_aruco_ids_and_requires_empty_floor():
    feed = BrowserCameraFeed()
    frame = frame_with_ids((0, 1, 2, 3, 4))
    annotated, observation = feed.observe_frame(frame)
    assert annotated.shape == frame.shape
    assert observation.ids == (0, 1, 2, 3, 4)
    assert observation.valid is False
    assert observation.pose is None
    feed.request_background()
    feed.observe_frame(frame)
    assert feed.background is None
    assert "robot ID 0" in feed.message
    feed.request_background()
    feed.observe_frame(frame_with_ids())
    assert feed.background is not None
    assert feed.background.shape == (720, 1280, 3)
    assert feed.tracker is None
    feed.disconnect()
    assert feed.snapshot()["connected"] is False
    assert feed.snapshot()["valid"] is False


def test_config_requires_measured_floor_positions_even_when_all_checks_claimed():
    example = json.loads(
        (Path(__file__).resolve().parents[2] /
         "backend_streamlit_and_telemetry/vision_control/example_camera_config.json").read_text()
    )
    example["checks"] = {key: True for key in example["checks"]}
    with pytest.raises(ValueError, match="measured floor marker"):
        load_config(example)
    example["floor_reference_positions_mm"] = {
        "1": [40, 590], "2": [40, 40], "3": [570, 40], "4": [570, 590],
    }
    with pytest.raises(ValueError, match="Invalid"):
        example["floor_reference_positions_mm"]["4"] = [float("nan"), 590]
        load_config(example)


def test_browser_mqtt_control_requires_independent_commissioning_and_keys():
    route = {
        "enabled": True, "commissioned": True, "mqtt_host": "private.example",
        "mqtt_username": "website-reviewer", "control_key": "a" * 64,
    }
    browser = {
        "enabled": True, "transport_latency_verified": True,
        "mqtt_host": "private.example", "mqtt_username": "camera-controller",
        "mqtt_password": "secret-not-for-browser", "drive_key": "b" * 64,
    }
    assert validate_browser_profile(route, browser) is True
    for update in (
        {"enabled": False},
        {"transport_latency_verified": False},
        {"mqtt_username": "website-reviewer"},
        {"drive_key": "a" * 64},
        {"mqtt_host": "another.example"},
    ):
        bad = dict(browser, **update)
        with pytest.raises(ValueError):
            validate_browser_profile(route, bad)
