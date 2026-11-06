"""Streamlit view over server-computed sensor state; no browser-side modelling."""
import json
from pathlib import Path

import streamlit as st

from .demo import demo_fleet
from .models import Calibration, motion_forecast, runtime_hours
from .mqtt_service import MQTTService
from .telemetry import ROBOT_IDS


@st.cache_resource(show_spinner=False)
def live_service(host, username, password, calibration_json):
    values = json.loads(calibration_json)
    calibrations = {rid: Calibration(**values[rid]) for rid in ROBOT_IDS}
    return MQTTService(host, username, password, calibrations)


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
def live_view(service):
    st.caption(f"MQTT/TLS 8883 · {service.status} · rejected packets: {service.fleet.rejected_packets}")
    snapshots = service.fleet.snapshots()
    for column, rid in zip(st.columns(len(ROBOT_IDS)), ROBOT_IDS):
        with column:
            show_robot(rid, snapshots[rid], service.fleet.robots[rid].calibration)


def inventory_view():
    from research_baseline.warehouse_twin.simulation import new_state, step, run_until, metrics, assert_invariants
    st.subheader("Warehouse replenishment experiment")
    st.info("Synthetic discrete-event experiment: one virtual robot per policy run. It is separate from the physical AMR-01 sensor node; no telemetry automatically confirms inventory movement.")
    policy = st.selectbox("Dispatch policy", ("fifo", "urgency"))
    if "inventory_experiment" not in st.session_state or st.session_state.inventory_experiment["policy"] != policy:
        st.session_state.inventory_experiment = new_state(policy)[0]
    state = st.session_state.inventory_experiment
    a, b, c = st.columns(3)
    if a.button("Next warehouse event"):
        step(state)
    if b.button("Run to 120 s"):
        run_until(state, max(120, state["time"]))
    if c.button("Reset warehouse experiment"):
        state = st.session_state.inventory_experiment = new_state(policy)[0]
    assert_invariants(state)
    st.caption(f"Simulation time: {state['time']:.1f} s. Stock changes only through scheduled demand, pickup and delivery events.")
    st.dataframe([{"sku": sku, **values} for sku, values in state["inventory"].items()], hide_index=True)
    st.caption("Reserved is a subset of reserve. Conservation: initial − fulfilled = reserve + transit + pick.")
    st.dataframe(list(state["tasks"].values()), hide_index=True)
    with st.expander("Experiment metrics and robot state"):
        st.json({"metrics": metrics(state), "robot": state["robot"]})
    st.caption("Detailed walkthrough/API and comparison tests remain in research_baseline/. [Ferrari et al. (2024), Section 4](https://doi.org/10.1007/s00170-023-12660-y) provides the WMS/WCS and discrete-event background. Our replenishment workflow is an adaptation; sensor equations are mapped separately.")


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
            st.caption("The backend subscribes to robot/amr01/state. Configure private Streamlit secrets and measured calibrations; no credentials are sent to the browser.")
            try:
                if not st.secrets["commissioning"]["measured_calibration_confirmed"]:
                    raise ValueError("Measured calibration must be confirmed")
                config = st.secrets["mqtt"]
                calibration = st.secrets["calibration"].to_dict()
                service = live_service(config["host"], config["username"], config["password"], json.dumps(calibration, sort_keys=True))
            except (KeyError, FileNotFoundError, ValueError, TypeError):
                st.warning("Live mode is not configured. Copy .streamlit/secrets.example.toml to private secrets and replace all illustrative calibration values with measured values.")
                service = None
            if service is not None:
                st.caption("Local origin is (0, 0, 0) at first accepted packet. Live models use session memory, not a durable measurement archive. Restarting Streamlit resets the integrals.")
                live_view(service)
    with inventory:
        inventory_view()
    with mapping:
        root = Path(__file__).resolve().parents[2]
        st.markdown((root / "project_documentation/slide_to_code_mapping.md").read_text())
