# Operator Guide

The dashboard opens in Simulation with three proposed missions awaiting review. Reset simulation clears that browser workspace after confirmation. Simulation and recording state belong to the current browser session; export evidence before reloading.

| View | Use |
| --- | --- |
| Floor | Inspect AMR-01/02/03, all twelve racks, bay states, camera presets and optional overlays |
| Route map | Select or tap start/destination nodes, pan/zoom, close links, choose distance/time, inspect both legs and step through Dijkstra |
| Hardware | Configure secure MQTT subscription and inspect three read-only device slots and packet freshness |
| Missions | Review travel, queue wait, both routes and battery reserve; approve, pause, cancel or reassign virtual work |
| Insights | Inspect stock, battery and deterministic forecast conditions |
| Twin lab | Compare measured/estimated/predicted state, import/export recordings, replay faults, calibrate and run paired scenarios |
| Activity | Review decisions and download the CSV event record |

Approval rechecks feasibility. One complete virtual delivery-and-return journey runs at a time. Route settings lock while approved reservations exist. Reassignment needs fresh approval. Pause and stop retain the aisle reservation.

Route-map closures and playback affect only the preview. Copy dispatch conditions reads the current settings without changing missions. Algorithm mode displays the actual solver trace; manual seeking remains available with reduced motion.

In Streamlit, the workspace scrolls below the header while navigation stays visible. Use the scrollbar, touch scrolling or focus the workspace and use Page Down. Each view opens at the top; ordinary updates preserve your position.

Use Dark/Bright and the motion control to adjust appearance. The Canvas fallback covers browsers without WebGL. Four A–D counts are monitored; the other eight racks are reference decoration.

For hardware, follow [ESP32 setup](../digital_twin_application/esp32_robot_firmware/esp32_wifi_and_telemetry_setup.md), connect through Hardware and select the live source. A Wi-Fi heartbeat does not establish measured pose, speed or battery. Physical control remains pending.

Twin lab labels synthetic recordings, measured fields and prediction gates. Export recordings as JSON to preserve evidence. Applying a fit changes only its eligible model profile; map/source changes invalidate approval where required. Paired comparison outcomes are tied to their frozen scenario and do not execute missions.

