"""Server-owned route approval, durable audit and short lived execution grants."""
import copy
import math
import threading
import uuid
from sqlalchemy import MetaData, Table, Column, String, Text, BigInteger, select, update
from .contracts import (scene, unseal, seal, canonical, fresh, ready, map_digest,
                        plan, digest, angle, APPROVAL_LEASE_MS, OPERATOR_PRESENCE_MS)
from .battery_policy import battery_action

metadata=MetaData()
reviews=Table('amr_route_reviews',metadata,
    Column('review_id',String(32),primary_key=True),Column('owner_id',String(32),nullable=False),
    Column('created_at_ms',BigInteger,nullable=False),Column('state',String(32),nullable=False),
    Column('record',Text,nullable=False))
ACTIVE={'sent','arming','running','battery_review','stopping'}


class Coordinator:
    def __init__(self,engine,secret,publish,clock):
        self.engine,self.secret,self.publish,self.clock=engine,secret,publish,clock
        self.lock=threading.RLock(); self.current=None; self.history=[]; self.row=None
        self.presence={}; self.connected=False; self.status_seq=-1
        # Never replay a request after a process restart.
        with engine.begin() as c:
            c.execute(update(reviews).where(reviews.c.state.in_(ACTIVE)).values(state='uncertain'))

    def save(self):
        value=dict(self.row)
        with self.engine.begin() as c:
            exists=c.execute(select(reviews.c.review_id).where(reviews.c.review_id==value['review_id'])).first()
            data=dict(review_id=value['review_id'],owner_id=value['owner_id'],created_at_ms=value['created_at_ms'],
                      state=value['state'],record=canonical(value))
            if exists: c.execute(update(reviews).where(reviews.c.review_id==value['review_id']).values(**data))
            else: c.execute(reviews.insert().values(**data))

    def observe(self,raw,retained=False):
        with self.lock:
            if retained: return
            s=scene(unseal('scene',raw,self.secret))
            now=self.clock()
            if not fresh(s['captured_at_ms'],now): return
            if self.current and self.current['agent_boot_id']==s['agent_boot_id'] and s['seq']<=self.current['seq']: return
            self.current=s
            self.history=[p for p in self.history if now-p['captured_at_ms']<=1000 and p['agent_boot_id']==s['agent_boot_id']]+[s]

    def stationary(self):
        s=self.current; now=self.clock()
        h=[p for p in self.history if ready(p,now) or (p['valid'] and 0<=now-p['captured_at_ms']<=1000 and p['hardware']['ready'])]
        if not ready(s,now) or len(h)<3 or h[-1]['captured_at_ms']-h[0]['captured_at_ms']<500: return False
        return all(not(p['hardware']['left_duty'] or p['hardware']['right_duty']) and map_digest(p)==map_digest(s)
                   and math.dist((p['pose']['x'],p['pose']['y']),(s['pose']['x'],s['pose']['y']))<=5
                   and abs(angle(p['pose']['heading']-s['pose']['heading']))<=.05 for p in h)

    def capture(self,owner,operator,goal):
        with self.lock:
            if self.row and self.row['state'] in ACTIVE: raise ValueError('Stop the current route before reviewing another')
            if not self.connected or not self.stationary(): raise ValueError('Fresh stationary camera and ESP32 feedback are required')
            route=plan(self.current,goal); now=self.clock()
            self.row=dict(review_id=uuid.uuid4().hex,owner_id=owner,operator=operator,created_at_ms=now,
                expires_at_ms=now+60000,state='pending',route=route,route_hash=digest(route),
                map_id=map_digest(self.current),start_pose=copy.deepcopy(self.current['pose']),
                agent_boot_id=self.current['agent_boot_id'],reason='Review the route before approving movement',events=[])
            self.save(); self.touch(owner)

    def touch(self,owner):
        with self.lock: self.presence[owner]=self.clock()

    def owned(self,owner,rid):
        if not self.row or self.row['owner_id']!=owner or self.row['review_id']!=rid:
            raise ValueError('This route belongs to another review session')

    def packet(self,op):
        now=self.clock(); r=self.row
        p=dict(operation=op,review_id=r['review_id'],issued_at_ms=now,expires_at_ms=now+APPROVAL_LEASE_MS)
        if op=='execute':
            p.update({k:r[k] for k in ('route','route_hash','map_id','start_pose','agent_boot_id')})
        return seal('request',p,self.secret)

    def decide(self,owner,rid,decision,note):
        with self.lock:
            self.owned(owner,rid)
            if self.row['state']!='pending' or decision not in ('approve','reject','hold'):
                raise ValueError('Capture a new pending route before deciding')
            if not isinstance(note,str) or not 1<=len(note.strip())<=240: raise ValueError('Record a short decision reason')
            now=self.clock(); r=self.row
            if now>=r['expires_at_ms']: raise ValueError('The review expired; capture a new route')
            if decision=='approve' and (not self.connected or not self.stationary() or map_digest(self.current)!=r['map_id']
                or math.dist((self.current['pose']['x'],self.current['pose']['y']),(r['start_pose']['x'],r['start_pose']['y']))>10):
                raise ValueError('The physical scene changed; capture a new route')
            r['events'].append(dict(at_ms=now,decision=decision,reason=note.strip()))
            r['state']='sent' if decision=='approve' else decision
            r['reason']='Approval recorded; awaiting the local controller' if decision=='approve' else 'Decision recorded; no movement requested'
            self.save()  # Commit approval before dispatch. Never queue a retry.
            if decision=='approve':
                self.touch(owner); self.dispatched_at=now; self.status_seq=-1; self.verification=[]
                try: self.publish(self.packet('execute'))
                except Exception:
                    r['state']='uncertain'; r['reason']='Dispatch failed; no automatic retry'; self.save()
                    raise ValueError(r['reason'])

    def battery_decide(self,owner,rid,choice,note):
        """Audit the human's battery choice before issuing a signed command.

        Choice 'continue' declines diversion but NEVER overrides the critical
        cutoff; choice 'divert' stops this route and requires a separately
        reviewed, collision-checked route to battery station E.
        """
        with self.lock:
            self.owned(owner,rid)
            if choice not in ('continue','divert') or self.row['state']!='battery_review':
                raise ValueError('No pending low-battery human decision')
            if self.row.get('battery_choice') is not None:
                raise ValueError('Battery advisory has already been decided')
            if not isinstance(note,str) or not 1<=len(note.strip())<=240:
                raise ValueError('Record a short battery decision reason')
            now=self.clock()
            if now-self.presence.get(owner,-10000)>OPERATOR_PRESENCE_MS or not self.connected:
                raise ValueError('Operator session or control connection is not active')
            s=self.current
            if not ready(s,now) or map_digest(s)!=self.row['map_id']:
                raise ValueError('Unsafe battery or changed camera scene; no continuation')
            if not self.stationary():
                raise ValueError('Wait until the robot is verifiably stopped before battery decision')
            if battery_action(s['hardware']['battery_voltage_v'],
                s['geometry']['min_pack_voltage_v'],
                s['geometry'].get('battery_advisory_voltage_v'))!='ask_human':
                raise ValueError('No current low-battery advisory requiring a decision')
            self.row['battery_choice']=choice
            self.row['events'].append(dict(at_ms=now,battery_decision=choice,
                                           reason=note.strip()))
            self.row['reason']=('Battery diversion approved; stopping before a new E route'
                if choice=='divert' else
                'Battery diversion declined; original route may continue above critical cutoff')
            self.save()
            try:
                self.publish(self.packet('battery_divert' if choice=='divert' else 'battery_continue'))
            except Exception:
                self.row['state']='uncertain'
                self.row['reason']='Battery decision dispatch unconfirmed; motors remain stopped'
                self.save()
                raise ValueError(self.row['reason'])

    def cancel(self,owner):
        with self.lock:
            self.presence.pop(owner,None)
            if not self.row or self.row['owner_id']!=owner or self.row['state'] not in ACTIVE: return
            self.row['state']='cancelled'; self.row['reason']='Stop requested; verify the robot is stationary'
            self.save()
            try: self.publish(self.packet('cancel'))
            except Exception: pass  # No more leases; local and ESP32 deadlines stop outputs.

    def status(self,raw,retained=False):
        with self.lock:
            if retained or not self.row or self.row['state'] not in ACTIVE: return
            p=unseal('status',raw,self.secret,4000); now=self.clock(); r=self.row
            if p.get('review_id')!=r['review_id'] or p.get('agent_boot_id')!=r['agent_boot_id'] or not fresh(p.get('issued_at_ms'),now) or type(p.get('seq')) is not int or p['seq']<=self.status_seq: return
            self.status_seq=p['seq']; state=p.get('state')
            if state not in ('arming','running','battery_review','stopping','verified','blocked'): return
            reason=p.get('reason','')
            if not isinstance(reason,str) or len(reason)>200: return
            if state=='verified':
                s=self.current
                if not ready(s,now) or map_digest(s)!=r['map_id'] or math.dist((s['pose']['x'],s['pose']['y']),r['route']['goal'])>15 or s['hardware']['left_duty'] or s['hardware']['right_duty']: return
                if not self.verification or s['seq']>self.verification[-1][0]: self.verification.append((s['seq'],s['captured_at_ms'],s['pose']))
                if len(self.verification)<3 or self.verification[-1][1]-self.verification[0][1]<300: return
                if max(math.dist((v[2]['x'],v[2]['y']),(s['pose']['x'],s['pose']['y'])) for v in self.verification)>5 or max(abs(angle(v[2]['heading']-s['pose']['heading'])) for v in self.verification)>.05: self.verification=[]; return
            if r['state']!=state:
                r['state']=state; r['reason']=reason; r['events'].append(dict(at_ms=now,state=state)); self.save()

    def tick(self):
        with self.lock:
            r=self.row; now=self.clock()
            if not r or r['state'] not in ACTIVE: return
            if now-self.presence.get(r['owner_id'],-10000)>OPERATOR_PRESENCE_MS or now-self.dispatched_at>60000 or not self.connected or not ready(self.current,now) or map_digest(self.current)!=r['map_id']:
                self.cancel(r['owner_id']); return
            self.publish(self.packet('lease'))

    def public(self,owner):
        with self.lock:
            r=self.row
            row={k:copy.deepcopy(r[k]) for k in ('review_id','state','route','created_at_ms','expires_at_ms','reason')} if r and r['owner_id']==owner else None
            if row is not None:
                row['battery_choice']=r.get('battery_choice')
                row['battery_prompt']=bool(r['state']=='battery_review' and not r.get('battery_choice'))
            battery=None
            if self.current:
                s=self.current
                critical=s['geometry']['min_pack_voltage_v']
                advisory=s['geometry'].get('battery_advisory_voltage_v')
                value=s['hardware']['battery_voltage_v']
                battery=dict(voltage_v=value,critical_v=critical,advisory_v=advisory,
                    action=battery_action(value,critical,advisory))
            return dict(scene=copy.deepcopy(self.current),ready=self.connected and self.stationary(),review=row,battery=battery)
