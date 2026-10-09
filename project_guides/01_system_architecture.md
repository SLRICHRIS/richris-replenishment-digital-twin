# System Architecture

## Runtime

Streamlit serves the application files. The browser runs the simulation, draws the warehouse and receives optional hardware measurements. Python does not calculate each animation frame.

| Data source | Processing | Display |
|---|---|---|
| Simulation | Mission scheduling, modeled movement and forecasts | Virtual fleet, stock and battery estimates |
| ESP32 devices | Secure MQTT broker → browser WebSocket connection → measurement validation | Three live device slots and available measured poses |

The [source map](../digital_twin_application/README.md) identifies the files responsible for each part.

## Mission flow

1. The operator proposes a destination and robot.
2. The model checks robot availability, duplicate shelf assignments, route timing and estimated return battery.
3. Approval rechecks feasibility and places accepted missions in the ordered queue.
4. One robot reserves the shared aisle for its complete delivery-and-return journey.
5. The simulation updates position, stock and battery; the interface displays the resulting state.
6. Returning to the bay releases the aisle for the next eligible mission.

Pausing retains the reservation. Reassignment requires fresh approval. The minimum modeled return reserve is 15%.

## Forecasting

A browser worker calculates stock depletion, feasible approved deliveries and battery reserve over the chosen horizon. Estimates use defined consumption, movement and energy rates. They are deterministic calculations, not a trained machine-learning model.

## State and scope

Simulation state belongs to one browser workspace and resets on reload. Activity export saves its decision record. Appearance and motion preferences are stored locally.

ESP32 integration receives measurements only. Physical position, speed, battery and controller state require sensors and calibration. The warehouse is an illustrative coordinate model. Physical driving, camera streaming and the separate LabVIEW supervisor are outside this application.
