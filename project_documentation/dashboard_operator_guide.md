# Single-AMR dashboard operator guide

The app opens in the existing 3D warehouse design. Only AMR-01 and its middle left-apron charging bay are present. Three demonstration jobs are sequential tasks for that robot. The Floor is a simulation; Sensor models is the active sensor-model display.

| View | Current use |
| --- | --- |
| Floor | Inspect the single virtual AMR, reference racks and its simulated missions; camera and appearance controls preserve the original design |
| Reference source only: Route map | Preview distance/time routes on the 19-node/24-link graph; closures, manager placement and Dijkstra playback are simulation tools |
| Sensor models | View Python-computed AMR-01 motion, power, energy, SOC, residual advisories and conditional forecasts; choose Demo data or Stored sensor data |
| Detailed readings | Open from Sensor models for packet values, charts, exports and references |
| Database | Open from Sensor models for saved records, table attributes and connection details |
| Missions | Review, approve, pause or cancel virtual replenishment jobs; actions do not command the physical motors |
| Reference source only: Insights | Inspect simulated stock/mission projections, separate from physical battery sensing |
| Reference source only: Reference lab | Optional recording/replay, older observer and policy studies; not connected to raw v2 Python sensor packets |
| Activity | Review virtual decisions and model boundaries; export the session event record |

The hosted navigation shows only Floor, Sensor models, Missions and Activity. Reference-only tools remain in source; old study links open Sensor models.

## Sensor workflow

1. Follow [direct-sensor commissioning](single_amr_sensor_twin_setup.md), not the legacy UART kit. Configure private Streamlit secrets and replace all example calibration values.
2. Open **Sensor models**. The default fixed synthetic trial is labelled; it is not a physical reading.
3. Select **Stored sensor data** only with the commissioned AMR-01 publisher and independent ingestion worker. The worker subscribes to `robot/amr01/state` and stores readings; the dashboard reads the database.
4. Check freshness, continuity and units before interpreting estimates. Missing or stale samples suspend advisories/forecasts; long gaps leave partial integrals.
5. Use **Open detailed readings** for equations, variables, exports and the manual stock/task example. Paper links and exact source pages also appear beside the six sensor models. The stock/task example is outside the final 17-slide presentation.

### Interpret the readouts

- **Data source and quality:** The notice above the cards distinguishes a synthetic example, current physical records, missing packets, old readings, clock/calibration mismatch and partial estimates. “Current readings” describes freshness; the motion advisory is separate.
- **Wheel motion:** L and R label the left/right wheel, with metres and metres per second on each value. Travel is the increment for one device interval, not total distance.
- **Position:** x, y and heading are named separately. Metres refer to the local trial origin; radians refer to heading. These are estimates, not surveyed warehouse coordinates.
- **Battery:** Voltage and current are measured inputs. SOC means state of charge; it and net Wh are calculated. Positive current is discharge and negative current is charging. Display decimals do not establish sensor accuracy.
- **Motion comparison:** The recorded gyro–encoder difference has a zero line, numeric scale and configured threshold lines. The hold time is explicit. Missing comparison intervals break the plot; an advisory asks for inspection and does not diagnose a particular fault.
- **Forecasts:** Position after five seconds and time to an assumed 20% charge reserve require constant-input assumptions. A visible explanation says why a result is unavailable, including missing data, partial integrals, a first-sample anchor and zero/charging current.

Sample age is time since MQTT receipt, not measured network latency. The display refreshes about once per second. A fixed demonstration has no physical sample age. Historical plots remain labelled as history when current readings are stale.

INA219 measures voltage/current, not battery percentage directly. Encoders provide relative wheel motion, not independently verified absolute location. MPU6050 z gyro provides angular rate, not a drift-free compass heading. No sensor in the supplied component list measures shelf stock or detects people/obstacles.

## Simulation controls

Approve one virtual job at a time; AMR-01 completes its delivery and bay return. Cancellation suppresses the old delivery and completes the reserved virtual path. Pause/stop, charging, 30-unit payload and return reserve are simulation policies. They do not stop or dispatch the physical robot.

Manager placement, no-entry circles and cone overlays are optional illustrations. They are not live personnel tracking or safety functions. The warehouse scenery, routes and inventory stay separate from Python sensor updates. A measured coordinate transform is required before a future live 3D synchronisation.

Navigation and normal model updates preserve the current view and scroll. Use Dark/Bright, motion preferences, camera presets and the compatibility renderer as needed. Session state is not a durable measurement archive; export trial evidence before restart. See [scope and pending work](implemented_dashboard_features_and_limits.md).
