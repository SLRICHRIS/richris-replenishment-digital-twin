# Single-AMR dashboard operator guide

The app opens in the existing 3D warehouse design with one virtual AMR-01. The navigation has three destinations.

| View | Current use |
| --- | --- |
| Floor | Inspect the single virtual AMR and warehouse; drag to orbit, zoom or choose a camera preset |
| Sensor models | View six Python-computed motion, gyro, battery, residual and forecast models; choose Demo data or Stored sensor data |
| Database | Inspect saved physical records and table attributes; no calibration is needed to browse records |

**Detailed readings and export** opens sensor charts, packet values and exports. Supporting explanations and linked papers are inside each model's **How it works & source** disclosure. The reading guide also contains sample age and reported state.

Mission approval, stock forecasts, manager placement, activity logs and legacy route/observer studies remain in source, outside the hosted navigation. Old study links open Sensor models.

## Sensor workflow

1. Follow [direct-sensor commissioning](single_amr_sensor_twin_setup.md), not the legacy UART kit. Configure private Streamlit secrets and replace all example calibration values.
2. Open **Sensor models**. The default fixed synthetic trial is labelled; it is not a physical reading.
3. Select **Stored sensor data** only with the commissioned AMR-01 publisher and independent ingestion worker. The worker subscribes to `robot/amr01/state` and stores readings; the dashboard reads the database.
4. Check freshness, continuity and units before interpreting estimates. Missing or stale samples suspend advisories/forecasts; long gaps leave partial integrals.
5. Use **Detailed readings and export** for charts, packet values and exports. Open **How it works & source** on a model for its equations, variables and linked paper pages.

### Interpret the readouts

- **Data source and quality:** The notice above the cards distinguishes a synthetic example, current physical records, missing packets, old readings, clock/calibration mismatch and partial estimates. “Current readings” describes freshness; the motion advisory is separate.
- **Wheel motion:** L and R label the left/right wheel, with metres and metres per second on each value. Travel is the increment for one device interval, not total distance.
- **Position:** x, y and heading are named separately. Metres refer to the local trial origin; radians refer to heading. These are estimates, not surveyed warehouse coordinates.
- **Battery:** Voltage and current are measured inputs. SOC means state of charge; it and net Wh are calculated. Positive current is discharge and negative current is charging. Display decimals do not establish sensor accuracy.
- **Motion comparison:** The recorded gyro–encoder difference has a zero line, numeric scale and configured threshold lines. The hold time is explicit. Missing comparison intervals break the plot; an advisory asks for inspection and does not diagnose a particular fault.
- **Forecasts:** Position after five seconds and time to an assumed 20% charge reserve require constant-input assumptions. A visible explanation says why a result is unavailable, including missing data, partial integrals, a first-sample anchor and zero/charging current.

Sample age is time since MQTT receipt, not measured network latency. The display refreshes about once per second. A fixed demonstration has no physical sample age. Historical plots remain labelled as history when current readings are stale.

INA219 measures voltage/current, not battery percentage directly. Encoders provide relative wheel motion, not independently verified absolute location. MPU6050 z gyro provides angular rate, not a drift-free compass heading. No sensor in the supplied component list measures shelf stock or detects people/obstacles.

## Warehouse view

The floor is a virtual illustration. Its position, battery and velocity are simulation values, separate from the sensor source. No mission dispatch or motor control is exposed here. The six sensor models use a local trial origin; a measured coordinate transform is required before live 3D synchronisation.

The original warehouse scenery and single robot remain. Overlapping rack labels, manager markers, repeated facility status and stock forecasts are omitted. Camera presets, zoom, reset, expand, Dark/Bright and motion preferences remain available. The compatibility renderer follows the same scope when WebGL 2 is unavailable.

Navigation and model updates preserve the current view and scroll. See [scope and pending work](implemented_dashboard_features_and_limits.md).
