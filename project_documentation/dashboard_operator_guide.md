# Single-AMR dashboard operator guide

The app opens in the existing 3D warehouse design. Only AMR-01 and its middle left-apron charging bay are present. Three demonstration jobs are sequential tasks for that robot. The Floor is a simulation; the Hardware view is the active sensor-model display.

| View | Current use |
| --- | --- |
| Floor | Inspect the single virtual AMR, reference racks and its simulated missions; camera and appearance controls preserve the original design |
| Reference source only: Route map | Preview distance/time routes on the 19-node/24-link graph; closures, manager placement and Dijkstra playback are simulation tools |
| Sensor models | View Python-computed AMR-01 motion, power, energy, SOC, residual advisories and conditional forecasts; select synthetic trial or commissioned live MQTT |
| Missions | Review, approve, pause or cancel virtual replenishment jobs; actions do not command the physical motors |
| Reference source only: Insights | Inspect simulated stock/mission projections, separate from physical battery sensing |
| Reference source only: Reference lab | Optional recording/replay, older observer and policy studies; not connected to raw v2 Python sensor packets |
| Activity | Review virtual decisions and model boundaries; export the session event record |

The hosted navigation shows only Floor, Sensor models, Missions and Activity. Reference-only tools remain in source; old study links open Sensor models.

## Sensor workflow

1. Follow [direct-sensor commissioning](single_amr_sensor_twin_setup.md), not the legacy UART kit. Configure private Streamlit secrets and replace all example calibration values.
2. Open **Sensor models**. The default fixed synthetic trial is labelled; it is not a physical reading.
3. Select **Live MQTT sensors** only with the commissioned AMR-01 publisher. The server subscribes to `robot/amr01/state`; no browser broker form or WSS setup is needed for this path.
4. Check freshness, continuity and units before interpreting estimates. Missing or stale samples suspend advisories/forecasts; long gaps leave partial integrals.
5. Use **Inspect models and slide 15 stock/tasks** for equations, variables, exports and the exact slide 15 manual stock/task example. Paper links and exact source pages also appear beside Hardware models.

INA219 measures voltage/current, not battery percentage directly. Encoders provide relative wheel motion, not independently verified absolute location. MPU6050 z gyro provides angular rate, not a drift-free compass heading. No sensor in the supplied component list measures shelf stock or detects people/obstacles.

## Simulation controls

Approve one virtual job at a time; AMR-01 completes its delivery and bay return. Cancellation suppresses the old delivery and completes the reserved virtual path. Pause/stop, charging, 30-unit payload and return reserve are simulation policies. They do not stop or dispatch the physical robot.

Manager placement, no-entry circles and cone overlays are optional illustrations. They are not live personnel tracking or safety functions. The warehouse scenery, routes and inventory stay separate from Python sensor updates. A measured coordinate transform is required before a future live 3D synchronisation.

Navigation and normal model updates preserve the current view and scroll. Use Dark/Bright, motion preferences, camera presets and the compatibility renderer as needed. Session state is not a durable measurement archive; export trial evidence before restart. See [scope and pending work](implemented_dashboard_features_and_limits.md).
