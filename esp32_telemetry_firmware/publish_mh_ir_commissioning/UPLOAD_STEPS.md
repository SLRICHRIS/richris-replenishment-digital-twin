# Upload the final multisensor Wi-Fi firmware

Use the classic ESP32 board that matches your TB6612 pin map. This firmware adds Wi-Fi and EMQX to the final supplied motor, MH wheel pulse, MPU6500/MPU6050 and INA219 sketch. Keep all files in this sketch folder together.

1. On the hardware laptop, extract the private package and open `AMR01_Multisensor_WiFi/AMR01_Multisensor_WiFi.ino`. From a public checkout, open `publish_mh_ir_commissioning.ino` and create the ignored private header from the example first.
2. Open `esp32_wifi_and_mqtt_settings.h`. Enter your 2.4 GHz hotspot name in `WIFI_SSID` and its password in `WIFI_PASSWORD`. The owner's private package already contains the EMQX publisher settings and trusted CA. Preserve them.
3. In Arduino IDE, use Arduino-ESP32 3.x. Install **PubSubClient** and **Adafruit INA219** with their Library Manager dependencies. The IMU uses checked Wire register reads; no MPU library is required.
4. Connect the ESP32 by a USB data cable. Select its board, normally ESP32 Dev Module for the supplied classic board, and its COM port. Click Upload. If it stays at Connecting, hold BOOT while the upload starts, then release after writing begins.
5. Open Serial Monitor at **115200 baud**. Keep the robot completely stationary and its wheels clear during the roughly three-second startup bias collection. Reset with EN if needed. Do the first motor checks on a secured stand with a physical motor-power cutoff.
6. Look for **Wi-Fi connected. Waiting for internet clock and EMQX.**, followed by **EMQX connected: commissioning topic only**. If the clock is unavailable, check that the hotspot has working internet. Certificate validation remains enabled.
7. Test local commands **F, B, L, R, S, +, -, Z**. Initial PWM is 160; speed steps are 20. **S stops; Z resets relative gyro yaw. Motion expires after three seconds unless an attended motion/speed command is repeated.** Speed changes cannot start a stopped robot. Direction changes have a 150 ms disabled interval. Sensor startup failures or stale sensor readings disable driving until ready; a stopped request does not resume automatically.

## Existing wiring

| Connection | ESP32 GPIO |
| --- | --- |
| Left PWM / AIN1 / AIN2 | 25 / 26 / 27 |
| Right PWM / BIN1 / BIN2 | 14 / 32 / 33 |
| TB6612 standby | 13 |
| Left / right MH digital output | 18 / 19 |
| Shared IMU + INA219 SDA / SCL | 21 / 22 |

The IMU address defaults to 0x68; WHO_AM_I 0x70 (MPU6500) and 0x68 (MPU6050) are supported. INA219 defaults to address 0x40 and the Adafruit standard 0.1-ohm shunt profile. Confirm actual module wiring, shunt resistance and electrical ranges. The packet contains load-side bus voltage, shunt voltage and their sum at the supply side. Current is in amperes, discharge-positive according to the configurable sign; raw gyroscope values are also sent in degrees/s, with z converted to radians/s.

## What reaches EMQX

The device sends non-retained JSON at approximately two observations per second on `robot/amr01/commissioning`. It contains cumulative **unsigned** wheel pulses, per-sensor sample times, accelerometer/gyro data, gyro bias estimate, relative yaw and battery measurements. Invalid or old channels become JSON null and availability is false. Wi-Fi/TLS and I2C acquisition run in tasks separate from the local motor loop. New samples replace old unsent snapshots; this is not a durable offline recorder.

Keep `PULSE_CALIBRATION_CONFIRMED = false` until measured pulses per wheel revolution are entered. Keep `BATTERY_SOC_INITIALIZATION_CONFIRMED = false` until usable capacity, actual initial charge and current polarity are confirmed. The supplied 2200 mAh and 100% are unconfirmed assumptions, so the default firmware withholds absolute SOC. Measurement gaps invalidate accumulated SOC; gyro yaw gaps require Z to start a new relative yaw segment.

This packet is **not** the signed-encoder `/state` contract. The current production ingester does not store the commissioning topic or drive the six-model physical prediction cards from it. Full wheel pose needs direction-sensing feedback and calibrated integration. No signs are invented from motor commands. This upload does not add an MQTT command receiver or enable website motor control.
