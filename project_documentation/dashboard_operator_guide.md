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

Approval rechecks feasibility. Journeys overlap when their node, segment and nearby-corridor windows are compatible. Departure speed remains fixed for each reserved journey. Cancellation suppresses supply and completes its reserved path before docking. Route settings lock while approved reservations exist. Reassignment needs fresh approval. Pause and stop freeze traffic time and retain spatial separation.

Route-map closures and playback affect only the preview. Copy dispatch conditions reads the current settings without changing missions. Algorithm mode displays the actual solver trace; manual seeking remains available with reduced motion.

Manager M1 and M2 have visible hatched standing areas, human figures and **No AMR entry** labels in Floor and Route map, including the Canvas fallback. These are configured reference locations, not live personnel tracking. The shared route solver excludes links whose full segment intersects a standing circle plus the model's 0.48 m robot footprint/clearance. Manual lane reopening cannot remove a manager restriction. The default areas sit clear of every reference lane, so published journey distances remain unchanged.

Default locations and radii are defined in [the manager standing-zone module](../frontend_warehouse_dashboard/browser_modules/warehouse_reference_geometry/warehouse_manager_standing_zones_and_route_clearance.js). Facility JSON may carry an optional `restrictedZones` array with `id`, plain `label`, `x_m`, `y_m` and `radius_m`; import/export preserves it and routing uses it. Older maps without this array remain supported. Custom Twin lab geometry does not reposition the reference floor figures. These illustrative areas and clearances require site measurement and controller integration before physical use.

In Streamlit, the workspace scrolls below the header while navigation stays visible. Use the scrollbar, touch scrolling or focus the workspace and use Page Down. Each view opens at the top; ordinary updates preserve your position.

Use Dark/Bright and the motion control to adjust appearance. The Canvas fallback covers browsers without WebGL. Four A–D counts are monitored; the other eight racks are reference decoration.

For hardware, follow [ESP32 setup](esp32_wifi_and_telemetry_setup.md), connect through Hardware and select the live source. A Wi-Fi heartbeat does not establish measured pose, speed or battery. Physical overrides use the separate [Coordinator service](operator_override_channel_and_hardware_commissioning.md).

Twin lab labels synthetic recordings, measured fields and prediction gates. Export recordings as JSON to preserve evidence. Applying a fit changes only its eligible model profile; map/source changes invalidate approval where required. Paired comparison outcomes are tied to their frozen scenario and do not execute missions.

