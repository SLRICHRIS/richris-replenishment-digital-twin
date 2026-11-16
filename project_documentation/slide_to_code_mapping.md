# Final 17-slide presentation → sensor model → Python implementation

**Authoritative source:** `Predictive_Digital_Twin_Warehouse_AMR_LabVIEW_HITL_S_L_Richris.pptx`, 17 slides, from the 7 November 2026 reviewed package. Do not use the older 15-slide deck for slide numbers.

**Status:** The encoder/gyro/energy/anomaly routines are implemented and tested using synthetic input. Forecasting is a project extension under constant-input assumptions. The independent worker and PostgreSQL schema enable durable AMR-01 sensor ingestion when externally deployed. **Physical calibration, live broker/DB commissioning, synchronization to a surveyed 3D map, and LabVIEW supervisory control are not validated or claimed.**

| Final slide | What it represents | Exact implementation / processing | Evidence boundary |
| --- | --- | --- | --- |
| 1 | Title, sources, project limitations | Documentation only | Two research papers are background, not physical validation |
| 2 | Single AMR → EMQX MQTT/TLS → Python → Streamlit, proposed LabVIEW return path | `esp32_telemetry_firmware/publish_raw_sensor_telemetry/publish_raw_sensor_telemetry.ino`, `predictive_twin/mqtt_service.py`, `ingest_worker.py`, `database.py`, `workspace_payload.py` | **Only one AMR (amr01)**; no live motor command return path |
| 3 | One sensor-to-model-to-insight pipeline, with two encoder uses | `telemetry.py`, `models.py` | Same encoders feed travel/pose AND residual comparison; gyro is independent consistency evidence |
| 4 | Sensor measurements versus inferred estimates, cited papers | Documentation and on-screen paper links | INA219 does **not** measure SOC or pose |
| **5 → 6** | Signed encoder counts → wheel travel/speed | `models.wheel_distance`, then `telemetry.RobotTwin.accept`: `v=ds/dt` | [A] p. 11 Eq. (9); p. 38 Eq. (A4). Effective counts/rev include gearing and x4 decoding |
| **7 → 8** | Left/right travel → differential-drive relative pose | `models.midpoint_pose` | [A] p. 8 Eqs. (1–3) continuous background; midpoint discretization is ours; **no EKF** |
| **9 → 10** | Gyro observation, stationary-bias estimation, corrected yaw rate | `models.stationary_gyro_bias`; `telemetry.RobotTwin.accept` subtracts configured bias | [A] p. 10 Eq. (8) sensor model; gyro bias calibration is a separate offline step |
| **11 → 12** | INA219 voltage/current → power, signed net Wh, coulomb-counted SOC fraction | `models.battery_step` and `RobotTwin.accept` | [B] p. 7 Eqs. (5–7), p. 8 Eqs. (8–9). Discharge-positive current; eta=1; requires measured starting SOC/capacity |
| **13 → 14** | Encoder-estimated yaw rate vs independent bias-corrected gyro yaw rate → persistent disagreement alert | `models.ResidualDetector` called by `RobotTwin.accept` | **Our project extension**, not an attributed numbered equation in [A]. Threshold/hold require trial calibration |
| **15** | Constant-wheel-speed pose extrapolation and constant-current runtime to reserve | `models.motion_forecast`; `models.runtime_hours` | **Proposed assumptions**, not obstacle-aware forecasting, battery health, or published validation |
| **16** | LabVIEW HITL: inspect → authorize → gateway → local motor controller → verification | **Not implemented in active worker**. Stored results are advisory/read-only | No cloud motor control; local emergency protection must remain independent |
| **17** | Thank you | Presentation only | No model |

## Actual data and database path

1. The ESP32 publishes a typed, non-retained `robot/amr01/state` JSON sample with signed wheel counts, gyroscope z angular velocity, INA219 current/voltage, boot ID, sequence and device monotonic sample time.
2. The independent Python `ingest_worker`, or the optional operator-protected on-demand connector, subscribes using MQTT/TLS 8883. They use the same sensor pipeline and exclusive writer lease. `FleetTwin` rejects invalid, retained, repeated and reordered readings and excludes unknown long gaps from integration.
3. The accepted sample feeds **the same `RobotTwin` calculations represented by final slides 5–15**; one transaction stores the raw packet and resulting derived state in PostgreSQL. Unique `(robot_id, boot_id, seq)` prevents replay duplicates even across worker restarts.
4. The display obtains a read-only persisted snapshot. The optional Connect AMR recorder runs in a separate session-bound background resource with private writer credentials; browser JavaScript is neither the ingester nor a motor controller. Generated demonstration trials remain separate and are **never inserted into physical telemetry tables**.
5. If the worker is down, the latest stored observation becomes **STALE**, rather than pretending to be current. Lost continuity requires physical reinitialization for trustworthy quantitative results. PostgreSQL stores raw values and derived state for traceability; it is **not** a surveyed ground-truth reference.

See `project_documentation/postgresql_sensor_pipeline.md` for schema, configuration, startup, data limitations, and tests.

## References and attribution

- **[A]** C. Villagomez Alfaro et al., *Real-to-Sim Calibration and Cross-Domain Trajectory Validation of a Low-Cost Multi-Sensor UGV Digital Twin*, Sensors **26**(18), 5729 (2026). [DOI](https://doi.org/10.3390/s26185729).
- **[B]** K. Movassagh et al., *A Critical Look at Coulomb Counting Approach for State of Charge Estimation in Batteries*, Energies **14**(14), 4074 (2021). [DOI](https://doi.org/10.3390/en14144074).
- **[C]** Texas Instruments, *INA219 Zero-Drift, Bidirectional Current/Power Monitor With I²C Interface*, SBOS448G, Rev. G (2015), sensor datasheet. [PDF](https://www.ti.com/lit/ds/symlink/ina219.pdf).

**Separate scope:** The warehouse stock/task simulator retained for historical demonstration is **not a slide-15 model** of the final presentation and must not be labelled as such. Warehouse rack visuals, missions and route animation are a simulation separate from the physical AMR's local odometry.
