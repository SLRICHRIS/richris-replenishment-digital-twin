# AMR-01: ArUco routes through direct Wi-Fi

This workflow connects the overhead camera to physical AMR movement: **live ArUco pose → route preview → human approval → direct Wi-Fi wheel commands → camera-verified arrival**. The dashboard embeds a workspace served by the laptop at `http://127.0.0.1:8765/`. The laptop processes the USB camera and sends authenticated commands to the fixed ESP32 address `10.15.213.112`. EMQX continues carrying sensor telemetry; route commands do not use the broker.

The manual direction pad remains a fallback. Opening the workspace, receiving telemetry or recording a sensor recommendation does not approve a route. Movement requires a current camera scene, fresh receiver feedback, verified measurements and an explicit route approval.

## 1. Prepare the laptop and robot

- Connect the Windows laptop and ESP32 to the same Wi-Fi/hotspot. Keep the ESP32 assigned to `10.15.213.112`; a router reservation avoids address changes. The app already knows this address.
- Plug the overhead Logitech camera into the laptop. Close Windows Camera, the old camera agent and the dashboard's cloud/WebRTC camera preview. Only the local workspace should own this camera.
- Keep the camera, floor markers and floor fixed during a run. The configured floor is **610 × 630 mm**, with reported lens height **1310 mm** and AMR body **170 × 155 × 150 mm**. These dimensions do not replace camera calibration or motor measurements.

## 2. Upload the local route receiver once

The existing manual web controller alone does not provide route acknowledgements. Download and extract the [local route firmware kit](../frontend_warehouse_dashboard/downloadable_hardware_kits_and_guides/AMR01_Local_Routes.zip), or use the source sketch at [`esp32_telemetry_firmware/AMR01_Local_Routes/AMR01_Local_Routes.ino`](../esp32_telemetry_firmware/AMR01_Local_Routes/AMR01_Local_Routes.ino).

1. Keep the working firmware and private settings as a local backup. Open the new sketch folder in Arduino IDE with the ESP32 board selected.
2. Copy `example_private_amr_settings.h` to `private_amr_settings.h` in that folder. Transfer your existing private Wi-Fi and telemetry connection values. Do not commit this private file.
3. Generate a separate **64-character lowercase hexadecimal** route key and set `AMR_ROUTE_KEY`. Use this exact key when the laptop program asks for its drive key. Do not reuse the dashboard access code or an old manual-control key.
4. Install the ESP32 board package and the **PubSubClient**, **Adafruit INA219** and **Adafruit BusIO** libraries. Upload the whole sketch folder, retaining its companion headers.
5. Keep the robot stationary for startup calibration. The route receiver retains its **60 PWM** limit and **6.6 V** minimum pack-voltage guard. Do not raise the limits to make a failed route start.

To generate the route key locally in Windows PowerShell:

```powershell
$routeBytes = New-Object byte[] 32
$routeRandom = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$routeRandom.GetBytes($routeBytes)
$routeRandom.Dispose()
-join ($routeBytes | ForEach-Object { $_.ToString('x2') })
```

Keep that output in the private firmware settings and enter the same value in the laptop's hidden prompt. It is not part of a public file or dashboard setting.

The receiver uses `POST /api/route/command` for signed V1 commands and `GET /api/route/hardware` for signed H1 acknowledgements. Its existing manual page remains available. The route receiver does not subscribe to MQTT motor topics. Its clock still needs valid UTC time; removing EMQX from control does not remove the clock requirement.

## 3. Start the laptop workspace

For a Windows executable, open this repository's **Actions → Build Windows AMR camera toolkit**, choose a successful build of the current source, download **AMR01-Windows-Camera-Toolkit** and extract it. The artifact contains `AMR01_LocalTwin.exe`, the camera setup utility and the older MQTT camera agent. Use **AMR01_LocalTwin.exe** for this workflow. An executable is available only after its Windows build succeeds.

Run from PowerShell in the extracted folder:

```powershell
.\AMR01_LocalTwin.exe
```

Enter the route key in the console's hidden prompt. It must match the ESP32's `AMR_ROUTE_KEY`. The optional environment variable is named `AMR_DRIVE_KEY`; a command-line key argument is deliberately not provided. Keep the console open while using the workspace.

The local page opens at `http://127.0.0.1:8765/`. In the digital twin, open **Drive & review → Camera routes** to use it inside the dashboard. Allow local-network access if the browser requests it. If embedding is blocked, use the local page in its own tab on the same laptop.

Starting the program does not connect the camera or command the robot. Use **Connect local session** when ready. If the built-in webcam is camera 0, start with `--camera 1` to select the Logitech device.

To run from source instead:

```powershell
python -m pip install -r backend_streamlit_and_telemetry/vision_control/requirements-vision.txt
python amr01_local_twin.py
```

Optional startup arguments are `--camera`, `--config`, `--background`, `--state-dir` and `--no-browser`. For an existing measured camera profile:

```powershell
.\AMR01_LocalTwin.exe --camera 0 --config camera_private_config.json --background empty_floor.png
```

## 4. Calibrate and import measured settings

Use the local workspace's calibration tools; do not restart the cloud camera preview at the same time.

1. Under **Camera and measured setup**, use **Capture board view** for at least **20 distinct checkerboard views**, then **Calculate intrinsics**. Use the shown **9 × 6 inner-corner checkerboard with 25 mm squares** at the selected camera resolution.
2. Remove the robot and select **Capture empty floor**. All four floor markers must be visible; robot marker **ID 0** must be absent.
3. Use **Load profile / template**, complete its measured fields and select **Apply measured profile**. Existing calibration can be reused only when the camera, resolution, floor references and physical setup still match.

Measure the four marker centres, marker size/height/orientation, robot centre offset, wheel track and polarity, PWM-to-speed gains, minimum movement duty, stopping distance and validated obstacle height. The reference IDs are **1 top-left, 2 bottom-left, 3 bottom-right, 4 top-right**. Do not substitute nominal corner offsets for measured coordinates.

The supplied camera layout has these identities and labels:

| Camera location | Floor marker | Nearby station label |
| --- | --- | --- |
| Upper left | 1 | C |
| Upper right | 4 | D |
| Lower left | 2 | B |
| Lower right | 3 | A |
| Right side, between upper and lower markers | No extra floor marker | E |

Robot marker **0** is separate from the four floor references. The printed A–E labels do not automatically supply robot-centre stopping coordinates.

The current template includes `floor_reference_rotations_deg` with **−90** for each floor ID, matching the decoded marker orientation in the supplied camera image. Angles are counterclockwise in the floor frame (+X right, +Y up). Measure `floor_reference_marker_edge_mm` across the black square; the template's **30 mm** is nominal. Floor tag orientation is separate from `marker_forward_offset_rad`, which establishes the robot's forward direction. Existing profiles without these new fields retain the old 0° / 30 mm assumptions; update and verify them if using this layout.

The robot tag appears displaced from the chassis centre in this view. The template now leaves `marker_center_to_robot_center_mm` unset. Measure that vector **from the marker centre to the tracked robot centre**, expressed along the decoded marker's right and top axes. Do not enter image-pixel offsets or set `[0, 0]` without checking. A screenshot verifies visibility and marker identities; it does not establish metric calibration.

The profile has nine explicit checks: intrinsics, floor-reference positions, empty floor, marker mount, wheel polarities, measured PWM/speed, stopping distance, motor voltage/current, and obstacle detection. Set a check to true only after its measurement or test. The local route profile must stay within the receiver's **60 PWM** limit. Manual movement at a higher duty does not establish a valid route calibration.

Applying a valid profile saves `camera_profile.json` and `empty_floor.png` in the local state folder, alongside `route_audit.sqlite3`. The default folder is `%USERPROFILE%\.amr-local-twin`; `--state-dir` selects another location. Later launches automatically validate and restore this pair. Restoring calibration does not connect the camera, arm the robot or replay an approval. If either saved file is missing or invalid, startup reports the problem; restore the matching pair or move both aside before recalibrating.

To use a different verified profile and background, override them together:

```powershell
.\AMR01_LocalTwin.exe --config "$env:USERPROFILE\.amr-local-twin\camera_profile.json" --background "$env:USERPROFILE\.amr-local-twin\empty_floor.png"
```

The small floor and the robot's required clearance can make a target unreachable. A **no safe route** result is a planning outcome, not a reason to remove clearance or freshness checks.

## 5. Review and run a route

1. Restore the robot to the floor, keep all markers visible and wait for fresh camera and receiver readiness.
2. Select a reachable destination on the map, or enter its X/Y coordinates in millimetres, then choose **Preview route**. Inspect the path, start pose, obstacles and destination.
3. Enter your decision reason, then select **Approve & run** for the displayed route. Use **Reject** or **Hold** if the scene or path is unsuitable.
4. Keep the workspace open and the robot in view. The local follower commands the wheels using live camera feedback. **STOP AMR** cancels the active run.
5. Accept completion only when the workspace reports camera-verified arrival. A delivered command or motor acknowledgement alone is not arrival.

Camera loss, stale receiver data, changed geometry/obstacles, expired approval, route deviation, critical battery voltage or lost operator presence stop the route. A new run needs a new review. The program records approvals and state changes in a local SQLite audit; it does not replay unfinished commands after restart.

The low-battery choice appears only when the measured profile includes a validated `geometry.battery_advisory_voltage_v` above its critical cutoff. The example profile does not assume this threshold. If that advisory pauses a route, review the evidence before choosing **Continue this route** or **Preview battery-station route**. Diversion stops the current route; select the physically measured coordinates of station E, preview the new path and approve it separately. The controller does not assume E's location or automatically plan a destination. The critical battery cutoff always applies and cannot be overridden by either choice.

For manual recovery, stop the route first, then use the embedded direct Wi-Fi controller or `http://10.15.213.112/`. A manual stop cancels route ownership; resuming route motion requires another approval.

## If movement remains disabled

| Observation | Check |
| --- | --- |
| Dashboard cannot open the local workspace | Keep `AMR01_LocalTwin.exe` running on this laptop; open `http://127.0.0.1:8765/` directly and check local-network browser permission. |
| Manual page works, route endpoint is missing | Upload `AMR01_Local_Routes`; the old manual-only HTTP interface is insufficient. |
| Receiver authentication fails | The laptop's drive key must exactly match the new firmware's `AMR_ROUTE_KEY`. |
| Receiver never becomes ready | Read the reported reason; check startup stillness, sensors, valid clock, battery and local/manual ownership. |
| Camera unavailable | Close other camera applications and select the correct `--camera` index. |
| Calibration is incomplete | Finish the measured profile and its checks; example values are not commissioning evidence. |
| No route or no progress | Check the physical clearances and measured movement range. Do not increase PWM or disable a guard blindly. |
| EMQX is disconnected | Sensor recording may pause. Direct route control has its own local connection and feedback. |

Software checks and executable builds do not establish physical commissioning. Upload, camera calibration, motor checks and an attended route trial are still required on the actual AMR before claiming that this integration has been physically verified.
