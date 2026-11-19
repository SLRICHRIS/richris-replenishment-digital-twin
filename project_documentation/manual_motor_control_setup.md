# Drive AMR-01 from the digital twin

Open **Vision routing → Drive control**, connect once with your existing alias
and access code, then hold a direction button to drive. Release to stop. Arrow
keys and W A S D work when focus is inside the drive pad; typing in a form or
using navigation keys elsewhere never starts driving. Stop, Escape, leaving
the page, lost feedback and lost held input end the hold. A new press is needed
after cancellation. There are no per-move review forms or approval reasons.

The speed slider sets PWM motor power, not distance or calibrated speed. The
updated manual receiver supports 0–255. Forward/backward drive both wheels;
Left drives the right wheel forward and Right drives the left wheel forward,
matching the supplied sketch's one-wheel turns. The ESP32 retains its reversal
interlock and local command expiry. Keep the vehicle in view.

## Update the receiver once

Use the supplied private `AMR01_Hold_Drive.ino` in Arduino IDE, allow creation
of its matching folder, select the ESP32 board/USB port and upload. It contains
the existing private Wi-Fi, telemetry and receiver settings. Keep it private.
The public source uses `esp32_wifi_and_mqtt_settings.h` beside the sketch, with
placeholders in `example_esp32_wifi_and_mqtt_settings.h`.

The existing EMQX users, exact-topic ACLs, signing key, Streamlit secrets and
restricted Neon audit login remain unchanged. The website publishes only
`robot/amr01/vision/drive` and subscribes to
`robot/amr01/vision/hardware`; the receiver has the opposite permissions.
Commands are not retained. Telemetry continues independently on the existing
commissioning topic. There is no new database migration or privilege grant.

The receiver advertises its PWM capability in a signed H2 heartbeat. Existing
H1 receivers remain limited to PWM 160 and retain their older IMU/startup
readiness requirements until updated. The new manual receiver needs working
PWM, fresh INA219 battery feedback at or above the existing 6.6 V remote
cutoff, MQTT/time connectivity and no competing local Serial drive. IMU
calibration, camera calibration, SOC and forecasts do not gate human-held
manual driving. Camera-guided routes retain their separate guards.

The saved encoder calibration is 20 counted pulses per wheel revolution.
Serial F/B/L/R commands in the updated sketch expire after 700 ms and must
be refreshed to continue. Serial S always overrides remote drive.

## Use the controls

1. Keep the ESP32 online and open **Vision routing → Drive control**.
2. Select the physical source if prompted, then connect with your existing
   operator alias and access code. Authentication is once per operator session.
3. Wait for fresh signed controller feedback and zero outputs. Choose motor
   power, then press and hold Forward, Backward, Left or Right. A slider value
   of zero stops and does not automatically resume when increased.
4. Release, press Stop, or press Escape to end the hold. Observe the AMR:
   reported GPIO/PWM output does not prove travel, stopping distance or arrival.

The visible metrics show controller voltage/output and the existing sensor
feed's current and encoder totals. Connection details distinguish the command
receiver from ordinary commissioning telemetry. A connected sensor feed alone
does not establish the separate authenticated motor receiver connection.

## Lease and ownership behavior

The browser sends held intent every 200 ms with a unique hold ID, increasing
input number and a timestamp aligned to the server clock. Old inputs cannot
renew a hold. The server records the explicit held intent before sending a
zero-output ARM. During that human hold, bounded zero-output keepalives can
maintain arming while its acknowledgement is in flight. Nonzero drive starts
only after the ESP32 reports the matching armed route with zero output.

Held input has a 700 ms source-time lease. Each signed ESP32 packet has at most
500 ms validity and cannot extend past that held-input deadline. A server
page-presence touch does not renew human input. Fresh hardware feedback is
required throughout. Release uses a command sequence newer than every drive;
delayed old inputs, controller reconnects and coordinator restarts cannot
recreate an ended hold. There is no automatic re-arm after expiry or loss.
Clock tolerance remains bounded by the existing protocol checks.

Manual and camera coordinators share the existing PostgreSQL advisory lock.
The restricted audit role can select/insert/update route-review records and
cannot delete, truncate or inherit broad privileges. The database records
start, setting changes, release and outcomes; MQTT carries the expiring motor
packets. The shared output writer retains inferred encoder signs from applied
motor direction, not measured quadrature direction.

Offline Python, browser and native C++ checks exercise lease/replay behavior,
keyboard scope, pointer release, hidden-page cancellation, full PWM range,
receiver compatibility and reversal/expiry behavior. CI compiles the paired
sketch on ESP32 Arduino cores 2.0.17 and 3.3.12. Physical movement is not
automatically tested or requested by deployment.
