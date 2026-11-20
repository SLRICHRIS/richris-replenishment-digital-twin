"""Server-side WebRTC camera processor for the Streamlit-hosted AMR.

Browser frames are decoded and ArUco-detected on the Streamlit server; browser
coordinates are NEVER accepted as trusted control observations. Public mode
previews markers; physically commissioned mode may produce Camera observations.
No secrets, MQTT or motor output are present in this module.
"""
from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import dataclass

import cv2
import numpy as np

from .camera import Camera, load_config

BOARD = (9, 6)
SQUARE_MM = 25.0
MIN_VIEWS = 20
MAX_RMS_PX = 1.0


@dataclass(frozen=True)
class Observation:
    captured_at_ms: int
    ids: tuple[int, ...]
    valid: bool
    reason: str
    pose: dict | None
    obstacles: tuple[dict, ...]
    frame_seq: int


class BrowserCameraFeed:
    """One webcam peer only; lock protects callback and Streamlit UI threads."""

    def __init__(self):
        self.lock = threading.RLock()
        self.detector = cv2.aruco.ArucoDetector(
            cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50),
            cv2.aruco.DetectorParameters(),
        )
        self.last_frame = None
        self.latest = Observation(0, (), False, "Start Logitech camera", None, (), 0)
        self.frames = []
        self.objects = []
        self.fingerprints = []
        self.intrinsics = None
        self.background = None
        self.calibration_request = False
        self.background_request = False
        self.message = "No video frames received"
        self.tracker = None
        self.tracker_config = None
        self.connected = False
        self.last_arrival_mono = None
        self.last_video_pts_s = None
        self.max_gap_ms = 0
        self.frame_counter = 0
        self.tracker_callback = None

    def request_checkerboard(self):
        with self.lock:
            if self.tracker_callback is not None:
                raise ValueError("Stop physical route control before changing calibration")
            self.calibration_request = True
            self.message = "Show a new checkerboard position to the Logitech camera"

    def request_background(self):
        with self.lock:
            if self.tracker_callback is not None:
                raise ValueError("Stop physical route control before capturing background")
            self.background_request = True
            self.message = "Remove robot ID 0 and expose all four fixed floor markers"

    def calculate_intrinsics(self):
        with self.lock:
            if len(self.frames) < MIN_VIEWS:
                raise ValueError("Capture at least 20 distinct checkerboard views")
            width, height = self.frame_size
            rms, matrix, distortion, _, _ = cv2.calibrateCamera(
                self.objects, self.frames, (width, height), None, None
            )
            if not math.isfinite(rms) or rms > MAX_RMS_PX:
                raise ValueError("Camera RMS exceeds 1 pixel; capture clearer varied views")
            self.intrinsics = dict(
                camera_matrix=matrix.tolist(),
                distortion_coefficients=distortion.flatten().tolist(),
                resolution=[width, height],
                calibration_rms_px=float(rms),
                calibration_views=len(self.frames),
            )
            self.message = f"Intrinsics captured, RMS {rms:.3f} px. Verify distances."
            return dict(self.intrinsics)

    def reset_calibration(self):
        with self.lock:
            if self.tracker_callback is not None:
                raise ValueError("Stop physical route control before resetting calibration")
            self.frames.clear()
            self.objects.clear()
            self.fingerprints.clear()
            self.intrinsics = None
            self.calibration_request = False
            self.message = "Calibration reset; capture 20 different checkerboard views"

    def enable_trusted_tracking(self, config):
        """Validated production geometry; no client-provided X/Y is trusted."""
        with self.lock:
            if self.background is None:
                raise ValueError("Capture empty floor from this camera first")
            if self.tracker_callback is not None:
                raise ValueError("Stop active route tracking before editing camera configuration")
            p = load_config(config)
            if self.intrinsics is None:
                raise ValueError("Complete this browser webcam's lens calibration")
            for name in ("camera_matrix", "distortion_coefficients", "resolution"):
                if p[name] != self.intrinsics[name]:
                    raise ValueError("Camera config does not match current browser lens calibration")
            if tuple(p["resolution"]) != self.background.shape[1::-1]:
                raise ValueError("Background and camera resolution differ")
            self.tracker = Camera(p, self.background.copy())
            self.tracker_config = p
            self.message = "Calibrated camera tracker initialized; verify real ruler distances"

    def disconnect(self):
        with self.lock:
            self.connected = False
            self.tracker_callback = None
            self.last_arrival_mono = None
            self.last_video_pts_s = None
            self.latest = Observation(0, (), False, "WebRTC video stopped", None, (), self.frame_counter)
            self.message = "WebRTC disconnected; protected controller must stop"

    def observe_frame(self, frame, frame_pts_s=None):
        """Decode one server-received frame; returns annotated BGR frame and observation."""
        now = int(time.time() * 1000)
        mono = time.monotonic()
        with self.lock:
            if not isinstance(frame, np.ndarray) or frame.ndim != 3 or frame.shape[2] != 3:
                raise ValueError("Expected a BGR video image")
            height, width = frame.shape[:2]
            if width < 320 or height < 240 or width > 4096 or height > 4096:
                raise ValueError("Unexpected camera resolution")
            self.frame_size = (width, height)
            self.connected = True
            self.frame_counter += 1
            seq = self.frame_counter
            gap_ms = round((mono - self.last_arrival_mono) * 1000) if self.last_arrival_mono is not None else 0
            # A large receive gap invalidates this observation; no cached frames can drive.
            self.max_gap_ms = max(0, gap_ms)
            pts_gap_ms = None
            if frame_pts_s is not None and self.last_video_pts_s is not None:
                pts_gap_ms = round((frame_pts_s - self.last_video_pts_s) * 1000)
            self.last_video_pts_s = frame_pts_s
            self.last_arrival_mono = mono
            self.last_frame = frame.copy()
            found_corners, ids, _ = self.detector.detectMarkers(frame)
            found = tuple(sorted(int(i) for i in ids.flatten())) if ids is not None else ()
            annotated = frame.copy()
            if ids is not None:
                cv2.aruco.drawDetectedMarkers(annotated, found_corners, ids)
            if self.calibration_request:
                self.calibration_request = False
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                success, corners = cv2.findChessboardCorners(gray, BOARD)
                if not success:
                    self.message = "Checkerboard not detected: need 9 × 6 inner corners"
                else:
                    refined = cv2.cornerSubPix(
                        gray, corners, (11, 11), (-1, -1),
                        (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001),
                    )
                    # Require a meaningfully different board placement/size/angle.
                    a = refined.reshape(-1, 2)
                    edges = a.max(axis=0) - a.min(axis=0)
                    if edges.min() < 80:
                        self.message = "Bring checkerboard nearer and keep it entirely visible"
                    else:
                        first, last = a[0], a[-1]
                        descriptor = np.array([
                            a[:, 0].mean() / width,
                            a[:, 1].mean() / height,
                            edges[0] / width,
                            edges[1] / height,
                            math.atan2(last[1] - first[1], last[0] - first[0]) / math.pi,
                        ])
                        if any(np.linalg.norm((descriptor - q) * [2, 2, 2, 2, 1]) < 0.12
                               for q in self.fingerprints):
                            self.message = "View too similar; move/tilt the checkerboard"
                        else:
                            grid = np.zeros((BOARD[0] * BOARD[1], 3), np.float32)
                            grid[:, :2] = np.mgrid[0:BOARD[0], 0:BOARD[1]].T.reshape(-1, 2) * SQUARE_MM
                            self.objects.append(grid)
                            self.frames.append(refined)
                            self.fingerprints.append(descriptor)
                            self.message = f"Captured checkerboard view {len(self.frames)}/{MIN_VIEWS}"
            if self.background_request:
                self.background_request = False
                if 0 in found or not {1, 2, 3, 4}.issubset(found):
                    self.message = "Cannot capture: robot ID 0 must be absent and IDs 1–4 visible"
                else:
                    self.background = frame.copy()
                    self.tracker = None
                    self.tracker_config = None
                    self.message = "Empty-floor reference captured in server memory"
            valid, pose, rects, reason = False, None, [], "Marker preview only; calibration required"
            if self.tracker is not None:
                try:
                    if gap_ms > 250 or (pts_gap_ms is not None and (pts_gap_ms <= 0 or pts_gap_ms > 250)):
                        raise ValueError("WebRTC frames delayed or discontinuous")
                    pose, rects = self.tracker.observe(frame, now)
                    valid, reason = True, "Server-verified ArUco position"
                except (ValueError, TypeError, cv2.error) as exc:
                    reason = str(exc)[:180]
            self.latest = Observation(now, found, valid, reason, pose,
                                      tuple(rects), seq)
            if valid:
                cv2.putText(annotated, f"X {pose['x']:.0f} Y {pose['y']:.0f} mm",
                            (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (10, 180, 30), 2)
            callback = self.tracker_callback
        # Run the protected MQTT/Agent callback outside the camera lock; never
        # block video rendering or allow a browser to submit fabricated coordinates.
        if callback is not None:
            callback(self.latest)
        return annotated, self.latest

    def snapshot(self):
        with self.lock:
            v = self.latest
            age = int(time.time() * 1000) - v.captured_at_ms if v.captured_at_ms else None
            return dict(
                connected=self.connected, ids=list(v.ids), valid=v.valid,
                reason=v.reason, pose=dict(v.pose) if v.pose else None,
                obstacles=len(v.obstacles), age_ms=age, seq=v.frame_seq,
                checkerboard_views=len(self.frames), background_saved=self.background is not None,
                intrinsics_saved=self.intrinsics is not None,
                measured_latency=False,  # video capture-to-cloud delay not proven from server receive time
                message=self.message,
            )
