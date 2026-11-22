"""Deterministic AMR battery decision policy; the physical cutoff is absolute.

The advisory threshold must be measured/configured separately from the
hardware critical cutoff. A human rejection means explicit CONTINUE (not an
unanswered prompt). No browser flag may override the critical safety limit.
"""
import math

MISSION_MINIMUM_V = 6.7
MISSION_ADVISORY_V = 7.0
MISSION_RECOVERY_V = 7.1
MISSION_REALERT_DROP_V = .1


def battery_action(voltage_v, critical_v, advisory_v=None, diversion_approved=None, *, mode='legacy'):
    """Return one of: critical_stop, normal, ask_human, continue_goal, divert_request.

    diversion_approved is exactly True/False/None. None means no human answer.
    divert_request requires a NEW protected, collision-checked E route approval;
    it is never permission to silently change the current route.
    """
    if mode not in ('legacy', 'mission'):
        raise ValueError('Unknown battery policy')
    for name, value in (("battery voltage", voltage_v), ("critical voltage", critical_v)):
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError("Invalid " + name)
    if not 0 < critical_v < 32:
        raise ValueError("Invalid critical battery cutoff")
    if advisory_v is not None:
        if type(advisory_v) not in (int, float) or not math.isfinite(advisory_v) or not critical_v < advisory_v <= 8.4:
            raise ValueError("Advisory voltage must be above the hardware cutoff")
    if diversion_approved is not None and type(diversion_approved) is not bool:
        raise ValueError("Battery diversion requires an explicit human decision")

    # CASE 1: CRITICAL always wins. No approval can override motor cutoff.
    if voltage_v <= critical_v or (mode == 'mission' and voltage_v < MISSION_MINIMUM_V):
        return "critical_stop"

    if mode == 'mission':
        advisory_v = MISSION_ADVISORY_V

    # CASE 2: Calibrated low-battery advisory, still safe to operate.
    if advisory_v is not None and voltage_v <= advisory_v:
        if diversion_approved is True:
            return "divert_request"  # Stop and request a new approved route to E.
        if diversion_approved is False:
            return "continue_goal"   # Continue original route, still subject to cutoff.
        return "ask_human"            # No answer: hold at zero PWM.

    # CASE 3: Normal measured battery voltage.
    return "normal"
