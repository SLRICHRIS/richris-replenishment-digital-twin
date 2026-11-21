# Gyro data dictionary

## Packet export

Each row of AMR01_Gyro_Packets.csv.gz is a physical telemetry packet. The original identifier is (robot_id, boot_id, seq). A blank cell means that the source did not report a value.

| Columns | Meaning |
| --- | --- |
| robot_id, boot_id, seq | Robot identifier, ESP32 boot identifier and integer packet sequence number. Keep boot_id as text. |
| received_at_utc | Server receipt timestamp in UTC. The first packet received for each boot assigns its chronological split. |
| sample_time_s, interval_s | Device packet time since boot in seconds and its reported sampling interval in seconds. |
| firmware_revision | Firmware revision when the packet includes it. |
| gyro_available, imu_who_am_i | Firmware validity flag and reported IMU identity register value. |
| imu_sample_time_s | IMU measurement timestamp on the device clock, in seconds since boot. |
| gyro_x_dps, gyro_y_dps, gyro_z_dps | Raw angular velocities about the IMU’s X, Y and Z axes, in degrees per second. Positive and negative signs retain the sensor convention. |
| gyro_bias_estimate_rad_s | Device-reported startup Z offset in radians per second. The corrected Z rate equals raw Z minus the offset multiplied by 180/π. |
| motor_output, pwm_duty | ESP32-reported drive direction or stopped state, and PWM duty count. A positive duty indicates reported motor output. Actual chassis movement needs a physical reference. |
| payload_sha256 | Original payload fingerprint for source traceability. |

A fresh reading requires a true availability flag, finite X, Y, Z and timestamps, and an IMU sample age from zero to 0.10 seconds at packet time, with a one-microsecond numeric tolerance. Training examples also require a finite startup offset. Missing values are kept in the packet export and excluded from forecast windows where required.

## Model dataset

Each row is one forecast made at history_last_seq. It uses the four most recent readings and predicts the arithmetic mean of the next two. The same six packets must share a boot and startup bias. The adjacent packet and IMU clock intervals must each be 0.45 to 0.55 seconds. No target packet is used in two targets. An earlier target can later become an observed history value.

| Columns | Meaning and role |
| --- | --- |
| boot_id, split, segment | Boot identifier, chronological partition and uninterrupted run of eligible packets. Audit only. |
| history_first_seq, history_last_seq | Sequence numbers of the oldest and most recent of the four input packets. |
| target_first_seq, target_last_seq | Sequence numbers of the two future measurements. |
| origin_imu_s, target_end_imu_s | Sensor times of the latest input and second future measurement, in seconds since boot. Their difference is the observed forecast horizon. |
| origin_received_utc | Server receipt timestamp of the latest input. |
| startup_bias_dps | Applied startup offset after conversion to degrees per second. |
| z_lag3_dps, z_lag2_dps, z_lag1_dps, z_now_dps | **Model inputs 1–4.** The four corrected Z angular rates in order from oldest to newest, in °/s. |
| history_median_dps, history_range_dps | **Model inputs 5–6.** Median and maximum minus minimum of those four readings, in °/s. |
| history_mean_dps | Mean of the four history readings, recorded for the moving-average comparison. |
| future_z1_dps, future_z2_dps | Two observed future corrected rates, in °/s, nominally 0.5 and 1.0 second after the latest input. Used to calculate the label. |
| next_two_mean_z_dps | **Prediction target.** Arithmetic mean of future_z1_dps and future_z2_dps, in °/s. |
| history_any_pwm, target_any_pwm | Whether any history or target packet, respectively, reported positive PWM. Used to describe data and score subgroups. |

## Evaluation tables

The five forecast columns are a constant zero, the latest reading, the mean and median of the four history readings, and the trained model. The same measured outcome and test origins are used for every method.

| Metric or subgroup | Interpretation |
| --- | --- |
| n, boots | Number of forecast windows and distinct boots represented. Each window has equal weight in pooled scores. |
| mae_dps | Mean of absolute forecast minus target differences in °/s. Smaller values mean less average error. |
| rmse_dps | Square root of the mean squared forecast error, in °/s. Large individual errors have greater influence. |
| bias_dps | Mean forecast minus target in °/s. Positive values indicate predictions above the observed rate on average. |
| r2 | Unitless coefficient of determination against the measured targets in that subset. |
| Target PWM active / Target PWM zero | At least one of the two future packets reports positive PWM, or both report zero, respectively. |
| Absolute target at least 10 dps | Absolute value of the corrected two-reading mean is at least 10°/s. This may include a sustained sensor offset. |
| Flagged boot / Other test boots | Post-evaluation sensitivity check. Among zero-output test boots with at least 100 examples, select the boot with the largest absolute median corrected Z rate. All test boots remain in the overall score. |
