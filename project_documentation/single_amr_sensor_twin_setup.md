# Single-AMR sensor twin commissioning

## Entry point and hosting

Use root `streamlit_app.py` and root `requirements.txt`; run locally with `streamlit run streamlit_app.py`. GitHub supplies code and the existing Streamlit deployment serves the app. Floor opens first. Connect AMR provides the optional on-demand sensor link. Sensor models offers Demo data and Stored sensor data in six modelling stages from presentation slides 5–15, with evidence-based operator recommendations. Open detailed readings for packet values, charts and references. Open Database for saved records, attributes and connection details. `research_baseline/streamlit_app.py` is a separate inventory walkthrough.

## Connect AMR from the site

The on-demand route is **ESP32 Wi-Fi → EMQX MQTT/TLS → validated Python models and PostgreSQL transaction → stored predictive insights → operator recommendations**. The website does not scan local Wi-Fi, flash firmware remotely or drive motors. The database remains the source for displayed physical estimates. TLS on port 8883 and the existing topic `robot/amr01/state` are reused.

1. Flash the raw-sensor ESP32 sketch using the Wi-Fi network and EMQX **publisher** credentials. Keep the subscriber credentials separate and allow the subscriber to read only `robot/amr01/state`.
2. Provision schema v3 and the limited writer/reader accounts from the [PostgreSQL pipeline guide](postgresql_sensor_pipeline.md). Keep the SELECT-only reader in `[database].url`.
3. In private Streamlit settings, configure `[mqtt]` and the measured `[calibration.amr01]` values. Confirm `[commissioning].measured_calibration_confirmed = true` only after measuring them. Add `[amr_connection]` with `enabled = true`, `writer_url` for the **same trial database** using its limited writer account, and a private random `access_code` of at least 16 characters. The [example configuration](../.streamlit/secrets.example.toml) shows these sections. Do not publish real credentials or use the database owner account.
4. Open **Connect AMR**, power the ESP32, enter the operator access code and select **Connect AMR**. The code is checked on the server; the broker password and writer URL never enter the component payload. The connection runs in a session-scoped, thread-safe resource with cleanup when that session is released. Broker success requires EMQX SUBACK. A subscribed broker can still be waiting for a device.
5. Follow the separate pipeline stages. A database connection does not prove packets have arrived; packet arrival does not establish measured calibration or model validity. Connect selects Stored sensor data for the sensor-model view. Disconnect drains admitted queued writes before releasing the sole-writer database lease; committed records remain available.

Use this connection for attended trials while the app session is active. Streamlit can sleep, restart or lose a session, so use the independent worker below for unattended recording. Do not run both against the same trial; the database lease rejects a second recorder without stopping the first. Unknown intervals after a restart remain partial; a new independently calibrated trial is required to restore quantitative cumulative forecasts. Never fill a disconnected interval with invented measurements.

Recommendations are deterministic operator guidance, not an LLM diagnosis or motor commands. They require current, continuous, calibrated inputs. The existing gyro–encoder hold detector can suggest inspecting slip/counts/mounting/bias without naming a fault. Coulomb counting at or below the assumed 20% reserve can suggest recharging. Runtime and five-second pose forecasts retain their constant-current and constant-wheel-speed assumptions. Missing calibration, stale data, gaps and invalid SOC suppress current forecasts and normal-operation guidance. Demo recommendations are labelled as examples and never written into physical tables.

The independent ingestion worker establishes MQTT/TLS on **8883** using the system trusted CA store. Use an EMQX hostname with a publicly trusted certificate; custom CA deployments require explicit worker-side CA configuration. The worker subscribes to `robot/amr01/state`, validates samples, computes sensor models and writes PostgreSQL transactions. Streamlit reads the database through a separate reader account and serves results over HTTPS. Browser WSS/8084 and the standalone v1 connection form are legacy interfaces. MQTT callbacks do not access Streamlit APIs or issue commands. Deploy one worker per AMR-01 trial database; its PostgreSQL lease prevents a concurrent writer.

Configure the private reader URL in Streamlit deployment secrets. Add measured calibration and set `commissioning.measured_calibration_confirmed = true` only after physical validation. Configure separate worker database/MQTT credentials and measured calibration through the environment variables in the [PostgreSQL pipeline guide](postgresql_sensor_pipeline.md). Never commit credentials. Subscriber permissions should allow only reading `robot/amr01/state`; use a dedicated publisher account for the ESP32.

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

The first packet of an empty trial anchors counts/time, with pose initialised to local (0,0,0). Device reboots, invalid readings, disconnects, device gaps >1 s or server freshness >2 s reset the residual timer and break integration continuity. Unknown intervals are not filled with invented measurements. Old-boot packets, repeats and reordered sequences cannot rewind the model. Retained messages cannot initialise live integrals. After continuity loss, later values are labelled partial and quantitative forecasts are suppressed. To reset measured initial conditions or change calibration, provision a separate trial database and preserve the previous evidence. No full EKF, absolute heading correction or map registration is claimed.

The worker's in-memory history is bounded to 1,200 derived samples; admitted physical samples and states are stored in PostgreSQL. Database schema v3 adds an atomic checkpoint. Worker restart restores committed pose/SOC/energy and boot/sequence watermarks, then waits for a fresh anchor rather than integrating downtime. Changed calibration is rejected against an existing trial. Original MQTT receive timestamps survive database queue delay, so late commits cannot make old readings fresh. The volatile queue and ESP32 QoS 0 still allow uncommitted readings to be lost. See [database migration and recovery](postgresql_sensor_pipeline.md). Independently preserve raw trial evidence for publication. Live telemetry cannot alter the separate inventory experiment.

## Direct-sensor firmware

The supplied TB6612 / MH IR controller uses different pins and single-channel pulse inputs. Follow [its commissioning guide](mh_ir_hardware_commissioning.md) while that hardware is being built. Its diagnostic stream is separate from the exact schema-v2 physical model contract below. Do not copy this quadrature example's pins onto the motor controller or infer wheel direction from commands.

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
