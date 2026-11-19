"""One human-approved motor burst. Hardware output acknowledgement is not odometry."""
import copy
import threading
import uuid
from sqlalchemy import select, update
from .coordinator import reviews
from .contracts import canonical, fresh
from .protocol import hardware, drive

ACTIVE = {'manual_arming', 'manual_sent', 'manual_acknowledged', 'manual_stopping'}
DIRECTIONS = {'F': (1, 1), 'B': (-1, -1), 'L': (-1, 1), 'R': (1, -1)}
BURST_MS = 250


class ManualCoordinator:
    def __init__(self, engine, secret, publish, clock):
        self.engine, self.secret, self.publish, self.clock = engine, secret, publish, clock
        self.lock = threading.RLock()
        self.connected = False
        self.current = self.row = None
        self.history = []
        self.retired = set()
        self.presence = {}
        self.last_touch = clock()
        self.zeroes = []
        with engine.begin() as db:
            db.execute(update(reviews).where(reviews.c.state.in_(ACTIVE)).values(state='manual_uncertain'))

    def save(self):
        r = self.row
        values = dict(review_id=r['review_id'], owner_id=r['owner_id'], created_at_ms=r['created_at_ms'],
                      state=r['state'], record=canonical(r))
        with self.engine.begin() as db:
            exists = db.execute(select(reviews.c.review_id).where(reviews.c.review_id == r['review_id'])).first()
            if exists:
                db.execute(update(reviews).where(reviews.c.review_id == r['review_id']).values(**values))
            else:
                db.execute(reviews.insert().values(**values))

    def touch(self, owner):
        with self.lock:
            self.presence[owner] = self.last_touch = self.clock()

    def stationary(self):
        h = self.current
        return bool(self.connected and h and h['ready'] and fresh(h['issued_at_ms'], self.clock())
                    and len(self.history) >= 2 and self.history[-1]['issued_at_ms'] - self.history[0]['issued_at_ms'] >= 150
                    and all(not (p['left_duty'] or p['right_duty']) for p in self.history))

    def capture(self, owner, operator, direction, pwm):
        with self.lock:
            if self.row and self.row['state'] in ACTIVE:
                raise ValueError('Wait for zero-output feedback before another review')
            if direction not in DIRECTIONS or type(pwm) is not int or not 20 <= pwm <= 160:
                raise ValueError('Choose F, B, L or R and PWM 20–160')
            if not self.stationary():
                raise ValueError('Fresh, ready ESP32 feedback with zero motor outputs is required')
            h, now = self.current, self.clock()
            self.row = dict(review_id=uuid.uuid4().hex, owner_id=owner, operator=operator,
                created_at_ms=now, expires_at_ms=now + 10000, state='manual_review', direction=direction,
                pwm=pwm, duration_ms=BURST_MS, boot_id=h['boot_id'], epoch_id=h['epoch_id'], arm_seq=h['command_seq'] + 1,
                reason='Review one burst and inspect the clear space around the AMR', events=[])
            self.touch(owner)
            self.save()

    def packet(self, op, seq, left=0, right=0):
        r = self.row
        return drive(r['boot_id'], r['epoch_id'], r['review_id'], seq, op, left, right,
                     self.clock(), self.secret, lease_ms=BURST_MS if op == 'drive' else 500, max_pwm=160)

    def send(self, op, seq, left=0, right=0):
        try:
            self.publish(self.packet(op, seq, left, right))
        except Exception:
            self.row['state'] = 'manual_uncertain'
            self.row['reason'] = 'Transport failed; no command retry is queued'
            self.save()
            raise ValueError(self.row['reason']) from None

    def approve(self, owner, rid, reason):
        with self.lock:
            r, h, now = self.row, self.current, self.clock()
            if not r or r['owner_id'] != owner or r['review_id'] != rid:
                raise ValueError('This review belongs to another operator session')
            if r['state'] != 'manual_review' or now >= r['expires_at_ms']:
                raise ValueError('Prepare a new review; this approval is no longer available')
            if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 240:
                raise ValueError('Record a short approval reason')
            if not self.stationary() or (h['boot_id'], h['epoch_id']) != (r['boot_id'], r['epoch_id']) or h['command_seq'] != r['arm_seq'] - 1:
                raise ValueError('ESP32 feedback changed; prepare a new review')
            if now - self.presence.get(owner, 0) > 2000:
                raise ValueError('Keep this manual control page open before approving')
            r.update(state='manual_arming', reason='Approval saved; waiting for ESP32 arming acknowledgement', dispatched_at_ms=now)
            r['events'].append(dict(at_ms=now, decision='approve', reason=reason.strip()))
            self.touch(owner)
            self.zeroes = []
            self.save()  # Durable human decision before any motor command.
            self.send('arm', r['arm_seq'])

    def observe(self, raw, retained=False):
        with self.lock:
            if retained:
                return
            h = hardware(raw, self.secret, self.clock(), max_pwm=160)
            identity = (h['boot_id'], h['epoch_id'])
            if identity in self.retired:
                return
            old = self.current
            if old:
                previous = (old['boot_id'], old['epoch_id'])
                if identity == previous:
                    if h['seq'] <= old['seq'] or h['issued_at_ms'] < old['issued_at_ms']:
                        return
                else:
                    self.retired.add(previous)
                    self.history = []
                    if self.row and self.row['state'] in ACTIVE:
                        self.row.update(state='manual_uncertain', reason='ESP32 reconnected; no movement will be replayed')
                        self.save()
            self.current = h
            self.history = [p for p in self.history if self.clock() - p['issued_at_ms'] <= 500] + [h]
            r = self.row
            if not r or r['state'] not in ACTIVE or identity != (r['boot_id'], r['epoch_id']) or h['route_id'] != r['review_id']:
                return
            if r['state'] == 'manual_arming' and h['command_seq'] == r['arm_seq'] and h['state'] == 'armed' and not (h['left_duty'] or h['right_duty']):
                if not self.connected or not h['ready'] or self.clock() - self.presence.get(r['owner_id'], 0) > 2000:
                    self.cancel(r['owner_id'])
                    return
                left, right = DIRECTIONS[r['direction']]
                r.update(state='manual_sent', reason='One 250 ms burst sent; waiting for controller feedback', burst_sent_at_ms=self.clock())
                self.save()
                self.send('drive', r['arm_seq'] + 1, left * r['pwm'], right * r['pwm'])
            elif h['command_seq'] >= r['arm_seq'] + 1:
                if h['left_duty'] or h['right_duty']:
                    if r['state'] == 'manual_sent':
                        r.update(state='manual_acknowledged', reason='ESP32 reports applied motor outputs; physical travel is not verified')
                        self.save()
                    self.zeroes = []
                elif h['state'] in ('expired', 'stopped', 'local_stop', 'unavailable'):
                    self.zeroes.append(h['issued_at_ms'])
                    if len(self.zeroes) >= 3 and self.zeroes[-1] - self.zeroes[0] >= 250:
                        r.update(state='manual_stopped', reason='ESP32 reports zero motor outputs. Inspect the AMR before another move.')
                        self.save()

    def cancel(self, owner):
        with self.lock:
            r = self.row
            if not r or r['owner_id'] != owner:
                return
            if r['state'] == 'manual_review':
                r.update(state='manual_cancelled', reason='Review cancelled; no movement requested')
                self.save()
            elif r['state'] in ACTIVE and r['state'] != 'manual_stopping':
                r.update(state='manual_stopping', reason='Stop sent; waiting for ESP32 zero-output feedback')
                self.save()
                self.send('stop', r['arm_seq'] + 2)

    def tick(self):
        with self.lock:
            r, now = self.row, self.clock()
            if not r:
                return
            if r['state'] == 'manual_review' and now >= r['expires_at_ms']:
                r.update(state='manual_cancelled', reason='Review expired; no movement requested')
                self.save()
            if r['state'] in ACTIVE:
                if now - r['dispatched_at_ms'] > 2000:
                    r.update(state='manual_uncertain', reason='Controller feedback not confirmed. The ESP32 command has a local expiry; inspect the AMR.')
                    self.save()
                elif not self.connected or now - self.presence.get(r['owner_id'], 0) > 2000:
                    self.cancel(r['owner_id'])

    def public(self, owner):
        with self.lock:
            h = self.current
            return dict(ready=self.stationary(), hardware=copy.deepcopy(h) if h and fresh(h['issued_at_ms'], self.clock()) else None,
                        review=copy.deepcopy(self.row) if self.row and self.row['owner_id'] == owner else None,
                        busy=bool(self.row and self.row['state'] in ACTIVE and self.row['owner_id'] != owner))
