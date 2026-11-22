# AMR-01: ArUco routes through direct Wi-Fi

This workflow connects the overhead camera to physical AMR movement: **live ArUco pose → route preview → human approval → direct Wi-Fi wheel commands → camera-verified arrival**. The dashboard embeds a workspace served by the laptop at `http://127.0.0.1:8765/`. The laptop processes the USB camera and sends authenticated commands to the ESP32; its default address is `10.55.54.112`, confirmed by the receiver's Serial output and a successful laptop HTTP request. EMQX continues carrying sensor telemetry; route commands do not use the broker.

The manual direction pad remains a fallback. Opening the workspace, receiving telemetry or recording a sensor recommendation does not approve a route. Movement requires a current camera scene, fresh receiver feedback, verified measurements and an explicit route approval.

## 1. Prepare the laptop and robot

- Connect the Windows laptop and ESP32 to the same Wi-Fi/hotspot. The app already knows the current address `10.55.54.112`, so normal startup needs no IP entry. A hotspot may assign a different subnet after restart; compare the app's displayed **Target** with the firmware's **AMR WIFI** line. A router reservation can avoid address changes.
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

The receiver disables Wi-Fi modem sleep with `WiFi.setSleep(false)` before connecting, to reduce hotspot packet delays. This increases radio power consumption; use new current measurements when estimating runtime. Installing this change requires uploading the updated sketch while retaining the existing private settings and route key. The laptop application, feedback freshness checks and motor-command deadlines are unchanged. Keep other robot controller pages closed and measure response timing after the upload; successful compilation alone does not establish a reliable physical link.

**Local Routes r2** also repairs HTTP recovery after a Wi-Fi interruption. The previous firmware set a `webServerStarted` flag once and never rebuilt the receiver after reconnection. The replacement waits for an IP address, closes the previous client and listener on disconnect/lost-IP/station-stop events, and opens a new listener after reconnection, including when the IP stays the same. A failed listen is retried once per second. Event callbacks only record state; the main loop owns HTTP and the motor task owns motor outputs. This follows [Espressif's socket recovery guidance](https://docs.espressif.com/projects/esp-idf/en/release-v5.5/esp32/api-guides/wifi.html#wifi-event-sta-disconnected). It is a confirmed recovery gap in the code, not proof that it caused every observed laptop timeout.

To update an existing installation, replace `amr_wireless_app.h` and `amr_route_control.h` in the current sketch folder with the copies from the updated kit, retain `private_amr_settings.h`, and upload `AMR01_Local_Routes.ino`. Serial Monitor at **115200** identifies **Local Routes r2**. Its `AMR WIFI` line reports the current IP, signal strength, disconnect count/reason and HTTP listener state; the `AMR NET` line reports actual H1 replies. Reconnection retires the previous route identity even if both Wi-Fi events occur between motor ticks. It never resumes a route or changes the existing freshness, command lease, PWM or battery limits.

Verify on the actual board with LocalTwin and other controller pages closed: confirm repeated HTTP 200 responses, briefly interrupt and restore the hotspot while the robot is stationary, then confirm the new HTTP-start count and successful requests at the current IP. A successful native test or ESP32 build does not replace this physical reconnect check. The same ESP32 HTTP receiver serves the manual page and camera-route endpoints; there is no extra cloud command server.

## 3. Start the laptop workspace

For a Windows executable, open this repository's **Actions → Build Windows AMR camera toolkit**, choose a successful build of the current source, download **AMR01-Windows-Camera-Toolkit** and extract it. The artifact contains `AMR01_LocalTwin.exe`, the camera setup utility and the older MQTT camera agent. Use **AMR01_LocalTwin.exe** for this workflow. An executable is available only after its Windows build succeeds.

Run from PowerShell in the extracted folder:

```powershell
.\AMR01_LocalTwin.exe
```

The console and **ESP32 feedback** card display the configured target. If a future hotspot change assigns another address, this executable accepts `--device-ip` followed by the private IPv4 address from Serial Monitor, without a rebuild. Both signed feedback requests and commands use that address, and the local workspace's manual-control link follows it. The separate cloud dashboard's embedded manual controller retains its documented default address. Address selection never connects or authorizes movement by itself; there is no subnet scan or automatic command retry.

Enter the route key in the console's hidden prompt. It must match the ESP32's `AMR_ROUTE_KEY`. The prompt accepts the 64-character value, the value in double quotes, or the complete `#define AMR_ROUTE_KEY "..."` line. An invalid paste shows a brief explanation and asks again; it does not close the app or print the pasted text. Press Ctrl+C to cancel before connecting anything. Uppercase or altered key characters are rejected rather than silently changed. The optional environment variable is named `AMR_DRIVE_KEY`; an invalid configured value reports a clean startup error. A command-line key argument is deliberately not provided. Keep the console open while using the workspace.

The local page opens at `http://127.0.0.1:8765/`. In the digital twin, open **Drive & review → Camera routes** to use it inside the dashboard. Allow local-network access if the browser requests it. If embedding is blocked, use the local page in its own tab on the same laptop.

Starting the program does not connect the camera or command the robot. Use **Connect local session** when ready. If the built-in webcam is camera 0, start with `--camera 1` to select the Logitech device.

The local app allows **250 ms per blocking socket operation**. In an isolated hotspot check, all five hardware requests returned HTTP 200, but three TCP handshakes exceeded the previous 150 ms limit; the slowest handshake was 185 ms and the slowest complete response was 308 ms. The socket timeout is not a total-request deadline. Signed feedback must still pass its **500 ms freshness check**, and the ESP32 still expires motor commands after at most **500 ms**. Failed commands are never automatically retried. Install the updated Windows executable for this timeout change; it does not require another firmware upload.

The **ESP32 feedback** card keeps the current connection error visible even after attended control ends. Expired feedback is reported before missing camera calibration so that a setup message cannot imply that the link is ready. A successful HTTP request alone does not establish authenticated readiness, calibration or reliable motion; check the fresh feedback card after restarting the app.

To run from source instead:

```powershell
python -m pip install -r backend_streamlit_and_telemetry/vision_control/requirements-vision.txt
python amr01_local_twin.py
```

Optional startup arguments are `--device-ip`, `--camera`, `--config`, `--background`, `--state-dir` and `--no-browser`. For an existing measured camera profile:

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

## 5. Configure stations and run a mission

1. Restore the robot to the floor, keep all markers visible and wait for fresh camera and receiver readiness.
2. Enter the physically measured **robot-centre stopping coordinates** for stations A, B, C, D and E in the local station setup. Keep their centres more than 30 mm apart so arrival zones do not overlap. Confirm the measurements and save them. The map belongs to the current camera calibration. Printed label centres near the paper edges are not automatically reachable stopping points.
3. Select **Start** and **Destination** from A–E. The selected start must match the observed robot position within 15 mm. This selection never sets the camera pose or moves the robot.
4. Preview the mission. Check the path, current robot position, obstacles, destination and battery recommendation. Enter a decision reason, then approve the displayed route.
5. Keep the local workspace visible during movement. The robot follows the approved path over direct Wi-Fi. Arrival is confirmed using fresh ArUco observations and stopped motor feedback.

If a new obstacle appears, the current route stops. Once the camera scene is valid and stable and signed motor feedback confirms the stop, the service proposes a fresh route to the same active destination. **Approve** authorizes that detour. **Reject / Stop** leaves the robot stationary. **Return to start** previews a new path to the actual position captured at the start of the mission; approve that path before movement. Return does not reverse the old wheel commands or assume the earlier path is still clear.

At **6.7–7.0 V inclusive**, the mission pauses for a battery decision. **Continue to the active target** authorizes continuation only with current safe evidence. **Go to battery station E** produces a new route preview to the measured E stopping point; movement requires approval. **Stop** leaves the robot stationary. Below **6.7 V**, no mission continuation or return is permitted. The configured hardware cutoff remains active and a stricter cutoff always wins. These are voltage policy thresholds, not a claim about state of charge or remaining runtime.

A battery choice cannot approve an obstructed route. Approval of an E route includes the displayed battery decision for that route; it cannot override the lower voltage stop. Losing the camera, receiver, operator session or calibrated geometry requires fresh setup and review. Reconnecting or restarting never resumes an earlier mission automatically.

See [station missions and decision rules](local_station_missions.md) for the transition table and execution evidence. The local SQLite audit retains mission and route decisions.

For manual recovery, stop the route first, then use the embedded direct Wi-Fi controller or `http://10.55.54.112/`. A manual stop cancels route ownership; resuming route motion requires another approval.

## If movement remains disabled

| Observation | Check |
| --- | --- |
| Dashboard cannot open the local workspace | Keep `AMR01_LocalTwin.exe` running on this laptop; open `http://127.0.0.1:8765/` directly and check local-network browser permission. |
| Manual page works, route endpoint is missing | Upload `AMR01_Local_Routes`; the old manual-only HTTP interface is insufficient. |
| ESP32 appears on the hotspot but HTTP requests time out | Check the laptop's network and current robot IP, then inspect `AMR WIFI` and `AMR NET` in Serial Monitor. Firmware r2 rebuilds the HTTP receiver after a Wi-Fi interruption; a hotspot device listing alone does not prove HTTP reachability. |
| Receiver authentication fails | The laptop's drive key must exactly match the new firmware's `AMR_ROUTE_KEY`. |
| Receiver never becomes ready | Read the reported reason; check startup stillness, sensors, valid clock, battery and local/manual ownership. |
| Camera unavailable | Close other camera applications and select the correct `--camera` index. |
| Calibration is incomplete | Finish the measured profile and its checks; example values are not commissioning evidence. |
| No route or no progress | Check the physical clearances and measured movement range. Do not increase PWM or disable a guard blindly. |
| EMQX is disconnected | Sensor recording may pause. Direct route control has its own local connection and feedback. |

Software checks and executable builds do not establish physical commissioning. Upload, camera calibration, motor checks and an attended route trial are still required on the actual AMR before claiming that this integration has been physically verified.
