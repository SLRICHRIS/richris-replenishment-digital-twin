# AMR-01: three camera-free routes

Open **AMR01_PresetRoutes.exe**, paste the same private `AMR_ROUTE_KEY`, and keep the console open. Close LocalTwin and other motor controller pages first. Open the local page at `http://127.0.0.1:8765` and select **Connect ESP32**. No ESP32 upload or camera calibration is needed for this mode. The current receiver address is `10.55.54.112`; use `--device-ip` if the hotspot assigns a different address.

This is an attended timed-route demonstration. It does not use ArUco, encoders or gyro feedback to steer or locate the robot. It does not detect obstacles. The operator watches the clear floor, presses Stop if necessary, and checks arrival. Starting the app, connecting, selecting a route, or restoring saved measurements never starts movement.

## Fixed layout and front-arrival points

The floor is 760 mm across by 560 mm bottom to top. Origin is the inner bottom-left red-tape corner. X increases right; Y increases up. Body dimensions remain 170 × 155 × 150 mm. Body-centre to front distance is 85 mm. Floor IDs 1–4 identify the same physical layout but are not read in this mode.

| Station | Front point, cm | Required parked direction | Body centre, cm |
|---|---|---|---|
| A | (63, 35) | Right, 0° | (54.5, 35) |
| B | (20.5, 43) | Up, 90° | (20.5, 34.5) |
| E | (29, 7.5) | Down, −90° | (29, 16) |

Before every route, put the robot front at the source point with the stated direction. A route finishes facing the destination direction. Mark these directions on the floor. E is a reference stop where the operator plugs in the charger; there is no automatic docking or charge verification.

| Route | First turn | Straight distance | Final turn |
|---|---|---|---|
| A → B | Right 179.16° | 34.00 cm | Right 90.84° |
| E → A | Left 126.69° | 31.80 cm | Right 36.69° |
| B → E | Right 155.32° | 20.36 cm | Right 24.68° |

These are geometric instructions calculated from measured coordinates, not motor timings inferred from a photo. The straight distance connects body-centre positions; driving the front-point separation would give the wrong endpoint after the final turn.

## Three short measurements, once per physical setup

Use a larger clear floor with the same surface, battery, wheels and load. Keep the robot in view. Choose a test PWM within the installed receiver's unchanged **60 PWM** cap. These tests use opposed wheel outputs for turns; the old manual controller's one-wheel turns are not equivalent measurements.

1. Mark the body-centre position and check the clear-area box. Select **Forward · 1 second**. After signed zero-output feedback, measure the centre's total travel in cm and its extra roll after motor cut-off. Enter both and confirm that it moved forward without slipping. Save. The software subtracts roll from the one-second speed sample and reserves it before the route endpoint.
2. Mark the robot's initial heading with tape. Select **Turn left · 1 second**, measure the actual angle using a protractor, confirm the direction, and save.
3. Repeat for **Turn right · 1 second**. Left and right rates are saved separately, along with each trial PWM.

The firmware's direction reversal interlock is retained. The software estimates motor onset between signed zero-output and moving samples, then times the pulse. HTTP sampling delay, motor acceleration, coasting, slip and battery variation still create error. These trials are an initial empirical timing calibration, not a position guarantee. If a pulse produces no physical movement, do not enter a fabricated reading or increase the receiver limit. Resolve the physical starting-duty issue first.

Measurements are stored in `%USERPROFILE%\.amr-local-twin\preset_measurements.json`. The private key is not stored there. A battery difference greater than 0.35 V from any saved trial requires repeating the trials. Repeat after changes to wheel load, surface, motor setting or geometry. These limits do not establish an accuracy specification.

## Run

Select one route, align its source position/direction, confirm that the floor is clear and attended, then press **Start selected route**. The controller turns, stops, moves forward, stops, aligns the final direction and stops. Every segment uses a new signed arm request; no segment proceeds without fresh feedback and zero outputs between movements. Keep the page visible. Stop or Escape cancels the remaining sequence; hiding/leaving the page cancels it too. Reopening never resumes motion.

After the sequence, inspect the robot's front and heading. Only **I checked the front at the destination** records operator-confirmed arrival. Time elapsed or zero PWM does not verify location. If it misses, reposition at the known source before another attempt. Do not chain routes from an unverified estimate.

The nominal route checks the complete body's circular swept footprint plus 20 mm and measured stopping distance against the taped floor. This is a check of the intended geometry, not live clearance validation. The finite segment deadline bounds commanded travel, and no later segment is authorized after lost attendance. If the measured stopping envelope does not fit, the paper target must move inward or the floor must be enlarged. Camera-mode geometry and evidence checks remain intact for the separate camera controller.

## Receiver and connection behaviour

The application uses the existing authenticated `/api/route/hardware` and `/api/route/command` endpoints. It retains private key authentication, boot/epoch checks, replay rejection, fresh feedback, applied-output checks, 60 PWM cap, firmware reversal interlock and voltage protections. The laptop also refuses motion below 6.7 V. Every command has a maximum 500 ms receiver lease, shortened to the current attendance and motion deadlines. An interrupted control loop, Wi-Fi failure, changed device identity, unexpected motor output or stale feedback cancels the job. No camera measurements or fake observations are sent to bypass the camera controller.

Command timestamps use the last authenticated receiver timestamp plus elapsed laptop time since receipt. This handles a small clock difference that could otherwise allow fresh feedback while rejecting the first arm request with HTTP 409. Reply transit shortens the command lease; it does not extend attendance or motion deadlines. Original signed feedback timestamps still have to pass the existing freshness checks. A 409 can also mean a changed receiver state, so this correction alone does not identify every rejection.

The one-time profile saves measurements only; it does not persist an active route or arming permission. `preset_audit.jsonl` records starts, measurements, stops and explicit operator arrival confirmation. Each interrupted movement also records its reason and the exact feedback available when it stopped, before the Stop request. The page preserves those values separately from subsequent live readings. It distinguishes expired feedback, unavailable battery readings, low voltage and an ESP32 not-ready flag. That flag alone cannot identify which internal firmware interlock changed. A later healthy sample never resumes the job or turns an interrupted pulse into a valid measurement. The camera and preset controllers share a process lock and loopback port, so the two executables cannot own the same default session simultaneously.

The Windows executable and software tests do not establish that a physical route has succeeded. Perform the first attempt with a clear floor and immediate access to Stop.
