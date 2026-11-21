"""Build and evaluate one-second AMR-01 gyro forecasts from the frozen packet export."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor


ROOT = Path(__file__).resolve().parent
PACKET_FIELDS = [
    "robot_id", "boot_id", "seq", "received_at_utc", "sample_time_s", "interval_s",
    "firmware_revision", "gyro_available", "imu_who_am_i", "imu_sample_time_s",
    "gyro_x_dps", "gyro_y_dps", "gyro_z_dps", "gyro_bias_estimate_rad_s",
    "motor_output", "pwm_duty", "payload_sha256",
]
HISTORY = ["z_lag3_dps", "z_lag2_dps", "z_lag1_dps", "z_now_dps"]
FEATURES = HISTORY + ["history_median_dps", "history_range_dps"]
TARGET = "next_two_mean_z_dps"
SPLITS = ["train", "validation", "test"]
TARGET_METHOD = "Boosted trees"
BASELINES = ["Zero rate", "Last reading", "Four-reading mean", "Four-reading median"]
VALIDATION_START = pd.Timestamp("2026-11-19 00:00", tz="Asia/Kolkata")
TEST_START = pd.Timestamp("2026-11-20 00:00", tz="Asia/Kolkata")
HIGH_RATE_DPS = 10.0
SEED = 42


def csv_out(frame, path):
    frame.to_csv(path, index=False, float_format="%.15g", lineterminator="\n")


def json_out(obj, path):
    path.write_text(json.dumps(obj, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def prepare_packets(path):
    p = pd.read_csv(path, usecols=PACKET_FIELDS, low_memory=False,
                    dtype={"robot_id":"string", "boot_id":"string", "payload_sha256":"string",
                           "firmware_revision":"string"}, true_values=["true","True"],
                    false_values=["false","False"])
    p = p[PACKET_FIELDS]
    raw_n = len(p)
    p = p.drop_duplicates().sort_values(["boot_id", "seq"]).reset_index(drop=True)
    key = ["robot_id", "boot_id", "seq"]
    if p.duplicated(key).any() or p[key].isna().any().any() or not p.robot_id.eq("amr01").all():
        raise ValueError("Invalid or conflicting AMR-01 packet identities.")
    if p.gyro_available.isna().any() or not pd.api.types.is_bool_dtype(p.gyro_available):
        raise ValueError("The gyro availability field must be boolean.")
    if not p.payload_sha256.str.fullmatch("[0-9a-f]{64}").fillna(False).all():
        raise ValueError("A source packet fingerprint is missing.")
    p["receipt"] = pd.to_datetime(p.received_at_utc, utc=True)
    sessions = p.groupby("boot_id").agg(first_receipt_utc=("receipt", "min"),
        last_receipt_utc=("receipt", "max"), raw_packets=("seq", "size"))
    sessions["split"] = np.select(
        [sessions.first_receipt_utc < VALIDATION_START, sessions.first_receipt_utc < TEST_START],
        ["train","validation"], default="test")
    for earlier, later in zip(SPLITS, SPLITS[1:]):
        if sessions.loc[sessions.split.eq(earlier), "last_receipt_utc"].max() >= \
           sessions.loc[sessions.split.eq(later), "first_receipt_utc"].min():
            raise ValueError("Boot time ranges overlap a planned split.")
    age = p.sample_time_s - p.imu_sample_time_s
    finite = np.isfinite(p[["gyro_x_dps","gyro_y_dps","gyro_z_dps",
                             "sample_time_s","imu_sample_time_s"]]).all(axis=1)
    p["fresh_gyro"] = p.gyro_available & finite & age.between(-1e-6, 0.100001)
    p["usable"] = p.fresh_gyro & np.isfinite(p.gyro_bias_estimate_rad_s)
    p["z_dps"] = p.gyro_z_dps - np.rad2deg(p.gyro_bias_estimate_rad_s)
    prev_usable = p.usable.shift(fill_value=False)
    continued = (p.usable & prev_usable & p.boot_id.eq(p.boot_id.shift()).fillna(False) &
                 p.seq.diff().eq(1) & p.sample_time_s.diff().between(.45,.55) &
                 p.imu_sample_time_s.diff().between(.45,.55) &
                 p.gyro_bias_estimate_rad_s.eq(p.gyro_bias_estimate_rad_s.shift()))
    p["segment"] = (p.usable & ~continued).cumsum()
    q = p[p.usable].copy()
    sessions["available_gyro_packets"] = p.groupby("boot_id").fresh_gyro.sum()
    sessions["calibrated_gyro_packets"] = p.groupby("boot_id").usable.sum()
    sessions["calibrated_packets_with_pwm"] = (p.usable & p.pwm_duty.gt(0)).groupby(p.boot_id).sum()
    audit = dict(raw_rows=raw_n, unique_packets=len(p), exact_duplicates_removed=raw_n-len(p),
        raw_boots=len(sessions), flag_valid=int(p.gyro_available.sum()), fresh_gyro_packets=int(p.fresh_gyro.sum()),
        fresh_gyro_boots=int(p.loc[p.fresh_gyro,"boot_id"].nunique()),
        unusable_flag_or_freshness=int((~p.fresh_gyro).sum()),
        fresh_without_bias=int((p.fresh_gyro & ~p.usable).sum()), calibrated_packets=len(q),
        calibrated_boots=int(q.boot_id.nunique()), valid_segments=int(q.segment.nunique()),
        calibrated_packets_with_pwm=int(q.pwm_duty.gt(0).sum()),
        first_received=p.receipt.min().isoformat(), last_received=p.receipt.max().isoformat())
    return p, q, sessions, audit


def build_examples(q, sessions, audit):
    frames = []
    short_points = small_segments = tail_points = 0
    for (boot, seg), g in q.groupby(["boot_id","segment"], sort=False):
        if len(g) < 6:
            small_segments += 1
            short_points += len(g)
            continue
        starts = np.arange(0, len(g)-5, 2)
        idx = starts[:, None] + np.arange(6)
        z = g.z_dps.to_numpy()[idx]
        t = g.imu_sample_time_s.to_numpy()[idx]
        seq = g.seq.to_numpy()[idx]
        pwm = g.pwm_duty.to_numpy()[idx]
        history = z[:, :4]
        frame = dict(boot_id=boot, split=sessions.at[boot,"split"], segment=int(seg),
            history_first_seq=seq[:,0], history_last_seq=seq[:,3], target_first_seq=seq[:,4],
            target_last_seq=seq[:,5], origin_imu_s=t[:,3], target_end_imu_s=t[:,5],
            origin_received_utc=g.received_at_utc.to_numpy()[idx[:,3]],
            startup_bias_dps=float(np.rad2deg(g.gyro_bias_estimate_rad_s.iloc[0])))
        frame.update({name:history[:,i] for i,name in enumerate(HISTORY)})
        frame.update(history_median_dps=np.median(history,axis=1),
            history_range_dps=np.ptp(history,axis=1), history_mean_dps=history.mean(axis=1),
            future_z1_dps=z[:,4], future_z2_dps=z[:,5], next_two_mean_z_dps=z[:,4:6].mean(axis=1),
            history_any_pwm=(pwm[:,:4]>0).any(axis=1), target_any_pwm=(pwm[:,4:]>0).any(axis=1))
        frames.append(pd.DataFrame(frame))
        tail_points += int(len(g)-int(idx[-1,-1])-1)
    if not frames:
        raise ValueError("No uninterrupted groups of six calibrated packets were found.")
    data = pd.concat(frames, ignore_index=True).sort_values(["origin_received_utc","boot_id","history_last_seq"]).reset_index(drop=True)
    if data.duplicated(["boot_id","history_last_seq"]).any():
        raise ValueError("Duplicate forecast origins.")
    if not data.history_last_seq.lt(data.target_first_seq).all():
        raise ValueError("Past and future sequence ranges overlap.")
    unique_target_ids = pd.concat([data[["boot_id",column]].rename(columns={column:"seq"})
                                   for column in ["target_first_seq","target_last_seq"]])
    if unique_target_ids.duplicated().any():
        raise ValueError("An observation appears twice as a label.")
    per_boot=data.groupby("boot_id").agg(examples=("history_last_seq","size"),
        target_pwm_examples=("target_any_pwm","sum"))
    sessions[["examples","target_pwm_examples"]] = per_boot.reindex(sessions.index, fill_value=0)
    splits = {}
    for split in SPLITS:
        d=data[data.split.eq(split)]
        s=sessions[sessions.split.eq(split)]
        if d.empty:
            raise ValueError("A planned split has no examples.")
        splits[split] = dict(raw_boots=len(s), raw_packets=int(s.raw_packets.sum()),
            calibrated_packets=int(s.calibrated_gyro_packets.sum()), examples=len(d),
            eligible_boots=int(d.boot_id.nunique()), target_pwm_examples=int(d.target_any_pwm.sum()),
            target_pwm_boots=int(d.loc[d.target_any_pwm,"boot_id"].nunique()))
    horizon = data.target_end_imu_s-data.origin_imu_s
    audit.update(examples=len(data), eligible_boots=int(data.boot_id.nunique()), splits=splits,
        segments_too_short=small_segments, packets_in_short_segments=short_points,
        unused_tail_packets_in_eligible_segments=tail_points, target_packets=2*len(data),
        median_horizon_s=float(horizon.median()), min_horizon_s=float(horizon.min()),
        max_horizon_s=float(horizon.max()), high_rate_threshold_dps=HIGH_RATE_DPS)
    return data


def baseline_predictions(df):
    return {"Zero rate":np.zeros(len(df)), "Last reading":df.z_now_dps.to_numpy(),
            "Four-reading mean":df.history_mean_dps.to_numpy(),
            "Four-reading median":df.history_median_dps.to_numpy()}


def fit_model(df, depth, leaf_size):
    model=GradientBoostingRegressor(loss="absolute_error", n_estimators=80, learning_rate=0.06,
        max_depth=depth, min_samples_leaf=leaf_size, random_state=SEED)
    return model.fit(df[FEATURES],df[TARGET])


def metrics(actual,pred):
    actual=np.asarray(actual,dtype=float)
    error=np.asarray(pred,dtype=float)-actual
    sst=np.square(actual-actual.mean()).sum()
    return dict(n=len(actual), mae_dps=float(np.abs(error).mean()),
        rmse_dps=float(np.sqrt(np.square(error).mean())), bias_dps=float(error.mean()),
        r2=None if sst==0 else float(1-np.square(error).sum()/sst))


def export_model(fit, depth, leaf_size, rows):
    trees=[]
    for estimator in fit.estimators_[:,0]:
        tree=estimator.tree_
        trees.append(dict(left=tree.children_left.tolist(), right=tree.children_right.tolist(),
            feature=tree.feature.tolist(), threshold=tree.threshold.tolist(),
            value=tree.value[:,0,0].tolist()))
    return dict(method=TARGET_METHOD, units="degrees per second", target=TARGET,
        features=FEATURES, initial=float(fit.init_.constant_[0,0]), learning_rate=fit.learning_rate,
        max_depth=depth, min_samples_leaf=leaf_size, loss="absolute_error",
        training_rows=rows, trees=trees)


def predict_saved(spec,frame):
    # sklearn's individual decision trees threshold float32 inputs.
    X=frame[spec["features"]].to_numpy(dtype=np.float32)
    if not np.isfinite(X).all():
        raise ValueError("Six finite gyro feature values are required.")
    out=np.full(len(X),spec["initial"],dtype=float)
    rid=np.arange(len(X))
    for tree in spec["trees"]:
        left=np.asarray(tree["left"]);right=np.asarray(tree["right"])
        feature=np.asarray(tree["feature"]);threshold=np.asarray(tree["threshold"])
        node=np.zeros(len(X),dtype=int)
        active=left[node]>=0
        while np.any(active):
            r=rid[active];i=node[r]
            node[r]=np.where(X[r,feature[i]].astype(float)<=threshold[i],left[i],right[i])
            active=left[node]>=0
        out+=spec["learning_rate"]*np.asarray(tree["value"])[node]
    return out


def paired_boot_interval(frame, baseline_column):
    # Keep all forecasts of a sampled boot together. Positive means lower model MAE.
    err_base=(frame[baseline_column]-frame[TARGET]).abs()
    err_model=(frame[TARGET_METHOD]-frame[TARGET]).abs()
    grouped=(err_base-err_model).groupby(frame.boot_id).agg(["sum","size"])
    rng=np.random.default_rng(SEED)
    picks=rng.integers(len(grouped),size=(2000,len(grouped)))
    delta=grouped["sum"].to_numpy()[picks].sum(axis=1)/grouped["size"].to_numpy()[picks].sum(axis=1)
    return dict(baseline=baseline_column, pooled_mae_gain_dps=float((err_base-err_model).mean()),
        low95_dps=float(np.quantile(delta,0.025)), high95_dps=float(np.quantile(delta,0.975)),
        test_boots=len(grouped), resamples=len(delta),seed=SEED)


def inspect_offsets(p, q, sessions, preds, output):
    # Descriptive sensitivity analysis. All test boots remain in the primary results.
    offsets=q.groupby("boot_id").agg(raw_median_z_dps=("gyro_z_dps","median"),
        median_bias_rad_s=("gyro_bias_estimate_rad_s","median"),
        corrected_median_z_dps=("z_dps","median"))
    offsets["median_bias_dps"]=np.rad2deg(offsets.median_bias_rad_s)
    inventory=sessions.join(offsets)
    inventory["all_nonzero_pwm_packets"]=p.pwm_duty.gt(0).groupby(p.boot_id).sum()
    csv_out(inventory.reset_index(),output/"boot_gyro_offsets.csv")
    eligible=inventory[inventory.split.eq("test") & inventory.examples.ge(100) &
                       inventory.all_nonzero_pwm_packets.eq(0)]
    if eligible.empty:
        return {}
    boot=eligible.corrected_median_z_dps.abs().idxmax()
    x=inventory.loc[boot]
    rows=[]
    for label,subset in [("Flagged boot",preds[preds.boot_id.eq(boot)]),
                         ("Other test boots",preds[preds.boot_id.ne(boot)])]:
        if subset.empty:
            continue
        for name in BASELINES+[TARGET_METHOD]:
            rows.append(dict(group=label,method=name,boots=int(subset.boot_id.nunique()),
                             **metrics(subset[TARGET],subset[name])))
    csv_out(pd.DataFrame(rows),output/"offset_sensitivity.csv")
    return dict(boot_id=str(boot), all_packets=int(x.raw_packets), fresh_calibrated_packets=int(x.calibrated_gyro_packets),
        test_examples=int(x.examples), raw_median_z_dps=float(x.raw_median_z_dps),
        median_bias_rad_s=float(x.median_bias_rad_s), median_bias_dps=float(x.median_bias_dps),
        corrected_median_z_dps=float(x.corrected_median_z_dps), all_nonzero_pwm_packets=int(x.all_nonzero_pwm_packets))


def run(source, extract):
    p,q,sessions,audit=prepare_packets(source)
    if extract:
        csv_out(p[PACKET_FIELDS],ROOT/"data"/"AMR01_Gyro_Packets.csv.gz")
    data=build_examples(q,sessions,audit)
    csv_out(data, ROOT/"data"/"AMR01_Gyro_Model_Dataset.csv")
    csv_out(sessions.sort_values("first_receipt_utc").reset_index(),ROOT/"data"/"boot_sessions.csv")
    E=ROOT/"evaluation"
    json_out(audit,E/"data_audit.json")
    train,val,test=[data.loc[data.split.eq(s)] for s in SPLITS]
    grid=[]
    for depth in (2,3):
        for leaf_size in (20,60):
            reg=fit_model(train,depth,leaf_size)
            grid.append(dict(depth=depth,leaf_size=leaf_size,
                **metrics(val[TARGET],reg.predict(val[FEATURES]))))
    grid=pd.DataFrame(grid)
    csv_out(grid,E/"validation_grid.csv")
    chosen=grid.sort_values(["mae_dps","depth","leaf_size"],ascending=[True,True,False]).iloc[0]
    depth,leaf=int(chosen.depth),int(chosen.leaf_size)
    val_b=[dict(method=k,**metrics(val[TARGET],v)) for k,v in baseline_predictions(val).items()]
    val_b=pd.DataFrame(val_b)
    csv_out(val_b,E/"validation_baselines.csv")
    reference=val_b.sort_values("mae_dps",kind="stable").iloc[0].method
    fit=data[data.split.ne("test")]
    reg=fit_model(fit,depth,leaf)
    spec=export_model(reg,depth,leaf,len(fit))
    json_out(spec,ROOT/"model"/"gyro_forecaster.json")
    yhat=reg.predict(test[FEATURES])
    np.testing.assert_allclose(predict_saved(spec,test),yhat,rtol=0,atol=1e-12)
    preds=test[["boot_id","origin_received_utc","history_last_seq","target_first_seq","target_last_seq",
                "origin_imu_s","target_end_imu_s",TARGET,"history_any_pwm","target_any_pwm"]].copy()
    for name,values in baseline_predictions(test).items():
        preds[name]=values
    preds[TARGET_METHOD]=yhat
    csv_out(preds,E/"test_predictions.csv")
    categories={"All":np.ones(len(test),dtype=bool),"Target PWM active":preds.target_any_pwm,
        "Target PWM zero":~preds.target_any_pwm,
        "Absolute target at least 10 dps":preds[TARGET].abs().ge(HIGH_RATE_DPS)}
    tables=[]
    for label,rows in categories.items():
        g=preds.loc[rows]
        if not len(g):
            continue
        for method in BASELINES+[TARGET_METHOD]:
            tables.append(dict(group=label, method=method,boots=int(g.boot_id.nunique()),
                **metrics(g[TARGET],g[method])))
    csv_out(pd.DataFrame(tables),E/"test_metrics.csv")
    by_boot=[]
    for boot,g in preds.groupby("boot_id",sort=False):
        for method in BASELINES+[TARGET_METHOD]:
            by_boot.append(dict(boot_id=boot, method=method, active_windows=int(g.target_any_pwm.sum()),
                **metrics(g[TARGET],g[method])))
    csv_out(pd.DataFrame(by_boot),E/"test_metrics_by_boot.csv")
    offset_check=inspect_offsets(p,q,sessions,preds,E)
    result=dict(chosen_depth=depth,chosen_min_leaf=leaf,trees=80,learning_rate=.06,
        validation_model_mae_dps=float(chosen.mae_dps), validation_reference=reference,
        validation_reference_mae_dps=float(val_b.loc[val_b.method.eq(reference),"mae_dps"].iloc[0]),
        final_fit_examples=len(fit), test_metrics=tables, paired_boot_comparison=paired_boot_interval(preds,reference),
        offset_check=offset_check,
        test_true_target_min_dps=float(test[TARGET].min()),test_true_target_max_dps=float(test[TARGET].max()))
    json_out(result,E/"results.json")
    print(f"{len(q):,} calibrated packets; {len(data):,} examples; {len(test):,} test origins.")
    print(pd.DataFrame(tables).query("group == 'All'").to_string(index=False))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",type=Path,default=ROOT/"data"/"AMR01_Gyro_Packets.csv.gz")
    parser.add_argument("--extract",action="store_true",help="Save the 17-column gyro packet projection.")
    parser.add_argument("--predict",type=Path,help="Apply the saved model to six past gyro features.")
    parser.add_argument("--output",type=Path)
    args=parser.parse_args()
    if args.predict:
        if not args.output:
            parser.error("--predict requires --output")
        data=pd.read_csv(args.predict,dtype={"boot_id":"string"})
        spec=json.loads((ROOT/"model"/"gyro_forecaster.json").read_text(encoding="utf-8"))
        data["forecast_next_two_mean_z_dps"]=predict_saved(spec,data)
        csv_out(data,args.output)
    else:
        run(args.source,args.extract)


if __name__=="__main__":
    main()
