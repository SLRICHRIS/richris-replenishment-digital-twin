<!-- Generated from project_documentation/digital_twin_architecture_and_validation_plan.md; edit the canonical document and rebuild downloads. -->

# AMR-01 sensor twin: modelling and validation plan

Owner: **S. L. Richris**. The current contribution is a single-AMR motion/battery model with sensor-consistency advisories and a separate simulated replenishment workflow. Physical synchronisation and measured validation remain to be demonstrated.

## Acquisition and models

The exact [v2 packet contract and commissioning procedure](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/single_amr_sensor_twin_setup.md) govern the active path. One ESP32 publishes cumulative x4 left/right counts, raw MPU6050 z angular rate, INA219 voltage/current, device monotonic time, boot/sequence and local state. The server subscribes read-only to `robot/amr01/state` through MQTT/TLS 8883.

| Model | Kind | Calibration / limits |
| --- | --- | --- |
| Wheel displacement | Linear conversion from count increment | Effective counts/revolution and wheel radius, including gearing and x4 decoding |
| Differential-drive pose | Nonlinear trigonometric midpoint kinematics | Left/right effective radii and track; planar rolling assumption; relative local pose |
| Gyro | Additive bias/noise measurement model | Stationary bias and orientation; yaw rate only; no full EKF or absolute heading correction |
| Battery power/energy | Product and discrete integration | Calibrated pack V/I, positive discharge; unknown intervals remain missing |
| SOC | Discrete coulomb counting | Known initial SOC and usable Ah capacity; ideal efficiency assumption; no degradation/RUL |
| Residual advisory | Threshold plus sustained-time rule | Healthy-trial threshold/hold and separate fault/slip validation; not a fault classifier |
| Motion/runtime forecast | Constant wheel speeds / assumed future load | Conditional short prediction; unavailable on stale or broken-continuity data |
| Stock/tasks | Discrete events with conservation | Synthetic demand, pickup and delivery; no inventory sensor in this BOM |

[Exact equations, variable definitions, slide mapping and paper pages](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/slide_to_code_mapping.md) identify paper-backed models and project extensions separately. The older scalar-position observer in the Reference lab is a separate legacy model, not the active encoder/gyro estimator.

## Data quality and synchronisation

Use device time for integration and the original MQTT UTC receive timestamp for dashboard freshness. Reject malformed/retained/reordered/retired-boot samples; do not fill long gaps with invented data. The worker keeps a bounded in-memory history and stores normalized samples and model states in PostgreSQL. Original raw JSON bytes are not archived by this path. Independently record raw samples and calibration versions for evaluation.

Before linking live pose to the 3D scene, survey map scale/origin/axes, measure the initial pose and heading, and define a local-to-map transform. Validate that transform using independent checkpoints and rotation trials. The current interface intentionally shows sensor pose in Sensor models while retaining separate Floor simulation state. Motor control is local and outside this observation sketch; physical navigation, obstacle avoidance and personnel tracking are not supplied.

## Evaluation plan

| Question | Measurement | Required evidence |
| --- | --- | --- |
| Does motion estimation match AMR-01? | Position/heading error, drift vs distance, speed error | Surveyed/camera ground truth on straight, square and turning trials; separate calibration/validation runs |
| Do battery estimates match the pack? | Meter V/I error, accumulated Ah/Wh, end-charge/SOC and runtime error | Measured usable capacity, known initial SOC and varied-load discharge trials |
| Is the residual useful? | False alerts, missed known disturbances and detection delay | Healthy trials plus separately labelled slip/sensor-disturbance trials; threshold fixed before validation |
| Are forecasts useful? | Pose/runtime errors vs horizon/load | Predictions stored before outcomes; forecast assumptions recorded |
| Does telemetry failure behave correctly? | Freshness, withheld forecasts and continuity flags | Real loss/disconnect/reboot tests without fabricated gap integration |
| Is replenishment consistent? | Event conservation, task completion and stockout outcomes | Synthetic checks now; independent physical pickup/delivery confirmations before live inventory claims |

Set acceptance tolerances before trials. Record hardware/firmware/model versions, radii/track/counts, sensor bias/current calibration, initial pose/SOC, capacity, sampling and load. [Software evidence](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/single_amr_alignment_validation.md) does not substitute for those physical trials. LabVIEW, the Coordinator, multi-AMR traffic experiments and command-latency benchmarks are historical references outside this scope.
