"""Read-only, incremental motor-branch energy from durable commissioning rows.

This display estimate needs voltage, current and sample times, not wheel/model
calibration or a battery capacity. It never supplies SOC or motor permission.
"""
from math import isfinite
import threading
from weakref import WeakKeyDictionary

from sqlalchemy import select

MAX_INTERVAL_S = 2.0
READ_BATCH = 2000
_monitors = WeakKeyDictionary()
_monitors_lock = threading.Lock()


def finite(value):
    return type(value) in (int, float) and isfinite(value)


class EnergyAccumulator:
    def __init__(self, boot_id):
        self.boot_id = boot_id
        self.last_seq = -1
        self.previous = None
        self.net_wh = self.covered_s = 0.0
        self.intervals = self.skipped = self.sample_count = 0
        self.first_time_s = None

    def extend(self, rows):
        for row in rows:
            if row['boot_id'] != self.boot_id or row['seq'] <= self.last_seq:
                continue
            self.last_seq = row['seq']
            self.sample_count += 1
            if self.first_time_s is None:
                self.first_time_s = row['sample_time_s']
            valid = (row['battery_available'] is True
                     and finite(row['battery_voltage_v']) and 0 < row['battery_voltage_v'] <= 32
                     and finite(row['battery_current_a'])
                     and finite(row['battery_voltage_v']*row['battery_current_a'])
                     and finite(row['battery_sample_time_s']) and finite(row['sample_time_s'])
                     and 0 <= row['sample_time_s']-row['battery_sample_time_s'] <= .500001)
            if not valid:
                self.previous = None
                self.skipped += 1
                continue
            previous = self.previous
            if previous:
                dt = row['battery_sample_time_s']-previous['battery_sample_time_s']
                sample_dt = row['sample_time_s']-previous['sample_time_s']
                consecutive = row['seq'] == previous['seq']+1
                if consecutive and 0 < sample_dt <= MAX_INTERVAL_S and 0 < dt <= MAX_INTERVAL_S:
                    p0 = previous['battery_voltage_v']*previous['battery_current_a']
                    p1 = row['battery_voltage_v']*row['battery_current_a']
                    self.net_wh += (p0+p1)*.5*dt/3600
                    self.covered_s += dt
                    self.intervals += 1
                elif not (consecutive and 0 < sample_dt <= MAX_INTERVAL_S and dt == 0):
                    # Repeated battery timestamps add no elapsed time. Missing
                    # packets, long pauses and backwards clocks are never bridged.
                    self.skipped += 1
            self.previous = dict(row)

    def public(self, target_seq):
        complete = self.last_seq == target_seq
        state = 'loading' if not complete else 'ready' if self.intervals else 'anchoring'
        return dict(state=state, net_wh=self.net_wh if complete and self.intervals else None,
                    covered_s=self.covered_s, intervals=self.intervals,
                    skipped_intervals=self.skipped, samples=self.sample_count,
                    first_sample_time_s=self.first_time_s, scope='recorded_motor_branch')


class EnergyMonitor:
    def __init__(self):
        self.lock = threading.Lock()
        self.accumulator = None

    def read(self, connection, table, latest):
        with self.lock:
            if self.accumulator is None or self.accumulator.boot_id != latest['boot_id']:
                self.accumulator = EnergyAccumulator(latest['boot_id'])
            accumulator = self.accumulator
            if accumulator.last_seq < latest['seq']:
                fields = ('boot_id', 'seq', 'sample_time_s', 'battery_sample_time_s',
                          'battery_available', 'battery_voltage_v', 'battery_current_a')
                query = select(*(table.c[name] for name in fields)).where(
                    table.c.robot_id == 'amr01', table.c.boot_id == latest['boot_id'],
                    table.c.seq > accumulator.last_seq, table.c.seq <= latest['seq'],
                ).order_by(table.c.seq).limit(READ_BATCH)
                accumulator.extend(connection.execute(query).mappings().all())
            return accumulator.public(latest['seq'])


def observed_energy(connection, table, latest):
    # Cached resources are shared by sessions. Bound memory to one boot per
    # engine, serialize its cursor, and recover from database rows after restart.
    with _monitors_lock:
        monitor = _monitors.setdefault(connection.engine, EnergyMonitor())
    return monitor.read(connection, table, latest)
