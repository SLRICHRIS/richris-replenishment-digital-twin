# AMR-01: the current MH IR controller and the physical twin

The final supplied controller uses two single-channel MH IR inputs on GPIO18/19, a TB6612FNG, an MPU6500/MPU6050 IMU at 0x68 and an INA219 at 0x40 on I2C GPIO21/22. The supplied sketch reads these sensors and accepts local Serial commands but has no Wi-Fi/MQTT. The updated firmware retains that wiring and adds protected telemetry. Pulse counts remain unsigned; motor commands cannot establish actual wheel direction.

Use `esp32_telemetry_firmware/publish_mh_ir_commissioning/` for this wiring. This new sketch preserves the pin map and local commands while publishing unsigned pulse observations, IMU data and battery measurements on a separate commissioning topic. It does not turn the MH sensor into a quadrature encoder or insert incomplete observations into the six-model physical database.

## Wiring retained from the supplied controller

| Signal | GPIO |
| --- | --- |
| Left PWM / AIN1 / AIN2 | 25 / 26 / 27 |
| Right PWM / BIN1 / BIN2 | 14 / 32 / 33 |
| TB6612 standby | 13 |
| Left / right MH digital output | 18 / 19 |
| IMU and INA219 SDA / SCL | 21 / 22 |

These pins target the classic ESP32 Dev Module used by the supplied wiring. Confirm the actual board before assembly. Check that each sensor's output is compatible with 3.3 V ESP32 inputs; powering a comparator board from 5 V may also pull its digital output to 5 V. Arrange a hardware standby pull-down and a physical motor-power cutoff. Initial motor tests belong on a secured stand with the wheels clear.

## What changed in the firmware

- Standby starts LOW. Failed PWM setup leaves the bridge disabled. `+` and `-` change configured speed without arming stopped or expired movement.
- Commands `F/B/L/R/S/+/-/Z` remain local at 115200 baud. Initial PWM is 160 and speed steps are 20, matching the final sketch. Z resets the relative gyro yaw segment. A motion request expires after three seconds without a recognized motion/speed command. Repeat commands to continue an attended test; change the private timeout setting only after assessing the physical behavior.
- Starting movement or changing direction inserts a 150 ms disabled interval. Stop cancels a pending direction change. This software pause is not proof that an actual wheel has stopped.
- GPIO output state and commanded motion are reported separately from physical wheel observations. No motor direction is inferred into the unsigned counters.
- ISR counters remain cumulative within a boot. The existing falling-edge / 2,000 us debounce convention is retained, including wrap-safe subtraction. Half-second reports use actual elapsed time and count differences.
- Pulses/second can be reported immediately. RPM is `null` until the operator confirms measured pulses per wheel revolution. The supplied value `1.0` remains an explicit unconfirmed setting, not an assumed physical calibration.
- Wi-Fi/TLS/MQTT and I2C acquisition run in separate FreeRTOS tasks, outside the local motor loop. Network code never operates the motor GPIO functions, and the local controller loop continues during reconnects. Actual stop latency, reset behavior, power integrity and TLS/network failure behavior still require hardware tests.
- The sketch only publishes. It does not subscribe to MQTT or implement remote motor commands. TLS certificate verification stays enabled; no Wi-Fi or MQTT passwords are printed.

## Commissioning packet and source boundary

| Setting | Value |
| --- | --- |
| Topic | `robot/amr01/commissioning` |
| Format | `schema_version: 1`, `message_type: mh_ir_commissioning` |
| Rate | Approximately two reports/second, with actual `interval_s` and per-sensor timestamps |
| Delivery | Non-retained MQTT QoS 0; bounded latest-sample snapshot, not durable offline replay |
| Actual observations | Unsigned cumulative wheel pulses/rates; accelerometer/gyro; INA219 voltage/current; monotonic observation times |
| Calculated RPM | Magnitude only, conditional on confirmed pulses/revolution |
| Explicit limitations | `direction_measured` and `predictive_models_ready` remain false; gyro/battery availability follows checked readings and freshness |

The [physical recording path](physical_sensor_recording.md) stores this channel through protected EMQX HTTP forwarding in `amr_commissioning_samples` and displays the actual sensor observations on the website. Its schema and forwarding action must be provisioned before records arrive. The signed-model Python worker still subscribes to `robot/amr01/state`; it does not reinterpret unsigned commissioning packets. A native firmware/real-parser regression check verifies that misrouting such a packet to `/state` cannot advance pose, charge or energy.

Do not publish this payload to `/state`, invent missing gyro/current readings, or give pulses a sign based on the last motor command. A wheel can coast, stall, slip, be pushed or reverse independently of that command. At one pulse/revolution, the wheel has only one observation per turn; increasing the reporting frequency does not increase that spatial information.

## Prepare the physical build for all six models

The existing full measured-model path needs direction-sensing feedback on each wheel (for example, properly decoded A/B quadrature). The final supplied build now includes the gyro and INA219; they still require physical calibration, current-polarity and electrical-range checks. The supplied MH inputs can remain useful for unsigned RPM checks, but do not establish signed wheel odometry during reverse or turning.

Before choosing additional encoder pins, preserve the motor pins above. The older direct-sensor example's GPIO25/26 and GPIO32/33 already belong to this motor driver; copying that example's wiring would create conflicts. A final combined motor/sensor pin map must be checked against the actual board and chosen encoders. I2C GPIO21/22 serve the IMU and INA219 in the final sketch; actual module wiring, voltage/current range and noise behavior still require commissioning.

Measure effective counts per wheel revolution, wheel radii, effective track, stationary gyro bias, usable battery capacity, starting SOC, and healthy residual threshold/hold time. Keep `commissioning.measured_calibration_confirmed = false` and forecasts unavailable until those measurements and the sensor feed are verified. The demo values in the secrets template are not measurements.

## Private configuration and first upload

1. Install Arduino-ESP32 3.x, PubSubClient and Adafruit INA219 with its dependencies. Open `publish_mh_ir_commissioning.ino` with its adjacent header in the matching folder.
2. Copy `example_esp32_wifi_and_mqtt_settings.h` to private `esp32_wifi_and_mqtt_settings.h`. Its filename is git-ignored. Enter Wi-Fi SSID/password, EMQX hostname, the dedicated publisher credentials and the broker's trusted CA certificate. The worker and dashboard do not need the Wi-Fi password.
3. Keep `PULSE_CALIBRATION_CONFIRMED = false` initially. Rotate each wheel through several measured full turns and check cumulative falling-edge counts. Enter independent left/right pulses per revolution and confirm the flag only after checking them.
4. Use MQTT/TLS 8883 and a publisher scoped to the commissioning topic. Use a separate subscriber for MQTTX commissioning. The production app subscriber remains scoped to the exact raw-sensor `/state` topic.
5. Upload to the actual board, open Serial Monitor at 115200 baud and verify standby-low startup, Stop, timeout, speed changes while stopped, direction interlock and continued local Stop during a broker outage. Confirm pin levels and movement physically; passing software checks does not establish these hardware results.
6. View the physical commissioning packet in MQTTX. Database/model cards can remain empty while the final sensors, direction feedback and calibration are unfinished.

## Verification

```sh
python automated_software_checks/esp32_firmware_compile_and_contract_checks/verify_mh_ir_commissioning.py --native-only
python automated_software_checks/esp32_firmware_compile_and_contract_checks/verify_mh_ir_commissioning.py
```

The first command compiles and runs the actual shared controller/packet code with g++, independently parses its JSON and checks the real Python twin's admission boundary. The second also compiles the actual Arduino sketch with temporary placeholder settings. GitHub Actions runs the Arduino build. These are software checks; no uploaded or physically tested robot is claimed.

See [full sensor contract and model commissioning](single_amr_sensor_twin_setup.md) and [EMQX setup](emqx_cloud_amr01_integration.md).

## Final multisensor upload

Follow [the exact upload steps](../esp32_telemetry_firmware/publish_mh_ir_commissioning/UPLOAD_STEPS.md). The private owner package includes a complete Arduino sketch folder and the broker settings, with only Wi-Fi placeholders to fill. Startup checks IMU identity/configuration and INA219, collects stationary gyro bias, and leaves motors disabled on failed initialization. Invalid/stale sensor channels are null on MQTT. Absolute SOC is withheld until capacity, starting charge and discharge-positive polarity are confirmed; gaps invalidate accumulated estimates. The default INA219 profile assumes a 0.1-ohm shunt. These software checks and successful compilation do not establish physical accuracy or stop latency.
