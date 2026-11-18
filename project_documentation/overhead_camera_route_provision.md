# Overhead USB camera provision

Open **Vision routing** in the published Streamlit dashboard. The known arena is A0 portrait: **841 × 1189 mm**, origin at the bottom-left, X right and Y up. Full robot body length/width, camera mounting height and printed robot-marker edge are intentionally blank until measured. The existing 100 mm wheel spacing is not substituted for body width.

## Available now

- Enter measured setup, save it in this browser, or export the setup and manual rehearsal as JSON. These settings do not alter production sensor calibration, database records, EMQX configuration or credentials.
- Place the robot start and destination by clicking or entering coordinates. Drag rectangular obstacles, enter their coordinates, remove the last rectangle or clear them all.
- Calculate a route once the full robot footprint is entered. Start/destination centers snap to a 10 mm grid. The planner uses A* with eight neighbor directions and Euclidean edge costs. It returns the shortest path on that grid for the manually drawn scene, not a claim about the physical floor.
- Review the preview with **Approve rehearsal**, **Reject** or **Hold**, with an optional note. The local trail records the scene revision. Any scene or setup edit clears the plan and invalidates the decision. Reloading never restores an approval. **Every result has `executionEnabled: false`.** There is no network/command bridge in this module.
- Start a video-only browser camera preview after explicitly granting permission, or select a PNG/JPEG/WebP still frame up to 8 MB. Choose the USB camera in browser camera settings if another camera is selected. Camera permissions can be blocked by an embedded browser policy; still preview remains available. Frames stay in browser memory and are not uploaded, stored or exported. The stream stops on navigation away, Stop preview or page exit, including a late permission response after stopping.

## Planning limits

The starting clearance of **20 mm** is an editable planning assumption, not measured localization uncertainty. The robot is conservatively represented by a circle of radius `hypot(length/2, width/2) + clearance`. Rectangular obstacles are expanded in X and Y by that radius, which is extra conservative at rectangle corners. Floor edges reserve the same radius. Every candidate grid edge is checked against the continuous expanded rectangles, preventing diagonal corner cuts and crossings of thin obstacles between nodes.

The preview does not model dynamic obstacles, wheel slip, turn duration, acceleration, tracking errors or image uncertainty. Manually omitted obstacles are unknown to the planner. A blocked scene reports no route; it does not reduce clearance or silently shrink the robot. Camera height is optional for a manual rehearsal but required in the future camera commissioning process.

## Morning commissioning inputs and remaining work

1. Measure the full robot envelope, including wheels and protrusions, and the camera height above the floor. Provide a frame with the whole flat A0 sheet visible. Measure the printed marker edge; planned family is ArUco 4×4/50, default ID 0.
2. Calibrate lens distortion and the floor perspective using measured correspondences. Robot markers above floor level need their own height/pose treatment; a floor homography alone is not a general 3D localization model.
3. Connect a Windows-local USB vision processor to extract robot pose and obstacle observations. Define timestamp, frame identity, coordinate convention, uncertainty, detection validity and stale/occluded-scene behavior before accepting these as evidence.
4. Add a separate authenticated and validated observation-ingest path and read-only stored scene view. The current commissioning receiver accepts ESP32 sensor packets; this page does not send invented camera packets into it.
5. Bind any future physical approval to a fresh immutable scene, calibration version, robot footprint and route. Revalidate immediately before dispatch and implement a tested local stop/watchdog and controller contract. The current provision does not implement waypoint execution or extend existing operator-command permissions.

Until those steps are implemented and validated, the page says **Setup · advisory only**, automatic detection **Not connected**, perspective/lens calibration **Pending**, and physical execution **Disabled**. Local preview is not automatic detection. Rehearsal approval is not physical authorization.
