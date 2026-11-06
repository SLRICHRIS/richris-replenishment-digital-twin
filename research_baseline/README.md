> Historical/reference workspace. The active single-AMR Python sensor path is documented in the root README and `project_documentation/single_amr_sensor_twin_setup.md`.

# Warehouse Replenishment Research Model

**A focused, event-driven warehouse replenishment model with a local persistent backend and a separate Streamlit research interface.**

**Research status:** The code is a *synthetic digital model*. It has been tested for software behaviour, but its task times, warehouse geometry, policies and physical equipment have not been validated against a real warehouse. It must not be described as a physically synchronized Digital Twin.

## Quick start: first understand one task

If the Streamlit app feels crowded, do **not** start with policy numbers. Open **1 Follow one replenishment** and advance events in this order:

1. At **t = 0**, KIT-A starts with 4 picking units and 70 reserve units. The model creates T001 for **14** units to reach its target of 18. Reserved goods are still physically in reserve.
2. At **t = 4 s**, click **Process the next event**. The 14 units move **reserve → in transit**. Verify the Before/After quantities.
3. At **t = 12 s**, the picking shelf receives demand for 5 KIT-A units but has only 4. The model records 4 filled and 1 unmet.
4. At **t = 26.048 s**, T001 is delivered. Stock moves **in transit → picking shelf**.

In between, events for other SKUs occur in chronological order. The interface shows exactly which event is next. The **Why this model** tab explains every component and equation term; **Evidence and paper** separates software checks from physical validation.

For all quantities, example calculations, screen definitions and scope boundaries, see [the complete guided walkthrough](docs/00_guided_walkthrough.md).

**New clarity module:** `warehouse_twin/explain.py` computes the next-event explanation, before/after stock difference and event interpretation from the authoritative simulation state, without changing warehouse logic. Tests for this module are in `tests/test_explain.py`.

## 1. What this repository contains

One simulated transport resource moves a known quantity of stock from reserve location `R` to picking locations `P1`, `P2` or `P3`. A replenishment request is triggered when a picking location falls below its threshold. The model keeps track of where the stock actually is and uses discrete, timestamped events to update state.

The system has **two user interfaces** that share exactly the same simulation logic:

| Interface | Entrypoint | State handling | Intended use |
|---|---|---|---|
| **FastAPI + web client** | `warehouse_twin.api:app` | SQLite transactions and per-run event log | Local full-stack system, telemetry interface and timing records |
| **Streamlit research view** | `streamlit_app.py` | Independent state in each browser session | Inspect the model, step through events, compare policies and teach the architecture |

The Streamlit Community Cloud version is intentionally **not** a substitute for the persistent FastAPI service. Its simulation does not control equipment or receive live ESP32 data.

## 2. Directory layout

```text
research_baseline/
├── README.md                        Begin here: purpose, run instructions and limitations
├── streamlit_app.py                 Streamlit inspection and experiment interface
├── requirements.txt                 Dependencies for the Streamlit entrypoint
├── requirements-backend.txt         Dependencies for the local FastAPI backend
├── requirements-dev.txt             Pytest and API-test dependencies
├── warehouse_twin/
│   ├── __init__.py                   Package metadata
│   ├── simulation.py                 Discrete-event model, routing, stock accounting and policy comparison
│   ├── explain.py                    Read-only event explanations and inventory deltas
│   ├── database.py                   Persistent SQLite state, events and measurements
│   ├── api.py                        HTTP and WebSocket access to the model
│   └── mqtt_gateway.py               Optional external MQTT to HTTP observation adapter
├── web/
│   ├── index.html                    Local backend web interface
│   ├── app.js                        API client and interface event handling
│   └── style.css                     Local interface typography and layout
├── tests/
│   ├── test_simulation.py            Event ordering, conservation, constraints, policy checks
│   ├── test_explain.py               Next-event explanations and before/after inventory logic
│   ├── test_api.py                   State persistence, validation and HTTP tests
│   └── test_mqtt_gateway.py          MQTT packet normalization test
├── examples/
│   └── telemetry_example.json        Example packet, NOT a measured device observation
├── docs/
│   ├── 00_guided_walkthrough.md       Step-by-step real event trace and screen tour
│   ├── 01_system_architecture.md      Responsibilities and detailed process flow
│   ├── 02_inventory_and_events.md     Inventory equations and event-state rules
│   ├── 03_modelling_choices.md        What, why, assumptions and alternatives
│   ├── 04_validation_protocol.md      Measurements needed to establish physical fidelity
│   ├── 05_streamlit_deployment.md     GitHub-to-Streamlit deployment steps
│   ├── 06_source_credit.md           Complete citation and proper attribution
│   └── 07_security_and_limitations.md Operational and security boundaries
├── Dockerfile                        Optional isolated local API container
├── compose.yaml                      Loopback-only local Docker service
├── start_windows.bat                 Local FastAPI starter on Windows
└── start_linux_macos.sh              Local FastAPI starter on Unix-like hosts
```

**Naming convention:** Python files use `snake_case`; directories name responsibilities rather than generic phases; each event has an uppercase event type; SKU identifiers identify items, while `T001`, `T002` identify tasks. No executable production source belongs in `docs/`.

## 3. Run the local full-stack system

Requires Python 3.11+ and a recent browser. Use an isolated environment:

```bash
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# Linux/macOS: source .venv/bin/activate
python -m pip install -r requirements-backend.txt
python -m uvicorn warehouse_twin.api:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. API schemas are at **http://127.0.0.1:8000/docs**.

The database is created on first launch at `data/twin.sqlite3`; never commit the database or a real telemetry payload containing personal or secret data. Run `docker compose up --build` as another local deployment option.

## 4. Run the separate Streamlit interface

```bash
python -m pip install -r requirements.txt
python -m streamlit run streamlit_app.py
```

The Streamlit app is a **session-isolated simulation workstation**, not the SQLite API. It lets you select FIFO or urgency dispatch, block an aisle before starting a run, vary assumed speed and handling delays, inspect inventory and tasks, advance one event at a time, run to a selected horizon, compare policies using matched inputs, export results, and enter self-reported timing observations.

Run the Streamlit app from this folder. For Streamlit Community Cloud inside the pre-existing GitHub repository, use the exact entrypoint `research_baseline/streamlit_app.py` and branch that actually contains this folder. See [Streamlit deployment](docs/05_streamlit_deployment.md).

## 5. The warehouse process in six steps

1. **Demand:** consumption reduces the picking quantity only as far as physical stock allows. Unmet demand is recorded separately.
2. **Request:** the WMS-like logic checks the reorder threshold and creates a replenishment task if stock is available in reserve.
3. **Reservation:** stock is earmarked within reserve; no physical transfer has occurred yet.
4. **Dispatch and travel:** the WCS-like logic chooses a task, finds routes through unblocked nodes and schedules pickup and delivery.
5. **Pickup:** reserved goods leave the reserve and enter the in-transit quantity.
6. **Delivery:** in-transit stock becomes available at the destination picking location; task is marked completed.

The simulation distinguishes Warehouse Management System (**WMS**, logical stock/task management) from Warehouse Control System (**WCS**, simulated equipment-task execution). They are **WMS-like and WCS-like software functions**, not commercial systems or connections to a real PLC.

## 6. What the equations mean

**Conservation per item `i`:**

```text
initial_stock_i - fulfilled_demand_i
    = reserve_on_hand_i + pick_face_stock_i + in_transit_i
```

Reserved units are a **subset** of reserve on hand, not a separate physical inventory pile. The model tests this invariant after events.

**Task-time estimate:**

```text
predicted_task_seconds = distance(robot, reserve) / assumed_speed
                       + assumed_load_seconds
                       + distance(reserve, pick_face) / assumed_speed
                       + assumed_unload_seconds
```

Distances are shortest-path graph weights, not metres measured in Ferrari's laboratory. All speeds and delays are illustrative until calibrated.

**Urgency dispatch:** for an item, the model estimates time to stockout as `current_picking_units / assumed_demand_rate`, then subtracts the predicted task time. Smaller slack takes priority. Rates are assumptions and are not calculated from future scheduled events.

## 7. Tests and evidence boundaries

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Current checks cover route feasibility, stock conservation, database transactions, event logging, HTTP endpoints, WebSocket notifications, duplicate telemetry, and measured-time entry. **Passing tests validates the code behaviour under the stated synthetic inputs, not the fidelity of a physical Digital Twin.**

See [validation protocol](docs/04_validation_protocol.md) for a controlled physical test plan, calibration/evaluation split and reporting requirements.

## 8. Hardware and MQTT

The optional adapter `warehouse_twin.mqtt_gateway` subscribes to an external MQTT broker and forwards observations to the API's telemetry endpoint. It accepts either a `firmware` or `firmware_version` field. Observations are stored in a **quarantine** table. They do not overwrite robot position, inventory or the simulated timeline.

It requires configuration, a broker and a physically instrumented system that are **not included**. See [system and security boundaries](docs/07_security_and_limitations.md). Never expose the local API publicly without authentication and a reviewed deployment architecture.

## 9. Research credit

**Primary methodological reference**

Ferrari, A., Carlin, A., Rafele, C., & Zenezini, G. (2024). *A method for developing and validating simulation models for automated storage and retrieval system digital twins.* **The International Journal of Advanced Manufacturing Technology, 131**, 5369-5382. https://doi.org/10.1007/s00170-023-12660-y

The paper motivates modelling physical and information-system behaviour jointly, and checking simulation timing against physical observations. The present code is **independent, newly authored research software** using a synthetic warehouse graph, independent example demand, and its own Python scheduling and routing implementation. It is **not Ferrari's software, dataset, AS/RS apparatus or validated Digital Twin**. The paper's original images and diagrams are not packaged here.

See [full research attribution and scope](docs/06_source_credit.md).

## 10. What is deliberately not included

Real robot actuation, emergency-stop handling, multi-robot coordination, multi-user authorization, production cloud storage, live physical synchronization, and calibration against observed data. These are separate engineering and validation tasks. The Streamlit Cloud app is a research demonstration, **not a live warehouse supervisor**.
