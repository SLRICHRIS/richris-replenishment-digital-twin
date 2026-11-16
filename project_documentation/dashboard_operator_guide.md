# Single-AMR dashboard operator guide

The app opens in the original warehouse with one virtual AMR-01. Floor, Connect AMR, Sensor models and Database share one dashboard shell, navigation and Dark/Bright appearance.

| View | Current use |
| --- | --- |
| Floor | Inspect the single virtual AMR and warehouse; drag to orbit, zoom or choose a camera preset |
| Connect AMR | Start or stop an operator-authorized on-demand EMQX recorder; check device, broker, storage and predictive readiness separately |
| Sensor models | View six Python-computed motion, gyro, battery, residual and forecast models; choose Demo data or Stored sensor data |
| Database | Browse seven sensor datasets, inspect table attributes and export displayed records as JSON; calibration is not required |

**Detailed readings and export** opens sensor charts, packet values and exports. Supporting explanations and linked papers are inside each model's **How it works & source** disclosure. The reading guide also contains sample age and reported state. On wide screens, the six models form a three-column grid; smaller screens use two or one column. Each card identifies its sensor/model input and keeps units with its readouts.

Mission approval, stock forecasts, manager placement, activity logs and legacy route/observer studies remain in source, outside the hosted navigation. Old study links open Sensor models.

## Connect the physical AMR

Follow [Connect AMR setup](single_amr_sensor_twin_setup.md#connect-amr-from-the-site) once. The ESP32 joins its configured Wi-Fi and publishes raw sensors to EMQX. The owner enters the private operator access code in Connect AMR to start the on-demand recorder. Broker passwords and database writer credentials stay in private server configuration. Missing setup disables Connect and lists the categories still required; it does not invent a connected device.

EMQX subscribed, fresh device samples, database access and prediction readiness are separate stages. This recorder follows the app session; choose the independent worker for unattended recording. Disconnect preserves committed data. The predictive insights show charge, conditional time to reserve and five-second local position only when the evidence allows them. Recommendations suggest operator checks or recharging from the existing models; they do not command the robot. The Sensor models view labels recommendations from the generated demo separately from physical guidance.

## Sensor workflow

With Demo data selected, choose a generated trial from the Trial selector. Baseline, turning, sustained disagreement, low charge and interrupted-stream cases use the same Python sensor engine. The description states the injected condition and expected behavior. Trial selection is shared with Detailed readings. Export trial evidence contains the example calibration, generated packets, Python outputs, recommendations and source fingerprints; it is disabled until the selected trial response arrives and is unavailable for physical data. Follow the [demonstration guide](faculty_demonstration_guide.md) and replay an export using `python -m project_maintenance_scripts.replay_generated_trial FILE.json`.

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
- **Motion comparison:** The recorded gyro–encoder difference has a zero line, numeric scale and configured threshold lines. Open the model details for the numeric threshold, hold time and plot time range. Missing comparison intervals break the plot; an advisory asks for inspection and does not diagnose a particular fault.
- **Forecasts:** Position after five seconds and time to an assumed 20% charge reserve require constant-input assumptions. A visible explanation says why a result is unavailable, including missing data, partial integrals, a first-sample anchor and zero/charging current.

Sample age is time since MQTT receipt, not measured network latency. The display refreshes about once per second. A fixed demonstration has no physical sample age. Historical plots remain labelled as history when current readings are stale.

Background refreshes keep the dashboard at full opacity. Source and archive choices update on the next scheduled tick without restarting the whole app. Interpret the data-source notice, sample age and database loading status for freshness; the entire screen does not fade while a read is running.

INA219 measures voltage/current, not battery percentage directly. Encoders provide relative wheel motion, not independently verified absolute location. MPU6050 z gyro provides angular rate, not a drift-free compass heading. No sensor in the supplied component list measures shelf stock or detects people/obstacles.

## Warehouse view

The floor is a virtual illustration. Its position, battery and velocity are simulation values, separate from the sensor source. No mission dispatch or motor control is exposed here. The six sensor models use a local trial origin; a measured coordinate transform is required before live 3D synchronisation.

The original warehouse scenery and single robot remain. Overlapping rack labels, manager markers, repeated facility status and stock forecasts are omitted. Camera presets, zoom, reset, expand, Dark/Bright and motion preferences remain available. The compatibility renderer follows the same scope when WebGL 2 is unavailable.

Navigation and model updates preserve the current view and scroll. See [scope and pending work](implemented_dashboard_features_and_limits.md).

## Database workflow

Open Database from the main navigation. A connection chip reports storage connectivity, independently from sensor calibration or freshness. Choose a dataset and switch between Records and Table attributes. Refresh reads the selected dataset again; Export JSON contains only the displayed records and is enabled only when rows are available.

The browser reads at most 50 records at a time. Empty data, a failed record query and unavailable storage have different messages. Field definitions remain available when storage cannot be reached. The archive refreshes while its screen is open; leaving it stops polling. A late response for an earlier dataset cannot relabel the current selection. Schema definitions are displayed from application models; the connection status separately verifies the production database structure.

The scrollable record and field tables are keyboard-focusable regions. Use Tab to enter a table, arrow keys or Page Down to scroll, and Tab to leave it. A visible focus outline identifies the active table. Database requests expose a busy state to assistive technology until the matching response arrives. Smaller-screen navigation, source choices, database controls and disclosures use larger touch targets; sensor values use a larger type size in the single-column layout.
