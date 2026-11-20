"""Real Logitech webcam in Streamlit over WebRTC, server-side ArUco tracking.

This panel lives on the same Streamlit page as the existing physical route
workspace; switching to an external Windows Camera/Python application is not
needed. Real motor commands remain behind the existing audited approval system,
physical commissioning and a separate protected MQTT receiver.
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import av
import streamlit as st
from streamlit_webrtc import webrtc_streamer, WebRtcMode

from .browser_camera import BrowserCameraFeed
from .browser_gateway import BrowserVisionGateway, validate_browser_profile

EXAMPLE = Path(__file__).with_name("example_camera_config.json")


@st.fragment(run_every="1s")
def readout(feed):
    snapshot = feed.snapshot()
    status = "CALIBRATED" if snapshot["valid"] and snapshot["age_ms"] is not None and snapshot["age_ms"] < 500 else "NOT YET TRUSTED"
    st.caption(
        f"Server-side webcam frames: {snapshot['seq']} | "
        f"ArUco IDs: {', '.join(map(str, snapshot['ids'])) or 'none'} | "
        f"Scene: {status} | "
        f"Age: {snapshot['age_ms'] if snapshot['age_ms'] is not None else '—'} ms"
    )
    if snapshot["pose"] and status == "CALIBRATED":
        pose = snapshot["pose"]
        st.write(
            f"Robot position: **X {pose['x']:.1f} mm**, "
            f"**Y {pose['y']:.1f} mm**, heading **{pose['heading']:.3f} rad**. "
            f"Detected obstacles: {snapshot['obstacles']}."
        )
    else:
        st.caption(snapshot["reason"])
    st.caption(snapshot["message"])


def _example_with_intrinsics(feed):
    example = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    if feed.intrinsics:
        example.update(
            {k: feed.intrinsics[k]
             for k in ("camera_matrix", "distortion_coefficients", "resolution")}
        )
    example["floor_reference_positions_mm"] = {
        "1": None, "2": None, "3": None, "4": None
    }
    example["reported_measurements_note"] += (
        " Browser-calibrated lens values may be reused only while the browser "
        "camera's focus/resolution stays unchanged. Measure the four marker "
        "centres from the floor origin before marking the check verified."
    )
    return json.dumps(example, indent=2)


def _camera_callback(feed, frame):
    frame_pts_s = (
        float(frame.pts * frame.time_base)
        if frame.pts is not None and frame.time_base is not None else None
    )
    annotated, _ = feed.observe_frame(frame.to_ndarray(format="bgr24"), frame_pts_s)
    return av.VideoFrame.from_ndarray(annotated, format="bgr24")


def _release(feed, gateway):
    if gateway is not None and not gateway.closed:
        gateway.close()
    feed.disconnect()


def render_browser_camera():
    with st.expander(
        "Logitech live camera tracking · Streamlit / WebRTC", expanded=True
    ):
        st.caption(
            "Uses your laptop's Logitech webcam directly in Chrome; OpenCV "
            "identifies markers on the Streamlit server. The ESP32 remains wireless. "
            "Close Windows Camera and stop the older USB preview before starting."
        )
        feed = st.session_state.get("amr_browser_camera_feed")
        if not isinstance(feed, BrowserCameraFeed):
            feed = BrowserCameraFeed()
            st.session_state.amr_browser_camera_feed = feed
        gateway = st.session_state.get("amr_browser_vision_gateway")
        if gateway is not None and gateway.closed:
            feed.tracker_callback = None
            st.session_state.pop("amr_browser_vision_gateway", None)
            gateway = None
        c1, c2, c3 = st.columns(3)
        with c1:
            if st.button("Capture checkerboard view", key="amr-cam-chess"):
                try:
                    feed.request_checkerboard()
                except ValueError as exc:
                    st.error(str(exc))
        with c2:
            if st.button("Calculate lens calibration (20 views)", key="amr-cam-calibrate"):
                try:
                    feed.calculate_intrinsics()
                    st.success("Lens parameters calculated; check real ruler distances")
                except (ValueError, cv2.error) as exc:
                    st.error(str(exc))
        with c3:
            if st.button("Capture empty floor", key="amr-cam-background"):
                try:
                    feed.request_background()
                except ValueError as exc:
                    st.error(str(exc))
        st.caption(
            "Lens calibration: use a 9 × 6 INNER-corner checkerboard with "
            "25 mm squares. Capture 20 different views. Empty floor: remove "
            "robot ID 0; leave IDs 1–4 visible."
        )

        if feed.intrinsics is not None:
            st.download_button(
                "Download calibrated lens values",
                json.dumps(feed.intrinsics, indent=2),
                "camera_intrinsics.json", mime="application/json",
                key="amr-camera-intrinsics-download",
            )
        st.download_button(
            "Download physical commissioning template",
            _example_with_intrinsics(feed),
            "camera_private_config_template.json", mime="application/json",
            key="amr-camera-config-download",
        )
        if feed.background is not None:
            ok, encoded = cv2.imencode(".png", feed.background)
            if ok:
                st.download_button(
                    "Download empty-floor reference",
                    encoded.tobytes(), "empty_floor.png", mime="image/png",
                    key="amr-camera-background-download",
                )
        uploaded = st.file_uploader(
            "Load your measured and independently checked camera + motor configuration (JSON)",
            type=["json"], key="amr-browser-config-file",
            help="No MQTT passwords or signing keys in this file. "
                 "Physical commissioning flags must be independently verified.",
        )
        if st.button("Verify and enable metric tracking", key="amr-browser-load-tracking"):
            try:
                if uploaded is None or uploaded.size > 50000:
                    raise ValueError("Choose a measured camera configuration smaller than 50 KB")
                candidate = json.loads(uploaded.getvalue())
                if not isinstance(candidate, dict):
                    raise ValueError("Camera configuration must be a JSON object")
                feed.enable_trusted_tracking(candidate)
                st.success("Server-side calibrated tracking enabled. Motor output still gated.")
            except (ValueError, json.JSONDecodeError, cv2.error) as exc:
                st.error("Tracking not enabled: " + str(exc))

        # Nothing can reach the protected motor topic until a commissioned
        # operator has explicitly enabled this alternative camera source.
        from ..predictive_twin.vision_execution_workspace import (
            profile as route_profile, authorized as route_authorized,
        )
        route, route_issues = route_profile()
        try:
            browser = dict(st.secrets["vision_browser"])
        except (KeyError, FileNotFoundError):
            browser = {}
        issues = list(route_issues)
        if not browser:
            issues.append("Add [vision_browser] to the Streamlit app secrets for browser-controlled routes.")
        elif route and route.get("commissioned") is True:
            try:
                validate_browser_profile(route, browser)
            except ValueError as exc:
                issues.append(str(exc))
        if st.session_state.get("warehouse_sensor_mode") != "live" or not st.session_state.get("vision_view"):
            issues.append("Open Live AMR mission → Physical AMR with the physical source selected.")
        if route and not route_authorized(route):
            issues.append("Unlock the operator session under Physical AMR → Connect.")
        if feed.tracker is None:
            issues.append("Load the measured camera configuration and verify metric tracking.")
        permitted = route is not None and not issues
        if not permitted and gateway is not None:
            _release(feed, gateway)
            st.session_state.pop("amr_browser_vision_gateway", None)
            gateway = None
        if issues:
            with st.expander("Physical route connection checks"):
                for issue in issues:
                    st.text(issue)
        if st.button(
            "Connect protected camera-to-EMQX mission controller",
            disabled=not permitted or gateway is not None,
            key="amr-browser-gateway-connect",
        ):
            try:
                gateway = BrowserVisionGateway(
                    dict(feed.tracker_config, config_id=feed.tracker.config_id),
                    route, browser,
                )
                st.session_state.amr_browser_vision_gateway = gateway
                with feed.lock:
                    feed.tracker_callback = gateway.submit
            except (ValueError, OSError, RuntimeError) as exc:
                st.error("Protected mission controller is not connected: " + str(exc))
        if st.button(
            "Disconnect protected mission controller",
            disabled=gateway is None,
            key="amr-browser-gateway-disconnect",
        ):
            with feed.lock:
                feed.tracker_callback = None
            _release(feed, gateway)
            st.session_state.pop("amr_browser_vision_gateway", None)
            gateway = None

        st.info(
            "Press START below and select the Logitech USB camera in Chrome. "
            "This WebRTC stream must stay connected while a mission runs. "
            "A video preview or ArUco ID alone does not authorize robot motion."
        )
        stream = webrtc_streamer(
            key="amr01-webcam-to-streamlit",
            mode=WebRtcMode.SENDRECV,
            video_frame_callback=lambda frame: _camera_callback(feed, frame),
            on_video_ended=lambda: _release(feed, gateway),
            media_stream_constraints={
                "video": {"width": {"ideal": 1280}, "height": {"ideal": 720}},
                "audio": False,
            },
            media_toggle_controls=False,
            rtc_configuration={
                "iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]
            },
            async_processing=False,
        )
        if gateway is not None and not stream.state.playing:
            with feed.lock:
                feed.tracker_callback = None
            gateway.close()
            st.session_state.pop("amr_browser_vision_gateway", None)
        readout(feed)
        if gateway is not None:
            status = gateway.public()
            st.caption(
                f"Protected EMQX controller: "
                f"{'connected' if status['subscribed'] else 'not connected'} | "
                f"state: {status['state']} | "
                f"camera scene age: {status['scene_age_ms']} ms"
            )
