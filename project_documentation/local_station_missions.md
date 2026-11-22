# AMR-01 station missions and human decisions

A mission records the selected start station, the camera-observed starting pose, and the selected destination. Its original start and destination remain fixed while individual approved routes can change. The active target is shown separately when returning to the start or visiting battery station E.

The reported inside red-tape floor is **760 mm across × 560 mm bottom to top**, with camera lens height **1300 mm**. The coordinate origin is the bottom-left inner tape corner, X right and Y up.

The current installation uses work stations **A and B**, plus **E as the charging reference stop**. The operator connects the charger manually after the robot stops; this installation has no automatic charging contacts. C and D are not configured or selectable. All four floor reference markers (IDs 1–4) and robot marker 0 are still required. Replacing the floor or camera setup requires new measurements and calibration; the old 610 × 630 mm template does not measure the new taped floor. Old five-station maps must be measured and saved again.

## Before movement

- Calibrate the camera, marker geometry, wheel response and stopping envelope.
- Choose centre-reference points or front-reference paper-edge points for A, B and E. For a front reference, choose the final facing direction for each point; the app derives the centre goal from half the measured body length. Centre goals remain separated by more than 30 mm so their arrival zones do not overlap. The saved station map is bound to the current camera configuration; changing that configuration requires verification again.
- Select a start station that agrees with the live ArUco position within 15 mm, and a destination station.
- Preview the route, inspect current evidence and record an approval reason.

Selecting a station does not create a pose observation. Camera observations are the only source of the physical start and progress. The planner checks the measured full-body clearance; a label near a wall can need a stopping point farther inside the floor. Station setup displays the usable robot-centre bounds. The 760 × 560 mm floor may not leave enough clearance for a detour around every object; a larger physical workspace may be necessary.

## Front reaches the paper edge

The operator confirmed that the robot **front**, rather than its centre, should reach the measured paper edge. The robot dimensions remain **170 × 155 × 150 mm**, so the forward distance from its tracked body centre to its front is **85 mm**. This offset is derived from the calibrated body length, not from the ArUco tag centre; the camera still needs the measured tag-to-body offset.

Station setup has **Robot front reaches paper edge** and **Load reported A/B/E paper-edge points** controls. The latter loads the user-reported points below, leaves verification unchecked and sends no request. B's X/Y order was explicitly corrected. The suggested final directions face the relevant paper from the floor interior; inspect them before saving.

| Station | Measured front target X, Y (mm) | Proposed final direction | Derived body centre X, Y (mm) |
| --- | --- | --- | --- |
| A | 630, 350 | Right, 0° | 545, 350 |
| B | 205, 430 | Up, 90° | 205, 345 |
| E | 290, 75 | Down, −90° | 290, 160 |

For a front target `(xf, yf)`, body length `L` and final heading `θ`, the centre target is `(xf − (L/2) cos θ, yf − (L/2) sin θ)`. X increases right and Y increases up. The saved record retains the measured front point, the final direction and the derived centre; reloading the form shows the original measured point. Changing the camera profile invalidates station verification.

The path still passes the existing full-body, reaction and stopping-clearance checks. Once the centre reaches the goal, the follower can turn to the selected final direction inside the checked clearance envelope. Arrival requires centre error at most 10 mm, front-point error at most 15 mm, the checked final heading, distinct fresh camera observations and signed applied-stop feedback. The heading tolerance is at most 0.05 rad and tightens for longer bodies. The coordinator independently repeats the pose checks. An approval binds the front target, heading and offset as part of the route hash, and the agent recomputes them from the calibrated geometry before accepting it.

**These coordinates are reported targets, not physical route validation.** With the current template's 20 mm/s speed and other default margins, required clearance is approximately 236 mm **plus the unmeasured stopping distance**. Front-target conversion alone therefore does not make the three reported targets reachable under that template. Use the actually commissioned geometry and motor response; if the required envelope does not fit, the floor layout needs more space. No clearance, freshness, voltage or command-lease guard is bypassed by front-reference mode.

The selected start is checked against the derived **body-centre** position. Return-to-start preserves the camera-observed original centre position. A battery diversion to E instead uses E's saved front target and final direction. E remains a manual charging reference, with no automatic electrical docking claim.

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
| Arrival | Stop and collect distinct fresh camera observations plus motor feedback | Show verified arrival only when the selected position reference, final direction (for front targets) and stopped-state evidence agree |

Obstacle recovery calculates a proposal automatically. It never approves that proposal. A changed scene invalidates the previous path and approval. Return and E diversion use current path planning rather than replaying a recorded drive trace.

Battery advice uses the measured pack voltage, not an invented battery percentage or time-to-empty. Permission to continue is limited to the reviewed mission route and current controller identity. Approving a proposed battery-station E route includes its current battery decision; a changed path still requires a new approval. A drop of 0.10 V from the warning baseline requires a new decision; the lower voltage boundary always remains active.

## Evidence and interruptions

The laptop retains an audit of mission intent, captured start, target changes, route reviews, reasons, interruptions and verified outcomes. Each replacement route receives a new review identity. The receiver still checks command signatures, boot/connection identity, sequence and short expiry.

An obstacle replan requires valid fresh camera observations, a stable scene and acknowledged zero motor outputs. Camera occlusion, stale frames and disconnected hardware are faults, not newly detected obstacles. Stop, rejection, page departure and a restarted process do not silently renew an old approval.

Real objects must be visible to the calibrated camera and within the validated detection envelope. Software tests use simulated camera and receiver evidence; a physical trial must establish actual detection latency, motor response and stopping distance before claiming a verified mission.
