"""Streamlit view over server-computed sensor state; no browser-side modelling."""
import json
from pathlib import Path

import streamlit as st

from .demo import demo_fleet
from .models import Calibration, motion_forecast, runtime_hours, stock_step, task_step
from .database import SensorDatabase, calibration_fingerprint
from .telemetry import ROBOT_IDS


@st.cache_resource(show_spinner=False)
def database_reader(database_url):
    return SensorDatabase(database_url, initialize=False)


def show_robot(rid, snapshot, calibration):
    st.subheader(rid.upper())
    age = snapshot["age_s"]
    st.caption(f"Data: {snapshot['quality']} · age: {'no sample' if age is None else f'{age:.2f} s'}")
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
    a.metric("Estimated SOC (%)", f"{snapshot['soc'] * 100:.3f}")
    b.metric("Net energy (Wh)", f"{snapshot['energy_wh']:.5f}")
    st.caption("SOC reference: [Movassagh et al. (2021)](https://doi.org/10.3390/en14144074) · PDF pp. 7–8, Eqs. (5–9), adapted to discharge-positive current and efficiency 1. Power and Wh integration use standard definitions.")
    derived = snapshot["derived"]
    if derived.get("soc_out_of_bounds"):
        st.error("Raw SOC is outside [0, 1]. Check initial charge, current calibration and usable capacity.")
    if derived:
        st.metric("Gyro–encoder residual (rad/s)", f"{derived['residual_rad_s']:.5f}")
        st.caption("Residual detector: project extension. Gyro input model: [Villagomez Alfaro et al. (2026), p. 10 Eq. (8)](https://doi.org/10.3390/s26185729). This is not the paper’s EKF or a validated fault classifier.")
        if derived["advisory"]:
            st.warning("Sustained model disagreement: inspect motion/sensors. This does not identify a specific fault.")
        else:
            st.success("No sustained residual advisory at this sample.")
    if snapshot["history"]:
        st.vega_lite_chart({"data": {"values": snapshot["history"]}, "mark": "line",
            "encoding": {"x": {"field": "x_m", "type": "quantitative", "title": "Local x (m)"},
                         "y": {"field": "y_m", "type": "quantitative", "title": "Local y (m)"},
                         "order": {"field": "sample_time_s", "type": "quantitative"}}}, width="stretch")
        st.caption("Odometry trajectory in an unsurveyed local frame; axis scales may differ. No absolute position or heading sensor is available.")
    if derived and not snapshot["continuity_lost"]:
        path = motion_forecast(snapshot["pose"], derived["v_left_m_s"], derived["v_right_m_s"], calibration.track_m)
        st.caption(f"5 s constant-wheel-speed forecast: x={path[-1][0]:.3f} m, y={path[-1][1]:.3f} m. No obstacle model.")
        raw = snapshot["raw"]
        remaining = runtime_hours(snapshot["soc"], .20, calibration.capacity_ah, raw["battery_current_a"])
        st.caption("Runtime to assumed 20% reserve: " + ("unavailable" if remaining is None else f"{remaining:.2f} h at the latest current held constant"))
    with st.expander("Raw packet and derived values"):
        st.json({"raw": snapshot["raw"], "derived": derived,
                 "invalid_packets": snapshot["invalid_packets"], "ignored_packets": snapshot["ignored_packets"]})
    if snapshot["history"]:
        st.download_button("Download derived history (JSON)", json.dumps(snapshot["history"], indent=2),
                           file_name=f"{rid}_derived_sensor_history.json", key=f"history-{rid}")


@st.fragment(run_every="1s")
def live_view(db, calibration):
    snapshot = db.read_snapshot(expected_fingerprint=calibration_fingerprint(calibration))
    st.caption("PostgreSQL-backed AMR-01: persisted measurements and model results")
    show_robot("amr01", snapshot, calibration)


def inventory_view():
    st.subheader("Stock and task events · legacy stock example")
    st.caption("Manual software example for one stock location and AMR-01. These inputs are not sensor measurements or physical commands.")
    if "slide15_state" not in st.session_state:
        st.session_state.slide15_state = dict(stock=100, task="idle")
    state = st.session_state.slide15_state
    left, right = st.columns(2)
    with left:
        st.metric("Stock (units)", state["stock"])
        st.code("stock_next = stock + delivered - consumed", language="python")
        with st.form("slide15_stock"):
            delivered = st.number_input("Delivered units", min_value=0, value=0, step=1)
            consumed = st.number_input("Consumed units", min_value=0, value=0, step=1)
            apply_stock = st.form_submit_button("Apply stock event")
        if apply_stock:
            try:
                updated = stock_step(state["stock"], delivered, consumed)
            except ValueError as error:
                st.error(str(error))
            else:
                state["stock"] = updated
                st.rerun()
        st.caption("stock: current units; delivered: received units; consumed: removed units. Inputs must be non-negative integers; negative resulting stock is rejected.")
    with right:
        st.metric("AMR-01 task state", state["task"])
        st.code("idle → assigned → travelling → servicing → idle", language=None)
        with st.form("slide15_task"):
            event = st.selectbox("Confirmed task event", ("assign", "start", "arrive", "complete", "fault"))
            apply_task = st.form_submit_button("Apply task event")
        if apply_task:
            state["task"] = task_step(state["task"], event)
            st.rerun()
        st.caption("assign/start/arrive/complete advance the matching state. Other events leave it unchanged. fault enters the fault state; automatic recovery is not defined.")
    if st.button("Reset slide 15 example"):
        st.session_state.slide15_state = dict(stock=100, task="idle")
        st.rerun()
    st.caption("Project extension from slide 15; no numbered equation in the two sensor papers. [Ferrari et al. (2024), Section 4](https://doi.org/10.1007/s00170-023-12660-y) is workflow background only. No policy comparison or fleet-allocation model is added here.")


def render_sensor_dashboard():
    st.title("Warehouse Robot Digital Twin")
    st.caption("S. L. Richris · one ESP32 sensor node · Python models in Streamlit · observer/advisory view")
    sensors, inventory, mapping = st.tabs(("Sensor twin", "Inventory & tasks", "Equations & evidence"))
    with sensors:
        mode = st.radio("Data source", ("Synthetic demonstration", "Live MQTT sensors"), horizontal=True)
        if mode == "Synthetic demonstration":
            st.info("SYNTHETIC DATA · illustrative calibration, not hardware validation. AMR01 has an injected gyro disagreement at 3–4 s.")
            fleet = demo_fleet()
            snapshots = fleet.snapshots(now=6)
            for col, rid in zip(st.columns(len(ROBOT_IDS)), ROBOT_IDS):
                with col:
                    show_robot(rid, snapshots[rid], fleet.robots[rid].calibration)
            with st.expander("Residual demonstration history"):
                st.line_chart(snapshots["amr01"]["history"], x="sample_time_s", y="residual_rad_s", x_label="Sample time (s)", y_label="Residual (rad/s)")
        else:
            st.caption("The dedicated worker subscribes to robot/amr01/state and persists validated samples. Configure a read-only database connection and measured calibration privately.")
            try:
                if st.secrets["commissioning"]["measured_calibration_confirmed"] is not True:
                    raise ValueError("Measured calibration must be confirmed")
                calibration = st.secrets["calibration"].to_dict()
                if set(calibration) != {"amr01"}:
                    raise ValueError("Only one measured AMR-01 calibration is supported")
                c = Calibration(**calibration["amr01"])
                db = database_reader(st.secrets["database"]["url"])
            except Exception:
                st.warning("Live database is not configured or reachable. Check private read-only database URL, measured calibration and ingestion worker.")
            else:
                st.caption("The independent ingestion worker persists AMR-01 samples. Dashboard reads stored estimates, without publishing commands.")
                live_view(db, c)
    with inventory:
        inventory_view()
    with mapping:
        root = Path(__file__).resolve().parents[2]
        st.markdown((root / "project_documentation/slide_to_code_mapping.md").read_text())
