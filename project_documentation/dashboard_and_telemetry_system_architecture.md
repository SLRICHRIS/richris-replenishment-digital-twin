# Single-AMR system architecture

`streamlit_app.py` starts the Streamlit Python host and serves the warehouse dashboard. The active hardware path is:

**ESP32 AMR-01 → MQTT/TLS 8883 → EMQX → independent Python worker and sensor models → PostgreSQL → read-only Streamlit views.**

| Layer | Inputs and processing | Output / authority |
| --- | --- | --- |
| Physical acquisition | Two cumulative wheel encoder counts; MPU6050 raw z gyro; INA219 pack voltage/current; firmware state and device time | One non-retained sensor topic: `robot/amr01/state` |
| Python subscriber | TLS verification, exact identity, boot/sequence and finite-value checks; retained/gap/freshness gates | Accepted sensor samples; no command publishing |
| Motion and battery | Calibrated wheel conversion, midpoint kinematics, gyro bias, power/energy and coulomb counting | Relative pose, wheel speed, SOC and energy estimates |
| Advisory computation | Gyro/encoder disagreement and assumed-load/constant-speed projections | Advisory alerts and conditional forecasts; no physical control authority |
| PostgreSQL | Typed samples, model states, calibration links, quality events and atomic checkpoint | Worker writes and dashboard reads through separate restricted accounts |
| Sensor models and Detailed readings | Receives public Python results through the Streamlit component protocol | Formats readouts; broker credentials stay on the server |
| Warehouse simulation | Browser-owned AMR-01, routes, stock and explicit virtual task events | Separate illustrative mission state; does not receive sensor pose yet |

GitHub stores code; an independent worker handles MQTT and model computation. Streamlit reads PostgreSQL and serves the browser over HTTPS. Browser MQTT/WSS 8084 belongs to the archived browser interface, not this active path. The direct-sensor observation sketch holds TB6612 standby LOW; a commissioned local movement controller remains necessary for physical driving.

## Reference geometry and virtual jobs

The illustrative graph has **19 nodes and 24 bidirectional links**. AMR-01 starts/returns at the middle left-apron bay. Four A–D bins are simulated task destinations; eight reserve racks and the surrounding building are decoration. Dijkstra supplies distance/time route previews. Approved jobs run sequentially on the single virtual robot, with a 15% simulated return reserve and assumed charging/drain rates. These simulation percentages are separate from INA219-based coulomb counting and the sensor runtime's configured reserve.

Manager figures, exclusion circles, route playback and cone overlays are optional simulation aids. They do not establish measured people, range sensing or physical collision safety. The Reference lab uses recordings/archived interfaces, not the active Python sensor state, and is hidden from the focused hosted navigation. Sensor models displays six compact stages from slides 5–15. Detailed readings includes a separate manual stock/task example.

## Synchronisation boundary

Python integrates odometry in a local frame starting at (0, 0, 0). The warehouse uses an illustrative map frame. No surveyed transform currently connects them, so live local pose is shown in Sensor models and is not placed automatically in the 3D scene. Coordinate registration and measured validation are outstanding core work, not a completed capability. Inventory and tasks also remain synthetic until independently confirmed events are integrated.

See [setup and raw schema](single_amr_sensor_twin_setup.md), [model and paper mapping](slide_to_code_mapping.md), [scope](implemented_dashboard_features_and_limits.md) and [validation](single_amr_alignment_validation.md). Legacy recorder, LabVIEW and Coordinator sources remain outside this path for reproducibility.

## Human supervision after recommendations

Recommendations feed LabVIEW human review, then the protected intervention gateway. The gateway uses the same PostgreSQL trial context and an intervention audit table. Only explicit approved, fresh and permitted actions can reach the optional command transport. Device acknowledgement and three fresh post-application sensor observations close the loop. The website rehearses this sequence with generated evidence and monitors physical reviews read-only. See the [implemented workflow and remaining physical commissioning](labview_human_review_and_action.md). The native LabVIEW VI and current hardware command receiver remain uncommissioned; this change does not enable remote motor control.
