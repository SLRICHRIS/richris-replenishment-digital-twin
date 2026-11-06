from dataclasses import asdict
import math

import pytest

from backend_streamlit_and_telemetry.predictive_twin.demo import demo_fleet, example_calibrations
from backend_streamlit_and_telemetry.predictive_twin.telemetry import FleetTwin, Packet


def packet(seq=0, t=0, rid='amr01', boot='boot1', count=0, gyro=.01):
    return asdict(Packet(rid, boot, seq, t, count, count, gyro, 7.4, .6, 'test'))


def send(fleet, p, received=None, retained=False):
    return fleet.ingest(p, f"robot/{p['robot_id']}/state", received=p['sample_time_s'] if received is None else received, retained=retained)


def test_single_robot_rejects_removed_identity_and_recovers_net_counts():
    f = FleetTwin(example_calibrations())
    send(f, packet())
    for removed in ('amr02', 'amr03'):
        assert not send(f, packet(rid=removed))
    assert set(f.robots) == {'amr01'}
    send(f, packet(2, .1, count=20))  # one missing packet; net counts retained
    s = f.snapshots(.1)
    assert s['amr01']['pose'][0] == pytest.approx(2 * math.pi * .033 * 20 / 600)
    assert s['amr01']['soc'] < .9


def test_duplicate_reordered_and_retired_boots_cannot_change_integrals():
    f = FleetTwin(example_calibrations())
    send(f, packet())
    send(f, packet(1, .1, count=10))
    old_pose = f.robots['amr01'].pose
    assert not send(f, packet(1, .1, count=999))
    assert not send(f, packet(0, .01))
    assert f.robots['amr01'].pose == old_pose
    send(f, packet(0, 0, boot='boot2'), received=.2)
    assert not send(f, packet(3, .3, boot='boot1'))
    # Freshness resets the integration anchor, but still rejects old sequences/boots.
    f.snapshots(4)
    assert not send(f, packet(0, 0, boot='boot2'), received=4)
    assert not send(f, packet(4, .4, boot='boot1'), received=4)
    assert f.robots['amr01'].pose == old_pose


def test_hold_timer_stale_invalid_gap_and_reboot_reset():
    f = FleetTwin(example_calibrations())
    send(f, packet())
    for seq in range(1, 7):
        send(f, packet(seq, seq * .1, gyro=.2))
    assert f.snapshots(.6)['amr01']['derived']['advisory']
    assert f.snapshots(3)['amr01']['stale']
    assert f.robots['amr01'].detector.duration_s == 0
    send(f, packet(7, .7, gyro=.2), received=3.1)
    assert f.snapshots(3.1)['amr01']['derived'] == {}
    send(f, packet(8, .8, gyro=.2), received=3.2)
    assert not f.snapshots(3.2)['amr01']['derived']['advisory']
    send(f, packet(9, 2.5, count=200, gyro=.2), received=3.3)
    assert f.snapshots(3.3)['amr01']['derived'] == {}
    assert f.snapshots(3.3)['amr01']['continuity_lost']
    bad = packet(10, 2.6); bad['gyro_z_rad_s'] = None
    assert not send(f, bad, received=3.4)
    assert f.robots['amr01'].detector.duration_s == 0
    assert f.robots['amr01'].previous is None


def test_device_time_drives_integrals_not_network_interval():
    f = FleetTwin(example_calibrations())
    send(f, packet(), received=10)
    send(f, packet(1, .05), received=11)
    assert f.robots['amr01'].energy_wh == pytest.approx(7.4 * .6 * .05 / 3600)
    assert f.robots['amr01'].soc == pytest.approx(.9 - .6 * .05 / 7200)


def test_backwards_clock_breaks_anchor_without_integrating():
    f = FleetTwin(example_calibrations())
    send(f, packet())
    send(f, packet(1, .1))
    assert not send(f, packet(2, .05))
    assert f.robots['amr01'].continuity_lost


def test_topic_identity_finiteness_and_retained_packets():
    f = FleetTwin(example_calibrations())
    assert not f.ingest(packet(), 'robot/amr02/state', received=0)
    assert not send(f, packet(), retained=True)
    for key, value in [('encoder_left_count', True), ('seq', -1), ('sample_time_s', float('nan')),
                       ('gyro_z_rad_s', float('inf')), ('battery_voltage_v', 0), ('boot_id', '')]:
        p = packet(); p[key] = value
        assert not send(f, p)
    assert not f.ingest(b'invalid-json', 'robot/amr01/state', received=0)
    assert not f.ingest([], 'robot/amr01/state', received=0)


def test_demo_injected_residual_clears_for_amr01():
    f = demo_fleet()
    a = f.snapshots(6)['amr01']
    assert any(row['advisory'] for row in a['history'])
    assert a['derived']['advisory'] is False  # cleared after the injected disagreement
