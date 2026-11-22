"""Pure, testable local execution state machine. Transport and camera are adapters."""
import copy
from .contracts import (unseal, seal, digest, map_digest, ready, plan, fresh,
                        Follower, identifier, angle, APPROVAL_LEASE_MS, MAX_ROUTE_MS,
                        scene_stop_cause, stopped_for_route)
from .battery_policy import (battery_action, MISSION_REALERT_DROP_V, MISSION_RECOVERY_V)


class Agent:
    def __init__(self, control_key, send_drive, *, battery_mode='legacy'):
        if battery_mode not in ('legacy', 'mission'): raise ValueError('Unknown battery policy')
        self.battery_mode=battery_mode
        self.key,self.send_drive=control_key,send_drive
        self.scene=None; self.job=None; self.lease_until=0; self.seq=0
        self.state='idle'; self.reason='Waiting for an approved route'; self.done=[]
        self.status_seq=0; self.seen=set(); self.stop_samples=[]; self.battery_reviewed=False
        self.stop_cause=None; self.stop_command_seq=0; self.approved_scene=None
        self.battery_review_seq=0; self.battery_warning_voltage_v=None
        self.battery_stop_command_seq=0
        self.battery_reviewed_voltage=None; self.battery_recovery_at=None

    def battery_action(self,s,decision=None):
        return battery_action(s['hardware']['battery_voltage_v'],s['geometry']['min_pack_voltage_v'],
            s['geometry'].get('battery_advisory_voltage_v'),decision,mode=self.battery_mode)

    def status(self,now):
        self.status_seq+=1
        return seal('status',dict(review_id=self.job['review_id'] if self.job else None,
            state=self.state,reason=self.reason,seq=self.status_seq,issued_at_ms=now,
            stop_cause=self.stop_cause,stop_command_seq=self.stop_command_seq,
            battery_review_seq=self.battery_review_seq,battery_warning_voltage_v=self.battery_warning_voltage_v,
            battery_stop_command_seq=self.battery_stop_command_seq,
            agent_boot_id=self.job['agent_boot_id'] if self.job else self.scene['agent_boot_id'] if self.scene else None),self.key)

    def request(self,raw,now,retained=False):
        if retained: raise ValueError('Retained approval rejected')
        p=unseal('request',raw,self.key,12000)
        rid=identifier(p.get('review_id'))
        if not fresh(p.get('issued_at_ms'),now,APPROVAL_LEASE_MS) or not now<p.get('expires_at_ms',0)<=now+APPROVAL_LEASE_MS:
            raise ValueError('Expired approval')
        op=p.get('operation')
        # Battery decisions are signed and tied to the current reviewed route.
        # Continuing never relaxes the critical voltage check in tick().
        if op in ('battery_continue','battery_divert'):
            if not self.job or rid!=self.job['review_id'] or self.state!='battery_review':
                raise ValueError('No battery advisory awaiting a human decision')
            if not ready(self.scene,now) or map_digest(self.scene)!=self.job['map_id']:
                raise ValueError('Camera scene or critical battery safety changed')
            if scene_stop_cause(self.approved_scene,self.scene,now) or self.battery_action(self.scene)=='critical_stop':
                raise ValueError('Fresh safe evidence is required for a battery decision')
            if self.battery_mode=='mission' and p.get('battery_review_seq')!=self.battery_review_seq:
                raise ValueError('Battery warning changed; review the current decision')
            if self.battery_mode=='mission':
                h=self.scene['hardware']
                if (h.get('route_id')!=rid or h['left_duty'] or h['right_duty']
                        or h.get('command_seq',0)<self.battery_stop_command_seq):
                    raise ValueError('Waiting for the applied zero-output battery hold acknowledgement')
            if op=='battery_continue':
                self.battery_reviewed=True
                self.battery_reviewed_voltage=self.battery_warning_voltage_v
                self.battery_recovery_at=None
                self.state='running'
                self.reason='Operator declined battery diversion; original route resumes above hard cutoff'
            else:
                self.halt('Operator approved battery diversion; review a new route to E',now,'battery_divert')
            return
        if op=='cancel' and self.job and rid==self.job['review_id']:
            self.halt('Operator cancelled the route',now,p.get('stop_cause') or 'explicit_stop'); return
        if op=='lease' and self.job and rid==self.job['review_id']:
            if self.state in ('arming','running','battery_review','stopping'):
                self.lease_until=max(self.lease_until,p['expires_at_ms'])
            return
        if op!='execute' or rid in self.seen or self.state in ('arming','running','battery_review','stopping'):
            raise ValueError('Approval cannot start another route')
        s=self.scene
        if not ready(s,now) or s['hardware']['left_duty'] or s['hardware']['right_duty']:
            raise ValueError('Fresh stationary camera and controller evidence required')
        if scene_stop_cause(None,s,now) or self.battery_action(s)=='critical_stop':
            raise ValueError('Fresh safe camera, controller and battery evidence required')
        if p.get('map_id')!=map_digest(s) or p.get('agent_boot_id')!=s['agent_boot_id']:
            raise ValueError('The approved scene changed')
        route=p.get('route')
        if not isinstance(route,dict) or digest(route)!=p.get('route_hash'):
            raise ValueError('Invalid approved route')
        # Recompute using the exact reviewed pose; compare current start separately.
        reviewed=copy.deepcopy(s); reviewed['pose']=p.get('start_pose',{})
        import math
        if math.dist((s['pose']['x'],s['pose']['y']),(reviewed['pose']['x'],reviewed['pose']['y']))>10:
            raise ValueError('Robot moved after review')
        if plan(reviewed,route['goal'])!=route:
            raise ValueError('Route no longer matches the physical scene')
        consent=p.get('battery_consent') if self.battery_mode=='mission' else None
        consent_voltage=None
        if consent is not None:
            consent_voltage=consent.get('voltage_v') if isinstance(consent,dict) else None
            if (type(consent_voltage) not in (int,float) or not 6.7<=consent_voltage<=32 or
                    consent_voltage>s['hardware']['battery_voltage_v']+.001 or
                    not fresh(consent.get('observed_at_ms'),now)):
                raise ValueError('Invalid route-specific battery consent')
        if len(self.seen)>=10000: raise ValueError('Restart the stationary controller before another session')
        self.seen.add(rid); self.job=p; self.follower=Follower(route,s['geometry'],now)
        self.approved_scene=copy.deepcopy(s)
        self.stop_cause=None; self.stop_command_seq=0
        self.battery_reviewed=False; self.battery_reviewed_voltage=None
        self.battery_warning_voltage_v=None; self.battery_review_seq=0; self.battery_recovery_at=None
        self.battery_stop_command_seq=0
        if consent_voltage is not None:
            self.battery_reviewed=True; self.battery_reviewed_voltage=consent_voltage
        self.state='arming'; self.reason='Waiting for a zero-output controller acknowledgement'
        self.started=now; self.lease_until=p['expires_at_ms']; self.stop_samples=[]
        self.command('arm',0,0,now)

    def command(self,operation,left,right,now):
        if not self.job or not self.scene: return
        self.seq+=1
        self.send_drive(self.scene['hardware'],self.job['review_id'],self.seq,operation,left,right,now)

    def halt(self,reason,now,cause='explicit_stop'):
        try:
            if self.state in ('arming','running','battery_review','stopping'):
                self.stop_command_seq=self.seq+1
                self.command('stop',0,0,now)
        finally:
            self.state='blocked'; self.reason=reason; self.lease_until=0; self.stop_cause=cause

    def tick(self,s,now):
        self.scene=s
        if self.state not in ('arming','running','battery_review','stopping'): return
        # Absolute hardware-critical cutoff always wins, including after a
        # human rejects diversion. There is no operator override of this guard.
        cause=scene_stop_cause(self.approved_scene,s,now)
        if cause and cause!='obstacle_changed':
            self.halt('Camera or controller evidence changed; approve a fresh route',now,cause); return
        if self.battery_action(s)=='critical_stop':
            self.halt('CRITICAL BATTERY: mandatory motor stop; cannot be overridden',now,'battery_critical'); return
        if now>=self.lease_until or now-self.started>MAX_ROUTE_MS:
            self.halt('Approval lease or route duration expired; approve a new route',now,'approval_expired'); return
        if not ready(s,now) or map_digest(s)!=self.job['map_id']:
            self.halt('Obstacle map changed; stopped before a new route proposal' if cause=='obstacle_changed'
                else 'Camera, controller or obstacle scene changed; approve a new route',now,cause or 'scene_changed'); return
        hw=s['hardware']
        if self.state=='arming':
            if hw.get('route_id')==self.job['review_id'] and hw.get('state')=='armed' and hw.get('command_seq',0)>=self.seq and not(hw['left_duty'] or hw['right_duty']):
                self.state='running'; self.reason='Following the approved route using camera feedback'
            elif now-self.started>1000:
                self.halt('The ESP32 did not acknowledge arming',now,'arm_unconfirmed')
            return
        if hw.get('route_id')!=self.job['review_id'] or hw.get('state') in ('expired','local_stop','unavailable'):
            self.halt('The ESP32 stopped or lost the active route',now,'controller_stopped'); return
        if self.state=='battery_review':
            # Keep the existing expiring drive lease alive with zero PWM while
            # waiting for an explicit human answer. Unanswered review cannot move.
            voltage=s['hardware']['battery_voltage_v']
            self.battery_warning_voltage_v=min(self.battery_warning_voltage_v,voltage) if self.battery_warning_voltage_v is not None else voltage
            self.command('drive',0,0,now)
            return
        if self.state=='running':
            voltage=s['hardware']['battery_voltage_v']
            deteriorated=False
            if self.battery_mode=='mission' and self.battery_reviewed:
                deteriorated=voltage <= self.battery_reviewed_voltage-MISSION_REALERT_DROP_V+1e-9
                if voltage>=MISSION_RECOVERY_V and (hw['left_duty'] or hw['right_duty']):
                    if self.battery_recovery_at is None: self.battery_recovery_at=now
                    elif now-self.battery_recovery_at>=1000: self.battery_reviewed=False
                else: self.battery_recovery_at=None
                if deteriorated: self.battery_reviewed=False
            action=self.battery_action(s,False if self.battery_reviewed else None)
            if action=='ask_human':
                self.state='battery_review'
                self.battery_review_seq+=1; self.battery_warning_voltage_v=voltage
                self.battery_stop_command_seq=self.seq+1
                self.reason=('Battery fell at least 0.10 V after consent; stopped for a new decision'
                    if deteriorated else 'LOW BATTERY advisory: stopped; choose continue destination or divert to E')
                self.command('drive',0,0,now)
                return
            try: left,right,done=self.follower.update(s,now)
            except ValueError as e: self.halt(str(e),now,'tracking_failed'); return
            if done:
                self.state='stopping'; self.reason='Destination reached in camera view; verifying stopped position'
                self.stop_command_seq=self.seq+1
                self.command('stop',0,0,now); self.stop_at=now
            else: self.command('drive',left,right,now)
        else:
            import math
            near=math.dist((s['pose']['x'],s['pose']['y']),self.job['route']['goal'])<=15
            quiet=stopped_for_route(s,now,self.job['review_id'],self.stop_command_seq)
            if near and quiet and s['captured_at_ms']>self.stop_at:
                if not self.stop_samples or s['seq']>self.stop_samples[-1][0]:
                    self.stop_samples.append((s['seq'],s['captured_at_ms'],s['pose']))
                if len(self.stop_samples)>=3 and self.stop_samples[-1][1]-self.stop_samples[0][1]>=300:
                    points=[(v[2]['x'],v[2]['y']) for v in self.stop_samples]
                    if max(math.dist(points[0],p) for p in points)<=5 and max(abs(angle(v[2]['heading']-self.stop_samples[0][2]['heading'])) for v in self.stop_samples)<=.05:
                        self.state='verified'; self.reason='Fresh camera observations verified the destination and stopped position'
                    else: self.stop_samples=[]
            else: self.stop_samples=[]
            if now-self.stop_at>3000: self.halt('Stopped destination could not be verified',now,'arrival_unconfirmed')
