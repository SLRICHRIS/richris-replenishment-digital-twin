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


def drive(boot,epoch,route,seq,operation,left,right,now,secret):
    for v in (boot,epoch,route): identifier(v)
    if operation not in ('arm','drive','stop') or type(seq) is not int or seq<1:
        raise ValueError('Invalid controller operation')
    if any(type(v) is not int or abs(v)>MAX_PWM for v in (left,right)):
        raise ValueError('Motor output exceeds the route limit')
    if operation!='drive' and (left or right): raise ValueError('Arming and stopping require zero output')
    return signed(('V1',boot,epoch,route,seq,operation,left,right,now,now+DRIVE_LEASE_MS),secret)


def hardware(raw,secret,now):
    f=verified(raw,secret,12)
    if f[0]!='H1': raise ValueError('Unsupported hardware packet')
    for v in f[1:3]+[f[4]]: identifier(v)
    values=[int(f[i]) for i in (3,5,7,8,9,10,11)]
    seq,command_seq,left,right,mv,is_ready,stamp=values
    if seq<0 or command_seq<0 or abs(left)>MAX_PWM or abs(right)>MAX_PWM or not 0<=mv<=32000 or is_ready not in (0,1) or not fresh(stamp,now):
        raise ValueError('Stale or invalid hardware heartbeat')
    if f[6] not in ('idle','armed','moving','interlock','stopped','expired','local_stop','unavailable'):
        raise ValueError('Invalid controller state')
    return dict(boot_id=f[1],epoch_id=f[2],seq=seq,route_id=f[4],command_seq=command_seq,state=f[6],
                left_duty=left,right_duty=right,battery_voltage_v=mv/1000,ready=bool(is_ready),
                issued_at_ms=stamp,age_ms=max(0,now-stamp))
