# Overhead USB camera provision

Open **Vision routing** in the published Streamlit dashboard. The reported arena is a **425 × 630 mm** portrait paper, origin at the bottom-left, X right and Y up. Reported camera height is **92 cm**, interpreted as lens-to-paper distance pending confirmation. The reported full robot outline is 187 × 150 × 150 mm, corrected from the original 180 mm length by axle-to-front F = 147 mm and axle-to-rear R = 40 mm. The printed robot-marker black edge is 40 mm at a reported height of 150 mm. These are planning defaults and metadata; saved browser edits are preserved. The 100 mm wheel spacing is not substituted for body width. Camera and motor commissioning remain pending.

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

The 18 November paper measurements supersede the original A0 assumption. Saved A0 maps are not restored into the new coordinate system. Camera calibration and physical commissioning remain pending.
