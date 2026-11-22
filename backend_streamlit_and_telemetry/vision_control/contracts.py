"""Bounded physical scene, route and authenticated message contracts.

No browser geometry or synthetic sensor stream authorizes these commands.
Distances are millimetres, headings radians, timestamps UTC milliseconds.
"""
import hashlib
import heapq
import hmac
import json
import math
import re

WIDTH, HEIGHT, GRID = 760, 560, 10
SCENE_VERSION = 2
SCENE_FRESH_MS, DRIVE_LEASE_MS, APPROVAL_LEASE_MS = 500, 500, 800
OPERATOR_PRESENCE_MS = 2500
MAX_PWM, MAX_ROUTE_MS = 80, 60000
PREFIX = 'robot/amr01/vision/'
SCENE_TOPIC, REQUEST_TOPIC, STATUS_TOPIC = (PREFIX + k for k in ('scene', 'request', 'status'))
DRIVE_TOPIC, HARDWARE_TOPIC = (PREFIX + k for k in ('drive', 'hardware'))
HEX32 = re.compile(r'[0-9a-f]{32}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')


def numeric(value, lo, hi, name='measurement'):
    if type(value) not in (int, float) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError(f'Invalid {name}')
    return value


def identifier(value, length=32):
    if not isinstance(value, str) or not (HEX32 if length == 32 else HEX64).fullmatch(value):
        raise ValueError('Invalid control identity')
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def key(value):
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise ValueError('Configure a private 64-character lowercase hexadecimal control key')
    return value.encode()


def seal(kind, value, secret):
    body = canonical(value)
    return dict(body=value, signature=hmac.new(key(secret), (kind+'\n'+body).encode(), hashlib.sha256).hexdigest())


def unseal(kind, raw, secret, max_bytes=48000):
    if isinstance(raw, (bytes, str)):
        if len(raw) > max_bytes:
            raise ValueError('Control message is too large')
        raw = json.loads(raw)
    if not isinstance(raw, dict) or set(raw) != {'body', 'signature'}:
        raise ValueError('Invalid signed control message')
    expected = seal(kind, raw['body'], secret)['signature']
    if not isinstance(raw['signature'], str) or not hmac.compare_digest(expected, raw['signature']):
        raise ValueError('Control authentication failed')
    if not isinstance(raw['body'], dict):
        raise ValueError('Invalid control message body')
    return raw['body']


def fresh(stamp, now, age=SCENE_FRESH_MS):
    return type(stamp) is int and now-age <= stamp <= now+100


def geometry(raw):
    ranges = dict(robot_length_mm=(1, 600), robot_width_mm=(1, 600), robot_height_mm=(1, 300),
                  wheel_track_mm=(1, 400), clearance_mm=(10, 200), uncertainty_mm=(2, 50),
                  stopping_distance_mm=(1, 150), tracking_tolerance_mm=(3, 30),
                  max_speed_mm_s=(5, 60), max_angular_rad_s=(.05, .6), max_pwm=(1, MAX_PWM),
                  left_pwm_per_mm_s=(.1, 20), right_pwm_per_mm_s=(.1, 20),
                  minimum_drive_pwm=(0, 60), min_pack_voltage_v=(6, 7.4))
    if not isinstance(raw, dict):
        raise ValueError('Measured motion configuration is missing')
    result = {n:numeric(raw.get(n), *r, n) for n,r in ranges.items()}
    # Optional verified advisory threshold for human diversion to battery point E.
    # Without a verified value the controller still enforces the hard battery cutoff,
    # but does not invent a low-battery advisory from uncalibrated SOC.
    advisory = raw.get('battery_advisory_voltage_v')
    if advisory is not None:
        numeric(advisory, 6.01, 8.4, 'battery_advisory_voltage_v')
        if advisory <= result['min_pack_voltage_v']:
            raise ValueError('Battery advisory must exceed the hard battery cutoff')
        result['battery_advisory_voltage_v'] = advisory
    for n in ('left_polarity', 'right_polarity'):
        if type(raw.get(n)) is not int or raw[n] not in (-1, 1):
            raise ValueError('Verify both physical wheel polarities')
        result[n] = raw[n]
    if type(result['max_pwm']) is not int or type(result['minimum_drive_pwm']) is not int or result['minimum_drive_pwm'] > result['max_pwm']:
        raise ValueError('Invalid measured motor PWM limits')
    if any(result['max_pwm']/result[side+'_pwm_per_mm_s'] > result['max_speed_mm_s'] for side in ('left','right')):
        raise ValueError('Measured PWM cap exceeds the configured maximum wheel speed')
    return result


def radius(config):
    g = geometry(config)
    # Reserve the measured stop distance AND worst communication/lease reaction.
    return (math.hypot(g['robot_length_mm'], g['robot_width_mm'])/2 + g['clearance_mm']
            + g['uncertainty_mm'] + g['stopping_distance_mm'] + g['tracking_tolerance_mm']
            + g['max_speed_mm_s']*(OPERATOR_PRESENCE_MS+APPROVAL_LEASE_MS+DRIVE_LEASE_MS)/1000)


def obstacles(raw):
    if not isinstance(raw, list) or len(raw) > 64:
        raise ValueError('The camera scene is too complex for this measured-floor controller')
    result=[]
    for r in raw:
        if not isinstance(r, dict):
            raise ValueError('Invalid obstacle')
        x,y = numeric(r.get('x'),0,WIDTH), numeric(r.get('y'),0,HEIGHT)
        w,h = numeric(r.get('width'),1,WIDTH), numeric(r.get('height'),1,HEIGHT)
        if x+w > WIDTH+.001 or y+h > HEIGHT+.001:
            raise ValueError('Obstacle outside the measured floor')
        result.append(dict(x=x,y=y,width=w,height=h))
    return sorted(result, key=lambda r:(r['x'],r['y'],r['width'],r['height']))


def scene(raw):
    if not isinstance(raw, dict) or raw.get('version') != SCENE_VERSION or raw.get('robot_id') != 'amr01':
        raise ValueError('Unsupported camera scene')
    if raw.get('floor_width_mm') != WIDTH or raw.get('floor_length_mm') != HEIGHT:
        raise ValueError('Camera scene does not match the reported 760 x 560 mm floor')
    for n,size in (('agent_boot_id',32),('config_id',64)):
        identifier(raw.get(n),size)
    if type(raw.get('seq')) is not int or raw['seq'] < 0 or type(raw.get('captured_at_ms')) is not int:
        raise ValueError('Invalid camera sequence or time')
    if type(raw.get('valid')) is not bool or not isinstance(raw.get('reason',''),str) or len(raw.get('reason',''))>200:
        raise ValueError('Invalid camera validity')
    g=geometry(raw.get('geometry'))
    rects=obstacles(raw.get('obstacles',[]))
    p=raw.get('pose')
    if raw['valid']:
        if not isinstance(p,dict):
            raise ValueError('Robot pose is missing')
        p=dict(x=numeric(p.get('x'),0,WIDTH), y=numeric(p.get('y'),0,HEIGHT),
               heading=numeric(p.get('heading'),-math.pi,math.pi))
    else:
        p=None
    hardware=raw.get('hardware')
    if not isinstance(hardware,dict):
        raise ValueError('Hardware evidence is missing')
    identifier(hardware.get('boot_id')); identifier(hardware.get('epoch_id'))
    if type(hardware.get('ready')) is not bool:
        raise ValueError('Hardware readiness is missing')
    numeric(hardware.get('age_ms'),0,600000)
    numeric(hardware.get('battery_voltage_v'),0,32)
    for n in ('left_duty','right_duty'):
        if type(hardware.get(n)) is not int or abs(hardware[n]) > MAX_PWM:
            raise ValueError('Invalid hardware motor output')
    return dict(version=SCENE_VERSION,floor_width_mm=WIDTH,floor_length_mm=HEIGHT,robot_id='amr01',agent_boot_id=raw['agent_boot_id'],config_id=raw['config_id'],
                seq=raw['seq'],captured_at_ms=raw['captured_at_ms'],valid=raw['valid'],reason=raw.get('reason',''),
                geometry=g,pose=p,obstacles=rects,hardware=dict(hardware))


def map_digest(s):
    return digest(dict(floor=[s['floor_width_mm'],s['floor_length_mm']],config=s['config_id'],geometry=s['geometry'],obstacles=s['obstacles'],
                       agent=s['agent_boot_id'],boot=s['hardware']['boot_id'],epoch=s['hardware']['epoch_id']))


def ready(s, now):
    return bool(s and s['valid'] and fresh(s['captured_at_ms'],now)
                and s['hardware']['ready'] and s['hardware']['age_ms'] <= SCENE_FRESH_MS
                and s['hardware']['battery_voltage_v'] >= s['geometry']['min_pack_voltage_v'])


def scene_stop_cause(reference, current, now):
    """Classify changed evidence; only a pure, usable obstacle change may replan.

    The reference is the approved scene. A concurrent clock, sensor, identity or
    calibration failure must never be presented as an obstacle-only update.
    """
    if not current:
        return 'camera_unavailable'
    if reference:
        if current['agent_boot_id'] != reference['agent_boot_id']:
            return 'camera_restarted'
        if any(current['hardware'][k] != reference['hardware'][k] for k in ('boot_id', 'epoch_id')):
            return 'controller_changed'
        if any(current[k] != reference[k] for k in ('config_id', 'geometry', 'floor_width_mm', 'floor_length_mm')):
            return 'calibration_changed'
    if not fresh(current['captured_at_ms'], now):
        return 'camera_stale'
    if not current['valid'] or not current.get('pose'):
        return 'camera_invalid'
    hardware = current['hardware']
    if not hardware['ready'] or not 0 <= hardware['age_ms'] <= SCENE_FRESH_MS:
        return 'controller_unavailable'
    # Hardware receive age was measured when this scene was formed. Its stored
    # ready flag cannot remain current merely because the camera was current.
    if hardware['age_ms'] + max(0, now-current['captured_at_ms']) > SCENE_FRESH_MS:
        return 'controller_stale'
    if reference and current['obstacles'] != reference['obstacles']:
        return 'obstacle_changed'
    return None


def stopped_for_route(s, now, route_id, command_seq):
    """Fresh signed acknowledgement of the requested stop, never zero PWM alone."""
    if (not ready(s, now) or scene_stop_cause(None, s, now) is not None or
            type(command_seq) is not int or command_seq <= 0):
        return False
    h = s['hardware']
    return bool(h.get('route_id') == route_id and h.get('state') == 'stopped'
                and type(h.get('command_seq')) is int and h['command_seq'] >= command_seq
                and not (h['left_duty'] or h['right_duty']))


def segment_clear(a,b,rects,r):
    if any(not (r <= p[0] <= WIDTH-r and r <= p[1] <= HEIGHT-r) for p in (a,b)):
        return False
    for q in rects:
        enter,leave=0.,1.
        for axis,low,high in ((0,q['x']-r,q['x']+q['width']+r),(1,q['y']-r,q['y']+q['height']+r)):
            delta=b[axis]-a[axis]
            if delta == 0:
                if a[axis]<low or a[axis]>high:
                    break
            else:
                t1,t2=(low-a[axis])/delta,(high-a[axis])/delta
                enter,leave=max(enter,min(t1,t2)),min(leave,max(t1,t2))
                if enter>leave:
                    break
        else:
            return False
    return True


def plan(s, goal):
    if not isinstance(goal,(list,tuple)) or len(goal)!=2:
        raise ValueError('Choose a destination on the measured floor')
    # Measured station coordinates are authoritative. The grid supplies only
    # intermediate nodes; rounding must never change clearance or arrival.
    goal=(numeric(goal[0],0,WIDTH),numeric(goal[1],0,HEIGHT))
    actual=(s['pose']['x'],s['pose']['y'])
    start=tuple(round(v/GRID)*GRID for v in actual)
    r=radius(s['geometry']); rects=s['obstacles']
    if not segment_clear(actual,actual,rects,r) or not segment_clear(goal,goal,rects,r):
        raise ValueError('Start or destination lacks footprint, reaction and stopping clearance')

    def result(points):
        if len(points)>300:
            raise ValueError('Route exceeds the bounded floor job size')
        return dict(points=[list(p) for p in points],goal=list(goal),
                    length_mm=sum(math.dist(a,b) for a,b in zip(points,points[1:])),
                    clearance_radius_mm=r,goal_tolerance_mm=15,grid_mm=GRID)

    if start==tuple(round(v/GRID)*GRID for v in goal) and segment_clear(actual,goal,rects,r):
        return result([actual] if actual==goal else [actual,goal])
    if not segment_clear(actual,start,rects,r):
        raise ValueError('Start or destination lacks footprint, reaction and stopping clearance')
    opened=[(math.dist(start,goal),0.,start)]; costs={start:0.}; previous={}; visited=set()
    while opened:
        _,cost,p=heapq.heappop(opened)
        if p in visited: continue
        if p==goal:
            points=[p]
            while p!=start: p=previous[p]; points.append(p)
            points.reverse()
            if actual!=start: points.insert(0,actual)
            return result(points)
        visited.add(p)
        neighbours=[(p[0]+dx,p[1]+dy) for dx in (-GRID,0,GRID) for dy in (-GRID,0,GRID) if dx or dy]
        # A visible neighbouring grid node can reach the exact goal even when
        # its nearest rounded node is blocked. This edge receives the same
        # continuous swept-clearance check and contributes its full length.
        if math.dist(p,goal)<=math.sqrt(2)*GRID:
            neighbours.append(goal)
        for q in neighbours:
            if q in visited or not segment_clear(p,q,rects,r): continue
            next_cost=cost+math.dist(p,q)
            if next_cost>=costs.get(q,math.inf): continue
            costs[q]=next_cost; previous[q]=p
            heapq.heappush(opened,(next_cost+math.dist(q,goal),next_cost,q))
    raise ValueError('No route fits this robot and the required stopping clearance')


def angle(value):
    return (value+math.pi)%(2*math.pi)-math.pi


def path_distance(p,points):
    result=math.inf
    for a,b in zip(points,points[1:]):
        dx,dy=b[0]-a[0],b[1]-a[1]
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))) if dx or dy else 0
        result=min(result,math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy))
    return min(result,math.dist(p,points[0]))


class Follower:
    """Camera-feedback waypoint tracking; no signed encoder pose is invented."""
    def __init__(self, route, config, now_ms):
        self.route,self.g=route,geometry(config)
        self.index=0; self.started=now_ms; self.progress_at=now_ms
        self.best=math.inf; self.last_pose=None

    def update(self, s, now_ms):
        if not ready(s,now_ms): raise ValueError('Fresh camera and hardware evidence lost')
        if now_ms-self.started>MAX_ROUTE_MS: raise ValueError('Route duration limit reached')
        p=(s['pose']['x'],s['pose']['y']); pts=self.route['points']
        if path_distance(p,pts)>self.g['tracking_tolerance_mm']:
            raise ValueError('Robot departed from the approved route')
        if not segment_clear(p,p,s['obstacles'],radius(self.g)):
            raise ValueError('Robot clearance is no longer valid')
        distance=math.dist(p,self.route['goal'])
        if distance <= self.route['goal_tolerance_mm']:
            return 0,0,True
        # Camera displacement OR heading progress counts, including detours.
        if self.last_pose is None or math.dist(p,self.last_pose[:2])>=5 or abs(angle(s['pose']['heading']-self.last_pose[2]))>=.08:
            self.last_pose=(*p,s['pose']['heading']); self.progress_at=now_ms
        if now_ms-self.progress_at>5000:
            raise ValueError('No route progress; inspect wheels and motor calibration')
        while self.index<len(pts)-1 and math.dist(p,pts[self.index])<min(15,self.g['tracking_tolerance_mm']):
            self.index+=1
        target=pts[self.index]
        if not segment_clear(p,target,s['obstacles'],radius(self.g)):
            raise ValueError('Next route segment no longer has clearance')
        error=angle(math.atan2(target[1]-p[1],target[0]-p[0])-s['pose']['heading'])
        omega=max(-self.g['max_angular_rad_s'],min(self.g['max_angular_rad_s'],2*error))
        speed=0 if abs(error)>.35 else min(self.g['max_speed_mm_s'],distance)*max(0,math.cos(error))
        wheels=(speed-omega*self.g['wheel_track_mm']/2,speed+omega*self.g['wheel_track_mm']/2)
        result=[]
        for side,v in zip(('left','right'),wheels):
            duty=round(abs(v)*self.g[side+'_pwm_per_mm_s'])
            if duty: duty=max(self.g['minimum_drive_pwm'],min(self.g['max_pwm'],duty))
            result.append((1 if v>=0 else -1)*duty*self.g[side+'_polarity'])
        return *result,False
