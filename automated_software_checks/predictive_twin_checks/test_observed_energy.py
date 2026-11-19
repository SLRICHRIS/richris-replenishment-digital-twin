"""Numerical and recovery checks; no hardware or production writes."""
import pytest

from backend_streamlit_and_telemetry.predictive_twin.observed_energy import EnergyAccumulator


def row(seq, time_s, voltage=12.0, current=1.0, boot='a'*16, valid=True, battery_time=None):
    return dict(boot_id=boot, seq=seq, sample_time_s=time_s,
                battery_sample_time_s=time_s if battery_time is None else battery_time,
                battery_available=valid, battery_voltage_v=voltage, battery_current_a=current)


def test_constant_power_and_signed_reverse_current_have_correct_wh_units():
    accumulator=EnergyAccumulator('a'*16)
    accumulator.extend([row(seq,seq) for seq in range(3601)])
    result=accumulator.public(3600)
    assert result['net_wh']==pytest.approx(12.0)
    assert result['covered_s']==3600 and result['intervals']==3600
    reverse=EnergyAccumulator('a'*16)
    reverse.extend([row(seq,seq,current=-.5) for seq in range(3601)])
    assert reverse.public(3600)['net_wh']==pytest.approx(-6.0)


def test_trapezoidal_acquisition_time_and_repeated_refresh_never_double_count():
    accumulator=EnergyAccumulator('a'*16)
    records=[row(5,1,voltage=10,current=1,battery_time=.9),
             row(6,2,voltage=10,current=3,battery_time=1.9)]
    accumulator.extend(records)
    accumulator.extend(records)
    result=accumulator.public(6)
    assert result['net_wh']==pytest.approx(20/3600)
    assert result['intervals']==1 and result['samples']==2
    assert accumulator.public(7)['net_wh'] is None


def test_gaps_invalid_readings_and_reboots_are_not_integrated_across():
    accumulator=EnergyAccumulator('a'*16)
    accumulator.extend([row(0,0),row(1,1),row(3,3),row(4,4),
                        row(5,5,valid=False),row(6,6),row(7,7),
                        row(8,20),row(9,21),row(10,22,boot='b'*16)])
    result=accumulator.public(9)
    assert result['net_wh']==pytest.approx(4*12/3600)
    assert result['covered_s']==4 and result['skipped_intervals']==3
    assert result['samples']==9
    restarted=EnergyAccumulator('b'*16)
    restarted.extend([row(0,0,boot='b'*16)])
    assert restarted.public(0)['state']=='anchoring'
    assert restarted.public(0)['net_wh'] is None


def test_duplicate_sensor_time_adds_no_energy_and_backwards_time_breaks_interval():
    accumulator=EnergyAccumulator('a'*16)
    accumulator.extend([row(0,1,battery_time=1),row(1,1.2,battery_time=1),
                        row(2,2,battery_time=2),row(3,1,battery_time=1),
                        row(4,2,battery_time=2)])
    result=accumulator.public(4)
    assert result['net_wh']==pytest.approx(24/3600)
    assert result['covered_s']==2 and result['skipped_intervals']==1


@pytest.mark.parametrize('fields', [
    {'battery_voltage_v':float('nan')}, {'battery_current_a':float('inf')},
    {'battery_sample_time_s':None}, {'battery_voltage_v':0},
    {'battery_sample_time_s':-1}, {'battery_available':False},
])
def test_invalid_electrical_samples_cannot_create_a_total(fields):
    accumulator=EnergyAccumulator('a'*16)
    invalid=row(1,1); invalid.update(fields)
    accumulator.extend([row(0,0),invalid,row(2,2)])
    assert accumulator.public(2)['net_wh'] is None
