# How the Digital Twin Works

## Starting the application

[streamlit_app.py](../streamlit_app.py) starts Streamlit and serves [digital_twin_application/](../digital_twin_application/). Its index.html page loads the scripts, fonts, screen styles and drawing libraries.

The simulation runs in the browser. Python does not recompute each animation frame.

## Simulation workflow

| Stage | What happens | Main source file |
|---|---|---|
| Review | Operator selects a shelf and robot and inspects readiness | [warehouse_simulation_controller.js](../digital_twin_application/warehouse_simulation_controller.js) |
| Assessment | Calculates route, time, availability and battery on return | [mission_scheduling_and_routes.js](../digital_twin_application/mission_scheduling_and_routes.js) |
| Approval | Rechecks feasibility and puts accepted missions into the approved queue | Controller and scheduling files |
| Dispatch | One robot enters the shared aisle while others wait | Controller and scheduling files |
| Movement | Updates simulated position, stock, distance and battery | warehouse_simulation_controller.js |
| Display | Draws the warehouse and current robot state | [three_dimensional_warehouse_view.js](../digital_twin_application/three_dimensional_warehouse_view.js) |
| Return | Releases the aisle after the complete return journey | Controller and scheduling files |

Pausing a robot retains its reservation. Reassigning a mission requires fresh approval.

## Forecasting

[stock_and_battery_forecast.js](../digital_twin_application/stock_and_battery_forecast.js) performs forecast calculations in a browser worker, separately from the interface's main JavaScript thread.

It uses current stock, consumption rates, feasible approved deliveries, route timing, congestion and the modeled battery-drain rate. Mission assessment uses a minimum estimated return reserve of 15%.

These estimates depend on simulation assumptions. They are not physical battery measurements or a trained AI model. Advice does not automatically approve a mission.

## Drawing the warehouse

| File | Meaning |
|---|---|
| [warehouse_building_and_robot_models.js](../digital_twin_application/warehouse_building_and_robot_models.js) | Constructs the warehouse objects and robot models |
| [three_dimensional_warehouse_view.js](../digital_twin_application/three_dimensional_warehouse_view.js) | Manages the 3D view and camera |
| [two_dimensional_warehouse_view.js](../digital_twin_application/two_dimensional_warehouse_view.js) | Provides a canvas drawing if the 3D renderer is unavailable |

## ESP32 measurement workflow

1. Each ESP32 reads available measurements.
2. Its firmware publishes a timestamped message to its assigned robot topic through secure MQTT.
3. The browser connects to the message broker through secure WebSockets.
4. [robot_measurement_validation.js](../digital_twin_application/robot_measurement_validation.js) checks identity, values, timestamps, ordering and freshness.
5. [esp32_connection_controls.js](../digital_twin_application/esp32_connection_controls.js) displays connection status and accepted measurements.
6. Live AMRs displays a robot position only when a fresh measured position is available.

Telemetry means measurements sent by a device. MQTT is the messaging protocol; a broker is the message-routing server.

The supported identities are amr-01, amr-02 and amr-03. See the [ESP32 setup guide](../digital_twin_application/esp32_robot_firmware/esp32_wifi_and_telemetry_setup.md) for topics and configuration.

## Session records

Each browser workspace has its own simulation state. Reloading resets it. Activity → Export CSV saves the decision record. Appearance and motion preferences are local browser settings.

LabVIEW remains a separate project and is not started by this application.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
