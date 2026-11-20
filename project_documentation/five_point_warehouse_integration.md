# Five-point paper warehouse: integration plan

Workspace: 425 x 630 mm. Logitech C270, USB to Windows laptop, nominal camera height 920 mm. Four stationary corner ArUco reference markers must remain distinct from racks A/B/C/D. Robot marker is the separately mounted fifth ArUco marker. **Existing camera.py currently uses floor references IDs 1,2,3,4 and robot ID 0; do not print a conflicting ID scheme.**

This branch introduces `vision_control.five_point_mission.FivePointMission` as a **decision-domain component**, not a live motor executor. Station coordinates are placeholders until measured in the calibrated floor frame. A/B/C/D are rack stops; E is the charging point.

Integration sequence:
1. Calibrate C270 intrinsics at the actual 1280x720 resolution and verify four fixed corner references, camera coverage, and robot marker visibility.
2. Measure each rack stop and E in floor coordinates, using accessible stopping poses (not rack centres).
3. On start/destination selection, ensure the physical robot is actually at the selected start rack; then compute the initial route without a routine human approval.
4. Reuse `Camera`, `contracts.plan`, `Follower`, signed MQTT, and ESP32 hardware ACKs. A changed obstacle map must immediately stop the active controller, create a fresh detour proposal and wait for explicit HITL approval before any movement resumes.
5. Low battery **prediction** prompts a diversion to E. Rejection permits a fresh destination route only if the hardware voltage remains above the existing electrical cutoff. Loss of camera, stale command, emergency stop, and critical voltage still stop the motors.
6. Persist every proposed and decided intervention to Neon; show pending requests and real robot pose in Streamlit. Never interpret a browser rehearsal as a physical ACK.

**Physical feasibility blocker to measure, not to hide:** existing robot footprint is reported as 187 x 150 mm, while the paper width is only 425 mm. The existing `contracts.radius` includes footprint, stopping distance, tracking tolerance and a conservative communication reaction allowance. It may exceed half the workspace width, making `plan()` correctly reject all routes. Measure actual stopping distance, reachable stopping zones, and usable arena size. Do not simply zero out clearance or spoof sensor readings to force motion.

**Wired in this branch:** physical-route panel start/destination selectors and operator-entered rack coordinates feed the existing physical route capture action. These inputs are not yet stored in Neon or shared with the local camera agent. The start rack is operator-declared and not yet checked against live camera pose.\n\n**Not yet wired in this branch:** camera event bridge, automatic execution grant, battery predictor hookup, Neon decision persistence, and physical ESP32 test. The existing controller still requires initial route approval. The mission module is a foundation, not a claim of completed end-to-end autonomy.
