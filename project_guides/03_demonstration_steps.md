# Demonstration Steps

Open the deployed application or follow the [startup guide](04_streamlit_deployment_instructions.md). Use Simulation mode. For a clean demonstration, Reset simulation and confirm the reset; this clears the current session record.

| Step | Action | Expected observation |
|---|---|---|
| 1 | Open Floor with Simulation selected | Three virtual robots and initial missions awaiting approval |
| 2 | Select each robot | Its battery, position and state appear in the inspector |
| 3 | Click Review 3 missions or Review dispatch | Readiness, arrival estimates and estimated return battery |
| 4 | Approve feasible missions | One mission becomes active while the others wait in the queue |
| 5 | Watch a complete delivery and return | The next queued journey starts after the aisle is released |
| 6 | Pause and resume the active unit | Movement pauses while the reservation remains held |
| 7 | Adjust the forecast window | Advice is recalculated from the current state and approved queue |
| 8 | Switch Dark/Bright and the motion preference | Colors change and interface animations can be reduced |
| 9 | Open Activity and export CSV | A decision and event record downloads |
| 10 | Open Hardware | Three slots remain offline until configured devices send valid measurements |

Values change while the simulation runs. Explain the current state rather than expecting a fixed screenshot.

## Questions for discussion

- Why is human approval required?
- Why does the aisle reservation include the return journey?
- Which assumptions determine stock and battery forecasts?
- How are simulated values distinguished from physical measurements?
- How are old or invalid ESP32 messages rejected?

## Physical-device demonstration

Follow the [ESP32 setup guide](../digital_twin_application/esp32_robot_firmware/esp32_wifi_and_telemetry_setup.md) when real boards, a broker and sensors are available. A connected broker does not prove all three robots are online.

A loaded dashboard or animation demonstrates interface loading. Physical operation requires separate evidence.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
