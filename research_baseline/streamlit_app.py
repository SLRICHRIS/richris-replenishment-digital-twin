"""Plain-language research workstation around the *shared* Python simulation.

This is a session-isolated Streamlit interface. The complete, persistent
FastAPI + SQLite system runs separately through warehouse_twin.api.
No commands to physical robots are issued by this interface.
"""
from __future__ import annotations

import copy
import csv
import io
import json
from html import escape

import streamlit as st
from warehouse_twin import simulation
from warehouse_twin.explain import (
    current_task, FIELD_LABELS, inventory_differences,
    interpret_event_logs, next_event, stock_explanation,
)

st.set_page_config(
    page_title="Replenishment | Understand the research model", layout="wide",
    initial_sidebar_state="expanded",
)

# High-contrast, deliberately restrained: no decorative gradients or status colours.
st.markdown("""<style>
  .block-container {max-width: 1240px; padding-top: 1.7rem; padding-bottom: 3.5rem;}
  h1,h2,h3 {letter-spacing: -.02em;}
  [data-testid="stMetric"] {border: 1px solid #d0d0d0; padding: 12px;}
  [data-testid="stMetricLabel"], [data-testid="stCaptionContainer"] {color: #222 !important;}
  [data-testid="stSidebar"] {border-right: 1px solid #c8c8c8;}
  .lab-flow {display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:10px 0 16px;}
  .lab-flow > div {border:1px solid #9a9a9a;padding:12px;background:white;color:#111;font-size:14px;}
  .lab-flow strong {display:block;margin-bottom:6px;}
  .lab-note {border-left:3px solid #111;padding:9px 14px;margin:10px 0;color:#111;background:#fafafa;}
  @media (max-width:800px){.lab-flow{grid-template-columns:1fr 1fr;}}
</style>""", unsafe_allow_html=True)


def reset_experiment(policy="fifo", blocked=None, parameters=None):
    model, initial_log = simulation.new_state(policy=policy, blocked=blocked, parameters=parameters)
    st.session_state.model = model
    st.session_state.event_log = initial_log
    st.session_state.steps = []
    st.session_state.physical_records = {}
    st.session_state.pop("comparison", None)


def get_state():
    if "model" not in st.session_state:
        reset_experiment()
    return st.session_state.model


def advance_one():
    state = get_state()
    if not state["queue"]:
        return
    prior = copy.deepcopy(state)
    events = simulation.step(state)
    record = {"number": len(st.session_state.steps) + 1,
              "time": state["time"], "scheduled_kind": min(prior["queue"], key=lambda e:(e["at"],e["id"]))["kind"],
              "events": events, "before": prior, "after": copy.deepcopy(state)}
    st.session_state.steps.append(record)
    st.session_state.event_log.extend(events)


def advance_to(until: float):
    state = get_state()
    if not 0 <= until <= 1440 or until + simulation.EPS < state["time"]:
        raise ValueError("Time must not be earlier than the current simulation clock or later than 1440 s.")
    steps = 0
    while state["queue"] and min(e["at"] for e in state["queue"]) <= until + simulation.EPS and steps < 500:
        advance_one()
        steps += 1
    state["time"] = max(state["time"], float(until))
    simulation.assert_invariants(state)


def graph_svg(state: dict) -> str:
    # Black/white route graph; positions and edge weights are synthetic.
    w, h = 760, 380
    x_of = lambda x: 45 + x * 67
    y_of = lambda y: 328 - y * 52
    blocked = set(state["blocked"])
    active = current_task(state)
    path = active["route_to_pick"] if active else []
    active_edges = {frozenset((a, b)) for a, b in zip(path, path[1:])}
    result = [f'<svg width="100%" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="Warehouse graph; R is reserve, P1 P2 P3 are picking shelves">',
              f'<rect width="{w}" height="{h}" fill="white"/>']
    for u, v, _ in simulation.EDGES:
        x1,y1=simulation.NODES[u];x2,y2=simulation.NODES[v]
        on_path=frozenset((u, v)) in active_edges
        style='stroke-dasharray="5 5"' if u in blocked or v in blocked else ''
        result.append(f'<line x1="{x_of(x1)}" y1="{y_of(y1)}" x2="{x_of(x2)}" y2="{y_of(y2)}" stroke="{("#111" if on_path else "#aaa")}" stroke-width="{4 if on_path else 1.5}" {style}/>')
    for name,(x,y) in simulation.NODES.items():
        robot = state["robot"]["node"] == name
        location = name == "R" or name.startswith("P")
        fill = "#111" if robot else "white"
        r = 22 if location else 17
        result.append(f'<circle cx="{x_of(x)}" cy="{y_of(y)}" r="{r}" fill="{fill}" stroke="black" stroke-width="{2 if location else 1.5}"/>')
        result.append(f'<text x="{x_of(x)}" y="{y_of(y)+5}" font-family="Arial,sans-serif" font-size="14" font-weight="{("bold" if location else "normal")}" fill="{("white" if robot else "black")}" text-anchor="middle">{escape(name)}</text>')
        if name in blocked:
            result.append(f'<path d="M {x_of(x)-10} {y_of(y)-10} l 20 20 M {x_of(x)+10} {y_of(y)-10} l -20 20" stroke="black" stroke-width="2"/>')
    result.append('<text x="15" y="371" font-family="Arial,sans-serif" font-size="13" fill="black">Thick line: assigned route   |   Black node: robot at last recorded location   |   X: closed aisle</text>')
    result.append('</svg>')
    return ''.join(result)


def csv_data(rows: list[dict]) -> bytes:
    if not rows:
        return b""
    b = io.StringIO()
    writer = csv.DictWriter(b, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return b.getvalue().encode("utf-8")


def inventory_rows(state):
    return [{"Product": sku, "Pick shelf": v["pick"], "Reserve shelf": v["reserve"],
             "Reserved (in reserve)": v["reserved"], "On robot": v["transit"],
             "Pick location": v["location"]} for sku,v in sorted(state["inventory"].items())]


def task_rows(state):
    return [{"Task":t["id"], "Item":t["sku"], "Units":t["quantity"],
             "Destination":t["location"], "State":t["status"],
             "Created (s)":t["created_at"], "Started (s)":t["assigned_at"],
             "Delivered (s)":t["delivered_at"]} for t in state["tasks"].values()]


state = get_state()

with st.sidebar:
    st.header("Experiment controls")
    st.write("These settings are for a **new synthetic run**. Editing them does not change a run already in progress.")
    with st.form("new_run"):
        policy = st.selectbox("Dispatch rule", ["fifo", "urgency"],
            index=0 if state["policy"]=="fifo" else 1,
            format_func=lambda v: "FIFO: oldest request first" if v=="fifo" else "Urgency: smallest stockout slack first")
        blocked = st.multiselect("Aisles unavailable from the start", sorted(simulation.BLOCKABLE), default=state["blocked"])
        speed = st.number_input("Assumed travel speed (graph units/s)", 0.05, 10.0, float(state["parameters"]["speed_units_per_second"]), .05)
        load = st.number_input("Assumed loading time (s)", 0.0, 60.0, float(state["parameters"]["load_seconds"]), 1.0)
        unload = st.number_input("Assumed unloading time (s)", 0.0, 60.0, float(state["parameters"]["unload_seconds"]), 1.0)
        restart = st.form_submit_button("Apply settings and restart", use_container_width=True)
    if restart:
        try:
            reset_experiment(policy, blocked, {"speed_units_per_second":speed,
                "load_seconds":load, "unload_seconds":unload})
            st.rerun()
        except ValueError as exc:
            st.error(str(exc))
    st.divider()
    st.markdown("**Settings in the active run**")
    st.write(f"Dispatch: **{state['policy'].upper()}**")
    st.write(f"Blocked: **{', '.join(state['blocked']) if state['blocked'] else 'None'}**")
    st.write(f"Speed: **{state['parameters']['speed_units_per_second']}** graph units/s")
    st.write(f"Load / unload: **{state['parameters']['load_seconds']} / {state['parameters']['unload_seconds']} s**")
    st.caption("Aisle closures here are initial conditions, not live safety or robot-control commands.")

st.title("Warehouse replenishment: see every decision")
st.write("**One problem:** a picking shelf has too little stock. A simulated robot must bring more from reserve storage while customer demand continues to arrive.")
st.markdown("""<div class="lab-note"><strong>What this is:</strong> A reproducible discrete-event digital model with invented warehouse geometry, demand and timings.
<strong>What this is not:</strong> A live, physically calibrated warehouse Digital Twin or a robot controller.</div>""", unsafe_allow_html=True)
st.markdown("""<div class="lab-flow">
<div><strong>1. Detect a shortage</strong>WMS-like function checks picking stock, creates a task and reserves stock.</div>
<div><strong>2. Choose execution</strong>WCS-like function selects a task and plans a traversable route.</div>
<div><strong>3. Move goods</strong>Timed pickup and delivery events move stock between locations.</div>
<div><strong>4. Check the result</strong>Inventory balances, service levels and simulated times are inspected.</div>
</div>""", unsafe_allow_html=True)

process, policy_tab, model_tab, evidence_tab = st.tabs([
    "1  Follow one replenishment", "2  Compare two decisions", "3  Why this model", "4  Evidence and paper"
])

with process:
    st.subheader("Follow one replenishment, one event at a time")
    st.write("**Start with task T001:** KIT-A starts with 4 units on its picking shelf. Its target is 18, so the model reserves 14 units from reserve stock. A reservation is not a delivery.")
    met = simulation.metrics(state)
    k1,k2,k3,k4 = st.columns(4)
    k1.metric("Simulation time", f"{state['time']:.3f} s")
    k2.metric("Robot", "Busy" if state['robot']['status']=='busy' else "Idle")
    k3.metric("Delivered tasks", met["tasks_completed"])
    k4.metric("Demand fulfilled", f"{met['fulfilled']} / {met['requested']} units")
    st.caption("Demand fulfilled is not a percentage until a demand event has occurred. Times and geometry are synthetic.")
    st.divider()
    left,right=st.columns([1.2,1],gap="large")
    with left:
        st.markdown("**Warehouse route and locations**")
        st.components.v1.html(graph_svg(state), height=400, scrolling=False)
        st.caption("Graph edges represent assumed route distance, not surveyed metres. The robot's node updates at pickup and delivery, not continuously in between.")
        current=current_task(state)
        if current:
            st.write(f"**Current task:** {current['id']} moves {current['quantity']} units of {current['sku']} to {current['location']}.")
            st.write(f"**Selected route:** {' → '.join(current['route_to_pick'])} (reserve to picking location)")
        else:
            st.write("**Current task:** None assigned. The robot is idle.")
    with right:
        st.markdown("**What happens next?**")
        queued=next_event(state)
        if queued:
            st.write(f"**At simulation time {queued['at']:.3f} s:** {queued['detail']}")
            st.write(queued["why"])
            if st.button("Process the next event", type="primary", use_container_width=True):
                try:
                    advance_one()
                    st.rerun()
                except (ValueError, AssertionError) as exc:
                    st.error(str(exc))
            with st.form("run_to_horizon"):
                until=st.number_input("Or advance to time (s)", min_value=float(state['time']), max_value=1440.0,
                    value=float(max(120.0,state['time'])), step=10.0)
                run=st.form_submit_button("Process all events up to this time", use_container_width=True)
            if run:
                try:
                    advance_to(until)
                    st.rerun()
                except (ValueError,AssertionError) as exc:
                    st.error(str(exc))
        else:
            st.write("No further events are scheduled. Restart the experiment to replay it.")
        st.divider()
        if st.session_state.steps:
            selected=st.selectbox("Inspect a processed step", list(range(len(st.session_state.steps)-1,-1,-1)),
                format_func=lambda i: f"Step {i+1}: {st.session_state.steps[i]['scheduled_kind'].upper()} at {st.session_state.steps[i]['time']:.3f} s")
            transition=st.session_state.steps[selected]
            st.markdown("**What actually happened**")
            for row in interpret_event_logs(transition['events']):
                st.write(f"{row['Action']}: {row['Recorded outcome']}")
            diff=inventory_differences(transition['before'], transition['after'])
            if diff:
                st.write("**Stock changes caused by this step**")
                st.dataframe(diff,hide_index=True,use_container_width=True)
            else:
                st.write("This step changed task or robot state, but did not physically move or consume stock.")
            st.caption(stock_explanation(transition['scheduled_kind']))
        else:
            st.write("**At time 0:** the WMS-like function has reserved stock, and the WCS-like function has dispatched T001. Click **Process the next event** to see the first physical inventory transfer.")
    st.divider()
    st.subheader("Where is the stock now?")
    st.dataframe(inventory_rows(state), hide_index=True, use_container_width=True)
    st.write("**Read the columns:** 'Reserve shelf' includes 'Reserved'. Reserved is a promise to transfer stock, not a second pile of goods. 'On robot' counts stock after pickup and before delivery. 'Pick shelf' is stock available to fill demand.")
    with st.expander("See all tasks and full timestamped event log", expanded=False):
        st.markdown("**Task ledger**")
        st.dataframe(task_rows(state),hide_index=True,use_container_width=True)
        st.markdown("**Events (recorded by the model)**")
        history=interpret_event_logs(st.session_state.event_log)
        st.dataframe(history,hide_index=True,use_container_width=True,height=320)
        st.download_button("Download all events (CSV)",csv_data(history),file_name="synthetic_replenishment_events.csv",mime="text/csv")

with policy_tab:
    st.subheader("Does smarter task selection improve the outcome?")
    st.write("**Research question:** If the same simulated warehouse is run twice with identical demand and routes, does prioritizing the task with less stockout slack improve service compared with FIFO? Each run has **one** virtual robot.")
    st.markdown("""<div class="lab-flow" style="grid-template-columns:repeat(3,1fr)">
    <div><strong>Same inputs</strong>Same initial stock, demand schedule, closures, speed and handling time.</div>
    <div><strong>One variable</strong>FIFO chooses the earliest request. Urgency chooses the smallest estimated stockout slack.</div>
    <div><strong>Compare outputs</strong>Count demand fulfilled, unmet units and completed missions at the same horizon.</div>
    </div>""", unsafe_allow_html=True)
    st.write("This policy comparison is independent of the current run's selected dispatch rule. It re-creates both policies from time zero with the active run's assumptions.")
    horizon=st.slider("Compare after how many simulated seconds?", 30, 180, 120, 10)
    if st.button("Run matched FIFO and urgency experiments", use_container_width=False):
        st.session_state.comparison=simulation.comparison(
            blocked=state['blocked'], until=float(horizon), parameters=state['parameters'])
    if "comparison" in st.session_state:
        comp=st.session_state.comparison
        rows=[]
        for key,title in (("fifo","FIFO"),("urgency","Urgency")):
            met=comp['policies'][key]['metrics']
            rows.append({"Dispatch rule":title, "Demand filled (units)":met['fulfilled'],
                "Demand unmet (units)":met['unmet'], "Fill rate (%)":met['fill_rate_pct'],
                "Completed tasks":met['tasks_completed'],
                "Mean assigned-to-delivered time (s)":met['mean_task_duration_seconds']})
        st.dataframe(rows, hide_index=True, use_container_width=True)
        a=comp['policies']['fifo']['metrics'];b=comp['policies']['urgency']['metrics']
        delta=b['fulfilled']-a['fulfilled']
        if delta>0:
            st.write(f"**In this synthetic run, urgency served {delta} more demand units than FIFO.**")
        elif delta<0:
            st.write(f"**In this synthetic run, urgency served {-delta} fewer demand units than FIFO.**")
        else:
            st.write("**In this synthetic run, both rules served the same number of units.**")
        st.write("**What this proves:** under these specified synthetic assumptions, the policy choice changes (or does not change) the simulated result. It does not prove a causal improvement in a real warehouse.")
        st.caption(f"Matched horizon: {comp['until']} simulated s. Both simulations start from the same initial state and demand events. Any numeric advantage may reverse under different assumptions.")
        st.download_button("Download reproducible comparison (JSON)",json.dumps(comp,indent=2),file_name="matched_policy_experiment.json",mime="application/json")
    else:
        st.write("No comparison has been computed yet. Select a horizon and run the experiment to see both policies under identical inputs.")
    with st.expander("Exactly how is urgency calculated?",expanded=False):
        st.latex(r'S_i = \frac{Q_{pick,i}}{\hat{\lambda}_i} - \hat{T}_i')
        st.write("**Sᵢ (seconds):** estimated stockout slack for item *i*; smaller means higher urgency.")
        st.write("**Q_pick,i (units):** quantity presently available at the picking shelf.")
        st.write("**λ̂ᵢ (units/second):** assumed demand rate, fixed before the run, not estimated from future known demand.")
        st.write("**T̂ᵢ (seconds):** predicted time to pick up and deliver this replenishment task.")
        st.write("The estimate is heuristic: actual demand occurs in discrete scheduled orders, not as a continuous rate. The decision policy is therefore an unvalidated experimental hypothesis.")

with model_tab:
    st.subheader("Why each component exists")
    st.write("Ferrari et al. motivate separating information-system decisions from physical equipment behaviour and validating predictions against observations. Our model makes that separation inspectable, using a much smaller synthetic warehouse.")
    choices=[
        ("WMS-like task generator", "Identify low stock and reserve items", "A task and a reservation are information decisions; neither moves goods by itself.", "WMS software here is a limited research function, not a commercial warehouse management system."),
        ("WCS-like dispatcher", "Select an executable task and route", "A robot needs an assignment and a traversable path before a timed physical transfer can occur.", "Dispatch does not communicate with real controllers or PLCs."),
        ("Discrete-event simulator", "Advance only when a scheduled event occurs", "Makes every state change auditable and supplies a measurable timestamp.", "Intermediate mechanical motion, collisions and acceleration are not physically reproduced."),
        ("Network shortest path", "Find route through permitted graph nodes", "A transparent, testable baseline for route closures.", "Graph weights are invented, not surveyed metres. Only one simulated vehicle is used."),
        ("Reserve / transit / picking accounts", "Track where units are physically located", "Prevents assigning goods at a shelf before delivery and detects artificial stock creation.", "Reserved units remain within reserve quantity; do not sum them again."),
        ("Local API + SQLite", "Save run history and externally supplied observations", "State should survive an API process restart for research auditability.", "This runs as a separate local FastAPI process, not inside Community Cloud Streamlit."),
    ]
    st.dataframe([{"Component":a,"What it does":b,"Why chosen":c,"Boundary":d} for a,b,c,d in choices],hide_index=True,use_container_width=True)
    st.subheader("A replenishment is not instantaneous")
    st.write("**Example at t=0:** KIT-A has 4 available units, target 18. The software creates T001 for 14 units. Those 14 are initially reserved in storage, not added to picking inventory.")
    st.write("**At pickup:** reserve decreases by 14 and in-transit increases by 14. **At delivery:** in-transit decreases by 14 and picking increases by 14. Incoming demand can consume picking stock while the robot is travelling.")
    st.subheader("Conservation equation, term by term")
    st.latex(r'Q_{initial,i} - D_{fulfilled,i} = Q_{reserve,i}+Q_{pick,i}+Q_{transit,i}')
    st.write("Each term is a **number of units of item i**, not a time or distance. Initial units minus units already used to satisfy demand must equal goods physically stored in reserve, at picking, or on the robot.")
    st.write("**Q_initial,i:** opening total stock of item *i*. **D_fulfilled,i:** cumulative units actually supplied to demand. **Q_reserve,i:** physical units at reserve (including any reserved units). **Q_pick,i:** physical units at the picking shelf. **Q_transit,i:** physical units carried by the robot.")
    st.write("A separate `reserved` counter describes allocation only. It is not added to the right side of the equation.")
    st.subheader("Estimated travel and handling time")
    st.latex(r'\hat T=\frac{d(robot,reserve)}{v}+t_{load}+\frac{d(reserve,pick)}{v}+t_{unload}')
    st.write("**T̂ (seconds):** estimated time from assignment to delivery. **d (graph distance units):** shortest permitted route distance between the two named locations. **v (graph units/second):** assumed constant speed. **t_load and t_unload (seconds):** assumed handling durations.")
    st.write("**Why not a 3D moving robot?** The model currently records position only when pickup or delivery occurs. Adding a smooth 3D animation would imply detailed mechanical behaviour the engine does not compute.")

with evidence_tab:
    st.subheader("Which claims can we defend today?")
    st.dataframe([
        {"Claim": "Events and inventory transfers follow the implemented rules", "Evidence": "Automated simulation tests and event ledger", "Status": "Software-checked"},
        {"Claim": "All physical units remain accounted for", "Evidence": "Conservation after event processing", "Status": "Software-checked"},
        {"Claim": "A dispatch policy performs better under a synthetic scenario", "Evidence": "Matched model runs with the same inputs", "Status": "Scenario-specific only"},
        {"Claim": "Travel and handling times match a real robot", "Evidence": "Requires independently timed physical trials", "Status": "Not demonstrated"},
        {"Claim": "Live, bidirectional Digital Twin synchronization", "Evidence": "Requires validated telemetry and command feedback", "Status": "Not implemented"},
    ], hide_index=True, use_container_width=True)
    st.subheader("Live software consistency check")
    balances=simulation.conservation(state)
    st.dataframe([{"Product":r['sku'], "Expected physical units":r['expected'],
                   "Observed model units":r['observed'], "Difference":r['difference'],
                   "Balance correct":r['valid']} for r in balances],hide_index=True,use_container_width=True)
    st.caption("A zero difference proves internal accounting is consistent. It does not prove the inventory matches a real warehouse.")
    st.subheader("Optional external timing comparison")
    completed=[t for t in state['tasks'].values() if t['status']=='completed']
    if completed:
        with st.form("timing_record"):
            choice=st.selectbox("Completed task",[t['id'] for t in completed])
            duration=st.number_input("Externally observed assignment-to-delivery duration (seconds)",min_value=0.01,value=30.0,step=1.0)
            source=st.text_input("Observation source / trial identifier",placeholder="e.g. physical run 01, or synthetic example")
            add=st.form_submit_button("Record user-entered observation")
        if add:
            if not source.strip():
                st.error("Enter a source or trial identifier so a number cannot be mistaken for verified physical evidence.")
            else:
                selected=next(t for t in completed if t['id']==choice)
                model_time=selected['delivered_at']-selected['assigned_at']
                st.session_state.physical_records[choice]={"Task":choice,"Source (self-reported)":source.strip(),
                    "Model (s)":round(model_time,3),"Entered observation (s)":round(duration,3),
                    "Absolute error (s)":round(abs(model_time-duration),3)}
        rows=list(st.session_state.physical_records.values())
        if rows:
            st.dataframe(rows,hide_index=True,use_container_width=True)
            mae=sum(r['Absolute error (s)'] for r in rows)/len(rows)
            st.write(f"**Mean absolute error for these entered values:** {mae:.3f} seconds.")
            st.caption("The app does not verify the source. This calculation alone is not physical calibration or validation. Use separate calibration and held-out testing runs.")
            st.download_button("Download entered timing records",csv_data(rows),file_name="user_entered_timings.csv",mime="text/csv")
    else:
        st.write("Complete at least one task in the first tab to enable timing comparison.")
    st.subheader("Research source and intellectual credit")
    st.markdown("""Ferrari, A., Carlin, A., Rafele, C., & Zenezini, G. (2024).
    **A method for developing and validating simulation models for automated storage and retrieval system digital twins.**
    *The International Journal of Advanced Manufacturing Technology*, 131, 5369–5382.
    [DOI: 10.1007/s00170-023-12660-y](https://doi.org/10.1007/s00170-023-12660-y)

    **Methodological inspiration:** explicit information-system and physical-process modelling; experimentally calibrated and checked simulation.
    **Our independent implementation:** the small warehouse graph, units, assumed demand, routing policies, Python event engine and interfaces. Ferrari's AnyLogic models, experimental apparatus, physical data and original figures are not reproduced here.

    We do not claim that Ferrari validated our implementation or that these synthetic results reproduce their experimental findings.""")
    st.write("**Required next experiment:** observe actual pickup, travel, unloading and demand events; identify time and route errors; calibrate on one set of physical trials; report prediction errors on independent held-out trials.")

st.divider()
st.caption("Educational research prototype | Synthetic model | Powered by warehouse_twin.simulation | Physical control disabled | Ferrari et al. (2024) credited above")
