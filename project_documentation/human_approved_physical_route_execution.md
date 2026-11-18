# Human-approved physical AMR route execution

The physical execution path is implemented separately from the browser rehearsal:
**USB camera → Windows camera controller → website review → human Approve & run →
local route follower → protected EMQX motor topic → ESP32 → TB6612 → wheels.**
Fresh camera observations verify arrival. An MQTT publish or ESP32 acknowledgement
alone never means the destination was reached. The existing sensor ingestion,
publisher permissions, calibration/model readiness and HTTP forwarding stay separate.

The published interface starts with execution disabled. This repository does not
claim that uploaded firmware, camera calibration, broker access or a physical
journey has already been commissioned. No production movement or invented telemetry
is sent by the software tests.

## Website workflow

Open **Vision routing → Physical AMR**. Follow the numbered stages:

1. **Setup:** record full body length, width and height, marker height/edge and camera measurements. These browser values are planning drafts. The camera controller must load separately verified physical calibration.
2. **Connect:** check the physical source, operator session, fresh calibrated camera scene and ESP32 receiver heartbeat. Expand connection details for missing configuration. Approval records use the private backend connection; there is no separate log login. The operator code still protects physical control.
3. **Plan:** choose a destination on the trusted live map or enter X/Y coordinates. The camera supplies the start. Calculate a server-owned route without moving the robot.
4. **Approve:** inspect the path, distance, protected radius, destination and expiry. Enter a decision reason, then approve and run, reject or hold. A changed destination needs a new proposal.
5. **Run:** observe controller state, camera freshness, reported motor output and arrival verification. Stop remains available during an active journey. No acknowledgement alone is labelled arrival.

**Practice** has a separate drawn map and local rehearsal decisions. Switching to it releases the physical presence grant. Returning to Physical AMR stops any browser USB preview so the laptop controller can own the camera. Practice measurements never replace the controller's trusted geometry. Leaving the page also ends presence authorization.

## Hardware retained

| Function | Connection |
| --- | --- |
| Left motor | PWMA 25, AIN1 26, AIN2 27 |
| Right motor | PWMB 14, BIN1 32, BIN2 33 |
| Driver standby | GPIO 13 |
| Left / right unsigned pulse sensor | GPIO 18 / 19 |
| IMU + INA219 I2C | SDA 21, SCL 22 |
| Motor supply | 2S battery → INA219 VIN+ → VIN− → TB6612 VM |
| ESP32 supply | Battery → verified 5 V buck → ESP32 VIN/5V |
| Logic supply / reference | 3.3 V, common ground |

The motor rail can reach 8.4 V. Confirm actual motor voltage and stall-current
ratings, driver thermal limits and INA219 shunt calibration before commissioning.
The INA219 measures the motor branch; it does not measure the ESP32/buck branch.
Single-channel wheel counts remain unsigned. Camera pose controls this route;
commanded direction is never relabelled measured encoder direction.
Wheel diameter was corrected to 65 mm on 19 November 2026; track 100 mm and
operator-reported 20 pulses/turn remain unchanged. The public firmware template still requires confirmation of
its pulse settings; use 20 only after checking actual counted falling edges.

## 1. Prepare the measured camera scene

Use a fixed overhead USB camera and a flat **425 × 630 mm portrait** floor.
The reported overhead USB camera height is **920 mm (92 cm)**.
On 19 November 2026 the operator supplied the full robot dimensions:
**180 mm length × 150 mm width × 150 mm height**, including its platform and
protrusions. These values prefill the shared planning form and the example
camera configuration. Saved browser edits are preserved; previously blank
dimensions receive these reported values. The operator separately confirmed the
printed marker surface at **150 mm above the floor**, and this value also prefills
the form and example configuration. The provided robot marker is ID 0 with a
**40 × 40 mm black square**, now recorded as a 40 mm edge in both setups.
The operator confirmed **A = 10 cm (100 mm) forward** from the drive-wheel axle
midpoint and **B = 0 mm sideways**. This robot-to-marker position is recorded in
the setup summary, planning export and `reported_marker_offset_robot_frame_mm`.
The camera's `marker_center_to_robot_center_mm` is the reverse displacement in
the printed marker's coordinate frame, so it remains unset until forward
alignment is verified. If printed marker +Y is verified to point robot-forward,
the reverse displacement is `[0, -100]` mm with zero angular offset. Do not infer
that alignment from the mounting distances alone. During mounting verification,
also check the full body envelope about the chosen axle reference; body dimensions
alone do not establish that the axle lies at the geometric body centre.
Every physical calibration check remains false until independently commissioned.

The Windows laptop must remain powered, connected to the camera, Wi-Fi and EMQX
throughout the journey. A cloud website cannot directly open a USB camera plugged
into another computer. Close the website's local USB preview before starting the
Python controller so both programs do not compete for the camera.

From the extracted repository folder in PowerShell:

```powershell
py -m venv .venv-vision
.\.venv-vision\Scripts\Activate.ps1
python -m pip install -r backend_streamlit_and_telemetry/vision_control/requirements-vision.txt
python -m backend_streamlit_and_telemetry.vision_control.setup_camera markers --robot-edge-mm 40 --output runtime/aruco-markers.html
```

The supplied AMR-01 robot marker uses a 40 mm black edge. Print at 100% actual
size and verify print scale during camera commissioning. Floor markers are DICT_4X4_50 IDs 1–4,
30 mm black edge. Their **centres**, in millimetres from the floor's bottom-left,
are:

| ID | X | Y |
| --- | ---: | ---: |
| 1 | 40 | 40 |
| 2 | 385 | 40 |
| 3 | 385 | 590 |
| 4 | 40 | 590 |

Each printed marker's top points toward +Y. Robot marker ID 0 must be fixed flat,
fully visible on top of the robot. Measure its height above the floor, black edge,
centre offset to the robot's rotation centre, and the angular offset from printed
marker +Y to robot forward. Measure full body length, width and height, including
protrusions. These are not wheel spacing or wheel diameter.

Calibrate the camera with a flat checkerboard of **9 × 6 inner corners** and 25 mm
squares; capture at least 20 genuinely different positions/tilts across the image.
Keep the resolution fixed thereafter:

```powershell
python -m backend_streamlit_and_telemetry.vision_control.setup_camera intrinsics --camera 0 --width 1280 --height 720 --output camera_intrinsics.json
python -m backend_streamlit_and_telemetry.vision_control.setup_camera background --camera 0 --width 1280 --height 720 --output empty_floor.png
Copy-Item backend_streamlit_and_telemetry/vision_control/example_camera_config.json camera_private_config.json
```

For the background, expose all four floor markers and remove the robot and every
obstacle. Do not recapture the background with an obstacle present. Copy measured
intrinsics into the private camera config. Enter the measured mounting geometry,
maximum possible obstacle height and conservative localisation uncertainty.
Validate ruler distances throughout the floor, marker occlusion, camera movement,
lighting changes and obstacle detection. All four reference markers are required
in every executing frame. The tracker intersects marker rays with the measured
horizontal marker plane; it does not infer reliable marker height from a tiny
square. The capture thread continuously drains the USB driver and discards old frames so inference cannot build a camera backlog. Validate actual exposure-to-command latency on the real camera. Background differences detect foreground obstacles, with a conservative
height/parallax envelope. It is a controlled laboratory detector, not a certified
collision safety system. Occluded or visually indistinguishable obstacles remain
a physical validation limit. Maintain operator supervision and access to power.

Measure low-speed wheel PWM gains and physical wheel polarities, stopping distance
and appropriate maximum PWM under the actual load. Enter measured values instead
of copying another robot's calibration. Start with wheels raised and attended local
serial commands. The private config refuses missing measurements and false checks.
Its speed cap must cover the maximum speed at the selected PWM cap on both wheels.
The route reserves the body diagonal, clearance, uncertainty, tracking allowance,
measured stopping distance and the worst 3.8-second presence/grant/drive reaction
envelope (2.5 s website presence grace + 0.8 s approval grant + 0.5 s motor lease). The measured paper may be too small
for some full-body measurements; then the planner correctly reports no valid route.

## 2. Provision separate, least-privilege MQTT identities

Keep the existing `publisher-amr01` account and commissioning topic untouched.
Create three new identities on the existing Serverless deployment, without changing
plan, spend limit, HTTP integrations or restarting the broker:

| Identity | Publish only | Subscribe only |
| --- | --- | --- |
| Website route coordinator | `robot/amr01/vision/request` | `robot/amr01/vision/scene`, `robot/amr01/vision/status` |
| Windows camera controller | `robot/amr01/vision/scene`, `robot/amr01/vision/status`, `robot/amr01/vision/drive` | `robot/amr01/vision/request`, `robot/amr01/vision/hardware` |
| ESP32 vision receiver | `robot/amr01/vision/hardware` | `robot/amr01/vision/drive` |

Deny other topics. Use TLS port 8883 with certificate verification. Use exact topic
permissions, not a wildcard control grant. All control messages are QoS 0 and
nonretained. Existing publisher credentials are used by the original telemetry
client; the firmware's independent protected client uses the new receiver identity.

Generate **two different new** signing keys privately with `secrets.token_hex(32)`.
Use 64 lowercase hexadecimal characters as ASCII key bytes. The control key is
shared by website and camera controller; the drive key by camera controller and
ESP32. Never reuse or expose the HTTP ingestion bearer token. Do not place keys,
passwords or private camera configuration in GitHub, screenshots or browser storage.

## 3. Upload the ESP32 receiver

Use the updated [Arduino import ZIP](../esp32_telemetry_firmware/downloads/AMR01_Arduino_Cloud_Import.zip)
or the canonical [sketch](../esp32_telemetry_firmware/publish_mh_ir_commissioning/publish_mh_ir_commissioning.ino).
It now needs four headers, including `vision_drive_guard.h`. Keep your existing
private Wi-Fi, telemetry MQTT credentials, CA and wiring settings. In the private
`esp32_wifi_and_mqtt_settings.h`, add:

```cpp
#define AMR_VISION_DRIVE_ENABLED 1
#define AMR_VISION_DRIVE_KEY "YOUR_NEW_PRIVATE_64_HEX_DRIVE_KEY"
#define AMR_VISION_MQTT_USERNAME "YOUR_PROTECTED_RECEIVER_USERNAME"
#define AMR_VISION_MQTT_PASSWORD "YOUR_PROTECTED_RECEIVER_PASSWORD"
#define AMR_VISION_MAX_PWM 60
#define AMR_VISION_MIN_PACK_V 6.6
```

`60` and `6.6` are conservative template settings, not a measured motor rating or
battery BMS. Confirm appropriate limits and make the camera config's PWM cap no
larger than the receiver cap. On old private headers without these settings, remote
control stays disabled. Keep the robot stationary during startup gyro collection.
Do not power an unverified ESP32 simultaneously through USB and the buck supply.

The ESP32 validates HMAC, boot nonce, per-connection epoch, sequence, route identity,
PWM limits and command time. Arming always starts at zero output. Commands expire
within 500 ms; the motor loop enforces the deadline independently of networking.
A reversal introduces a 150 ms zero-output interlock. Sensor loss, low motor-branch
voltage, Wi-Fi/control-client loss or serial **S** ends the remote route. Expired,
ended or locally stopped routes cannot resume on a late drive packet. A new route
requires another explicit approval. The physical power switch remains the direct
stop when software cannot be relied on.

## 4. Configure website review and audit

Apply [route_audit.sql](../backend_streamlit_and_telemetry/vision_control/route_audit.sql)
with the Neon owner as one atomic statement. It creates the audit table, removes
inherited sensor-reader/worker grants from that table and provisions
`amr_route_coordinator` with SELECT, INSERT and UPDATE only. A newly created role
has **NOLOGIN**, so provisioning creates no usable login or password and does not
enable movement. The owner activates a private login when ready for commissioning
and stores its direct PostgreSQL URL privately in Streamlit. The runtime rejects
owner or broad audit credentials (including DELETE/TRUNCATE privileges).
Do not put the owner URL or public sensor-reader URL into this control profile.
Other sensor-table permissions are unchanged. Runtime never creates tables. Put the
private configuration into Streamlit secrets:

```toml
[vision_control]
enabled = true
commissioned = false
mqtt_host = "YOUR_EXISTING_EMQX_HOST"
mqtt_username = "YOUR_WEBSITE_ROUTE_USERNAME"
mqtt_password = "YOUR_PRIVATE_PASSWORD"
control_key = "YOUR_NEW_PRIVATE_64_HEX_CONTROL_KEY"
audit_url = "postgresql+psycopg://YOUR_ROUTE_ROLE:YOUR_PASSWORD@DIRECT_NEON_HOST/amr_twin?sslmode=require"
```

Reuse the existing private `[amr_connection].access_code` (at least 12 characters).
Set `commissioned=true` only after the attended camera/motor bench checks, when ready for the first supervised route validation.
This gate does not set the six sensor-model calibration flags or enable battery SOC
and runtime predictions. Vision execution uses its own measured camera/motor
configuration. Route evidence and the operator's reason are committed before
sending. One PostgreSQL advisory lease owns the robot across website sessions.
A service restart marks unfinished requests uncertain and never replays movement.

## 5. Run the USB-camera controller and approve a route

Set private environment variables in your local session using your normal private
secret-entry method: `AMR_MQTT_HOST`, `AMR_MQTT_USERNAME`, `AMR_MQTT_PASSWORD`,
`AMR_CONTROL_KEY`, `AMR_DRIVE_KEY`. Use the camera identity from the permissions table.
No password or key is required in chat. Alternatively, `--interactive` prompts locally with hidden password/key entry. Then run:

```powershell
python -m backend_streamlit_and_telemetry.vision_control.desktop_agent --config camera_private_config.json --background empty_floor.png --camera 0 --interactive
```

Restart the ESP32 when restarting a camera-controller session so the receiver
creates a fresh epoch/sequence context. Do not run two camera controllers on one
robot. In the website select **Physical sensor**, open **Vision routing**, unlock
with an operator alias/code, select destination X/Y, then **Capture physical route**.
The robot's start and obstacles come only from signed camera observations. The
manual drawing/rehearsal below it cannot authorize motor output.

Review the server-generated route. Record a reason and choose **Approve & run**,
**Reject** or **Hold**. Approval starts the local follower; reject/hold send no
movement. The page distinguishes sent, arming, running, stopping and verified.
Keep the route page visible and open. Lock, leave, hide, lose the operator session,
press **Stop route** or interrupt the camera controller to end the grant. Stop is
best effort over MQTT, backed by the local lease/watchdog; verify the actual robot
has stopped. The site does not claim a cancelled request is a verified stop.

Loss of fresh camera/hardware evidence, obstacle-map change, path departure,
insufficient clearance, no observed progress or the 60-second route limit stops
the job and requires a fresh capture/approval. A new obstacle never silently
changes an approved route. Arrival requires at least three distinct camera frames
spanning 300 ms near the destination, stable position and zero acknowledged motor
output, then independent website confirmation from fresh scenes.

## Software checks and commissioning boundary

Offline tests exercise signed messages, replay/epoch rejection, leases, ownership,
source isolation, planner clearance, camera projection, foreground/parallax,
occlusion, camera movement, stop controls and simulated closed-loop arrival.
Native C++ tests exercise the exact firmware guard. CI compiles both receiver
modes against ESP32 cores 2.0.17 and 3.3.12. These are software checks; real wheel
polarity, speed, slip, obstacle visibility, USB latency and stopping distance must
still be measured on the user's robot. Begin with a short attended low-speed
route in a clear floor area and physically validate each stop condition before
normal use.


## Measured-floor revision: 18 November 2026

The reported paper is 63 cm long and 42.5 cm wide, replacing the earlier A0 assumption.
The active coordinate frame is X 0..425 mm and Y 0..630 mm. The reported camera
height is 92 cm.
`example_camera_config.json` now records `floor_width_mm=425`,
`floor_length_mm=630` and `camera_height_mm=920`, with all commissioning checks false.
Do not mark those checks true merely because the dimensions are entered.

Scene contract version 2 explicitly binds the measured floor dimensions. Version 1
and A0-sized signed scenes are rejected. Download the current camera-controller
code before commissioning, update the private floor configuration, place floor
markers at the revised coordinates above and capture a new empty-floor image.
Revalidate the camera geometry. Intrinsics may be reused only when they remain
valid for the same lens, focus and resolution. Old browser A0 maps and proposals
are not restored; the measured-floor browser setup uses a new storage version.
The route planner preserves all footprint and stopping margins on the smaller
paper and reports no route if those margins do not fit.
