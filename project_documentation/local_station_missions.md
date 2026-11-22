# AMR-01 station missions and human decisions

A mission records the selected start station, the camera-observed starting pose, and the selected destination. Its original start and destination remain fixed while individual approved routes can change. The active target is shown separately when returning to the start or visiting battery station E.

## Before movement

- Calibrate the camera, marker geometry, wheel response and stopping envelope.
- Measure the robot-centre stopping coordinates of A–E, separated by more than 30 mm so their 15 mm arrival zones do not overlap. The saved station map is bound to the current camera configuration; changing that configuration requires verification again.
- Select a start station that agrees with the live ArUco position within 15 mm, and a destination station.
- Preview the route, inspect current evidence and record an approval reason.

Selecting a station does not create a pose observation. Camera observations are the only source of the physical start and progress. The planner checks the measured full-body clearance; a label near a wall can need a stopping point farther inside the floor. Station setup displays the usable robot-centre bounds. The 610 × 630 mm floor may not leave enough clearance for a detour around every object; a larger physical workspace may be necessary.

## Decision rules

| Event | Immediate response | Human decision and result |
| --- | --- | --- |
| Initial mission | Preview a path from the observed pose to the destination | Approve starts that route; reject or stop sends no motion |
| New obstacle during travel | Stop and retire the current route; wait for fresh stationary evidence | Preview a new path to the same active destination; approval starts only that path |
| Reject a detour | Keep the robot stopped | No further automatic proposal or movement resumes the rejected route |
| Return to start | Stop if needed and preview a path to the immutable observed mission start | Approve the return path; its route is calculated against the current obstacles |
| Battery 6.7–7.0 V, including both endpoints | Hold stopped and show the battery decision | Continue toward the current active target only after the relevant approval, or preview and approve a path to E |
| Go to E | Preserve the original mission destination and set E as the active target | Approve the new path; arrival at E does not certify charging or docking |
| Battery below 6.7 V, or configured cutoff reached | Stop | No continue, return or diversion can override the voltage stop |
| Changed camera calibration, lost tracking/feedback or lost operator presence | Stop and invalidate the movement permission | A fresh review is required after the cause is resolved |
| No collision-free path | Stay stopped and explain the blocked proposal | Change the physical obstruction or choose another permitted reviewed action |
| Arrival | Stop and collect distinct fresh camera observations plus motor feedback | Show verified arrival only when both position and stopped-state evidence agree |

Obstacle recovery calculates a proposal automatically. It never approves that proposal. A changed scene invalidates the previous path and approval. Return and E diversion use current path planning rather than replaying a recorded drive trace.

Battery advice uses the measured pack voltage, not an invented battery percentage or time-to-empty. Permission to continue is limited to the reviewed mission route and current controller identity. Approving a proposed battery-station E route includes its current battery decision; a changed path still requires a new approval. A drop of 0.10 V from the warning baseline requires a new decision; the lower voltage boundary always remains active.

## Evidence and interruptions

The laptop retains an audit of mission intent, captured start, target changes, route reviews, reasons, interruptions and verified outcomes. Each replacement route receives a new review identity. The receiver still checks command signatures, boot/connection identity, sequence and short expiry.

An obstacle replan requires valid fresh camera observations, a stable scene and acknowledged zero motor outputs. Camera occlusion, stale frames and disconnected hardware are faults, not newly detected obstacles. Stop, rejection, page departure and a restarted process do not silently renew an old approval.

Real objects must be visible to the calibrated camera and within the validated detection envelope. Software tests use simulated camera and receiver evidence; a physical trial must establish actual detection latency, motor response and stopping distance before claiming a verified mission.
