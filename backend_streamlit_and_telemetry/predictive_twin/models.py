"""Slide equations in SI units; no network or UI dependencies.

Slide mapping and paper/adaptation boundaries: project_documentation/slide_to_code_mapping.md.
"""
from dataclasses import dataclass
import math
from statistics import fmean


def finite(*values):
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError("Expected finite numeric measurements")


def positive(*values):
    finite(*values)
    if any(v <= 0 for v in values):
        raise ValueError("Expected strictly positive calibration/time")


@dataclass(frozen=True)
class Calibration:
    radius_left_m: float
    radius_right_m: float
    track_m: float
    counts_left_per_rev: int
    counts_right_per_rev: int
    capacity_ah: float
    initial_soc: float
    gyro_bias_rad_s: float
    residual_threshold_rad_s: float
    residual_hold_s: float
    max_gap_s: float = 1.0

    def __post_init__(self):
        positive(self.radius_left_m, self.radius_right_m, self.track_m,
                 self.capacity_ah, self.residual_threshold_rad_s,
                 self.residual_hold_s, self.max_gap_s)
        for value in (self.counts_left_per_rev, self.counts_right_per_rev):
            if type(value) is not int or value <= 0:
                raise ValueError("Effective quadrature counts per wheel revolution must be positive integers")
        finite(self.initial_soc, self.gyro_bias_rad_s)
        if not 0 <= self.initial_soc <= 1:
            raise ValueError("Initial SOC must be a calibrated fraction in [0, 1]")


def wheel_distance(count_delta, radius_m, counts_per_rev):
    """Slides 4–5: signed counts -> metres (gearing + quadrature included in N)."""
    finite(count_delta)
    positive(radius_m, counts_per_rev)
    return 2 * math.pi * radius_m * count_delta / counts_per_rev


def midpoint_pose(x, y, theta, ds_left, ds_right, track_m):
    """Slides 6–7: nonlinear planar rolling approximation; theta is unwrapped."""
    finite(x, y, theta, ds_left, ds_right)
    positive(track_m)
    ds = (ds_right + ds_left) / 2
    dtheta = (ds_right - ds_left) / track_m
    return (x + ds * math.cos(theta + dtheta / 2),
            y + ds * math.sin(theta + dtheta / 2), theta + dtheta)


def stationary_gyro_bias(samples):
    """Slides 8–9: operator must independently ensure robot is stationary."""
    values = list(samples)
    if not values:
        raise ValueError("Stationary samples are required")
    finite(*values)
    return fmean(values)


def battery_step(soc, energy_wh, voltage_v, discharge_current_a, dt_s, capacity_ah):
    """Slides 10–11: right-end sample rectangular integration, eta=1.

    Negative current means charging. Energy is signed net consumption; raw SOC
    is intentionally not clipped so calibration/data problems remain visible.
    """
    finite(soc, energy_wh, voltage_v, discharge_current_a)
    positive(dt_s, capacity_ah, voltage_v)
    power = voltage_v * discharge_current_a
    return (power, energy_wh + power * dt_s / 3600,
            soc - discharge_current_a * dt_s / (3600 * capacity_ah))


@dataclass
class ResidualDetector:
    duration_s: float = 0.0
    exceeding: bool = False

    def reset(self):
        self.duration_s = 0.0
        self.exceeding = False

    def update(self, gyro_z, bias, v_left, v_right, track, dt, threshold, hold):
        """Slides 12–13: sustained consistency residual, not fault classification."""
        finite(gyro_z, bias, v_left, v_right)
        positive(track, dt, threshold, hold)
        residual = gyro_z - bias - (v_right - v_left) / track
        # Slide 13 starts the timer at the first abnormal sample, not one dt earlier.
        if abs(residual) <= threshold:
            self.reset()
        elif self.exceeding:
            self.duration_s += dt
        else:
            self.exceeding = True
            self.duration_s = 0.0
        return residual, self.exceeding and self.duration_s >= hold


def motion_forecast(pose, v_left, v_right, track, horizon_s=5.0, dt_s=None):
    """Slide 14 extension: hold wheel speeds fixed; no obstacle/route prediction."""
    finite(*pose, v_left, v_right, horizon_s)
    positive(track)
    if not 0 <= horizon_s <= 300:
        raise ValueError("Forecast horizon must be between 0 and 300 seconds")
    # Slide 14 uses 20 midpoint substeps. An explicit dt remains available for trials.
    if dt_s is None:
        dt_s = horizon_s / 20 if horizon_s else 1.0
    positive(dt_s)
    if horizon_s / dt_s > 10000:
        raise ValueError("Forecast step count too large")
    result = [tuple(pose)]
    remaining = horizon_s
    while remaining > 1e-9:
        dt = min(dt_s, remaining)
        result.append(midpoint_pose(*result[-1], v_left * dt, v_right * dt, track))
        remaining -= dt
    return result


def runtime_hours(soc, reserve_soc, capacity_ah, future_discharge_a):
    """Slide 14 extension: constant future current, no battery degradation model."""
    finite(soc, reserve_soc, future_discharge_a)
    positive(capacity_ah)
    if not 0 <= soc <= 1 or not 0 <= reserve_soc <= 1:
        return None
    if future_discharge_a <= 0:
        return None
    return max(0, soc - reserve_soc) * capacity_ah / future_discharge_a


def stock_step(stock, delivered, consumed):
    """Slide 15: confirmed integer stock balance at one location."""
    if any(type(value) is not int for value in (stock, delivered, consumed)):
        raise ValueError("Stock quantities must be integer units")
    stock_next = stock + delivered - consumed
    if min(stock, delivered, consumed, stock_next) < 0:
        raise ValueError("Invalid stock event")
    return stock_next


def task_step(state, event):
    """Slide 15 finite-state machine; unknown events do not change state."""
    transitions = {
        ("idle", "assign"): "assigned",
        ("assigned", "start"): "travelling",
        ("travelling", "arrive"): "servicing",
        ("servicing", "complete"): "idle",
    }
    if event == "fault":
        return "fault"
    return transitions.get((state, event), state)
