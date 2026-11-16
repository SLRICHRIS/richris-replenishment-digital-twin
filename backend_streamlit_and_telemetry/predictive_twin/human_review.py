"""Human review, durable intervention audit and evidence-based outcome checks.

The website records physical decisions through its protected server service.
Generated rehearsals use isolated memory. MQTT credentials stay on the server.
"""
from copy import deepcopy
import math
import re
import threading
import time

from sqlalchemy import (MetaData, Table, Column, String, Float, Integer, JSON,
                        Index, BigInteger, select, update, text)
from .insights import predictive_insights

metadata = MetaData()
reviews = Table('amr_operator_reviews', metadata,
    Column('review_id', String(32), primary_key=True),
    Column('robot_id', String(16), nullable=False),
    Column('created_at', Float, nullable=False),
    Column('expires_at', Float, nullable=False),
    Column('state', String(32), nullable=False),
    Column('evidence', JSON, nullable=False),
    Column('decision', JSON), Column('command', JSON), Column('ack', JSON),
    Column('events', JSON, nullable=False),
    Column('verified_samples', Integer, nullable=False, default=0),
    Column('last_verified_seq', BigInteger, nullable=False, default=-1))
Index('ix_amr_reviews_state_created', reviews.c.state, reviews.c.created_at)
TERMINAL = {'reviewed', 'rejected', 'deferred', 'expired', 'blocked', 'verified', 'uncertain'}
ACTIONS = {'no_action', 'reduce_speed', 'pause'}
COMMAND_TOPIC = 'robot/amr01/commands'
ACK_TOPIC = 'robot/amr01/command_ack'
LABELS = {'pending':'Awaiting human review', 'dispatching':'Sending approved request',
          'sent':'Awaiting controller acknowledgement', 'acknowledged':'Checking new sensor readings',
          'reviewed':'Reviewed · no command issued', 'rejected':'Intervention rejected',
          'deferred':'Review deferred', 'expired':'Review expired', 'blocked':'Approved · delivery unavailable',
          'verified':'Observed effect verified', 'uncertain':'Outcome unconfirmed'}


def valid_id(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{32}', value) is not None


def evidence(payload):
    """Only validated server-side model context can authorize a review."""
    r = payload.get('robots', {}).get('amr01') or {}
    guidance = predictive_insights(payload)
    age = r.get('age_s', 0 if payload.get('mode') == 'demo' else None)
    if (not guidance['ready'] or isinstance(age, bool) or not isinstance(age, (int, float))
            or not math.isfinite(age) or not 0 <= age <= 2):
        raise ValueError('Fresh, continuous, calibrated sensor readings are required')
    raw = r['raw']
    if (raw.get('robot_id') != 'amr01' or not isinstance(raw.get('boot_id'), str)
            or type(raw.get('seq')) is not int or raw['seq'] < 0):
        raise ValueError('Sensor identity and sequence are required')
    speeds = [r['derived'].get(k) for k in ('v_left_m_s', 'v_right_m_s')]
    if not all(type(v) in (int, float) and math.isfinite(v) for v in speeds):
        raise ValueError('Valid wheel speed estimates are required')
    return dict(source=payload['mode'], boot_id=raw['boot_id'], seq=raw['seq'],
        sample_time_s=raw['sample_time_s'], speed_m_s=max(abs(v) for v in speeds),
        calibration=r.get('calibration_fingerprint', ''),
        recommendations=guidance['recommendations'], raw=deepcopy(raw),
        derived=deepcopy(r['derived']), soc=r['soc'])


class ReviewCoordinator:
    def __init__(self, engine, *, publisher=None, commands_enabled=False, clock=time.time, source='live', response_timeout_s=5):
        if response_timeout_s != 5 and (source != 'demo' or response_timeout_s != 60):
            raise ValueError('Physical response deadline must remain five seconds')
        self.response_timeout_s = response_timeout_s
        if source not in {'demo', 'live'}:
            raise ValueError('Unknown review source')
        self.source = source
        self.engine, self.publisher = engine, publisher
        self.commands_enabled, self.clock = commands_enabled, clock
        self.lock = threading.RLock()

    def _evidence(self, payload):
        if payload.get('mode') != self.source:
            raise ValueError('Review source cannot cross the physical/rehearsal boundary')
        if self.source == 'live':
            stamp = payload.get('observed_at')
            if type(stamp) not in (int, float) or not math.isfinite(stamp) or self.clock() < stamp:
                raise ValueError('Current server observation time is required')
            payload = deepcopy(payload)
            robot = payload.get('robots', {}).get('amr01') or {}
            age = robot.get('age_s')
            if type(age) not in (int, float):
                raise ValueError('Current sample age is required')
            robot['age_s'] = age+self.clock()-stamp
        return evidence(payload)

    def _lock(self, c):
        # Serialize decisions across gateway processes, not just HTTP threads.
        if c.dialect.name == 'postgresql':
            c.execute(text('SELECT pg_advisory_xact_lock(707010316)'))

    def _row(self, c, rid):
        row = c.execute(select(reviews).where(reviews.c.review_id == rid)).mappings().first()
        if row is None:
            raise ValueError('Unknown review')
        return dict(row)

    def _save(self, c, row, state, detail, **changes):
        row = deepcopy(row)
        row.update(changes, state=state)
        row['events'].append(dict(at=self.clock(), state=state, detail=detail))
        c.execute(update(reviews).where(reviews.c.review_id == row['review_id']).values(
            **{k:v for k,v in row.items() if k != 'review_id'}))
        return row

    def _expire(self, c, row):
        if row['state'] not in TERMINAL and self.clock() > row['expires_at']:
            delivered = row['state'] in {'dispatching', 'sent', 'acknowledged'}
            return self._save(c, row, 'uncertain' if delivered else 'expired',
                'Deadline passed. A late response cannot revive this review.')
        return row

    def create(self, payload, review_id):
        if not valid_id(review_id):
            raise ValueError('Review ID must be 32 lowercase hexadecimal characters')
        if payload.get('mode') != self.source:
            raise ValueError('Review source cannot cross the physical/rehearsal boundary')
        with self.lock, self.engine.begin() as c:
            self._lock(c)
            old = c.execute(select(reviews).where(reviews.c.review_id == review_id)).mappings().first()
            if old:
                return self._expire(c, dict(old))  # Retries retain the original evidence even as the stream advances.
            active = c.execute(select(reviews).where(~reviews.c.state.in_(TERMINAL))).mappings().all()
            for previous in active:
                previous = self._expire(c, dict(previous))
                if previous['state'] not in TERMINAL:
                    raise ValueError('Finish the current review before creating another')
            proof = self._evidence(payload)
            now = self.clock()
            row = dict(review_id=review_id, robot_id='amr01', created_at=now, expires_at=now+30,
                state='pending', evidence=proof, decision=None, command=None, ack=None,
                events=[dict(at=now, state='pending', detail='Recommendation evidence captured for human review.')],
                verified_samples=0, last_verified_seq=-1)
            c.execute(reviews.insert().values(**row))
            return row

    def decide(self, rid, *, decision, action, operator, reason, payload):
        if (decision not in {'approve', 'reject', 'defer'} or action not in ACTIONS
                or not isinstance(operator, str) or re.fullmatch(r'[A-Za-z0-9_-]{1,40}', operator) is None
                or not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 240):
            raise ValueError('Choose a permitted action, operator ID and a reason of 1..240 characters')
        choice = dict(decision=decision, action=action, operator=operator, reason=reason.strip())
        with self.lock, self.engine.begin() as c:
            self._lock(c)
            row = self._expire(c, self._row(c, rid))
            if row['decision']:
                if row['decision'] != choice:
                    raise ValueError('This review already has a different decision')
                return row
            if row['state'] != 'pending':
                raise ValueError('Review is no longer pending')
            if decision != 'approve':
                return self._save(c, row, 'rejected' if decision == 'reject' else 'deferred',
                                  'Human decision recorded; no command issued.', decision=choice)
            current = self._evidence(payload)
            if (current['source'] != row['evidence']['source'] or current['boot_id'] != row['evidence']['boot_id']
                    or current['seq'] < row['evidence']['seq'] or current['calibration'] != row['evidence']['calibration']
                    or current['recommendations'] != row['evidence']['recommendations']):
                return self._save(c, row, 'expired', 'Evidence changed; request a new human review.')
            if action == 'no_action':
                return self._save(c, row, 'reviewed', 'Human chose no intervention. No command issued.', decision=choice)
            if not self.commands_enabled or self.publisher is None:
                return self._save(c, row, 'blocked', 'Human approval recorded. The command gateway is not enabled.', decision=choice)
            now = self.clock()
            packet = dict(command_id=rid, robot_id='amr01', target_boot_id=current['boot_id'],
                source_seq=current['seq'], source_sample_time_s=current['sample_time_s'],
                action=action, speed_limit_percent=50 if action == 'reduce_speed' else 0,
                issued_at_ms=int(now*1000), expires_at_ms=int((now+2)*1000))
            row = self._save(c, row, 'dispatching', 'Approved request committed before transport.',
                             decision=choice, command=packet, expires_at=now+self.response_timeout_s,
                             evidence={**row['evidence'], 'dispatch_speed_m_s':current['speed_m_s']})
        try:
            self.publisher(COMMAND_TOPIC, packet)
        except Exception:
            with self.lock, self.engine.begin() as c:
                self._lock(c)
                return self._save(c, self._row(c, rid), 'uncertain',
                                  'Transport failed. Delivery is unconfirmed; automatic retry is disabled.')
        with self.lock, self.engine.begin() as c:
            self._lock(c)
            row = self._row(c, rid)
            return self._save(c, row, 'sent', 'Request sent; transport success is not execution.') if row['state'] == 'dispatching' else row

    def acknowledge(self, packet, *, retained=False):
        required = {'command_id', 'robot_id', 'boot_id', 'action', 'source_seq', 'status', 'applied_sample_time_s'}
        if (retained or not isinstance(packet, dict) or set(packet) != required
                or not valid_id(packet.get('command_id')) or packet.get('robot_id') != 'amr01'
                or packet.get('status') not in {'accepted', 'applied', 'rejected'}):
            raise ValueError('Invalid, retained or uncorrelated controller acknowledgement')
        with self.lock, self.engine.begin() as c:
            self._lock(c)
            row = self._expire(c, self._row(c, packet['command_id']))
            cmd = row['command']
            applied = packet.get('applied_sample_time_s')
            if packet['status'] == 'applied' and (type(applied) not in (int, float) or not math.isfinite(applied)
                    or not cmd or not cmd['source_sample_time_s'] <= applied <= cmd['source_sample_time_s']+2):
                raise ValueError('Controller application time is outside the command window')
            if (not cmd or packet['boot_id'] != cmd['target_boot_id'] or packet['action'] != cmd['action']
                    or type(packet['source_seq']) is not int or packet['source_seq'] != cmd['source_seq']):
                raise ValueError('Acknowledgement does not match the approved command')
            if row['state'] in TERMINAL:
                return row
            if packet['status'] == 'rejected':
                return self._save(c, row, 'rejected', 'Local controller rejected the intervention.', ack=packet)
            if packet['status'] == 'applied':
                if row['state'] == 'acknowledged':
                    return row
                return self._save(c, row, 'acknowledged', 'Controller reports applied; new sensor evidence is still required.', ack=packet)
            # An accepted ACK cannot downgrade an applied ACK.
            return row

    def observe(self, payload):
        with self.lock, self.engine.begin() as c:
            self._lock(c)
            try:
                current = self._evidence(payload)
            except ValueError:
                current = None
            rows = c.execute(select(reviews).where(~reviews.c.state.in_(TERMINAL))).mappings().all()
            for raw in rows:
                row = self._expire(c, dict(raw))
                if row['state'] != 'acknowledged':
                    continue
                if current is None:
                    if row['verified_samples']:
                        self._save(c, row, 'acknowledged', 'Sensor evidence unavailable; verification count reset.', verified_samples=0)
                    continue
                cmd = row['command']
                if current['source'] != row['evidence']['source']:
                    continue
                if current['boot_id'] != cmd['target_boot_id'] or current['calibration'] != row['evidence']['calibration']:
                    self._save(c, row, 'uncertain', 'Device boot or calibration changed before verification.')
                    continue
                if current['seq'] <= max(cmd['source_seq'], row['last_verified_seq']):
                    continue
                if current['sample_time_s'] <= row['ack']['applied_sample_time_s']:
                    continue
                limit = .01 if cmd['action'] == 'pause' else row['evidence']['dispatch_speed_m_s']*.5+.01
                within = current['speed_m_s'] <= limit and (cmd['action'] != 'pause' or current['raw']['robot_state'] in {'paused','stopped','standby'})
                count = row['verified_samples']+1 if within else 0
                state = 'verified' if count >= 3 else 'acknowledged'
                self._save(c, row, state,
                    'Three new sensor samples meet the requested limit; this is observed effect, not causal fault diagnosis.' if count >= 3 else 'Checking a new post-command sensor sample.',
                    verified_samples=count, last_verified_seq=current['seq'])

    def recover(self):
        with self.lock, self.engine.begin() as c:
            self._lock(c)
            for raw in c.execute(select(reviews).where(~reviews.c.state.in_(TERMINAL))).mappings().all():
                row = dict(raw)
                self._save(c, row, 'uncertain' if row['command'] else 'expired',
                           'Gateway restarted. Old approvals are not replayed.')

    def get(self, rid):
        with self.lock, self.engine.begin() as c:
            self._lock(c)
            return self._expire(c, self._row(c, rid))

    def history(self, limit=10):
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(select(reviews).order_by(reviews.c.created_at.desc()).limit(min(20,limit))).mappings()]


def panel(payload, row=None, feedback=''):
    demo = payload.get('mode') == 'demo'
    try:
        proof = evidence(payload)
        eligible = True
    except ValueError:
        proof, eligible = None, False
    return dict(source='Demo rehearsal' if demo else 'Website operator review', demo=demo,
        eligible=eligible, feedback=feedback, review=row,
        state_label=LABELS.get(row['state'], row['state']) if row else 'Ready for review' if eligible else 'Waiting for valid sensor evidence',
        detail=('Rehearse the operator decision and response checks. Generated evidence never contacts a device.' if demo else
                'Review the recommendation here. The server records your decision and checks fresh evidence before any enabled intervention.'),
        recommendations=proof['recommendations'] if proof else [],
        steps=['Recommendation', 'Human review', 'Gateway checks', 'Controller acknowledgement', 'Sensor verification'])
