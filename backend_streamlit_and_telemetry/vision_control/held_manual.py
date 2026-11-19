"""Authenticated human-held driving; fresh input renews short MCU leases only."""
from sqlalchemy import select, update
from .manual import ManualCoordinator, MIN_PACK_V
from .coordinator import reviews
from .contracts import fresh, identifier
from .protocol import drive

HELD = {'hold_arming', 'hold_driving', 'hold_stopping'}
DIRECTIONS = {'F':(1,1), 'B':(-1,-1), 'L':(0,1), 'R':(1,0)}
INPUT_LEASE_MS = 700
RENEW_MS = 150


class HeldManualCoordinator(ManualCoordinator):
    max_pwm = 255
    allow_manual_protocol = True

    def __init__(self, *args):
        super().__init__(*args)
        with self.engine.begin() as db:
            db.execute(update(reviews).where(reviews.c.state.in_(HELD)).values(state='manual_uncertain'))

    def hardware_ready(self, zero=False):
        h=self.current
        return bool(self.connected and h and fresh(h['issued_at_ms'],self.clock()) and h['ready']
                    and h['battery_voltage_v']>=MIN_PACK_V
                    and (not zero or not (h['left_duty'] or h['right_duty'])))

    def hold(self, owner, operator, hold_id, input_seq, issued, direction, pwm):
        with self.lock:
            identifier(hold_id)
            now=self.clock()
            if (type(input_seq) is not int or not 1<=input_seq<=2147483647
                    or type(issued) is not int or not -100<=now-issued<=500):
                raise ValueError('Held input expired; release and press again')
            cap=min(255,(self.current or {}).get('max_pwm',160))
            if direction not in DIRECTIONS or type(pwm) is not int or not 1<=pwm<=cap:
                raise ValueError('Choose a direction and PWM within the receiver limit')
            r=self.row
            if r and r['review_id']==hold_id:
                if r['owner_id']!=owner: raise ValueError('Another operator owns this hold')
                if r['state'] not in ('hold_arming','hold_driving'):
                    raise ValueError('This hold ended; release and press again')
                if input_seq<=r['input_seq']: return
                if issued<r['input_issued_ms'] or now>=r['input_until_ms']:
                    self.cancel(owner)
                    raise ValueError('Held input expired; release and press again')
                if not self.hardware_ready():
                    self.cancel(owner)
                    raise ValueError('Fresh, ready controller feedback is required')
                changed=(direction,pwm)!=(r['direction'],r['pwm'])
                r.update(direction=direction,pwm=pwm,input_seq=input_seq,input_issued_ms=issued,
                         input_until_ms=issued+INPUT_LEASE_MS,expires_at_ms=issued+INPUT_LEASE_MS)
                if changed:
                    r['events'].append(dict(at_ms=now,decision='adjust',direction=direction,pwm=pwm))
                    self.save()
                self.touch(owner)
                return
            if r and r['state'] in HELD:
                raise ValueError('Release the current hold before another direction')
            if not self.hardware_ready(zero=True):
                raise ValueError('Wait for fresh ready feedback with zero outputs')
            with self.engine.connect() as db:
                if db.execute(select(reviews.c.review_id).where(reviews.c.review_id==hold_id)).first():
                    raise ValueError('This hold already ended; release and press again')
            h=self.current
            self.row=dict(review_id=hold_id,owner_id=owner,operator=operator,created_at_ms=now,
                expires_at_ms=issued+INPUT_LEASE_MS,state='hold_arming',direction=direction,pwm=pwm,
                duration_ms=INPUT_LEASE_MS,boot_id=h['boot_id'],epoch_id=h['epoch_id'],
                arm_seq=h['command_seq']+1,next_seq=h['command_seq']+1,
                input_seq=input_seq,input_issued_ms=issued,input_until_ms=issued+INPUT_LEASE_MS,
                dispatched_at_ms=now,last_sent_ms=0,
                reason='Direction held; waiting for controller arming acknowledgement',
                events=[dict(at_ms=now,decision='hold',direction=direction,pwm=pwm)])
            self.touch(owner)
            self.save()  # Record the explicit human-held intent before zero-output arming.
            self.send_held('arm')

    def send_held(self, op, left=0, right=0):
        r=self.row; now=self.clock()
        lease=500 if op=='stop' else min(500,r['input_until_ms']-now)
        if lease<=0: return False
        seq=r['next_seq'];r['next_seq']+=1
        packet=drive(r['boot_id'],r['epoch_id'],r['review_id'],seq,op,left,right,now,self.secret,
                     lease_ms=lease,max_pwm=255)
        try: self.publish(packet)
        except Exception:
            r.update(state='manual_uncertain',reason='Transport failed; release and press again')
            self.save()
            raise ValueError(r['reason']) from None
        r['last_sent_ms']=now
        return True

    def observe(self, raw, retained=False):
        with self.lock:
            previous=self.accepted_count
            super().observe(raw,retained)
            if self.accepted_count==previous: return
            r=self.row;h=self.current
            if not r or r['state'] not in HELD: return
            if (h['boot_id'],h['epoch_id'])!=(r['boot_id'],r['epoch_id']):
                r.update(state='manual_uncertain',reason='Controller reconnected; release and press again')
                self.save();return
            if h['route_id']!=r['review_id']: return
            if (r['state']=='hold_arming' and h['state'] in ('armed','interlock')
                    and r['arm_seq']<=h['command_seq']<r['next_seq']
                    and not (h['left_duty'] or h['right_duty'])):
                if not self.hardware_ready() or self.clock()>=r['input_until_ms']:
                    self.cancel(r['owner_id']);return
                r.update(state='hold_driving',reason='Driving while direction is held')
                self.save();self.renew()
            elif h['state'] in ('expired','stopped','local_stop','unavailable') and not (h['left_duty'] or h['right_duty']):
                r.update(state='hold_stopped',reason='ESP32 reports zero outputs; release before another hold')
                r['events'].append(dict(at_ms=self.clock(),decision='zero_outputs'))
                self.save()

    def renew(self):
        r=self.row
        if r['state']!='hold_driving' or self.clock()>=r['input_until_ms']: return
        left,right=DIRECTIONS[r['direction']]
        self.send_held('drive',left*r['pwm'],right*r['pwm'])

    def cancel(self, owner):
        with self.lock:
            r=self.row
            if not r or r['owner_id']!=owner: return
            if r['state'] in ('hold_arming','hold_driving'):
                r.update(state='hold_stopping',reason='Direction released; stop requested',stop_at_ms=self.clock())
                r['events'].append(dict(at_ms=self.clock(),decision='release'))
                self.save();self.send_held('stop')
            elif r['state'] not in HELD:
                super().cancel(owner)

    def end_hold(self, owner, hold_id, input_seq):
        with self.lock:
            r=self.row
            if r and r['owner_id']==owner and r['review_id']==hold_id:
                if type(input_seq) is int and input_seq>r['input_seq']:
                    r['input_seq']=input_seq;self.cancel(owner)

    def tick(self):
        with self.lock:
            r=self.row;now=self.clock()
            if not r or r['state'] not in HELD:
                return super().tick()
            if r['state']=='hold_stopping':
                if now-r['stop_at_ms']>2000:
                    r.update(state='manual_uncertain',reason='No stop acknowledgement; local command expiry remains active')
                    self.save()
                return
            if not self.hardware_ready() or now>=r['input_until_ms']:
                self.cancel(r['owner_id']);return
            if r['state']=='hold_arming' and now-r['dispatched_at_ms']>=2000:
                self.cancel(r['owner_id']);return
            if r['state']=='hold_arming' and now-r['last_sent_ms']>=RENEW_MS:
                self.send_held('drive',0,0)  # Keep zero-output arming alive during a human hold.
            if r['state']=='hold_driving' and now-r['last_sent_ms']>=RENEW_MS:
                self.renew()

    def public(self, owner):
        with self.lock:
            value=super().public(owner)
            r=self.row
            owned=bool(r and r['owner_id']==owner and r['state'] in ('hold_arming','hold_driving'))
            value.update(ready=self.hardware_ready(zero=not owned),
                         busy=bool(r and r['state'] in HELD and r['owner_id']!=owner),
                         max_pwm=min(255,(self.current or {}).get('max_pwm',160)),
                         server_time_ms=self.clock(),input_lease_ms=INPUT_LEASE_MS,
                         holding=owned,receiver_updated=(self.current or {}).get('protocol')=='H2')
            return value
