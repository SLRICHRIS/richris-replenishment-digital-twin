# AMR-01 gyroscope forecasting study

This project uses real AMR-01 telemetry to forecast the mean of the next two bias-corrected Z-axis gyroscope readings. The second reading arrives about one second after the forecast. Angular rate is measured in degrees per second (°/s). The dataset, fitted model and all reported predictions are included. You can reproduce the study while the robot is offline.

## Result

The four-reading median gave the smallest average absolute error overall. Repeating the latest reading performed best during windows in which the ESP32 reported motor output. The archive supplied gyro measurements as the scoring reference. Independent camera measurements of rotation are still needed to assess heading accuracy.

| Method | Overall MAE, 8,562 windows (°/s) | Motor output active, 149 windows (°/s) |
| --- | ---: | ---: |
| Four-reading median | 0.542 | 9.237 |
| Latest reading | 0.646 | 8.876 |
| Trained gradient-boosted trees | 2.626 | 9.199 |

One test boot contributed 1,891 examples and reported zero motor PWM throughout. Subtracting its recorded startup bias of −30.22°/s changed a median raw Z rate of −0.53°/s to +29.69°/s. The overall evaluation includes this boot. The report gives the separate scores for this boot and the other 28 test boots.

## Data and split

The frozen physical telemetry export contains 68,130 unique packets from 86 ESP32 boots. The export cutoff was 22 November 2026 at 00:51 IST. Of 62,032 fresh gyro readings, 38,795 had a finite device-reported startup offset. They produced 18,766 complete input and target windows across 55 boots. Each window requires six consecutive fresh packets with a stable offset. The stride of two gives every example its own two target packets. Neighbouring windows within a boot can share history.

| Split | First packet of boot, IST | Boots with eligible windows | Windows |
| --- | --- | ---: | ---: |
| Train | 17–18 November | 7 | 6,107 |
| Validation | 19 November | 19 | 4,097 |
| Test | 20–22 November | 29 | 8,562 |

We selected the tree settings on the validation set, then fitted the final model on all 10,204 earlier windows. The test includes 149 motor-active target windows from eight boots. The six model inputs are the last four signed, bias-corrected Z readings, their median and their range. The model has 80 trees of depth at most three, at least 60 training examples per leaf and a learning rate of 0.06.

## Reproduce on Windows

From the repository root, open PowerShell and run `cd physical_data_studies/gyroscope`. The recorded environment used Python 3.12.14. The raw packet CSV is losslessly compressed with gzip and the scripts read it directly. With Python 3.12 installed, run the following commands.

~~~powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe gyro_study.py
.\.venv\Scripts\python.exe verify_study.py
~~~

The first script cleans the packaged packet CSV and recreates the labelled dataset, trained model and evaluation tables. The second checks the source packets for every window, the held-out split, the forecasts from the saved model and the errors for every evaluation group.

To make forecasts with the saved JSON model, run the command below. You can replace the input with any CSV containing the six named model features in the data dictionary. The output keeps the input columns and adds forecast_next_two_mean_z_dps.

~~~powershell
.\.venv\Scripts\python.exe gyro_study.py --predict data/AMR01_Gyro_Model_Dataset.csv --output predictions.csv
~~~

## Included files

| File | Contents |
| --- | --- |
| AMR01_Gyro_Study_Report.pdf | Faculty report with the sample count, preprocessing, model, results and a measured trace. |
| data/AMR01_Gyro_Packets.csv.gz | Seventeen gyro and provenance fields from every packet in the frozen physical export, including unavailable readings. Use the original packet key to locate a source record. |
| data/AMR01_Gyro_Model_Dataset.csv | One row per labelled forecasting example, including its split and source sequence numbers. |
| data/data_dictionary.md | Units, six model inputs, two target packets and audit fields. |
| data/source.json and data/boot_sessions.csv | Source identity, snapshot cutoff, software versions and counts per boot. |
| model/gyro_forecaster.json | Fitted trees, input order and coefficients for inference. |
| evaluation/validation_grid.csv and evaluation/validation_baselines.csv | All four tree settings and all simple forecasts on validation. |
| evaluation/test_predictions.csv | The five forecasts and measured target at each held-out origin. |
| evaluation/test_metrics.csv and evaluation/test_metrics_by_boot.csv | Errors overall, for the recorded output and rate subgroups, and for individual boots. |
| evaluation/boot_gyro_offsets.csv and evaluation/offset_sensitivity.csv | Per-boot offset inspection and the post-evaluation check with the largest sustained offset. |
| evaluation/data_audit.json and evaluation/results.json | Exact packet and window counts by split, model settings and scores. Split dates are defined in gyro_study.py. |
| SHA256SUMS.txt | File fingerprints for checking the distributed project. |

Direct execution rewrites generated results. The [combined reproduction runner](../README.md#reproduce-on-windows) checks both studies in a temporary folder.

[Study index](../README.md) · [Faculty review](../faculty_review.md) · [PDF report](AMR01_Gyro_Study_Report.pdf)
