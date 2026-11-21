# Direct Wi-Fi control for AMR-01

The digital twin's **Live AMR mission → Direct Wi-Fi drive** panel opens the
ESP32's own local control page in a separate tab. Movement commands travel
from the operator's browser directly to the ESP32 over the local network.
EMQX continues to carry sensor telemetry to the database and digital twin.

## Open the controller

1. Connect the laptop and ESP32 to the same Wi-Fi network or phone hotspot.
2. Find the ESP32's IPv4 address in the hotspot's connected-device details.
   Use its IP address, not its MAC address or the hotspot gateway.
3. Enter that address in **Direct Wi-Fi drive**, then select **Open ESP32
   controller**. The address is saved only in that browser's local storage.
4. The new tab uses `http://<ESP32-IP>/`. The installed
   `AMR01-Wireless-H1-r3` firmware already serves this dashboard; opening the
   page does not require uploading a different sketch.

The hosted website does not fetch private LAN addresses or embed the HTTP
controller inside its HTTPS page. Opening the controller is a navigation,
not a command to move the robot. If the page does not load, check the current
address and same-network connection. Some hotspots isolate connected clients.

## First movement check

Securely support the robot with its wheels clear of the surface. On the
ESP32 page, verify that voltage readings are updating and the pack is above
6.60 V. Check the local motor-power setting before pressing a direction:
it is separate from the old cloud slider. Start at PWM 40, hold Forward
briefly, then release and confirm that both wheels stop. Use Stop if needed.
The local firmware has a 700 ms command timeout and a reversal interlock.

The local route uses the installed firmware's local controls. It does not
inherit the cloud receiver's gyro/readiness checks or remote PWM cap. The
operator must inspect the local readings before movement; this website
does not certify motor power, battery calibration, actual travel or stopping.

## Separation from the cloud command path

The Streamlit drive panel no longer starts the MQTT manual coordinator or
accepts cloud hold/login events. On reload it cancels this session's existing
cloud hold and clears that manual authorization. The existing sensor recorder
and EMQX telemetry configuration remain available.

Camera-guided route execution is a separate workflow and retains its existing
commissioning and transport requirements. This change applies to attended
manual driving. The local dashboard uses `/cmd`, `/speed` and `/status` on
the ESP32; the digital twin does not proxy these endpoints.

Do not expose or port-forward the local HTTP controller to the Internet.
Use a trusted local network and keep the robot in view during operation.
