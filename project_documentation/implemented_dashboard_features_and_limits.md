# AMR-01 capabilities and operating scope

The working hardware uses one ESP32, two single-channel MH IR pulse inputs,
an MPU6050 and an INA219 on the motor supply branch. Current physical sensor
observations, calibrated model results and generated simulation examples have
separate evidence requirements.

| Capability | Current behavior | Evidence / boundary |
| --- | --- | --- |
| Physical observations | ESP32 commissioning packets carry wheel pulse magnitudes, gyro/acceleration, motor-branch voltage/current/power and requested/reported motor output | `robot/amr01/commissioning` reaches EMQX, the protected HTTP receiver and PostgreSQL on Neon; unsigned pulses do not independently measure direction |
| Sensor display | The dashboard reads stored packets, shows receipt time and packet age, and distinguishes current readings from history | Current physical readings require a packet within five seconds; the archive retains historical records |
| Live recommendations | Current packets and up to 30 seconds of same-boot history support battery, power, wheel, IMU, controller and connection checks | [Checks and responses](live_sensor_recommendations.md); screening settings are explicit, not validated fault probabilities or certified safety limits |
| Direct Wi-Fi driving | The installed ESP32 controller at `10.15.213.112` appears inside the dashboard after Connect controller | Local browser-to-ESP32 commands; EMQX continues carrying telemetry. The laptop and AMR must share a network; the parent cannot certify connection from an iframe loading |
| Local stop and hold expiry | Native controls provide direction holds, Stop and motor-power selection, with a 700 ms command timeout | Observe actual motion. This local path does not inherit the separate cloud receiver's gyro, battery-voltage or PWM gates |
| Human observation review | The operator captures evidence, chooses one of nine responses and records a reason; the audit then collects three fresh later readings | Recording a decision sends no motor command. The operator uses direct controls or performs the physical task. Follow-up does not prove that task occurred |
| Calibrated model pipeline | A separate `robot/amr01/state` contract supports signed wheel odometry, corrected gyro, power/energy/SOC, consistency checks and conditional forecasts | Requires measured calibration, direction feedback and valid continuous inputs; it is not unlocked by raw commissioning packets |
| Calibrated intervention contract | Separate server logic supports bounded intervention requests, matching controller acknowledgements and sensor-effect checks | Requires an explicitly commissioned receiver/transport; observation review cannot silently adopt that authority |
| Camera routes | A separate workflow supports calibrated browser/WebRTC tracking or a commissioned Windows camera agent, human route review and camera-based follow-up | Requires current geometry, camera/receiver readiness, latency and stopping validation. Direct Wi-Fi driving and camera preview do not establish route readiness |
| Data archive and studies | Read-only tables and exports retain physical source records; frozen battery-voltage and gyro forecasting studies include reproducible preprocessing and evaluation | [Physical data studies](../physical_data_studies/README.md). Offline forecasting results do not establish online navigation or motor safety |
| Warehouse simulation | One virtual AMR, a reference floor, racks, replenishment examples and route studies remain available as simulation tools | The virtual robot's readiness and movements are not physical AMR state; no surveyed live-pose mapping into this scene is claimed |

## Interpreting the estimates

The wheel geometry and counted pulses support rotation and rim-speed magnitudes.
Command-inferred direction and local motion estimates remain distinct from
independently measured ground travel. Local yaw is not an absolute heading.

INA219 measures the motor branch, so its integrated energy does not include every
electrical load. A reported 2.2 Ah capacity and an assumed 100% start support only
the labelled charge scenario. Usable capacity, initial charge and current
calibration are prerequisites for quantitative whole-pack SOC/runtime estimates.
The five-second position forecast assumes unchanged motion; runtime forecasts
assume future load.

## Integration and validation boundaries

Camera routes use the current measured configuration in their setup, not fixed
dimensions copied into an architecture illustration. Actual motor direction,
PWM response, stopping distance, electrical limits and camera latency need
attended verification before commissioning route execution. A controller report
does not prove travel or arrival.

Synchronising measured pose with the warehouse scene requires a surveyed
odometry-to-map transform, initial pose/heading and independently checked units
and axes. Validate motion, battery estimates and anomaly screening against
independent measurements and separate healthy/fault trials.

No installed range or temperature sensor establishes obstacle distance or motor
temperature. Multi-AMR coordination, personnel detection, SLAM, a full EKF and
battery degradation/RUL are outside the current sensor twin. Legacy LabVIEW,
UART/coordinator and browser-broker kits remain reference material, separate from
the installed commissioning and direct-control paths.
