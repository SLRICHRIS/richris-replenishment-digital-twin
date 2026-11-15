# Replenish · ESP32 live telemetry

> **Legacy v1 reference — outside the current direct-sensor AMR-01 path.** For the current ESP32 encoder/MPU6050/INA219 system, use [single-AMR commissioning](single_amr_sensor_twin_setup.md). These older UART, browser MQTT, LabVIEW and control interfaces are not prerequisites for the current twin.

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.

This starter connects **one ESP32 board** to the standalone reference viewer’s Sensor models workspace. It publishes measurements only. It does not receive or transmit motor, mission or emergency-stop commands.

## What you need

- One Wi-Fi-capable ESP32 board and its USB cable.
- Arduino IDE with Espressif’s Arduino-ESP32 **3.3.12** board package (the verified reference version), plus Nick O’Leary’s **PubSubClient 2.8** library.
- A private MQTT broker with a trusted TLS certificate, an MQTT TLS listener for the boards, and a **WSS listener for the browser**. These are usually different ports. Use the exact addresses supplied by your broker operator.
- Your network must allow the board to reach the broker and an NTP time server. Both the ESP32 and browser clocks must be accurate to within a few seconds.

The dashboard provides the viewer and firmware, **not a provisioned MQTT broker**. The boards may share one Wi-Fi network; the browser can use any network that can reach the broker. Browser access to a local broker also depends on its trusted certificate and local-network permissions.

## Verified reference build

The sketch compiled and linked successfully on **6 October 2026** with this configuration:

| Component | Verified version / selection |
| --- | --- |
| Arduino CLI | 1.5.1 |
| Espressif Arduino-ESP32 | 3.3.12 |
| PubSubClient | 2.8 |
| Board profile | ESP32 Dev Module · `esp32:esp32:esp32` · default options |

The legacy UART telemetry code was built with test-only configuration values and compiler warnings enabled. It uses approximately **1.00 MB of flash (76%)** and **48 KB of static RAM (14%)** under the reference board profile. These figures do not measure runtime Wi-Fi/TLS memory use.

Compilation does not verify a physical board, sensor wiring, localization or a real broker connection. Select your exact board model before uploading and complete the connection checks below. This kit contains source code; it does not contain preconfigured firmware binaries or credentials.

## 1. Create narrowly scoped broker accounts

The default prefix is `richris/warehouse01`. Use a private namespace and change it consistently in the viewer, firmware and broker access rules.

| Account | Allowed operation | Exact topic |
| --- | --- | --- |
| AMR-01 publisher | Publish only | `richris/warehouse01/amr-01/telemetry` |
| Browser viewer | Subscribe/read only | The AMR-01 topic above |

Give every board a different publisher password. Do not put a broker administrator password into the browser or firmware. Device IDs alone are labels; broker authentication and topic permissions enforce the slot boundaries.

## 2. Configure and flash each board

1. Extract the ZIP. Open `esp32_telemetry_firmware/publish_esp32_robot_telemetry/publish_esp32_robot_telemetry.ino` in Arduino IDE.
2. Copy `example_esp32_wifi_and_mqtt_settings.h` to `esp32_wifi_and_mqtt_settings.h` in the same folder.
3. Enter your Wi-Fi name/password, broker **host**, MQTT **TLS port**, and this board’s publisher credentials.
4. Paste the broker provider’s trusted **root CA certificate** into `BROKER_ROOT_CA`. Certificate verification stays enabled.
5. Set `AMR_SLOT` to **1** only. Other slots have been removed.
6. Select the exact ESP32 board model and its USB port, then compile and upload.
7. Open Serial Monitor at **115200 baud**. Wait for Wi-Fi, time synchronization and “Broker connected”.

`esp32_wifi_and_mqtt_settings.h` contains secrets. Keep it on your own computer; do not commit or upload it. Firmware compilation and physical behavior must be checked against your exact board before use. This starter has no motor tasks; if you incorporate it into existing robot firmware, keep TLS connection work separate from time-critical motor and emergency-stop logic.

## 3. Connect the viewer

1. Open **Sensor models** in the standalone v1 reference viewer. The hosted Python app uses its PostgreSQL reader instead of this browser WSS form.
2. Enter the broker’s complete **WSS URL**, for example `wss://your-broker-host:your-wss-port/mqtt`. This is a placeholder, not a working broker.
3. Enter the read-only viewer username/password and the matching topic prefix.
4. Choose **Connect AMR-01**. “Subscribed” means the broker approved the AMR-01 subscription. It does not mean AMR-01 is online.
5. AMR-01 becomes **Live** only after receiving a fresh, valid packet from its matching device.

The password is held in this tab only, sent to the specified broker, and cleared from the form after connecting. It is not saved in browser storage. Reloading requires reconnecting. This viewer does not keep a durable telemetry history or run while the page is closed.

Each slot shows which measurements are available: **pose, battery, speed and controller state**. Open **Stream diagnostics** for receive cadence, sequence gaps, detected reboots, and the 95th-percentile capture offset. These use up to 60 seconds and 120 accepted packets per slot; the interval plot shows the most recent 30 intervals. Five samples are needed for percentile values.

Capture offset is browser receipt time minus device capture time. It includes clock error and is **not a measured network latency**. Sequence gaps identify skipped sequence numbers; they are **not a measured Wi-Fi packet-loss rate**. Rejected packets never renew freshness. The most recent rejection remains visible in diagnostics even after valid telemetry resumes. The four measurement indicators are highlighted only while their values are fresh.

## 4. Connect your measurements

Configure the measured UART bridge using [controller commissioning](operator_override_channel_and_hardware_commissioning.md). `readMeasurements()` reads its fresh controller cache. The starter reports actual Wi-Fi RSSI, uptime and firmware identity. It deliberately sends `null` for unconfigured sensors.

| Field | Measurement required |
| --- | --- |
| `batteryPct` | Calibrated battery state-of-charge estimate, 0–100% |
| `speedMps` | Measured speed magnitude, 0–10 m/s |
| `xM`, `yM`, `headingDeg` | Calibrated localization from odometry, UWB, tracking or another suitable source |
| `state` | State read from your AMR’s controller |

Wi-Fi signal strength is **not** a position measurement. Battery percentage cannot be inferred reliably from an arbitrary ADC value; connect your battery measurement and calibration first.

The displayed warehouse is an **illustrative reference**, not a surveyed map of your room. In **Plan** view, its inner coordinate origin is at the top-left: +X goes right, +Y goes down. The supported area is X **0–12 m**, Y **0–6.6667 m**. Heading **0°** points along +X and **+90°** along +Y. Transform your localization into this coordinate frame before publishing. Position outside these bounds is rejected rather than clamped.

Use **View on floor** on a slot with a fresh pose, or choose **Live AMRs** on the Floor. Missing or stale poses are hidden. The inspector identifies stale values as last readings. Inventory, simulated missions and forecasts are not interpreted as physical measurements.

## Telemetry contract · version 1

Publish UTF-8 JSON, **QoS 0, retain false**, normally once per second. All shown fields are required; unmeasured sensor fields use JSON `null`.

```json
{
  "v": 1,
  "device_id": "amr-01",
  "boot_id": "a3b428e190acd071",
  "seq": 1,
  "sent_at_ms": 0,
  "uptime_ms": 12345,
  "state": "unknown",
  "battery_pct": null,
  "pose": null,
  "speed_mps": null,
  "wifi_rssi_dbm": -61,
  "firmware": "richris-esp32-1.1.0"
}
```

The example timestamp `0` is deliberately invalid: the board must insert its **current UTC Unix time in milliseconds**. A measured pose is an object such as `{"x_m": 1.2, "y_m": 2.0, "heading_deg": 90}`. Use `null` for the entire pose until all three fields are measured.

- Device IDs are exactly `amr-01` and must match the topic.
- A new random hexadecimal `boot_id` is generated on every reboot. Sequence numbers increase within a boot.
- States: `unknown`, `idle`, `moving`, `paused`, `charging`, `fault`.
- Fresh: up to 5 seconds after capture/receipt. Stale: over 5 and up to 15 seconds. Offline: over 15 seconds, or the broker connection is unavailable.
- Retained, duplicate, out-of-order, oversized, malformed, mismatched and expired packets are rejected. Rejected packets do not renew freshness.
- Updates are best-effort telemetry. Wi-Fi, internet, broker and browser delays vary; this is not a deterministic real-time control channel.

## Troubleshooting

- **No broker connection:** verify the TLS/WSS endpoint, port, credentials, firewall and certificate chain. ESP32 uses the TLS host/port; the browser uses WSS.
- **Subscriptions denied:** grant the viewer read access to the AMR-01 exact topic.
- **Subscribed, but no device:** check the prefix, slot number, publisher permissions and Serial Monitor.
- **Timestamp rejected:** allow NTP access and correct the computer’s clock.
- **Live, but no robot on the floor:** localization has not been measured, calibrated or included yet.
- **Frequent disconnects:** ensure each board uses a unique slot and the firmware’s unique MQTT client ID.

## References and third-party software

- Espressif secure client and CA validation: https://github.com/espressif/arduino-esp32/tree/master/libraries/NetworkClientSecure
- MQTT.js browser transport and reconnect API: https://github.com/mqttjs/MQTT.js
- PubSubClient: https://github.com/knolleary/pubsubclient

MQTT.js is MIT licensed; its license is supplied with the Site. Arduino-ESP32 and PubSubClient retain their respective licenses and are installed separately. The project’s ownership notice applies to its original code, UI and educational content.
