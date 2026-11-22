# Webcam-based AMR tracking directly inside Streamlit

This is an **experimental, commissioned-only** browser camera source for
the existing audited physical route controller. It removes the need to install
a Windows Python agent during normal use, but **does not** remove geometry,
motor, network-delay or emergency-stop validation.

## On-screen workflow

1. Open the Streamlit dashboard in **Chrome on the Logitech camera laptop**.
2. Select **Logitech camera tracking (browser)** in the Streamlit sidebar.
3. Stop the older **Physical AMR > Setup > Show Logitech camera** USB preview
   and close Windows Camera; no other app can hold the webcam.
4. Press **START** in the WebRTC panel. Allow camera access and select the
   Logitech USB device. Server-side OpenCV overlays detected ArUco IDs 0–4.
5. To calibrate the lens, present a 9 × 6 **inner-corner** 25 mm checkerboard
   at **20 different tilts and placements**. Press **Capture checkerboard view**
   for each, then **Calculate lens calibration (20 views)**. The server refuses
   RMS reprojection above 1 px; independently validate ruler measurements.
6. To capture an empty floor, remove robot ID 0 and any temporary obstacles,
   leaving reference IDs 1–4 visible. Press **Capture empty floor**. Reposition
   robot ID 0 after confirmation.
7. Use **Download physical commissioning template**, record the actual X/Y
   centre of each reference marker relative to the 760 × 560 mm floor origin,
   verify the forward marker axis, camera height (1300 mm), marker height,
   floor measurements, motor PWM/speed/polarity, physical stopping distance
   and obstacle envelope. Set individual check flags true **only after
   physical tests**. Do not include any private MQTT credentials in the file.
8. Upload that private measured JSON in the panel and press **Verify and
   enable metric tracking**. The server checks saved camera intrinsics,
   background, reference marker order and reprojection errors and refuses
   uncommissioned measurements.
9. For physical motor control, use distinct website / browser vision /
   ESP32 protected MQTT credentials and HMAC keys in Streamlit **secrets**.
   The active vision route service also requires a dedicated restricted
   PostgreSQL route-audit identity, configured and tested independently.
   Configure `vision_browser.enabled=true` and
   `vision_browser.transport_latency_verified=true` only after measurement
   of end-to-end frame age, frame-gap tails, TLS broker round-trip, remote
   motor stopping and current reserve clearance on the actual network.
   The server uses strict frame TTLs, rejects frame jumps and stops on
   tracking or network loss. A view-only WebRTC connection does not cause
   motion.
10. Select **Physical AMR** in the dashboard and unlock the operator
    session. Only after ALL commissioning prerequisites are proven may
    **Connect protected camera-to-EMQX mission controller** be enabled.
11. Select rack start and destination, verify robot centre against measured
    station coordinates, calculate a collision-checked route and separately
    **Approve & run**. If the obstacle map changes, route execution stops.
    Replanning requires a new collision-checked and audited approval.

## Safety and operational limitations

**A live webcam frame does not prove capture-to-motor latency.** The server
can time its own received frames, but not the complete camera exposure →
browser → ICE/TURN → Streamlit process → MQTT broker → motor path
without additional instrumentation. Verify the actual latency distribution,
not only average frame rate. Headless cloud hosting, TURN fallback, browser
background throttling, device sleep, or unstable connections may make this
architecture unsuitable for physical real-time motion. No unattended drive
or obstacle avoidance is allowed without appropriate engineered physical
safety measures and accessible emergency motor-power stop.

For a real dynamic obstacle, the current controller stops on map change.
It does NOT silently reroute around a new obstacle. A fresh safe route must
be proposed and separately approved. Station E similarly requires measured
coordinates and a new approved route. The robot's hardware-critical battery
cutoff is never overridden by an operator advisory decision.

The WebRTC STUN server in the default configuration does not guarantee that
the cloud browser connection will establish on every network. A dedicated
TURN service may be required in restricted networks.

The original Windows executable camera agent remains available as a
commissioned fallback when reliable remote browser-to-cloud latency cannot
be established.
