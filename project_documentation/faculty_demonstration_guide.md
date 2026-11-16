# AMR-01: demonstration and evidence guide

Start with the research question: **How can encoder, gyro and battery measurements support interpretable motion estimates, short forecasts and operator recommendations for one AMR?**

The original warehouse is a separate simulation. The six sensor models implement the final presentation's slides 5–15. Generated trials exercise the same Python sensor engine used by the physical ingestion pipeline, without inserting anything into its database. Physical accuracy and live map registration require independent measurements and are not established by this demonstration.

## Suggested walkthrough

1. Open Floor to establish the single-AMR setting. Identify it as a virtual warehouse, then open Sensor models.
2. Select Demo data and Baseline run. Open Wheel motion's equation/source to show signed counts, wheel radius, effective counts/revolution and interval time. The same encoders feed relative pose and the independent gyro comparison.
3. Select Turning motion. Unequal wheel speeds change local x, y and heading; a matching corrected gyro produces no sustained disagreement. This is encoder odometry, not an EKF or surveyed absolute pose.
4. Select Sustained sensor disagreement. The injected gyro offset crosses the residual threshold for the configured hold period. Explain why the recommendation suggests checking slip, counts, mounting and bias instead of diagnosing a particular hardware fault.
5. Select Low battery reserve. Show the estimated SOC, zero time to the assumed reserve and recharge recommendation. INA219 measures voltage/current; SOC requires starting charge and usable capacity. The runtime forecast holds current constant and is not a battery-life guarantee.
6. Select Interrupted sensor stream. The plot breaks across the missing interval. Cumulative estimates become partial and forecasts are withheld. Missing evidence does not produce a normal-operation recommendation.
7. Export trial evidence. It contains the example calibration, generated raw packets, current Python outputs, recommendations and source fingerprints. Replay it using the command below. Open Evidence and validation for the source mapping and actual CI runs.
8. Open Connect AMR and Database. Explain each status separately: broker SUBACK, fresh device samples, storage access and prediction readiness. Demonstrate the actual configured state. Do not describe a database connection or synthetic example as a physical AMR test.

## What each generated trial should show

| Trial | Expected observable result |
| --- | --- |
| Baseline run | A disagreement appears in the 3–4 s history and clears by the final sample |
| Turning motion | Curved local pose, changing heading and a near-zero gyro–encoder residual |
| Sustained sensor disagreement | Active residual advisory and a motion-inspection recommendation |
| Low battery reserve | About 18% calculated charge, zero time to the assumed 20% reserve and recharge guidance |
| Interrupted sensor stream | A 1.6 s observation gap, a broken residual path, partial estimates and withheld forecasts |

## Reproduce an exported trial

From a repository checkout with the dependencies installed:

```sh
python -m project_maintenance_scripts.replay_generated_trial amr01_disagreement_synthetic_trial.json
```

The verifier checks the format and source fingerprints, admits the exported packets through a fresh in-memory FleetTwin, and compares the final state, forecasts and recommendations. It never opens the physical database. A modified output or a source mismatch fails verification. Fingerprints establish source alignment; they are not a digital signature or proof of hardware validity. Keep the export with the repository revision used for the demonstration.

The baseline has an independent analytical check: 1,200 counts per wheel, radius 0.033 m and 600 effective counts/revolution produce approximately 0.41469 m of travel. A 0.6 A discharge for six seconds from a 2 Ah example battery changes SOC by 0.0005 and consumes 0.0074 Wh at 7.4 V. Turning is checked against the constant-curvature solution; other checks verify admission, gaps, replay, recommendations and source isolation.

## Distinguish the evidence levels

| Evidence | What it establishes |
| --- | --- |
| Unit and regression checks | Implemented equations, invariants and specified edge-case behavior |
| PostgreSQL integration checks | Transactional raw/derived persistence and worker ownership in an isolated database |
| Firmware compilation | The observation sketch compiles with example settings |
| Live UI inspection | Navigation, display states and interaction behavior on the deployed app |
| Calibrated physical trials | Requires measured sensors, independent ground truth and separate validation runs; software checks do not substitute for it |

Use [model-to-slide mapping](slide_to_code_mapping.md), [connection setup](single_amr_sensor_twin_setup.md#connect-amr-from-the-site) and [capability limits](implemented_dashboard_features_and_limits.md) when answering detailed questions.
