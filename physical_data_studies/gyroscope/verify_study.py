"""Independently check every forecast origin against the six source packets."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from gyro_study import FEATURES, HISTORY, TARGET, TARGET_METHOD, predict_saved

ROOT=Path(__file__).resolve().parent
P=ROOT/"data"
E=ROOT/"evaluation"


def verify():
    d=pd.read_csv(P/"AMR01_Gyro_Packets.csv.gz",dtype={"boot_id":"string"},low_memory=False)
    x=pd.read_csv(P/"AMR01_Gyro_Model_Dataset.csv",dtype={"boot_id":"string"},low_memory=False)
    audit=json.loads((E/"data_audit.json").read_text(encoding="utf-8"))
    assert d[["robot_id","boot_id","seq"]].duplicated().sum()==0
    assert len(d)==audit["unique_packets"] and d.boot_id.nunique()==audit["raw_boots"]
    assert d.gyro_available.sum()==audit["flag_valid"]
    assert x.groupby("boot_id").split.nunique().eq(1).all()
    assert len(x)==audit["examples"]
    source=d.set_index(["boot_id","seq"],verify_integrity=True)
    references=[]
    for k in range(-3,3):
        keys=pd.MultiIndex.from_arrays([x.boot_id,x.history_last_seq+k],names=["boot_id","seq"])
        picked=source.loc[keys].reset_index(drop=True)
        assert picked.gyro_available.all()
        assert np.isfinite(picked[["gyro_x_dps","gyro_y_dps","gyro_z_dps","gyro_bias_estimate_rad_s"]]).all().all()
        assert (picked.sample_time_s-picked.imu_sample_time_s).between(-1e-6,.100001).all()
        references.append(picked)
    def matrix(name):
        return np.column_stack([v[name].to_numpy() for v in references])
    assert np.all((np.diff(matrix("sample_time_s"),axis=1)>=.45) & (np.diff(matrix("sample_time_s"),axis=1)<=.55))
    assert np.all((np.diff(matrix("imu_sample_time_s"),axis=1)>=.45) & (np.diff(matrix("imu_sample_time_s"),axis=1)<=.55))
    assert np.all(np.ptp(matrix("gyro_bias_estimate_rad_s"),axis=1)==0)
    z=matrix("gyro_z_dps")-matrix("gyro_bias_estimate_rad_s")*180/np.pi
    np.testing.assert_allclose(x[HISTORY],z[:,:4],atol=1e-10,rtol=0)
    np.testing.assert_allclose(x.history_median_dps,np.median(z[:,:4],axis=1),atol=1e-10,rtol=0)
    np.testing.assert_allclose(x.history_range_dps,np.ptp(z[:,:4],axis=1),atol=1e-10,rtol=0)
    np.testing.assert_allclose(x[TARGET],z[:,4:].mean(axis=1),atol=1e-10,rtol=0)
    np.testing.assert_array_equal(x.target_any_pwm,(matrix("pwm_duty")[:,4:]>0).any(axis=1))
    assert x.history_first_seq.eq(x.history_last_seq-3).all()
    assert x.target_first_seq.eq(x.history_last_seq+1).all()
    assert x.target_last_seq.eq(x.history_last_seq+2).all()
    k=pd.concat([x[["boot_id",col]].rename(columns={col:"seq"}) for col in ["target_first_seq","target_last_seq"]])
    assert not k.duplicated().any()
    source_clock=pd.to_datetime(d.received_at_utc,utc=True)
    clocks=source_clock.groupby(d.boot_id).agg(["min","max"])
    nov19=pd.Timestamp("2026-11-19",tz="Asia/Kolkata")
    nov20=pd.Timestamp("2026-11-20",tz="Asia/Kolkata")
    clocks["expected"]=np.where(clocks["min"]<nov19,"train",np.where(clocks["min"]<nov20,"validation","test"))
    assert x.boot_id.map(clocks.expected).eq(x.split).all()
    for early,late in [("train","validation"),("validation","test")]:
        assert clocks.loc[clocks.expected.eq(early),"max"].max()<clocks.loc[clocks.expected.eq(late),"min"].min()
    test=x.loc[x.split.eq("test")].copy()
    saved=pd.read_csv(E/"test_predictions.csv",dtype={"boot_id":"string"})
    assert len(saved)==len(test)
    keys=["boot_id","history_last_seq"]
    check=test.merge(saved[keys+[TARGET_METHOD]],on=keys,validate="one_to_one")
    assert len(check)==len(test)
    spec=json.loads((ROOT/"model"/"gyro_forecaster.json").read_text(encoding="utf-8"))
    predictions=predict_saved(spec,check[FEATURES])
    np.testing.assert_allclose(check[TARGET_METHOD],predictions,atol=1e-9,rtol=0)
    m=pd.read_csv(E/"test_metrics.csv")
    for col,mask in {"All":np.ones(len(saved),dtype=bool),"Target PWM active":saved.target_any_pwm,
                     "Target PWM zero":~saved.target_any_pwm,
                     "Absolute target at least 10 dps":saved[TARGET].abs().ge(10)}.items():
        subset=saved.loc[mask]
        for row in m[m.group.eq(col)].itertuples():
            err=subset[row.method]-subset[TARGET]
            assert int(row.n)==len(subset)
            assert abs(np.abs(err).mean()-row.mae_dps)<1e-10
            assert abs(np.sqrt(np.square(err).mean())-row.rmse_dps)<1e-10
    print(f"Verified {len(d):,} source identities, {len(x):,} labelled examples, {len(saved):,} saved-model forecasts and the subgroup scores.")


if __name__=="__main__":
    verify()
