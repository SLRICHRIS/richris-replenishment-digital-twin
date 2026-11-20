# Enable the AMR-01 protected motor receiver and test E parking

## What changed

The **private firmware-settings examples** now set `AMR_VISION_DRIVE_ENABLED 1`.
That makes the protected motor-receiver capability available **only after the
actual ESP32 has been flashed with a complete, private configuration**. It does
**not** make a GitHub commit or Streamlit refresh remotely alter an existing
ESP32. The sample credentials remain blank, so public example firmware cannot
receive control commands.

The robot's final target **E is a measured stopping point near the charger**.
There is **no autonomous charging/docking hardware**. After a completed journey,
the robot must stop with zero motor duty; charging is connected manually.

## One-time ESP32 provisioning

1. Confirm the physical sketch used by the robot (do not upload another sketch
   without preserving the currently working telemetry, Wi-Fi, sensor and pins).
   The protected camera-guided receiver's canonical implementation is
   `esp32_telemetry_firmware/publish_mh_ir_commissioning/publish_mh_ir_commissioning.ino`.
2. In the **private, git-ignored** file
   `esp32_telemetry_firmware/publish_mh_ir_commissioning/esp32_wifi_and_mqtt_settings.h`,
   keep the existing working Wi-Fi/telemetry settings and set:

```cpp
#define AMR_VISION_DRIVE_ENABLED 1
#define AMR_VISION_DRIVE_KEY "YOUR_OWN_64_HEX_DRIVE_KEY"
#define AMR_VISION_MQTT_USERNAME "YOUR_PROTECTED_RECEIVER_USERNAME"
#define AMR_VISION_MQTT_PASSWORD "YOUR_PROTECTED_RECEIVER_PASSWORD"
#define AMR_VISION_MAX_PWM 60
#define AMR_VISION_MIN_PACK_V 6.6
```

   The `60` value is only a **cap** on PWM and must be reduced if testing
   reveals the motor, driver or power circuit needs a lower safe limit; it is
   not a measured minimum drive duty. The `6.6` V two-cell battery cutoff
   also requires confirmation against the installed cells/BMS, including
   behavior under motor load. Never disable undervoltage protection.
3. Upload once in Arduino IDE with wheels raised and a physical power cutoff
   within reach. Normal operation then uses Wi-Fi/EMQX, not a USB connection
   to Streamlit.
4. Confirm a **fresh signed `robot/amr01/vision/hardware` heartbeat**, not
   merely ordinary ESP32 telemetry. The protected MQTT control identity must
   subscribe to `robot/amr01/vision/drive` and publish only the hardware topic.
   Use broker TLS and per-topic permissions.
5. The firmware still refuses remote drive until sensor freshness, motor PWM
   setup, startup readiness, battery voltage, signed drive key, broker link,
   explicit arming, unexpired per-route control messages, and command sequence
   checks pass. Signed commands expire within 500 ms. Serial `S` and the
   physical power switch override a route.

## First movement test in Streamlit

1. Put the AMR on blocks so **both drive wheels are completely off the floor**.
   Keep hands and loose objects away from the wheels.
2. Confirm motors power on without an unintended movement at startup.
3. In Streamlit open **Live AMR mission → Drive control**.
4. Select the physical source, enter the existing private operator access
   credentials, and verify the screen reports a **fresh protected hardware
   heartbeat** and zero motor outputs. Ordinary telemetry is not sufficient.
5. Set motor PWM to a **low value appropriate to the measured motor/driver**.
   Press and hold Forward briefly, release, and confirm both wheels stop.
   Repeat Backward/Left/Right only after the previous motion has ended.
   Use STOP if either wheel moves unexpectedly, polarity is wrong, or the
   output continues after release.
6. Compare reported signed motor output, wheel pulses and camera direction.
   A successful command acknowledgement is **not** evidence that floor
   navigation or obstacle avoidance works. Record wheel polarity, minimum PWM,
   stopping distance and current under load before a floor mission.

## Follow-on camera-guided mission

- Use the measured floor **610 × 630 mm** and the actual Logitech calibration.
  Fixed ArUco reference IDs: 1 upper-left, 2 lower-left, 3 lower-right,
  4 upper-right; robot marker ID 0.
- Configure the measured stopping positions **A, B, C, D and E** in mm.
  E must be a physically reachable stopping spot with sufficient robot
  footprint, latency and stopping clearance; never choose a point on a wall.
- Start with a short, unobstructed attended route, **not** a surprise obstacle.
  Current production coordinator requires operator approval of the initial
  route. New obstacle maps invalidate the authorization; a detour requires
  a fresh verified route and human approval.
- If low battery is advisory, motors stop for an explicit human decision.
  Accepting diversion ends the old route; the operator may approve a new
  route to parking E. Declining diversion resumes the original route
  **only while voltage remains above the critical cutoff**. At critical
  cutoff the ESP32 and controller must stop regardless of decision.

**Important status**: Browser-based WebRTC camera-to-controller integration is
a separate, still-unverified software change. A Logitech preview inside the
Streamlit iframe does not itself send ArUco poses or signed motor commands.
Do not claim that the new settings cause autonomous movement until the actual
ESP32 is flashed, camera/marker geometry commissioned, and motor/obstacle tests
pass.
