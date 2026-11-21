# AMR-01 physical telemetry study

S. L. Richris | B.Tech ECE, Amritapuri | 22 November 2026

## What was measured

The project database held **68,130 unique physical sensor packets from 86 ESP32 boots** at 00:51 IST on 22 November 2026. A data point in this count is one packet. Packet readings cover the period from 17 November to 22 November, Indian Standard Time. The raw data contain 3,085 packets reporting nonzero motor output duty. Individual packets are repeated observations from one robot.

## What was predicted

For each eligible forecast origin, predict the mean of the monitored voltage readings over the next 10 seconds using only the preceding 10 seconds. The resulting **1,518 labelled examples** were constructed from actual device measurements. Input windows need at least 18 valid readings and a minimum reading of 5.5 V to focus the experiment on the pack-voltage range. The underlying supply type was not logged. Future values below this input threshold are retained.

## Files to open

| Question | Evidence |
| --- | --- |
| How many real points were collected? | `dataset/snapshot.json` and the reproducible `dataset/count.sql` |
| Where are the raw readings? | `dataset/physical_packets.csv.gz`, 42 selected fields per packet, with a stored source fingerprint |
| How were the data preprocessed? | `study.py`, `dataset/data_dictionary.md`, `evaluation/data_audit.json` |
| Where is the labelled model dataset? | `dataset/AMR01_Model_Dataset.csv` with feature values, future voltage and train/validation/test membership |
| What model was actually fitted? | `model/voltage_ridge.json` with the fitted intercept, coefficients, scaler and selected penalty |
| How did it perform? | `evaluation/test_metrics.csv`, `test_metrics_by_boot.csv`, `test_predictions.csv` and the PDF report |

## Evaluation design

Whole boots are ordered by their first recorded packet in IST. Training boots started before 20 November, validation boots started on 20 November, and test boots started on or after 21 November. Adjacent examples within a boot share a 10-second window. No boot appears in two splits. The archived time ranges of successive splits do not overlap.

| Partition | Recorded boots | Boots with examples | Examples |
| --- | ---: | ---: | ---: |
| Train | 40 | 18 | 704 |
| Validation | 33 | 9 | 450 |
| Test | 13 | 3 | 364 |

The model estimates the change from the previous 10-second voltage mean using six standardized features. Validation MAE selected ridge alpha **1000**. The final fit used **1,154** earlier training and validation examples. On the **364** held-out examples the final ridge had **MAE 0.03029 V**, **RMSE 0.03913 V** and **R² 0.962**. Using the most recent single reading gave an MAE of 0.09697 V. Carrying the previous 10-second mean forward gave the smallest error at **0.02491 V**. It also had the lowest MAE on each of the three test boots.

## Reproduce on Windows

From the repository root, open PowerShell and run `cd physical_data_studies/battery_voltage`. The study was run with Python 3.12.14. Installing the packages requires an internet connection. Training and evaluation run offline from the included compressed packet CSV. The script reads gzip directly.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe study.py
```

Rebuilding writes the labelled dataset, split summaries, validation scores, fitted model and held-out predictions. To apply the saved model to a CSV containing the six feature columns, run the following from the same folder. The included labelled CSV also works as a reproducibility example.

```powershell
.\.venv\Scripts\python.exe study.py --predict dataset/AMR01_Model_Dataset.csv --output predictions.csv
```

For evaluation details, use the test-set predictions under `evaluation/`. Complete definitions and units are in `dataset/data_dictionary.md`. To reproduce the source count against an authorized database connection, run `dataset/count.sql`; to export the fixed source projection, run `dataset/export.sql`. The SHA-256 list in this study folder identifies the packaged files. Direct execution rewrites generated results; the [combined reproduction runner](../README.md#reproduce-on-windows) checks them in a temporary folder.

[Study index](../README.md) · [Methodology](../methodology.md) · [PDF report](AMR01_Data_Study_Report.pdf)
