# Direct Wi-Fi control for AMR-01

The digital twin's **Live AMR mission → Direct Wi-Fi drive** panel embeds the
ESP32's existing local control page at **http://10.15.213.112/**. The address
is fixed in the dashboard; no typing or new firmware upload is required.
Movement commands travel directly from the browser to the ESP32 over the
local network. EMQX continues to carry sensor telemetry.

## Open the controller inside the dashboard

1. Connect the laptop and ESP32 to the same Wi-Fi network or phone hotspot.
2. Open **Live AMR mission → Direct Wi-Fi drive → Connect controller**.
3. If Chrome asks for local-network access, allow it for this dashboard.
4. Confirm **Wi-Fi connected** and updating readings inside the embedded
   ESP32 page. Use its direction buttons, Stop and motor-speed slider.

The installed `AMR01-Wireless-H1-r3` firmware serves this page. The dashboard
loads it only after selecting Connect controller. A frame loading does not
prove a successful connection; the status inside the ESP32 page is authoritative.
The parent dashboard does not read cross-origin device responses or send
motor commands itself, so no firmware CORS changes are needed.

Current Chrome versions support local HTTP frames from HTTPS sites through
[Local Network Access permission](https://developer.chrome.com/blog/local-network-access).
If embedding is blocked or the frame stays blank, check that permission and
select **Reload controller**, or use **Open separately**. Do not disable
browser security protections. The separate-page fallback uses the same saved IP.

A hotspot can assign a different address after reconnecting. If the ESP32
moves, update `DIRECT_CONTROLLER_URL` and the displayed address in
`frontend_warehouse_dashboard/browser_modules/vision_routing/manual_motor_control.js`.
This dashboard setting does not reserve an address in the hotspot's DHCP server.

## Driving and leaving the panel

Check the controller's live voltage and motor-power setting before moving.
Keep the robot in view, support its wheels clear for an initial check, and
use the previously verified setting for that physical setup. Release the
button to stop and verify that the wheels stop. Stop testing if the measured
pack falls below 6.60 V or the motors stall.

The installed local firmware has a 700 ms command timeout and a reversal
interlock. It does not inherit the cloud receiver's gyro/readiness checks,
remote PWM cap or low-voltage gate. The operator must inspect the live
readings; the website does not certify actual travel or stopping.

**Close controller**, leaving the drive view, hiding the browser tab, opening
the separate-page fallback, and page teardown remove the embedded browsing
context and its command-renewal timers. The ESP32 timeout still applies after
the last command it accepts. Returning to the panel requires Connect controller
again and never automatically resumes a hold. Regular sensor refreshes leave
the active embedded page intact.

## Separation from the cloud command path

The Streamlit drive panel does not start the MQTT manual coordinator or
accept cloud hold/login events. It cancels this session's old cloud hold and
clears that manual authorization. The sensor recorder and EMQX telemetry
configuration remain available.

Camera-guided route execution remains a separate workflow with its existing
commissioning and transport requirements. This panel is for attended manual
driving. The ESP32 page uses its own `/cmd`, `/speed` and `/status` endpoints;
the cloud server does not proxy them.

Do not expose or port-forward the local HTTP controller to the Internet.
Use a trusted local network.
