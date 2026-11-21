# AMR-01 dataset dictionary

## Physical packets

`physical_packets.csv.gz` contains one row per physical commissioning message accepted from AMR-01. Each row has 42 fields drawn from the database. The original JSON body is represented by its stored SHA-256 fingerprint. Blank cells carry missing values. Zero is retained as a real reading. UTC timestamps end in Z. To open this file in Excel, import the CSV and set `boot_id` and `payload_sha256` to **Text**.

| Fields | Meaning |
| --- | --- |
| robot_id, boot_id, seq | Robot identifier, firmware-generated boot identifier, sequence number within that boot. Together they identify one packet. |
| received_at_utc, stored_at_utc | UTC time of broker receipt and database insertion, respectively. |
| sample_time_s, interval_s | Device time in seconds since boot and duration since the previous observation. |
| firmware_revision | Firmware revision reported in the payload. A blank means the packet omits this field. |
| left_pulses_total, right_pulses_total | Cumulative optical encoder pulses on each wheel since boot. |
| left_pulse_hz, right_pulse_hz | Encoder pulse rates in Hz. |
| rpm_calibration_confirmed, left_rpm, right_rpm | Whether counts per revolution were confirmed, and available wheel speed estimates in revolutions per minute. |
| commanded_motion, motor_output, pwm_duty | Device-reported requested motion, output state and actual output duty on the 0 to 255 scale. Independent observation is needed to verify chassis travel. |
| direction_measured | Whether wheel travel direction was independently measured. |
| gyro_available, imu_who_am_i, imu_sample_time_s | IMU availability flag, device identity register and device-relative measurement time. |
| accel_x_g, accel_y_g, accel_z_g | Three-axis accelerometer readings in g. |
| gyro_x_dps, gyro_y_dps, gyro_z_dps, gyro_z_rad_s | Gyroscope rates about each axis in degrees per second, plus Z rate in radians per second. |
| gyro_bias_estimate_rad_s, yaw_estimate_deg | Reported stationary Z bias in radians per second and relative yaw in degrees, when available. |
| battery_available, battery_sample_time_s | Battery monitor availability flag and time of its reading in seconds since boot. |
| battery_bus_voltage_v, battery_shunt_voltage_mv, battery_voltage_v | INA219 bus voltage in volts, shunt drop in millivolts and the device's monitored input voltage in volts. |
| battery_current_a, battery_power_w, battery_continuity | Reported monitored-branch current in amperes, power in watts and continuity of readings. The model uses current magnitude. |
| device_soc_estimate_percent, predictive_models_ready | Device-supplied charge estimate and onboard model-readiness flag. The forecast uses voltage measurements as its labels. |
| payload_sha256 | SHA-256 of the source packet payload stored at ingestion. |

The source table enforces the AMR identity, commissioning topic and message schema. The topic is `robot/amr01/commissioning`, the message type is `mh_ir_commissioning` and each broker client ID has the form `amr01-ir-` followed by its boot ID. The frozen query is in `export.sql`. `snapshot.json` records the extraction cutoff, source counts and firmware inventory.

## Forecast examples

`AMR01_Model_Dataset.csv` has one row per eligible 10-second forecast origin. The timestamp used for features is the ESP32 clock from its current boot. For an origin at 120 seconds, features use packets from 110 up to 120 seconds, and the label uses packets from 120 up to 130 seconds. The upper end of each interval is excluded. Each eligible input window has readings of at least 5.5 V throughout. This study rule identifies a measured voltage range. The actual supply connection was not logged.

| Column | Role | Definition |
| --- | --- | --- |
| boot_id, segment | Audit | Boot identifier and consecutive-packet section. A sequence discontinuity, a non-increasing device time or a gap over 1.25 s starts a new section. |
| split | Evaluation | Train, validation or test, based on the start of the whole boot. |
| origin_device_s | Audit | Forecast origin, in seconds since boot, aligned to 10-second boundaries. |
| history_last_received_utc | Audit | Broker receipt time of the last eligible input packet. |
| history_first_seq, history_last_seq | Audit | Inclusive sequence range containing the input observations. |
| target_first_seq, target_last_seq | Audit | Inclusive sequence range containing future label observations. |
| history_n, target_n | Audit | Number of valid readings used to construct each mean. |
| voltage_mean_v | Feature and baseline | Mean measured voltage over the preceding 10 s, in volts. |
| last_minus_mean_v | Feature | Last input voltage minus the input mean, in volts. |
| slope_v_per_s | Feature | Least-squares slope of voltage against device time in the input window, in V/s. |
| voltage_sd_v | Feature | Population standard deviation of the input voltages, in volts. |
| mean_abs_current_a | Feature | Mean absolute branch current across input readings, in amperes. |
| mean_pwm_duty | Feature | Mean device-reported output duty across input readings, in 0 to 255 units. |
| voltage_last_v | Baseline | Last valid input voltage, in volts. |
| next_10s_mean_v | Target | Arithmetic mean of measured voltage over the following 10 s, in volts. |

The two windows must occupy consecutive 10-second bins in one uninterrupted section. Each bin needs at least 18 valid observations covering both edges within 1 s. For a valid voltage reading, the battery flag must be true, voltage must be finite and positive, and the battery measurement age must be between zero and 0.5 s with 1 microsecond tolerance for timestamp rounding. A battery reading cached from a preceding bin is excluded from the new bin. Voltage and output from the future window never enter the prediction features. Low future voltages are retained.

`boot_sessions.csv` lists every recorded boot, its packet count, split, voltage range, and number of usable examples. Consecutive examples from a boot share observations, so the unit of separation between training and testing is the boot.
