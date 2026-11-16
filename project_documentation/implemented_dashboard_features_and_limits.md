# Single-AMR capabilities and scope

| Capability | Current behavior | Evidence / boundary |
| --- | --- | --- |
| AMR-01 acquisition | One ESP32, two quadrature encoders, MPU6050 z gyro and INA219 voltage/current; topic `robot/amr01/state` | [Direct-sensor setup](single_amr_sensor_twin_setup.md); physical commissioning pending |
| Motion twin | Effective encoder counts → wheel distance → differential-drive midpoint pose; stationary gyro bias | [Equations and paper pages](slide_to_code_mapping.md); local relative pose, no EKF or absolute localisation |
| Battery twin | Power, accumulated Wh and coulomb-counted SOC | Initial SOC, usable capacity and calibrated current required; runtime assumes future load |
| Advisory models | Sustained gyro/encoder residual, short constant-wheel-speed projection, reserve-based runtime | Project extensions; no validated fault classification or battery remaining useful life |
| Telemetry quality | Boot/sequence checks, retained-message rejection, device-time integration and freshness/gap gates | [Software evidence](single_amr_alignment_validation.md); original receive-time freshness and PostgreSQL restart checkpoints; volatile pending queue and QoS 0 remain |
| Existing warehouse interface | One AMR-01, one central left-apron bay, 12 racks and 4 simulated replenishment stations | Preserves the original design; live sensor pose does not yet drive the 3D scene |
| Separate manual stock/task example | `stock_step` balance and `task_step` finite-state machine in the detailed view | Manual software events; no sensor-driven stock or expanded policy experiment |
| Route preview | 19 nodes, 24 bidirectional links, distance/time objectives and closures | Optional simulation tool; no physical navigation or collision-avoidance claim |
| Reference experiments | Older observer, policy comparisons, route playback and energy analytics retained in source | Hidden from the focused hosted navigation; no competing model workflow |

## Outside the current hardware scope

LabVIEW/camera inventory feeds, browser telemetry, UART/Coordinator commands and their downloadable kits are retained only as legacy references. They are not commissioning prerequisites for the direct-sensor AMR-01 path. Multi-AMR coordination, personnel detection, physical exclusion zones, motor-system identification, SLAM, full EKF and battery degradation/RUL are not implemented by the current sensor twin. Facility details are illustrative scenery. The cone overlay has no matching range sensor in the component list.

## Remaining core integration

Survey the physical test area and calibrate a local-odometry-to-map transform before synchronising measured pose into the 3D scene. Establish initial pose/heading, units and axis directions explicitly; withhold stale or discontinuous observations. Then validate motion, battery, forecasts and residual advisories using independent measurements and separate healthy/fault trials. Until that work is complete, describe this as a sensor-model implementation with a separate warehouse simulation, not a physically validated synchronised twin.
