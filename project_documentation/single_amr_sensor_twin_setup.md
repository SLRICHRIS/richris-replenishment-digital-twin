# Single-AMR sensor twin commissioning

## Entry point and hosting

Deploy branch containing this change with root `streamlit_app.py` and root `requirements.txt`. Run locally with `streamlit run streamlit_app.py`. GitHub supplies code to Streamlit; it is not a continuously running computation host. The original warehouse dashboard opens first; select Sensor models for Python-derived sensor results. Its initial source is a fixed synthetic trial. The detailed model-inspection view includes slide 15’s manual stock-balance/task-state example. The active Sensor models view follows the six modelling stages of slides 4–14; equation/variable details are collapsible. Reuse the existing Streamlit app deployment rather than creating another private app. Earlier `research_baseline/streamlit_app.py` is a separate inventory walkthrough.

The Streamlit backend establishes MQTT/TLS on **8883** using the system trusted CA store. Use a serverless EMQX hostname with a publicly trusted certificate; custom CA deployments require explicit server-side CA configuration. It subscribes read-only to the single AMR-01 state topic. Browser WSS/8084 belongs to the preserved standalone v1 interfaces, not the current raw-sensor path. When Python arguments are present, Hardware displays the new backend readouts and hides the old v1 connection form. Browser access uses Streamlit HTTPS. MQTT callbacks never access Streamlit UI/session APIs or issue commands. A cached subscriber and lock-protected fleet state are shared by viewers of the same server process/configuration.

Copy `.streamlit/secrets.example.toml` into **private** `.streamlit/secrets.toml`, or enter the contents into Streamlit Cloud secrets. Replace broker credentials and **every illustrative calibration value**, then set `commissioning.measured_calibration_confirmed = true`. Never commit that private file. Subscriber permissions should allow only reading `robot/amr01/state`; use a dedicated AMR-01 publisher credential.

## Contract v2

Publish a non-retained JSON object on `robot/<robot_id>/state`, with these exact fields. Legacy x/y/battery-percent packets are deliberately not accepted as raw sensor measurements. The old recorder/gateway/API remain legacy interfaces; do not feed v2 packets through their x/y normalizer.

```json
{"schema_version":2,"robot_id":"amr01","boot_id":"unique-per-reboot","seq":0,"sample_time_s":0.05,"encoder_left_count":0,"encoder_right_count":0,"gyro_z_rad_s":0.01,"battery_voltage_v":7.4,"battery_current_a":0.6,"robot_state":"standby"}
```

| Field | Definition |
|---|---|
| schema_version | Integer 2 |
| robot_id | Exactly amr01 only; must match topic |
| boot_id | Nonempty unique boot identifier, at most 64 characters |
| seq | Strictly increasing nonnegative uint32 within boot; duplicate/out-of-order packets ignored |
| sample_time_s | Device monotonic acquisition time in seconds, increasing within boot; not broker receive time |
| encoder_left_count / encoder_right_count | Signed cumulative int64 x4 quadrature counts; forward-positive; no count reset within boot |
| gyro_z_rad_s | Body z angular rate, rad/s, positive counterclockwise; raw bias still present |
| battery_voltage_v | Pack terminal voltage in volts |
| battery_current_a | Pack current in amperes; **positive discharge**, negative charge |
| robot_state | Explicit local firmware state; not inferred from warehouse task simulation |

Encoder and gyro acquisitions are approximate simultaneous snapshots; firmware sensor readout/network latency are not a hardware time-synchronisation guarantee. Target 20 Hz, but actual device Δt drives computation. 20 Hz is inspired by [A]'s acquisition context, not a guarantee over Wi-Fi. Counts accumulated between samples recover net travel after short losses; midpoint motion and right-endpoint battery integration assume representative motion/current over that interval. Large gaps cannot recover the missing trajectory or charge accurately.

First packet anchors counts/time, with pose initialised to local (0,0,0). Device reboots, invalid readings, disconnects, device gaps >1 s or server freshness >2 s reset the residual timer and break integration continuity. Unknown intervals are not filled with invented measurements. Old-boot packets, repeats and reordered sequences cannot rewind the model. Retained messages cannot initialise live integrals. After continuity loss, later values are labelled partial and quantitative forecasts are suppressed; reinitialise from a measured pose/SOC by restarting the service with updated calibrated initial conditions. No full EKF, absolute heading correction or map registration is claimed.

History is bounded to 1,200 derived samples per robot in server memory and can be exported. Server restart resets pose/SOC integration; this is **not a durable experiment recorder**. Save exports and independently record raw trial data for publication evidence. Live telemetry cannot alter the separate inventory experiment.

## Direct-sensor firmware

Use `esp32_telemetry_firmware/publish_raw_sensor_telemetry/publish_raw_sensor_telemetry.ino`; copy the adjacent example settings to private `esp32_wifi_and_mqtt_settings.h`. Install Arduino ESP32, PubSubClient, Adafruit MPU6050, Adafruit INA219, Adafruit Unified Sensor and Adafruit BusIO. Use ESP32 Dev Module. Assign amr01 only and use the broker's trusted CA. Certificate verification is enabled and NTP provides time before TLS. The sketch has no separate UART controller dependency.

| Connection | Example pins / acquisition |
|---|---|
| MPU6050 and INA219 | Shared SDA21/SCL22, addresses 0x68/0x40, 3.3 V logic |
| Left encoder A/B | GPIO32/33, both edges, x4 quadrature |
| Right encoder A/B | GPIO25/26, both edges, x4 quadrature |
| TB6612 standby | GPIO23, held LOW by observation sketch |
| Motor movement | Add/retain a commissioned **local** controller; this sketch does not drive the motors or implement navigation |
| INA219 current path | Battery+ to VIN+; VIN− to **all** robot loads. Bus voltage is VIN−; shunt drop is added to estimate pack terminal voltage. |

Verify actual shunt resistance. Adafruit's 32V/2A calibration assumes a 0.1-ohm shunt; use suitable measurement range and calibration for the actual module/load. Compare voltage/current against a meter, confirm discharge sign, and verify all loads pass through the shunt. The current sensor does not directly output SOC. Range, shunt heating, motor noise and sample timing must be assessed on hardware. Do not run the motors from an ESP32 pin; encoder signals must be compatible with 3.3 V logic.

Roll each wheel forward by hand and adjust its encoder sign. Measure effective counts per wheel revolution including gearbox and all four edges; measure radii against actual travel and track against rotation trials. Mount IMU with body z positive counterclockwise, and estimate stationary bias with `models.stationary_gyro_bias` using independently stationary samples. MPU6050 has no magnetometer, so integrating gyro alone would drift. Measure usable capacity and initial SOC at the start of every quantitative trial; voltage alone is not a calibrated SOC measurement. Learn residual threshold and hold time from healthy trials and validate on separate fault/slip trials.

The new firmware is a commissioning observation sketch, not a completed autonomous controller. Firmware compile/hardware status is recorded in [software evidence](single_amr_alignment_validation.md). Legacy UART sketches and downloadable kits remain for historical reproducibility, identified as legacy in the README.

## Primary implementation references

- [EMQX Serverless port guide](https://docs.emqx.com/en/cloud/latest/deployments/port_guide_serverless.html) and [Python SDK connection](https://docs.emqx.com/en/cloud/latest/connect_to_deployments/python_sdk.html).
- [Streamlit architecture](https://docs.streamlit.io/develop/concepts/architecture/architecture).
- [Adafruit MPU6050 source](https://github.com/adafruit/Adafruit_MPU6050) and [INA219 source](https://github.com/adafruit/Adafruit_INA219); gyro is rad/s, current getter is mA converted to A, shunt getter is mV converted to V.
- [TI INA219 data sheet](https://www.ti.com/lit/ds/symlink/ina219.pdf) for sensor limits/scaling.
- [Exact modelling references and pages](slide_to_code_mapping.md).
