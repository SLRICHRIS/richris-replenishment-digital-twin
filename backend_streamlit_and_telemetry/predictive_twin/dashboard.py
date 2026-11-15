"""Streamlit view over server-computed sensor state; no browser-side modelling."""
import json

import streamlit as st

from .demo import demo_fleet
from .models import motion_forecast, runtime_hours
from .database import calibration_fingerprint
from .telemetry import ROBOT_IDS
from .workspace_payload import SOURCE_LABELS, quality_display, stored_sensor_context


def show_robot(rid, snapshot, calibration, demo=False):
    st.subheader(rid.upper().replace('AMR', 'AMR-', 1))
    age = snapshot["age_s"]
    display = quality_display(snapshot, demo=demo)
    st.caption(f"Data quality: {display['label']} · sample age: {'fixed demo trial' if demo else 'no sample' if age is None else f'{age:.1f} s'}")
    st.caption(display['detail'])
    if snapshot["stale"]:
        st.warning("No fresh valid sensor data. Forecasts and alerts are suspended.")
        return
    if snapshot["continuity_lost"]:
        st.warning("An observation interval was lost. Pose, energy and SOC are partial estimates. Reinitialise with measured state before quantitative use.")
    x, y, theta = snapshot["pose"]
    a, b, c = st.columns(3)
    a.metric("Local x (m)", f"{x:.3f}")
    b.metric("Local y (m)", f"{y:.3f}")
    c.metric("Heading (rad)", f"{theta:.3f}")
    st.caption("Motion background: [Villagomez Alfaro et al. (2026)](https://doi.org/10.3390/s26185729) · PDF p. 8, Eqs. (1–3); encoder conversion p. 11 Eq. (9), p. 38 Eq. (A4). Midpoint discretisation is our implementation.")
    a, b = st.columns(2)
    a.metric("Estimated charge / SOC (%)", f"{snapshot['soc'] * 100:.1f}")
    st.caption("SOC means state of charge. Positive current means discharge; negative current means charging. Charge is calculated from measured current and calibrated capacity.")
    b.metric("Net energy (Wh)", f"{snapshot['energy_wh']:.5f}")
    st.caption("SOC reference: [Movassagh et al. (2021)](https://doi.org/10.3390/en14144074) · PDF pp. 7–8, Eqs. (5–9), adapted to discharge-positive current and efficiency 1. Power and Wh integration use standard definitions.")
    derived = snapshot["derived"]
    if derived.get("soc_out_of_bounds"):
        st.error("Raw SOC is outside [0, 1]. Check initial charge, current calibration and usable capacity.")
    if derived:
        if derived.get("residual_valid", True) and derived.get("residual_rad_s") is not None:
            st.metric("Gyro–encoder residual (rad/s)", f"{derived['residual_rad_s']:.5f}")
        else:
            st.metric("Gyro–encoder residual (rad/s)", "Unavailable")
            st.warning("A sensor sequence gap prevents a trustworthy residual at this sample.")
        st.caption("Residual detector: project extension. Gyro input model: [Villagomez Alfaro et al. (2026), p. 10 Eq. (8)](https://doi.org/10.3390/s26185729). This is not the paper’s EKF or a validated fault classifier.")
        if derived["advisory"]:
            st.warning("Sustained model disagreement: inspect motion/sensors. This does not identify a specific fault.")
        elif derived.get("residual_valid", True):
            st.info("No sustained motion disagreement at this sample. This does not establish that the robot is fault-free.")
        st.caption(f"Advisory requires an absolute gyro–encoder difference above {calibration.residual_threshold_rad_s:.3f} rad/s continuously for {calibration.residual_hold_s:.2f} s.")
    if snapshot["history"]:
        st.vega_lite_chart({"data": {"values": snapshot["history"]}, "mark": "line",
            "encoding": {"x": {"field": "x_m", "type": "quantitative", "title": "Local x (m)"},
                         "y": {"field": "y_m", "type": "quantitative", "title": "Local y (m)"},
                         "order": {"field": "sample_time_s", "type": "quantitative"}}}, width="stretch")
        st.caption("Odometry trajectory in an unsurveyed local frame; axis scales may differ. No absolute position or heading sensor is available.")
    if derived and snapshot["quality"] == "OK" and not snapshot["continuity_lost"]:
        path = motion_forecast(snapshot["pose"], derived["v_left_m_s"], derived["v_right_m_s"], calibration.track_m)
        st.caption(f"5 s constant-wheel-speed forecast: x={path[-1][0]:.3f} m, y={path[-1][1]:.3f} m. No obstacle model.")
        raw = snapshot["raw"]
        remaining = runtime_hours(snapshot["soc"], .20, calibration.capacity_ah, raw["battery_current_a"])
        st.caption("Runtime to assumed 20% reserve: " + ("unavailable" if remaining is None else f"{remaining:.2f} h at the latest current held constant"))
    recent_events = snapshot.get("pipeline_events") or []
    if recent_events:
        with st.expander(f"Packet-quality evidence ({len(recent_events)} recent events)"):
            st.caption(
                "Sequence gaps, long sampling gaps and reboot events are recorded "
                "separately from physical sensor measurements. Missing intervals "
                "are not fabricated or treated as independent fault diagnoses."
            )
            st.dataframe(recent_events, hide_index=True, use_container_width=True)
    with st.expander("Raw packet and derived values"):
        st.json({"raw": snapshot["raw"], "derived": derived})
        st.caption("Use the recorded packet-quality events to inspect rejected readings and missing samples. This view does not report lifetime rejection totals.")
    if snapshot["history"]:
        st.download_button("Download derived history (JSON)", json.dumps(snapshot["history"], indent=2),
                           file_name=f"{rid}_derived_sensor_history.json", key=f"history-{rid}")


@st.fragment(run_every="1s")
def live_view(db, calibration):
    snapshot = db.read_snapshot(expected_fingerprint=calibration_fingerprint(calibration))
    st.caption("PostgreSQL-backed AMR-01: persisted measurements and model results")
    show_robot("amr01", snapshot, calibration)


def render_sensor_dashboard():
    if st.button('Back to dashboard'):
        st.session_state.pending_workspace_view = 'Warehouse dashboard'
        st.rerun()
    st.title("Detailed sensor readings")
    st.caption("AMR-01 · sensor measurements, model estimates and references")
    mode = st.radio("Data source", tuple(SOURCE_LABELS), format_func=SOURCE_LABELS.get,
                    index=1 if st.session_state.get('warehouse_sensor_mode') == 'live' else 0,
                    horizontal=True)
    st.session_state.warehouse_sensor_mode = mode
    if mode == "demo":
        fleet = demo_fleet()
        snapshots = fleet.snapshots(now=6)
        for col, rid in zip(st.columns(len(ROBOT_IDS)), ROBOT_IDS):
            with col:
                show_robot(rid, snapshots[rid], fleet.robots[rid].calibration, demo=True)
        with st.expander("Demo residual history"):
            st.line_chart(snapshots["amr01"]["history"], x="sample_time_s", y="residual_rad_s", x_label="Sample time (s)", y_label="Residual (rad/s)")
    else:
        st.caption("Read physical sensor records saved in PostgreSQL by the MQTT ingestion worker.")
        db, c, notice = stored_sensor_context()
        if notice:
            st.warning(notice['label'] + '. ' + notice['detail'])
        else:
            live_view(db, c)
