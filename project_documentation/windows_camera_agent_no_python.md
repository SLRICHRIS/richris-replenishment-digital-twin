# AMR-01 camera toolkit for Windows (no Python installation)

For the current **direct Wi-Fi ArUco workflow**, use `AMR01_LocalTwin.exe` and the [local route guide](direct_wifi_aruco_routes.md). The instructions below document the older `AMR01_CameraAgent.exe` broker-based route path.

This is the **existing calibrated Windows camera-controller architecture**, bundled into Windows executables. The toolkit is built in GitHub Actions using Python; **the operator does not need to install Python on the laptop**. The Logitech USB webcam stays connected to the Windows laptop. The ESP32 remains wireless on battery and EMQX.

## Where to obtain it

Open the repository's **Actions → Build Windows AMR camera toolkit** workflow. Open the latest successful **main** build, download the **AMR01-Windows-Camera-Toolkit** artifact and extract it on the Windows laptop. Artifacts expire after 14 days; the workflow can be run again. Only run executables downloaded from this repository's trusted workflow. These builds are unsigned and Windows SmartScreen may warn. Do not disable system-wide protections.

If the workflow has not produced a successful Windows build, the executables are **not yet available**; do not attempt to download an invented release link.

## Before camera tracking

- Close **Windows Camera** and click **Stop preview** on the Streamlit dashboard. The USB camera cannot reliably be shared by the browser and the controller.
- Power down the robot's motor driver while commissioning the camera.
- Keep the camera and four printed floor markers in fixed positions.
- Current measured floor **610 × 630 mm**, Logitech lens **1310 mm** above the floor, AMR body **170 × 155 × 150 mm**; robot marker ID 0 is nominally at the body centre.
- Camera reference IDs observed: **1 top-left; 2 bottom-left; 3 bottom-right; 4 top-right**. Each marker's X/Y centre must be measured physically from the floor origin. **The example's 40 mm insets are provisional and do not count as verified.**

### 1. Capture the empty-floor image

Remove the robot from the floor and leave all four corner markers visible. Open PowerShell in the extracted toolkit folder:

```powershell
.\AMR01_CameraSetup.exe background --camera 0 --width 1280 --height 720 --output empty_floor.png
```

Press **C** to capture when the Logitech view is correct. If camera 0 is the laptop's built-in camera, try `--camera 1`. The saved image must have the exact resolution used by the agent.

### 2. Complete one-time lens intrinsics

Use a **9 × 6 INNER-corner** checkerboard with **25 mm squares**. Capture at least **20 distinct views** using Space; then press C:

```powershell
.\AMR01_CameraSetup.exe intrinsics --camera 0 --width 1280 --height 720 --output camera_intrinsics.json
```

The tool refuses RMS reprojection error greater than 1 pixel. Confirm ruler distances before marking camera intrinsics as verified.

### 3. Private calibration and safety checks

Copy `example_camera_config.json` to `camera_private_config.json`. Insert the measured `camera_matrix`, `distortion_coefficients` and `resolution` from `camera_intrinsics.json` and complete the individually measured **physical geometry and motor configuration**. Verify marker height, printed-axis-to-robot-forward orientation, the four floor marker centres, wheel polarity, PWM-to-speed gains, maximum obstacle height, stopping distance, power limits and obstacle detection.

**Never set a check to true without its real measurement and test.** The agent will refuse to start with unset values, stale floor measurements or checks still false. The executable does not bypass any of these safeguards. The 610 × 630 mm lab floor is small compared with the robot and its reserved safety radius; a proposed rack mission may correctly report **no safe route** until layout and clearance are validated.

### 4. Run the existing secure wireless controller

Only after camera and motor commissioning and protected MQTT credentials are configured, keep the robot stationary, remove physical motor power for the initial connection check, and run:

```powershell
.\AMR01_CameraAgent.exe --config camera_private_config.json --background empty_floor.png --camera 0 --interactive
```

The program requests your existing **EMQX host**, camera-controller MQTT identity/password, **control key**, and **drive key** privately. Do not paste secrets into GitHub, screenshots, chat or the dashboard. The camera controller publishes signed live scene data and communicates with the protected motion receiver, not the ordinary telemetry publisher. It only emits motor commands after valid website/operator approval.

### 5. Physical wireless-drive prerequisites

The ESP32 may already send physical telemetry while **protected route driving remains disabled**. Its private firmware must explicitly enable `AMR_VISION_DRIVE_ENABLED` and the signed-drive MQTT receiver, with the appropriate user-specific keys and least-privilege broker identity. This requires a one-time verified firmware upload, plus wheels-raised testing. Normal operation thereafter is wireless.

Verify that **Live AMR mission → Physical AMR → Connect** shows a fresh *trusted camera scene* and a fresh *protected hardware heartbeat*. Ordinary telemetry is not enough. Follow the [human-approved physical route execution guide](human_approved_physical_route_execution.md) for the separate restricted route-audit role and protected website setup.

### 6. Autonomous mission

In the Digital Twin, select the physical source, authenticate as operator, choose the **reachable** station target, capture a server-owned route, inspect it and **approve once**. The Windows camera agent then follows the route automatically through EMQX and the ESP32. Keep the page open and power-stop accessible. An invalid scene, lost heartbeat, camera occlusion, obstacle change, route deviation or stale approval stops the route and requires a new approval. A command acknowledgement alone is not verified arrival.

**No unattended or obstacle-rich autonomous run** is authorized by the existence of this toolkit. First test low-speed physical movement with the wheels raised, then a short supervised straight-line route on a clear floor, and only then a station mission with all safety checks validated.
