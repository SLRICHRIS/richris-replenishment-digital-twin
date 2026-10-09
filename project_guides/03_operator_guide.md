# Operator Guide

Open Floor and select Simulation. For a fresh session, use Reset simulation; confirming it clears the current simulation and activity record.

| Task | Action | Expected result |
|---|---|---|
| Inspect a robot | Select AMR-01, AMR-02 or AMR-03 | Its state and measurements appear in the inspector |
| Review missions | Click Review dispatch or Review 3 missions | Proposed assignments and readiness estimates appear |
| Start approved work | Approve feasible missions | One journey starts; the others wait in the queue |
| Inspect the warehouse | Drag to orbit, scroll to zoom, or select Plan | The camera view changes |
| Pause movement | Pause the active unit, then resume | Its virtual movement pauses and continues |
| Inspect forecasts | Adjust the forecast window | Advice updates for the selected horizon |
| Adjust appearance | Choose Dark/Bright or the motion control | Theme or interface animation changes |
| Save the session record | Activity → Export CSV | The decision and event record downloads |

Values change while the simulation runs.

For real measurements, follow [ESP32 setup](../digital_twin_application/esp32_robot_firmware/esp32_wifi_and_telemetry_setup.md), connect through Hardware, then select Live AMRs. Device slots become live when valid fresh messages arrive.
