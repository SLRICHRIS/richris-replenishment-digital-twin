<!-- Generated from project_documentation/digital_twin_feature_alignment_audit.md; edit the canonical document and rebuild downloads. -->

# Single-AMR feature alignment audit

This audit supersedes the earlier three-AMR/UART control architecture. The current active system uses AMR-01 direct sensors and server-side Python models.

| Scope issue | Current alignment | Remaining limit |
| --- | --- | --- |
| Multiple robot/bay references | One AMR-01, one middle left-apron bay, one raw topic/calibration/card; virtual jobs are sequential | No multi-AMR coordination claim |
| Legacy hardware instructions | Current setup points to direct encoders, MPU6050 and INA219 on ESP32 | UART/Coordinator/LabVIEW sources and ZIPs retained only as legacy references |
| Mixing measured and simulated states | Hardware shows Python sensor estimates; Floor and stock/tasks retain labelled simulation | Coordinate registration and live 3D synchronisation still required |
| Sensor/model ambiguity | Counts → wheel motion → nonlinear pose; gyro rate/bias; V/I → power/Wh/SOC | No full EKF, absolute localisation or measured stock |
| Predictive/anomaly overstatement | Constant-speed/load assumptions and sustained residual advisories identified as project extensions | Physical forecast/fault validation pending; no fault classification or RUL |
| Unbacked sensing graphics | Manager circles and cones labelled illustrative simulation tools | No people/range sensor or physical collision-safety claim |
| Incorrect route totals | Single-AMR reference graph has 19 nodes and 24 bidirectional links | Dijkstra playback is an optional teaching tool |
| Paper attribution | Hyperlinks, exact PDF pages and boundaries at model use sites | Project adaptations are not presented as verbatim paper equations |

The original warehouse appearance is retained. Detailed facility scenery, reference replay and route demonstrations are presentation/simulation aids, not additional physical subsystems. The live-floor v1 selector and legacy kit links are not exposed in the Python-hosted workflow.

See [current scope](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/implemented_dashboard_features_and_limits.md), [architecture](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/dashboard_and_telemetry_system_architecture.md), [commissioning](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/single_amr_sensor_twin_setup.md) and [software versus physical evidence](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/single_amr_alignment_validation.md). Historical results and sources remain available in Git history and explicitly marked legacy documents.
