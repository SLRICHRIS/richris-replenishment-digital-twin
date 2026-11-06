"""Strict v2 raw sensor contract and isolated per-robot online state.

Device monotonic sample time drives equations; server monotonic time drives
freshness. No packet can move inventory or issue motor commands.
"""
from collections import deque
from dataclasses import asdict, dataclass
import json
import threading
import time

from .models import Calibration, ResidualDetector, battery_step, finite, midpoint_pose, wheel_distance

ROBOT_IDS = ("amr01",)


@dataclass(frozen=True)
class Packet:
    robot_id: str
    boot_id: str
    seq: int
    sample_time_s: float
    encoder_left_count: int
    encoder_right_count: int
    gyro_z_rad_s: float
    battery_voltage_v: float
    battery_current_a: float
    robot_state: str
    schema_version: int = 2

    @classmethod
    def parse(cls, payload, topic):
        if not isinstance(payload, dict):
            raise ValueError("Packet must be an object")
        keys = cls.__dataclass_fields__
        if set(payload) - set(keys) or set(keys) - set(payload):
            raise ValueError("Packet fields must match schema v2 exactly")
        p = cls(**payload)
        if type(p.schema_version) is not int or p.schema_version != 2 or p.robot_id not in ROBOT_IDS:
            raise ValueError("Unsupported schema or robot")
        if topic != f"robot/{p.robot_id}/state":
            raise ValueError("Topic/robot identity mismatch")
        if not isinstance(p.boot_id, str) or not 1 <= len(p.boot_id) <= 64:
            raise ValueError("boot_id is required")
        if not isinstance(p.robot_state, str) or not 1 <= len(p.robot_state) <= 64:
            raise ValueError("robot_state is required")
        for value in (p.seq, p.encoder_left_count, p.encoder_right_count):
            if type(value) is not int:
                raise ValueError("Counts and sequence must be integers")
        finite(p.sample_time_s, p.gyro_z_rad_s, p.battery_voltage_v, p.battery_current_a)
        if not 0 <= p.seq < 2**32 or any(not -(2**63) <= n < 2**63 for n in (p.encoder_left_count, p.encoder_right_count)) or p.sample_time_s < 0 or p.battery_voltage_v <= 0:
            raise ValueError("Invalid sequence/time/voltage")
        return p


class RobotTwin:
    def __init__(self, calibration: Calibration):
        self.calibration = calibration
        self.previous = None
        self.last_received = None
        self.pose = (0.0, 0.0, 0.0)  # local starting frame; not surveyed warehouse coordinates
        self.soc = calibration.initial_soc
        self.energy_wh = 0.0
        self.detector = ResidualDetector()
        self.history = deque(maxlen=1200)
        self.seen_boots = set()
        self.active_boot = None
        self.last_seq = -1
        self.quality = "WAITING"
        self.continuity_lost = False
        self.invalid_packets = 0
        self.ignored_packets = 0
        self.last_result = {}

    def invalidate(self):
        # Anchor after bad/missing observations so no residual bridges an unknown interval.
        self.previous = None
        self.detector.reset()
        self.continuity_lost = True
        self.quality = "INVALID_DATA"
        self.invalid_packets += 1
        self.last_result = {}

    def accept(self, packet, received):
        c = self.calibration
        old = self.previous
        if packet.boot_id != self.active_boot and packet.boot_id in self.seen_boots:
            self.ignored_packets += 1
            return False
        if packet.boot_id == self.active_boot and packet.seq <= self.last_seq:
            self.ignored_packets += 1
            return False
        dt = packet.sample_time_s - old.sample_time_s if old else None
        if old and packet.boot_id == old.boot_id and dt <= 0:
            self.invalidate()
            return False
        reboot = self.active_boot is not None and packet.boot_id != self.active_boot
        if reboot or (dt is not None and dt > c.max_gap_s):
            self.continuity_lost = True
            self.detector.reset()
            old = None
        self.previous = packet
        self.seen_boots.add(packet.boot_id)
        self.active_boot = packet.boot_id
        self.last_seq = packet.seq
        self.last_received = received
        if old is None:
            self.detector.reset()
            self.last_result = {}
            self.quality = "ANCHOR_UNCERTAIN" if self.continuity_lost else "ANCHORED"
            return True
        ds_l = wheel_distance(packet.encoder_left_count - old.encoder_left_count,
                              c.radius_left_m, c.counts_left_per_rev)
        ds_r = wheel_distance(packet.encoder_right_count - old.encoder_right_count,
                              c.radius_right_m, c.counts_right_per_rev)
        self.pose = midpoint_pose(*self.pose, ds_l, ds_r, c.track_m)
        power, self.energy_wh, self.soc = battery_step(self.soc, self.energy_wh,
            packet.battery_voltage_v, packet.battery_current_a, dt, c.capacity_ah)
        residual, alert = self.detector.update(packet.gyro_z_rad_s, c.gyro_bias_rad_s,
            ds_l / dt, ds_r / dt, c.track_m, dt, c.residual_threshold_rad_s, c.residual_hold_s)
        self.quality = "CONTINUITY_LOST" if self.continuity_lost else "OK"
        self.last_result = dict(v_left_m_s=ds_l / dt, v_right_m_s=ds_r / dt,
            yaw_rate_rad_s=(ds_r - ds_l) / (c.track_m * dt),
            corrected_gyro_rad_s=packet.gyro_z_rad_s - c.gyro_bias_rad_s,
            residual_rad_s=residual, advisory=alert, power_w=power,
            soc_out_of_bounds=not 0 <= self.soc <= 1)
        self.history.append(dict(sample_time_s=packet.sample_time_s, x_m=self.pose[0],
            y_m=self.pose[1], theta_rad=self.pose[2], soc=self.soc,
            energy_wh=self.energy_wh, **self.last_result))
        return True

    def snapshot(self, now, stale_after_s):
        age = None if self.last_received is None else max(0.0, now - self.last_received)
        stale = age is None or age > stale_after_s
        if stale and self.previous is not None:
            self.previous = None
            self.detector.reset()
            self.continuity_lost = True
            self.last_result = {}
        return dict(pose=self.pose, soc=self.soc, energy_wh=self.energy_wh,
            quality="STALE" if stale else self.quality, age_s=age, stale=stale,
            continuity_lost=self.continuity_lost, invalid_packets=self.invalid_packets,
            ignored_packets=self.ignored_packets, raw=asdict(self.previous) if self.previous else None,
            derived=dict(self.last_result), history=list(self.history))


class FleetTwin:
    def __init__(self, calibrations, stale_after_s=2.0):
        if set(calibrations) != set(ROBOT_IDS):
            raise ValueError("Configure the measured amr01 calibration only")
        finite(stale_after_s)
        if stale_after_s <= 0:
            raise ValueError("Freshness timeout must be positive")
        self.robots = {rid: RobotTwin(calibrations[rid]) for rid in ROBOT_IDS}
        self.stale_after_s = stale_after_s
        self.lock = threading.RLock()
        self.rejected_packets = 0

    def ingest(self, payload, topic, received=None, retained=False):
        received = time.monotonic() if received is None else received
        with self.lock:
            # Retained snapshots cannot establish freshness or initialize an integral.
            if retained:
                self.rejected_packets += 1
                return False
            try:
                if isinstance(payload, (str, bytes)):
                    if len(payload) > 4096:
                        raise ValueError("Packet too large")
                    payload = json.loads(payload)
                packet = Packet.parse(payload, topic)
            except (ValueError, TypeError, UnicodeDecodeError):
                self.rejected_packets += 1
                for rid in ROBOT_IDS:
                    if topic == f"robot/{rid}/state":
                        self.robots[rid].invalidate()
                return False
            robot = self.robots[packet.robot_id]
            if robot.last_received is not None and received - robot.last_received > self.stale_after_s:
                robot.invalidate()
            return robot.accept(packet, received)

    def snapshots(self, now=None):
        now = time.monotonic() if now is None else now
        with self.lock:
            return {rid: robot.snapshot(now, self.stale_after_s) for rid, robot in self.robots.items()}
