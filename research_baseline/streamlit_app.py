"""Streamlit research workstation for the shared Python warehouse simulation engine.

Each browser session gets an isolated synthetic scenario. No physical telemetry
or motor control occurs in this Community Cloud view. Persistent FastAPI +
SQLite endpoints are provided by warehouse_twin.api for local use.
"""
from __future__ import annotations
import copy
import csv
import io
import json
from html import escape

import streamlit as st
from warehouse_twin import simulation

st.set_page_config(page_title="Warehouse Replenishment | Research Model", layout="wide")


def fresh(policy="fifo", blocked=None, params=None):
    state, initial = simulation.new_state(policy=policy, blocked=blocked, parameters=params)
    st.session_state.model_state = state
    st.session_state.events = initial
    st.session_state.recorded_errors = {}
    st.session_state.run_id = st.session_state.get("run_id", 0) + 1


def record_events(events):
    st.session_state.events.extend(events)


def current_state():
    if "model_state" not in st.session_state:
        fresh()
    return st.session_state.model_state


def grid_svg(state):
    width, height = 790, 400
    cx=lambda x: 50+65*x
    cy=lambda y: 350-58*y
    blocked=set(state["blocked"])
    parts=[f'<svg width="100%" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Warehouse graph with blocked nodes">',
           '<rect x="0" y="0" width="790" height="400" fill="white"/>']
    for u,v,_ in simulation.EDGES:
        x1,y1=simulation.NODES[u];x2,y2=simulation.NODES[v]
        dash='stroke-dasharray="5 7"' if u in blocked or v in blocked else ''
        parts.append(f'<line x1="{cx(x1)}" y1="{cy(y1)}" x2="{cx(x2)}" y2="{cy(y2)}" stroke="#777" stroke-width="2" {dash}/>')
    for node,(x,y) in simulation.NODES.items():
        isblock=node in blocked
        isrobot=node==state['robot']['node']
        fill='#222' if isrobot else ('#fff' if not isblock else '#ddd')
        stroke='#333'
        parts.append(f'<circle cx="{cx(x)}" cy="{cy(y)}" r="19" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
        parts.append(f'<text x="{cx(x)}" y="{cy(y)+5}" font-size="14" font-family="Arial" text-anchor="middle" fill="{("white" if isrobot else "black")}">{escape(node)}</text>')
        if isblock: parts.append(f'<path d="M {cx(x)-10} {cy(y)-10} l 20 20 M {cx(x)+10} {cy(y)-10} l -20 20" stroke="#111" stroke-width="2"/>')
    parts += ['<text x="10" y="392" font-size="13" fill="black">R: reserve | P1-P3: picking locations | Filled circle: simulated robot | Cross: blocked node</text>','</svg>']
    return ''.join(parts)


def stock_table(state):
    rows=[]
    for sku, item in sorted(state['inventory'].items()):
        rows.append({'SKU':sku, 'Picking':item['pick'], 'Reserve on hand':item['reserve'],
                     'Of which reserved':item['reserved'], 'In transit':item['transit'],
                     'Picking location':item['location']})
    return rows


def task_table(state):
    return [{ 'Task':t['id'], 'SKU':t['sku'], 'Units':t['quantity'],
              'Status':t['status'], 'Destination':t['location'],
              'Dispatch s':t['assigned_at'], 'Delivered s':t['delivered_at'],
              'Predicted duration s':t['estimated_duration']} for t in state['tasks'].values()]


def event_rows():
    return [{'Time s':e['time'],'Event':e['kind'],'Explanation':e['message']} for e in st.session_state.events]


def csv_bytes(rows):
    if not rows:return b''
    target=io.StringIO()
    writer=csv.DictWriter(target,fieldnames=list(rows[0]))
    writer.writeheader();writer.writerows(rows)
    return target.getvalue().encode('utf-8')

state=current_state()
st.title('Warehouse Replenishment | Research Model')
st.caption('Discrete-event model with synthetic demand and equipment timings. It is not a physically validated or bidirectionally synchronized Digital Twin.')

with st.sidebar:
    st.header('Experiment settings')
    selected_policy=st.selectbox('Task dispatch rule',options=['fifo','urgency'],
        format_func=lambda s:'FIFO: first requested, first executed' if s=='fifo' else 'Urgency: lowest estimated stockout slack',
        index=0 if state['policy']=='fifo' else 1)
    selected_blocked=st.multiselect('Blocked aisle nodes (applied on reset)',sorted(simulation.BLOCKABLE),
                                     default=state['blocked'],help='Blockage is imposed before dispatch; this version does not replan a moving robot.')
    params=state['parameters']
    speed=st.number_input('Travel speed (graph units per second)',min_value=0.05,max_value=10.0,value=float(params['speed_units_per_second']),step=0.05)
    load=st.number_input('Load time (s)',min_value=0.0,max_value=60.0,value=float(params['load_seconds']),step=1.0)
    unload=st.number_input('Unload time (s)',min_value=0.0,max_value=60.0,value=float(params['unload_seconds']),step=1.0)
    if st.button('Create new experiment',use_container_width=True):
        try:
            fresh(selected_policy,selected_blocked,{'speed_units_per_second':speed,'load_seconds':load,'unload_seconds':unload})
            st.rerun()
        except ValueError as exc:st.error(str(exc))
    st.divider()
    st.markdown('**Research boundary**')
    st.write('This Streamlit app operates the same simulation engine as the local FastAPI system, but its state is held in the current browser session. Streamlit Community Cloud does not provide a durable SQLite backend for this demo.')
    st.write('No physical robot, MQTT broker, or sensor is connected here.')

tab_process,tab_experiment,tab_model,tab_validation,tab_credit=st.tabs([
    '1. Warehouse process','2. Policy experiment','3. Model structure','4. Evidence and validation','5. References'])

with tab_process:
    left,right=st.columns([1.4,1])
    with left:
        st.subheader('Warehouse movement graph')
        st.components.v1.html(grid_svg(state),height=420,scrolling=False)
        st.caption('This graph is synthetic. Edge weights are dimensionless route distances until physical surveying and calibration occur.')
    with right:
        st.subheader('Current simulation state')
        m=simulation.metrics(state)
        c1,c2=st.columns(2)
        c1.metric('Simulation clock',f"{state['time']:.1f} s")
        c2.metric('Robot status',state['robot']['status'].capitalize())
        c1.metric('Demand filled',f"{m['fulfilled']} / {m['requested']} units")
        c2.metric('Tasks completed',m['tasks_completed'])
        st.write('One robot is used to isolate timing and queue behaviour during model validation.')
        if st.button('Advance one event',use_container_width=True):
            try: record_events(simulation.step(state));st.rerun()
            except (ValueError,AssertionError) as exc: st.error(str(exc))
        until=st.number_input('Advance to simulation time (seconds)',min_value=float(state['time']),max_value=1440.0,
            value=float(max(120.0,state['time'])),step=10.0)
        if st.button('Run until selected time',use_container_width=True):
            try: record_events(simulation.run_until(state,until=float(until)));st.rerun()
            except (ValueError,AssertionError) as exc: st.error(str(exc))
    st.subheader('Inventory, including transfer state')
    st.dataframe(stock_table(state),hide_index=True,use_container_width=True)
    st.caption('A task reserves stock without moving it. Reserve decreases at pickup. Picking stock increases only at delivery.')
    st.subheader('Replenishment tasks')
    st.dataframe(task_table(state),hide_index=True,use_container_width=True)
    st.subheader('Timestamped operational events')
    rows=event_rows()
    st.dataframe(rows,hide_index=True,use_container_width=True,height=260)
    st.download_button('Export event log CSV',csv_bytes(rows),file_name='synthetic_warehouse_event_log.csv',mime='text/csv')

with tab_experiment:
    st.subheader('Matched policy comparison')
    st.write('FIFO and urgency policies receive identical demand, graph constraints and timing assumptions. The comparator does not modify the active simulation.')
    horizon=st.slider('Experiment horizon (simulated seconds)',min_value=30,max_value=180,value=120,step=10)
    if st.button('Compute both policies'):
        st.session_state['comparison_result']=simulation.comparison(blocked=selected_blocked,until=horizon,
            parameters={'speed_units_per_second':speed,'load_seconds':load,'unload_seconds':unload})
    if 'comparison_result' in st.session_state:
        comp=st.session_state['comparison_result'];result=[]
        for policy,v in comp['policies'].items():
            m=v['metrics']
            result.append({'Policy':policy.upper(),'Fill rate (%)':m['fill_rate_pct'],
                           'Demand filled (units)':m['fulfilled'],'Unmet demand (units)':m['unmet'],
                           'Tasks completed':m['tasks_completed'],'Mean task time (s)':m['mean_task_duration_seconds']})
        st.dataframe(result,hide_index=True,use_container_width=True)
        st.bar_chart(data={r['Policy']:r['Demand filled (units)'] for r in result}, horizontal=True)
        st.caption('These values are synthetic scenario results. They are not improvements measured in a real warehouse.')
        st.download_button('Export comparison JSON',json.dumps(comp,indent=2),file_name='matched_policy_comparison.json')

with tab_model:
    st.subheader('What is represented')
    st.markdown("""**Warehouse Management System (WMS), represented as a limited research function:**
    detects low pick-face stock, creates a replenishment task and reserves goods at the reserve location.

**Warehouse Control System (WCS), represented as a limited research function:**
    chooses a queued task, finds a traversable route for the simulated robot, and schedules pickup and delivery.

**Discrete-event simulation (DES):**
    updates state at task dispatch, pickup, delivery and customer-demand events rather than generating decorative robot motion.

**SQLite persistence:**
    the *local FastAPI system* stores state, per-run events and separate unverified telemetry. This hosted Streamlit view isolates state by browser session instead of sharing an unprotected SQLite file.
""")
    st.write('**Inventory conservation**')
    st.latex(r'Q_{initial,i}-D_{fulfilled,i}=Q_{reserve,i}+Q_{pick,i}+Q_{transit,i}')
    st.write('Reserved stock remains part of reserve on hand, so it is not counted twice.')
    st.write('**Predicted replenishment time**')
    st.latex(r'\hat{T}=\frac{d(robot,reserve)}{v}+t_{load}+\frac{d(reserve,pick)}{v}+t_{unload}')
    st.write('Distances are weighted shortest-path graph distances; speed and handling delays are synthetic inputs, not calibrated equipment measurements.')
    st.write('**Dispatch priority**')
    st.latex(r'S_i=\frac{Q_{pick,i}}{\hat{\lambda}_i}-\hat{T}_i')
    st.write('Urgency dispatches the task with the smallest estimated time-to-stockout slack. The demand-rate estimate is fixed and does not use future scheduled demand.')

with tab_validation:
    st.subheader('Logical checks')
    checks=simulation.conservation(state)
    st.dataframe(checks,hide_index=True,use_container_width=True)
    st.write('All SKU balances must equal initial stock less fulfilled demand.')
    st.subheader('Physical timing comparison (optional, entered by researcher)')
    completed=[t for t in state['tasks'].values() if t['status']=='completed']
    if completed:
        lookup={t['id']:t for t in completed}
        task_id=st.selectbox('Completed simulation task',list(lookup))
        observed=st.number_input('Independent observed task duration (s)',min_value=0.01,value=30.0,step=1.0)
        if st.button('Record provided measurement'):
            pred=lookup[task_id]['delivered_at']-lookup[task_id]['assigned_at']
            st.session_state.recorded_errors[task_id]={'Task':task_id,'Model time (s)':round(pred,3),
                'Entered time (s)':observed,'Absolute error (s)':round(abs(pred-observed),3)}
        if st.session_state.recorded_errors:
            measurements=list(st.session_state.recorded_errors.values())
            st.dataframe(measurements,hide_index=True,use_container_width=True)
            st.metric('MAE over entered observations',f"{sum(r['Absolute error (s)'] for r in measurements)/len(measurements):.2f} s")
            st.caption('Entries are self-reported. The interface cannot verify that these numbers came from physical experiments.')
    else:st.info('Complete one simulated replenishment task before entering a comparison measurement.')
    st.subheader('What remains unvalidated')
    st.write('Physical travel distance and time, handling delays, physical sensor timing, calibration against held-out observations, and bidirectional physical-device synchronization.')

with tab_credit:
    st.subheader('Scientific basis and attribution')
    st.markdown("""**Primary methodological reference:**
    Ferrari, A., Carlin, A., Rafele, C., & Zenezini, G. (2024).
    *A method for developing and validating simulation models for automated storage and retrieval system digital twins.*
    The International Journal of Advanced Manufacturing Technology, 131, 5369–5382.
    https://doi.org/10.1007/s00170-023-12660-y

    **What was adopted conceptually:** explicit physical and information-system boundaries, event-driven modelling, and the requirement for calibration and physical validation.

    **What was not copied:** Ferrari's laboratory dimensions, shuttle mechanics, AnyLogic simulation, code, data, experimental measurements, or original paper figures. The warehouse graph, sample stock, demand pattern, policies, and Python implementation in this project are independently prepared research examples.

    This code is a methodological adaptation and does not imply approval, authorship, or endorsement by the paper's authors.""")
