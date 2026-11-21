"""Build the AMR-01 voltage forecasting dataset and repeat the evaluation offline."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


ROOT = Path(__file__).resolve().parent
WINDOW_S = 10
MIN_WINDOW_READINGS = 18
MAX_EDGE_GAP_S = 1.0
MAX_PACKET_GAP_S = 1.25
MIN_HISTORY_V = 5.5
VALIDATION_FROM = pd.Timestamp("2026-11-20 00:00", tz="Asia/Kolkata")
TEST_FROM = pd.Timestamp("2026-11-21 00:00", tz="Asia/Kolkata")
ALPHAS = (0.1, 1.0, 10.0, 100.0, 1000.0)
FEATURES = ["voltage_mean_v", "last_minus_mean_v", "slope_v_per_s", "voltage_sd_v",
            "mean_abs_current_a", "mean_pwm_duty"]
TARGET = "next_10s_mean_v"
KEY = ["robot_id", "boot_id", "seq"]


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def write_csv(frame, path):
    frame.to_csv(path, index=False, float_format="%.12g", lineterminator="\n")


def read_packets(path):
    packets = pd.read_csv(path, dtype={"boot_id": "string", "payload_sha256": "string"},
                          true_values=["true"], false_values=["false"], low_memory=False)
    count = len(packets)
    if not packets["robot_id"].eq("amr01").all() or packets[KEY].isna().any().any():
        raise ValueError("Expected identified AMR-01 packets.")
    packets = packets.drop_duplicates()
    if packets.duplicated(KEY).any():
        raise ValueError("Conflicting rows share a packet identity.")
    if not packets["payload_sha256"].str.fullmatch("[0-9a-f]{64}").fillna(False).all():
        raise ValueError("A source payload fingerprint is missing or malformed.")
    packets = packets.sort_values(["boot_id", "seq"]).reset_index(drop=True)
    packets["received"] = pd.to_datetime(packets["received_at_utc"], utc=True)
    if not np.isfinite(packets["sample_time_s"]).all():
        raise ValueError("A device timestamp is invalid.")
    age = packets["sample_time_s"] - packets["battery_sample_time_s"]
    packets["valid_voltage"] = (packets["battery_available"] &
        np.isfinite(packets["battery_voltage_v"]) & (packets["battery_voltage_v"] > 0) &
        age.between(-0.000001, 0.500001))
    sessions = packets.groupby("boot_id").agg(
        first_received_utc=("received", "min"), last_received_utc=("received", "max"),
        packets=("seq", "size"), valid_voltage_packets=("valid_voltage", "sum"),
        min_voltage_v=("battery_voltage_v", "min"), max_voltage_v=("battery_voltage_v", "max"),
        nonzero_pwm_packets=("pwm_duty", lambda values: int(values.gt(0).sum())))
    sessions["split"] = np.select(
        [sessions.first_received_utc < VALIDATION_FROM, sessions.first_received_utc < TEST_FROM],
        ["train", "validation"], default="test")
    for earlier, later in [("train", "validation"), ("validation", "test")]:
        if sessions.loc[sessions.split == earlier, "last_received_utc"].max() >= \
           sessions.loc[sessions.split == later, "first_received_utc"].min():
            raise ValueError("Session boundaries overlap. Review the chronological split.")
    same_boot = packets.boot_id.eq(packets.boot_id.shift()).fillna(False)
    delta_s = packets.sample_time_s.diff()
    gap = same_boot & (packets.seq.diff().ne(1) | delta_s.le(0) | delta_s.gt(MAX_PACKET_GAP_S))
    packets["segment"] = ((~same_boot) | gap).cumsum()
    packets["bin"] = np.floor(packets.sample_time_s / WINDOW_S).astype(int)
    stats = dict(raw_rows=count, unique_packets=len(packets),
                 exact_duplicate_rows_removed=count-len(packets), boots=len(sessions),
                 valid_voltage_packets=int(packets.valid_voltage.sum()),
                 missing_voltage_packets=int(packets.battery_voltage_v.isna().sum()),
                 gyro_available_packets=int(packets.gyro_available.sum()),
                 nonzero_pwm_packets=int(packets.pwm_duty.gt(0).sum()),
                 continuity_breaks_within_boot=int(gap.sum()),
                 contiguous_segments=int(packets.segment.nunique()))
    return packets, sessions, stats


def make_block(group):
    # Battery time keeps a cached measurement from the previous bin out of its successor.
    start = int(group["bin"].iloc[0]) * WINDOW_S
    valid = group[group.valid_voltage & group.battery_sample_time_s.ge(start)]
    if len(valid) < MIN_WINDOW_READINGS:
        return None
    times = valid.sample_time_s.to_numpy()
    if times[0]-start > MAX_EDGE_GAP_S or start + WINDOW_S-times[-1] > MAX_EDGE_GAP_S:
        return None
    voltage = valid.battery_voltage_v.to_numpy()
    t = times-times.mean()
    mean_v = float(voltage.mean())
    return dict(n=len(valid), first_seq=int(valid.seq.iloc[0]), last_seq=int(valid.seq.iloc[-1]),
                received=valid.received_at_utc.iloc[-1], min_v=float(voltage.min()),
                voltage_mean_v=mean_v, voltage_last_v=float(voltage[-1]),
                last_minus_mean_v=float(voltage[-1]-mean_v),
                slope_v_per_s=float(np.dot(t, voltage-mean_v) / np.dot(t, t)),
                voltage_sd_v=float(voltage.std()),
                mean_abs_current_a=float(np.abs(valid.battery_current_a.to_numpy()).mean()),
                mean_pwm_duty=float(valid.pwm_duty.mean()))


def supervised_rows(packets, sessions):
    rows = []
    stats = dict(ten_second_bins=0, eligible_coverage_bins=0, consecutive_bin_pairs=0,
                 insufficient_coverage_pairs=0, input_below_5p5_pairs=0,
                 missing_input_feature_pairs=0)
    for (boot, seg), segment in packets.groupby(["boot_id", "segment"], sort=False):
        previous_bin, previous = None, None
        for bin_id, group in segment.groupby("bin", sort=False):
            block = make_block(group)
            stats["ten_second_bins"] += 1
            stats["eligible_coverage_bins"] += int(block is not None)
            if previous_bin is not None and bin_id == previous_bin + 1:
                stats["consecutive_bin_pairs"] += 1
                if previous is None or block is None:
                    stats["insufficient_coverage_pairs"] += 1
                elif previous["min_v"] < MIN_HISTORY_V:
                    stats["input_below_5p5_pairs"] += 1
                elif not all(np.isfinite(previous[f]) for f in FEATURES):
                    stats["missing_input_feature_pairs"] += 1
                else:
                    origin = int(bin_id)*WINDOW_S
                    rows.append(dict(boot_id=boot, split=sessions.at[boot, "split"],
                        segment=int(seg), origin_device_s=origin,
                        history_last_received_utc=previous["received"],
                        history_first_seq=previous["first_seq"], history_last_seq=previous["last_seq"],
                        target_first_seq=block["first_seq"], target_last_seq=block["last_seq"],
                        history_n=previous["n"], target_n=block["n"],
                        **{f:previous[f] for f in FEATURES},
                        voltage_last_v=previous["voltage_last_v"], next_10s_mean_v=block["voltage_mean_v"]))
            previous_bin, previous = bin_id, block
    data = pd.DataFrame(rows).sort_values(["history_last_received_utc", "boot_id", "origin_device_s"])
    data = data.reset_index(drop=True)
    if data.duplicated(["boot_id", "origin_device_s"]).any():
        raise ValueError("Duplicate forecast origins.")
    if not data.history_last_seq.lt(data.target_first_seq).all():
        raise ValueError("Input and target overlap.")
    expected = (stats["consecutive_bin_pairs"] - stats["insufficient_coverage_pairs"] -
                stats["input_below_5p5_pairs"] - stats["missing_input_feature_pairs"])
    if len(data) != expected:
        raise ValueError("Dataset flow counts do not reconcile.")
    sessions["forecast_examples"] = data.groupby("boot_id").size().reindex(sessions.index, fill_value=0)
    return data, stats


def fit_ridge(frame, alpha):
    # Model the change from the immediately preceding mean. Zero predicted change is a strong baseline.
    pipeline = make_pipeline(StandardScaler(), Ridge(alpha=alpha, solver="svd"))
    pipeline.fit(frame[FEATURES], frame[TARGET]-frame.voltage_mean_v)
    return pipeline


def estimate(pipeline, frame):
    return frame.voltage_mean_v.to_numpy() + pipeline.predict(frame[FEATURES])


def scores(actual, predicted):
    actual = np.asarray(actual, dtype=float)
    error = np.asarray(predicted)-actual
    sst = np.sum((actual-actual.mean())**2)
    return dict(n=len(actual), mae_v=float(np.abs(error).mean()),
                rmse_v=float(np.sqrt(np.mean(error**2))),
                bias_v=float(error.mean()), r2=None if sst == 0 else float(1-np.sum(error**2)/sst))


def summarize_model(pipeline, alpha, n):
    scaler, ridge = pipeline[0], pipeline[1]
    return dict(model="Ridge regression of the change in mean voltage",
                prediction="voltage_mean_v + intercept + sum(coefficient * (feature - mean) / scale)",
                output_unit="V", target=TARGET, alpha=alpha, fitting_examples=n, features=FEATURES,
                feature_mean=scaler.mean_.tolist(), feature_scale=scaler.scale_.tolist(),
                coefficient=ridge.coef_.tolist(), intercept=float(ridge.intercept_))


def predict_saved(model, frame):
    features = frame[model["features"]].to_numpy(dtype=float)
    if not np.isfinite(features).all():
        raise ValueError("All six input features must be finite.")
    z = (features-np.array(model["feature_mean"])) / np.array(model["feature_scale"])
    return frame.voltage_mean_v.to_numpy() + model["intercept"] + z @ model["coefficient"]


def build_and_evaluate(root):
    packets, sessions, audit = read_packets(root/"dataset"/"physical_packets.csv.gz")
    with (root/"dataset"/"snapshot.json").open(encoding="utf-8") as file:
        frozen = json.load(file)["audit"]
    if int(frozen["unique_packets"]) != audit["unique_packets"]:
        raise ValueError("Raw CSV does not match the frozen database count.")
    data, flow = supervised_rows(packets, sessions)
    out = root/"evaluation"
    out.mkdir(exist_ok=True)
    (root/"model").mkdir(exist_ok=True)
    write_csv(data, root/"dataset"/"AMR01_Model_Dataset.csv")
    write_csv(sessions.sort_values("first_received_utc").reset_index(), root/"dataset"/"boot_sessions.csv")
    audit.update(flow)
    split_summary = {}
    for split in ("train", "validation", "test"):
        s = sessions[sessions.split.eq(split)]
        d = data[data.split.eq(split)]
        split_summary[split] = dict(raw_packets=int(s.packets.sum()), raw_boots=len(s), examples=len(d),
            eligible_boots=int(d.boot_id.nunique()), first_received=s.first_received_utc.min().isoformat(),
            last_received=s.last_received_utc.max().isoformat())
    audit.update(examples=len(data), splits=split_summary, modeling_boots=int(data.boot_id.nunique()))
    write_json(out/"data_audit.json", audit)
    train, val, test = (data[data.split.eq(s)] for s in ("train", "validation", "test"))
    if any(d.empty for d in (train, val, test)):
        raise ValueError("A planned split has no examples.")
    validation = []
    for alpha in ALPHAS:
        predicted = estimate(fit_ridge(train, alpha), val)
        validation.append(dict(alpha=alpha, **scores(val[TARGET], predicted)))
    validation = pd.DataFrame(validation)
    write_csv(validation, out/"validation_grid.csv")
    best = float(validation.sort_values(["mae_v", "alpha"], ascending=[True, False]).iloc[0].alpha)
    fit = data[data.split.isin(["train", "validation"])]
    model = fit_ridge(fit, best)
    spec = summarize_model(model, best, len(fit))
    write_json(root/"model"/"voltage_ridge.json", spec)
    predicted = estimate(model, test)
    if not np.allclose(predicted, predict_saved(spec, test), rtol=0, atol=1e-12):
        raise ValueError("Portable model failed its prediction round trip.")
    detail = test[["boot_id", "origin_device_s", "history_last_received_utc", TARGET]].copy()
    detail["last_reading_v"] = test.voltage_last_v
    detail["previous_10s_mean_v"] = test.voltage_mean_v
    detail["ridge_v"] = predicted
    methods = {"Last reading": "last_reading_v", "Previous 10 s mean": "previous_10s_mean_v",
               "Ridge regression": "ridge_v"}
    metrics = [dict(method=name, **scores(detail[TARGET], detail[column])) for name, column in methods.items()]
    per_boot = []
    for boot, g in detail.groupby("boot_id", sort=False):
        for name, column in methods.items():
            per_boot.append(dict(boot_id=boot, method=name, **scores(g[TARGET], g[column])))
    write_csv(detail, out/"test_predictions.csv")
    write_csv(pd.DataFrame(metrics), out/"test_metrics.csv")
    write_csv(pd.DataFrame(per_boot), out/"test_metrics_by_boot.csv")
    write_json(out/"results.json", dict(alpha=best, final_fit_examples=len(fit), test_metrics=metrics,
        validation_baselines={k:scores(val[TARGET], val[col]) for k,col in
            [("Last reading","voltage_last_v"), ("Previous 10 s mean","voltage_mean_v")]},
        test_target_min_v=float(test[TARGET].min()), test_target_max_v=float(test[TARGET].max()),
        test_targets_below_5p5=int(test[TARGET].lt(5.5).sum())))
    print(f"{len(packets):,} packets; {len(data):,} examples; {len(test):,} held-out predictions.")
    print(pd.DataFrame(metrics).to_string(index=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predict", type=Path, help="CSV containing the six history features")
    parser.add_argument("--output", type=Path, help="Output CSV for prediction mode")
    args = parser.parse_args()
    if args.predict:
        if not args.output:
            parser.error("--predict requires --output")
        records = pd.read_csv(args.predict, dtype={"boot_id":"string"})
        model = json.loads((ROOT/"model"/"voltage_ridge.json").read_text(encoding="utf-8"))
        records["predicted_next_10s_mean_v"] = predict_saved(model, records)
        write_csv(records, args.output)
    else:
        build_and_evaluate(ROOT)


if __name__ == "__main__":
    main()
