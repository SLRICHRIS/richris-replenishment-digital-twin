<!-- Generated from project_documentation/digital_twin_feature_alignment_audit.md; edit the canonical document and rebuild downloads. -->

# Feature alignment audit

This release addresses the 11 October 2026 review of GitHub commit `b5c847813141e6744272579583ce8e673f48d260`.

| Review finding | Correction | Verification |
| --- | --- | --- |
| Firmware packet rejected by recorder | Restore the protocol key `firmware`, independently of the folder name | Compile the `.ino` serializer header; feed identical output to JS/Python; null and zero remain distinct |
| ZIP repeats mismatch | Rebuild both kits and guide copies from sources | Source/member byte checks and extracted-kit tests |
| No override path | Separate HTTP/MQTT Coordinator, LabVIEW HTTP adapter and ESP32-to-controller bridge | Command boot/ID/expiry gates, idempotency, terminal ACK semantics and latency benchmark |
| Prediction isolation unmeasured | Production command handler benchmark with production prediction in separate processes | 100 requests each at idle, normal and heavy software load |
| Only one effective robot | Shared node, segment and adjacent-corridor time windows | Concurrent dashboard runs and fleet footprint checks |
| Sensors always NaN | Fresh measured UART acquisition replaces the unconditional stub | Real sensor link remains to be wired/calibrated; unavailable readings stay null |
| Long unreadable source | Prettier with HTML template formatting and named pure scheduling module | Formatter check and existing behavior/oracle regressions |
| Repeated evidence clutter | Remove historical logs, hashes and rename maps; Git retains history | One current verification record and current file-purpose catalog |
| Observer overstatement | Name scalar-variance position filter explicitly; heading is not filtered | [Model contract](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/digital_twin_architecture_and_validation_plan.md) |

## Model differences retained deliberately

The runtime charges docked waiting robots at 0.16 percentage points/s; motion consumes 0.06/s and the return reserve is 15%. The paired study uses source profiles and no charging. Both use the same window constraints and graph routing, with their energy assumptions visible.

Departure locks journey speed and geometry. New speed disturbances apply to queued journeys. Cancelling/reassigning a moving mission suppresses its old delivery and completes the reserved route before docking. Paused/stopped movement freezes traffic time rather than invalidating another robot's windows. These policies are reflected in execution, forecasts and operator text.

Physical sensor acquisition, native LabVIEW VI, real controller execution and independent ground truth remain commissioning evidence. The browser remains a telemetry viewer for hardware; control is local to the separate Coordinator process. [Verification results](https://github.com/SLRICHRIS/richris-replenishment-digital-twin/blob/main/project_documentation/software_verification_results/current_software_check_results.md) lists measured software results and reproduction commands.
