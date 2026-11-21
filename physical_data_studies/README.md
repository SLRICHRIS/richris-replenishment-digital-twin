# AMR-01: real data, preprocessing, training and evaluation

**S. L. Richris | B.Tech ECE, Amritapuri | 22 November 2026**

Two reproducible studies use one frozen export of **68,130 unique physical sensor packets from 86 ESP32 boots**. A packet is one recorded observation from AMR-01. The voltage and gyro studies reuse these observations; their packet counts must not be added together.

**Start with the [methodology guide](methodology.md).** It documents data acquisition, preprocessing, labelled datasets, model training and evaluation.

## Choose a study

| | [Battery / supply voltage](battery_voltage/README.md) | [Gyroscope](gyroscope/README.md) |
| --- | --- | --- |
| Prediction | Mean monitored voltage over the next 10 seconds | Mean of the next two corrected Z-axis gyro readings, about 1 second ahead |
| Eligible labelled examples | 1,518 | 18,766 |
| Train / validation / test examples | 704 / 450 / 364 | 6,107 / 4,097 / 8,562 |
| Boots with examples in train / validation / test | 18 / 9 / 3 | 7 / 19 / 29 |
| Trained model | Standardized Ridge regression | Gradient-boosted regression trees |
| Held-out model MAE | 0.03029 V | 2.626 degrees/s |
| Best overall baseline MAE on the test set | Previous 10-second mean: 0.02491 V | Four-reading median: 0.542 degrees/s |
| Report | [Voltage PDF](battery_voltage/AMR01_Data_Study_Report.pdf) | [Gyro PDF](gyroscope/AMR01_Gyro_Study_Report.pdf) |

Both models were trained and evaluated. The simple baselines had lower overall test error in this snapshot. The gyro study also reports motor-active windows and a sensor-offset sensitivity check. These are offline measurement-forecasting experiments; the labels come from the sensors themselves.

## Follow the evidence

| Stage | Voltage evidence | Gyro evidence |
| --- | --- | --- |
| 1. Real data and source count | [Snapshot](battery_voltage/dataset/snapshot.json), [count query](battery_voltage/dataset/count.sql), [raw packets](battery_voltage/dataset/physical_packets.csv.gz) | [Source identity](gyroscope/data/source.json), [gyro packet projection](gyroscope/data/AMR01_Gyro_Packets.csv.gz) |
| 2. Preprocessing and quality | [Data dictionary](battery_voltage/dataset/data_dictionary.md), [audit counts](battery_voltage/evaluation/data_audit.json) | [Data dictionary](gyroscope/data/data_dictionary.md), [audit counts](gyroscope/evaluation/data_audit.json) |
| 3. Labelled dataset and splits | [Model CSV](battery_voltage/dataset/AMR01_Model_Dataset.csv), [boot inventory](battery_voltage/dataset/boot_sessions.csv) | [Model CSV](gyroscope/data/AMR01_Gyro_Model_Dataset.csv), [boot inventory](gyroscope/data/boot_sessions.csv) |
| 4. Training and saved model | [Training script](battery_voltage/study.py), [validation grid](battery_voltage/evaluation/validation_grid.csv), [fitted coefficients](battery_voltage/model/voltage_ridge.json) | [Training script](gyroscope/gyro_study.py), [validation grid](gyroscope/evaluation/validation_grid.csv), [fitted trees](gyroscope/model/gyro_forecaster.json) |
| 5. Evaluation | [Metrics](battery_voltage/evaluation/test_metrics.csv), [every test prediction](battery_voltage/evaluation/test_predictions.csv), [per-boot scores](battery_voltage/evaluation/test_metrics_by_boot.csv) | [Metrics](gyroscope/evaluation/test_metrics.csv), [every test prediction](gyroscope/evaluation/test_predictions.csv), [per-boot scores](gyroscope/evaluation/test_metrics_by_boot.csv) |

## Reproduce on Windows

Download or clone the repository. Open PowerShell in its top-level folder, where the main README is located. Use Python 3.12; the recorded runs used 3.12.14.

```powershell
py -3.12 -m venv .venv-study
.\.venv-study\Scripts\python.exe -m pip install -r physical_data_studies/requirements.txt
.\.venv-study\Scripts\python.exe physical_data_studies/reproduce.py
```

The runner checks the packaged file fingerprints, decompresses and checks the source identity, rebuilds both datasets, retrains both models, and compares the regenerated datasets, model parameters and evaluation outputs with the committed results. It runs in a temporary folder and leaves the published evidence intact. The gyro verifier additionally traces every forecast to its six source packets. It requires no database, broker, robot or private connection settings. Package installation requires internet access; the study runs offline afterwards.

For one study, append `--study battery_voltage` or `--study gyroscope`. To check only the packaged file fingerprints, append `--verify-only`.

On an existing Python environment on Linux or macOS:

```sh
python -m pip install -r physical_data_studies/requirements.txt
python physical_data_studies/reproduce.py
```

The raw CSVs use lossless gzip compression. The scripts read them directly. For Excel, decompress the selected `.csv.gz`, then import `boot_id` and `payload_sha256` as text. The labelled CSVs are already uncompressed.

## Snapshot and interpretation

The source cutoff is **22 November 2026, 00:51:37 IST**. Recorded packets span **17 November, 21:22:04 IST to 22 November, 00:15:41 IST**. These are frozen snapshot counts, not a query of the current live database.

Whole boots are assigned chronologically to splits, with study-specific date boundaries. No boot crosses training, validation and test within a study. Windows within one boot remain correlated; thousands of rows do not represent thousands of independent experiments.

The voltage target measures monitored supply voltage. The export did not record whether each interval was powered by USB or the battery. The gyro target measures the recorded rate after applying the startup offset. Independent rotation measurements are needed to establish physical heading accuracy. These results do not establish battery lifetime or completed robot travel.

[Source archive fingerprints and packaging record](source_manifest.json) · [File fingerprints](SHA256SUMS.txt) · [Main project](../README.md)
