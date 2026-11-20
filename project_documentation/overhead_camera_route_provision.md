# Overhead USB camera provision

Open **Live AMR mission** in the published Streamlit dashboard. The physical floor is **610 × 630 mm**, with origin at the bottom-left, X right and Y up. The Logitech camera is **131 cm** vertically above the floor. The full AMR-01 body is **170 × 155 × 150 mm** (L × W × H). ArUco marker **ID 0** is reported at the body centre; its directional alignment still needs verification. The robot's black-square marker edge is nominally **40 mm** at a reported surface height of **150 mm**.

**Observed physical floor marker arrangement (20 November 2026 image):**

- **ID 1:** top-left corner
- **ID 2:** bottom-left corner
- **ID 3:** bottom-right corner
- **ID 4:** top-right corner

The OpenCV `DICT_4X4_50` detector recognized IDs 0–4 in the supplied screenshot. **Visibility is not metric calibration:** the exact floor coordinates of each *marker centre*, camera intrinsics, marker heading alignment, motor polarity/speed, and stopping distance must be verified before any autonomous drive. The software's 40 mm corner insets are provisional, not physical measurements. Keep all commissioning checks false until independently tested. An on-laptop USB video preview is now available under **Physical AMR → Setup → Show Logitech camera**; it does not feed trusted localization and must be stopped before launching the separate camera agent.

## Page organization

The default **Physical AMR** mode has five stages: **Setup → Connect → Plan → Approve → Run**. Each stage shows the next required action. Physical setup and execution are covered in the [physical route guide](human_approved_physical_route_execution.md). Setup is shared with a separate **Practice** tab; it is stored only as a browser planning draft.

## Practice capabilities

- Enter measured setup, save it in this browser, or export the setup and manual rehearsal as JSON. These settings do not alter production sensor calibration, database records, EMQX configuration or credentials.
- Place the robot start and destination by clicking or entering coordinates. Drag rectangular obstacles, enter their coordinates, remove the last rectangle or clear them all.
- Calculate a route once the full robot footprint is entered. Start/destination centers snap to a 10 mm grid. The planner uses A* with eight neighbor directions and Euclidean edge costs. It returns the shortest path on that grid for the manually drawn scene, not a claim about the physical floor.
- Review the preview with **Approve rehearsal**, **Reject** or **Hold**, with an optional note. The local trail records the scene revision. Any scene or setup edit clears the plan and invalidates the decision. Reloading never restores an approval. **Every result has `executionEnabled: false`.** There is no network/command bridge in this module.
- Start a video-only browser camera preview after explicitly granting permission, or select a PNG/JPEG/WebP still frame up to 8 MB. Choose the USB camera in browser camera settings if another camera is selected. Camera permissions can be blocked by an embedded browser policy; still preview remains available. Frames stay in browser memory and are not uploaded, stored or exported. The stream stops on navigation away, a switch back to Physical AMR, Stop preview or page exit, including a late permission response after stopping.

## Planning limits

The starting clearance of **20 mm** is an editable planning assumption, not measured localization uncertainty. The robot is conservatively represented by a circle of radius `hypot(length/2, width/2) + clearance`. Rectangular obstacles are expanded in X and Y by that radius, which is extra conservative at rectangle corners. Floor edges reserve the same radius. Every candidate grid edge is checked against the continuous expanded rectangles, preventing diagonal corner cuts and crossings of thin obstacles between nodes.

The preview does not model dynamic obstacles, wheel slip, turn duration, acceleration, tracking errors or image uncertainty. Manually omitted obstacles are unknown to the planner. A blocked scene reports no route; it does not reduce clearance or silently shrink the robot. Camera height is optional for a manual rehearsal but required in the future camera commissioning process.

## Physical commissioning

The protected camera/controller/ESP32 path is implemented, but its physical commissioning remains pending. Follow the [physical execution guide](human_approved_physical_route_execution.md) for measured camera geometry, firmware upload, private backend audit setup, broker permissions and attended commissioning. The browser preview alone is neither automatic obstacle detection nor trusted physical calibration. Practice approval never authorizes the physical AMR.

The 20 November measured floor supersedes all older 425 mm and A0 dimensions. Camera calibration and physical commissioning remain pending. Browser setup/preview alone cannot authorize motion.
