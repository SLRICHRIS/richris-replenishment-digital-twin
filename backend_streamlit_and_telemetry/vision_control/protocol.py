"""Small ASCII HMAC protocol also implemented by the ESP32 guard.

The 64 hexadecimal characters are used as ASCII key bytes, never hex-decoded.
Every connection receives a new epoch; retained/replayed commands cannot arm it.
"""
import hashlib
import hmac
from .contracts import key, identifier, fresh, MAX_PWM, DRIVE_LEASE_MS


def signed(fields, secret):
    body='|'.join(str(x) for x in fields)
    return body+'|'+hmac.new(key(secret),body.encode(),hashlib.sha256).hexdigest()


def verified(raw, secret, fields):
    if isinstance(raw,bytes): raw=raw.decode('ascii')
    if not isinstance(raw,str) or len(raw)>600 or len(raw.split('|'))!=fields+1:
        raise ValueError('Invalid controller packet')
    body,signature=raw.rsplit('|',1)
    identifier(signature,64)
    expected=hmac.new(key(secret),body.encode('ascii'),hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected,signature): raise ValueError('Controller authentication failed')
    return body.split('|')


def drive(boot,epoch,route,seq,operation,left,right,now,secret,lease_ms=DRIVE_LEASE_MS,max_pwm=MAX_PWM):
    if type(lease_ms) is not int or not 1 <= lease_ms <= DRIVE_LEASE_MS:
        raise ValueError("Invalid motor command lease")
    if type(max_pwm) is not int or not 1 <= max_pwm <= 255:
        raise ValueError("Invalid configured PWM cap")
    for v in (boot,epoch,route): identifier(v)
    if operation not in ('arm','drive','stop') or type(seq) is not int or seq<1:
        raise ValueError('Invalid controller operation')
    if any(type(v) is not int or abs(v)>max_pwm for v in (left,right)):
        raise ValueError('Motor output exceeds the route limit')
    if operation!='drive' and (left or right): raise ValueError('Arming and stopping require zero output')
    return signed(('V1',boot,epoch,route,seq,operation,left,right,now,now+lease_ms),secret)


def hardware(raw,secret,now,max_pwm=MAX_PWM,allow_manual=False):
    version=raw[:3] if isinstance(raw,(str,bytes)) else ''
    extended=version in ('H2|',b'H2|')
    f=verified(raw,secret,13 if extended else 12)
    if f[0] not in ('H1','H2'): raise ValueError('Unsupported hardware packet')
    if extended and not allow_manual:
        raise ValueError('Manual-only receiver cannot establish camera-route readiness')
    for v in f[1:3]+[f[4]]: identifier(v)
    values=[int(f[i]) for i in (3,5,7,8,9,10,11)]
    seq,command_seq,left,right,mv,is_ready,stamp=values
    if seq<0 or command_seq<0 or abs(left)>max_pwm or abs(right)>max_pwm or not 0<=mv<=32000 or is_ready not in (0,1) or not fresh(stamp,now):
        raise ValueError('Stale or invalid hardware heartbeat')
    if f[6] not in ('idle','armed','moving','interlock','stopped','expired','local_stop','unavailable'):
        raise ValueError('Invalid controller state')
    cap=int(f[12]) if extended else 160
    if not 1<=cap<=255: raise ValueError('Invalid controller PWM capability')
    return dict(boot_id=f[1],epoch_id=f[2],seq=seq,route_id=f[4],command_seq=command_seq,state=f[6],max_pwm=cap,protocol=f[0],
                left_duty=left,right_duty=right,battery_voltage_v=mv/1000,ready=bool(is_ready),
                issued_at_ms=stamp,age_ms=max(0,now-stamp))
