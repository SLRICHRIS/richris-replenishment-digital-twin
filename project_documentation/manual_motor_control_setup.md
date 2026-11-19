# Control the working AMR-01 through the digital twin

The supplied ESP32 sketch publishes sensor readings but only reads movement commands from USB Serial. The new **Vision routing → Manual control** tab adds human-approved, one-shot Wi-Fi motor control. It does not require camera calibration. Camera-guided autonomous routes retain their separate requirements.

Each approval requests one burst at PWM 20–160 (out of 255), lasting at most 250 ms after its server issue time. Network delay and reversal interlocks can shorten it. This is a motor-output request, not a guaranteed travel distance. There is no automatic repeat or queued retry.

## Connect once

1. Open the private `AMR01_Digital_Twin_Control.zip` supplied with this change. It contains an updated copy of the user's exact working sketch, the existing private Wi-Fi and telemetry settings, two **new** MQTT identities, and the matching server signing key. Keep this package private.
2. In the existing EMQX deployment, create the two users and exact-topic ACLs listed in `EMQX_new_manual_users.txt`. Keep the existing telemetry publisher unchanged. The website may publish only `robot/amr01/vision/drive` and subscribe to `robot/amr01/vision/hardware`. The receiver has the opposite permissions. Deny other topics for these identities and do not retain commands.
3. In the existing Neon PostgreSQL database, run `backend_streamlit_and_telemetry/vision_control/route_audit.sql` as the database owner if this table/role has not yet been created. Activate the restricted `amr_route_coordinator` login with a new private password. Use its **direct**, TLS-enabled connection URL with `postgresql+psycopg://`, not the pooler URL or database-owner URL. The restricted role may select/insert/update `amr_route_reviews`; it must not inherit other roles. Do not change the sensor tables or their credentials.
4. In Streamlit app settings → Secrets, append `Streamlit_manual_secrets.toml`. Replace only its audit URL placeholder with that restricted direct URL. Keep the existing `[amr_connection]` section and operator access code. Do not duplicate an existing TOML section. The signing key is private and must match the firmware header.
5. Open `AMR01_Manual_WiFi/AMR01_Manual_WiFi.ino` with its settings header beside it. Install the same ESP32 core, PubSubClient and Adafruit INA219 libraries used by the working code. Upload this updated sketch once. The firmware supports ESP32 Arduino cores 2 and 3. Keep the AMR stationary at startup while its existing gyro bias routine finishes.
6. Keep the ESP32 connected to its configured Wi-Fi with Internet access to TLS MQTT port 8883 and network time. Use a charged 2S pack: remote control requires at least 6.6 V at the INA219 and fresh sensor readings. The example screenshot around 6.5 V would leave remote control unavailable. Local Serial behavior is preserved from the supplied sketch.

## Move from the site

1. Open the [digital twin](https://richris-replenishment-digital-twin-s99b4letmnfusbbh6sjab9.streamlit.app/) and select **Vision routing → Manual control**.
2. Select **Use physical AMR source** if shown. Enter an operator alias and the access code you already have, then choose **Enable manual control**. Keep this page open.
3. Wait for **ESP32 ready · zero outputs reported**. If switching from camera routing, the previous controller releases its database lease after about five seconds without page presence.
4. Observe the AMR and clear space around it. Select Forward, Backward, Turn left or Turn right, and PWM (default 160, matching the supplied working sketch). Choose **Prepare move for review**.
5. Read the proposal, enter an approval reason and choose **Approve & move once** within ten seconds. One approval sends one burst. Prepare a fresh review for each further move.
6. Wait for the controller's zero-output status and observe the physical AMR. **Stop** sends a stop request for the current burst; local Serial **S** also overrides remote control. MCU expiry remains active even if the website disconnects. This short-burst panel is not a physical emergency-stop circuit.

## What the feedback means

| Feedback | Evidence |
| --- | --- |
| Approval saved | PostgreSQL committed the human decision before dispatch |
| Burst sent | Server handed one authenticated, expiring packet to MQTT |
| Applied motor outputs | A fresh signed ESP32 heartbeat reports the requested GPIO/PWM state |
| Zero motor outputs | Three fresh signed heartbeats report zero outputs for that command |
| Outcome uncertain | Expected feedback was absent; no repeat is queued |

GPIO/PWM feedback cannot prove wheel rotation, stopping distance or arrival. Camera routes use the calibrated overhead-camera controller for pose and continuous planning. Neon is the hosted PostgreSQL database; it records approvals and outcomes, while expiring MQTT packets carry motor commands.

## Implementation and checks

The new sketch retains the supplied pin mapping, continuous local Serial mode, sensor code, inferred signed encoder diagnostic counts and existing commissioning telemetry. One shared output writer handles local drive, remote drive and zero output, avoiding a stale local-stop cache. Single-channel encoder sign remains inferred from requested motor direction, not measured quadrature direction.

Server checks bind each review to an operator session, current ESP32 boot/connection epoch, fresh ready zero-output feedback and a ten-second review expiry. ARM acknowledgement precedes a single DRIVE packet. HMAC signatures, increasing command numbers, connection epochs and MCU monotonic expiry reject stale/replayed commands. Manual and camera coordinators share one PostgreSQL advisory lock and cannot own the robot simultaneously. Recovery marks interrupted approvals uncertain and never replays them.

Offline Python, DOM and native C++ checks exercise these boundaries. CI compiles the modified single-file sketch on ESP32 Arduino 2.0.17 and 3.3.12. Physical movement still requires the private setup and the updated firmware upload on the user's laptop.

## When the battery is charged but Prepare stays disabled

Open **Connection details** in Manual control. The page reports the website's broker login/subscription state, received/accepted/ignored packet counts, last accepted feedback age and the last authenticated receiver clock difference. These are diagnostic values only; they cannot enable movement.

- **Website login rejected**: check the new website MQTT user's credentials.
- **Feedback subscription rejected**: check its Subscribe Allow rule on `robot/amr01/vision/hardware`, above its Deny fallback.
- **MQTT connected, no receiver packets**: check the ESP32 receiver's separate MQTT connection and its Publish Allow rule for that feedback topic. Ordinary commissioning telemetry alone does not establish this channel.
- **Authentication failed**: check that the private control key matches between ESP32 and website.
- **Clock/freshness rejection**: check ESP32 Internet time synchronisation and network delay. Packet age must remain inside the existing freshness window; the diagnostics do not relax it.
- **Old connection/sequence ignored**: the replay protection rejected that packet. End and re-enable the operator session to collect fresh state before a new review.

A valid packet is still required to report ready zero outputs before Prepare is enabled. The 6.6 V remote cutoff, short command expiry, approval checks and replay protection continue to apply.

If Connection details reports **Waiting for the active manual page** while the operator session is enabled, the server has not yet received an active-page acknowledgement. A validated operator Connect now explicitly selects Manual control, and a visible Manual page reasserts a lost initial view update at a bounded rate. Hidden, practice and departing pages do not renew that state. Page-state messages include the complete selected mode; the sibling page handler does not overwrite it. Versioned control scripts ensure a refresh loads this event-handling update. Motor readiness, fresh signed feedback and explicit per-burst approval remain required.
