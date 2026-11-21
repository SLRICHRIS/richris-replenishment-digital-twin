# AMR-01 data science methodology

**Workflow: real observations → preprocessing → labelled dataset → training → held-out evaluation.**

## 1. Data acquisition

The frozen database export contains **68,130 unique AMR-01 sensor packets from 86 ESP32 boots**. Each packet is identified by `(robot_id, boot_id, seq)` and retains the stored source-payload SHA-256. Of these packets, **3,085 report nonzero motor PWM**. PWM describes reported motor output; it is not independent proof of chassis movement.

The [snapshot](battery_voltage/dataset/snapshot.json) records the source table and cutoff. The [count query](battery_voltage/dataset/count.sql) and [export query](battery_voltage/dataset/export.sql) document extraction. Both studies use the same source observations.

| Count | Voltage study | Gyro study |
| --- | ---: | ---: |
| Source packets | 68,130 | 68,130 |
| Valid voltage / fresh gyro packets | 68,126 | 62,032 |
| Fresh gyro packets with a recorded startup offset | Not required for the voltage model | 38,795 |
| Labelled forecasting examples | 1,518 | 18,766 |
| Boots contributing examples | 30 | 55 |
| Held-out test examples | 364 | 8,562 |

## 2. Data preprocessing

Both pipelines check packet identity, remove exact duplicate rows if present, reject conflicting packet keys, retain missing values in the raw export and construct windows within continuous device sessions. This snapshot had no exact duplicate rows.

| Rule | Voltage | Gyro |
| --- | --- | --- |
| Reading quality | Monitor available; finite positive voltage; measurement age at most 0.5 s | Gyro available; finite X/Y/Z and clocks; measurement age at most 0.10 s |
| Continuity | New segment after a sequence gap, non-increasing time or packet gap over 1.25 s | Six consecutive packets in one boot, stable recorded bias and adjacent intervals of 0.45–0.55 s on both clocks |
| Input construction | Previous 10-second bin, at least 18 readings, both bin edges covered within 1 s; input voltage at least 5.5 V | Previous four Z rates after converting and subtracting the recorded startup offset |
| Target construction | Mean monitored voltage in the following 10-second bin with the same coverage rule | Mean of the next two corrected Z readings |
| Missing information | Ineligible windows excluded, no imputation | Missing offset or invalid/stale readings excluded from windows |

The voltage threshold selects an observed voltage range; the actual supply connection is not logged. Future voltage values are not filtered using that threshold. Future readings never enter the feature vector for their own prediction.

Exact exclusions are recorded in the [voltage audit](battery_voltage/evaluation/data_audit.json) and [gyro audit](gyroscope/evaluation/data_audit.json). Definitions and units appear in each study's data dictionary.

## 3. Labelled datasets and chronological splits

Each labelled row contains the history features, a future measured target, source sequence identifiers and its train/validation/test assignment.

| Partition | Voltage examples / boots | Gyro examples / boots |
| --- | ---: | ---: |
| Training | 704 / 18 | 6,107 / 7 |
| Validation | 450 / 9 | 4,097 / 19 |
| Test | 364 / 3 | 8,562 / 29 |

Voltage boots are split by first receipt: before 20 November IST, on 20 November, and from 21 November. Gyro boundaries are before 19 November, on 19 November, and from 20 November. All dates are in 2026. Whole-boot time ranges do not overlap across partitions. Adjacent rows within a boot can share past observations.

Open the [voltage dataset](battery_voltage/dataset/AMR01_Model_Dataset.csv) and [gyro dataset](gyroscope/data/AMR01_Gyro_Model_Dataset.csv).

## 4. Model training

A separate model is trained for each target. Validation selects settings; the final fit uses the earlier training and validation examples. Test examples do not enter fitting or parameter selection.

| | Voltage Ridge model | Gyro boosted-tree model |
| --- | --- | --- |
| Six inputs | Past voltage mean, last-minus-mean, slope, standard deviation, mean absolute current, mean PWM | Four past corrected Z rates, their median, their range |
| What is fitted | Change from the past voltage mean, with standardized inputs and L2 regularization | Future two-reading mean, minimizing absolute error |
| Settings selected on validation | Ridge alpha 1000 from five candidates | Depth 3 and minimum leaf size 60 from four candidates |
| Other settings | StandardScaler fitted only on fitting data | 80 trees; learning rate 0.06; random seed 42 |
| Final fitting rows | 1,154 | 10,204 |
| Saved model | [Scaler and coefficients](battery_voltage/model/voltage_ridge.json) | [Portable fitted trees](gyroscope/model/gyro_forecaster.json) |

## 5. Model evaluation

Models are evaluated on later held-out boots, using the same test origins for each model and its baselines. MAE is average absolute prediction error. RMSE gives greater weight to large errors. Both use the target's units. R² describes variance explained on the evaluated targets; it is not an accuracy percentage.

### Voltage: 364 test examples from 3 boots

| Method | MAE (V) | RMSE (V) | R² |
| --- | ---: | ---: | ---: |
| Latest reading | 0.09697 | 0.10913 | 0.702 |
| Previous 10-second mean | **0.02491** | **0.03405** | **0.971** |
| Trained Ridge | 0.03029 | 0.03913 | 0.962 |

Ridge performed better than repeating a single reading. Carrying the previous mean forward performed best overall and on each test boot. Ridge's MAE was about 5.4 mV, or 21.6%, higher than that stronger baseline.

### Gyro: 8,562 test examples from 29 boots

| Method | Overall MAE (degrees/s) | RMSE (degrees/s) | R² | Motor-active MAE (degrees/s) |
| --- | ---: | ---: | ---: | ---: |
| Zero rate | 7.121 | 14.427 | -0.240 | 9.818 |
| Latest reading | 0.646 | 4.167 | 0.897 | **8.876** |
| Four-reading mean | 0.570 | 3.911 | 0.909 | 9.312 |
| Four-reading median | **0.542** | **3.886** | **0.910** | 9.237 |
| Trained boosted trees | 2.626 | 5.726 | 0.805 | 9.199 |

There are **149 motor-active target windows from 8 test boots**, about 1.7% of the gyro test set. The latest-reading baseline has the lowest MAE in that subgroup.

One zero-output boot contributes 1,891 test windows with a large recorded startup offset. It remains in the primary evaluation. The [offset sensitivity table](gyroscope/evaluation/offset_sensitivity.csv) reports its effect with all model predictions fixed. Forecast consistency with the instrument does not independently verify physical rotation.

## Study overview

> We collected 68,130 real sensor packets from one AMR across 86 boots. We checked sensor validity and time continuity, then built separate voltage and gyro forecasting datasets. We trained Ridge regression and gradient-boosted trees, selected their settings on validation boots, and evaluated on later boots. We compared every trained model with simple baselines and retained the datasets, fitted parameters and each held-out prediction so the results can be reproduced.

For stronger physical validation, the next experiment should log the power source, use repeated motor-active runs and compare gyro rotation with synchronized camera heading.

[Return to the study index](README.md)
