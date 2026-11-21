"""Auditable live checks over measured channels, with bounded same-boot history.

Screening thresholds below are engineering review settings, not learned fault
probabilities or certified safety limits. No rule publishes a motor command.
"""
import math
from statistics import median

POLICY = dict(version='live-sensor-checks-v1', history_s=30., fresh_s=5.,
              drive_cutoff_v=6.6, load_drop_v=.5, sustained_s=2.,
              minimum_samples=5, imbalance_fraction=.5, minimum_wheel_pulses=10,
              zero_current_a=.02, reverse_current_a=-.05,
              apparent_tilt_deg=25., stationary_rate_dps=5., acceleration_delta_g=.5)

ACTION_CATALOG = [
    dict(id='no_action', label='Keep monitoring', channel='observation',
         detail='Continue the attended trial and compare the next live readings.'),
    dict(id='stop_and_inspect', label='Stop and inspect the AMR', channel='local_manual',
         detail='Use Stop in the direct Wi-Fi controller, then inspect the indicated part.'),
    dict(id='lower_power', label='Review a lower motor-power setting', channel='local_manual',
         detail='Stop first. Adjust the local controller to a previously verified lower setting, then make a brief attended check.'),
    dict(id='recharge', label='Check / recharge battery', channel='physical_task',
         detail='Stop the AMR, disconnect motor power and check the pack and its connections before charging.'),
    dict(id='inspect_power', label='Inspect the motor-power path', channel='physical_task',
         detail='With motor power off, check the pack, connectors, driver supply, common ground and driver enable wiring.'),
    dict(id='inspect_wheels', label='Inspect wheels and encoder feedback', channel='physical_task',
         detail='Stop, isolate motor power and check wheel obstruction, encoder alignment, wiring and left/right assignment.'),
    dict(id='calibrate_imu', label='Check IMU mounting and gyro calibration', channel='physical_task',
         detail='Keep the robot still and level; check mounting and startup calibration before using heading or route estimates.'),
    dict(id='check_feed', label='Restore the sensor connection', channel='physical_task',
         detail='Check ESP32 power, the hotspot and sensor forwarding; wait for fresh packets before interpreting guidance.'),
    dict(id='inspect', label='Inspect the AMR / sensors', channel='physical_task',
         detail='Check the affected sensor and compare its readings with an independent observation.'),
]


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def _valid_sensor(row, flag, clock):
    if row.get(flag) is not True:
        return False
    # Legacy display payloads omit sensor clocks. Production rows include them.
    if clock not in row:
        return True
    t, sampled = row.get('sample_time_s'), row.get(clock)
    maximum = .55 if flag == 'battery_available' else .15
    return number(t) and number(sampled) and 0 <= t-sampled <= maximum


def history_window(physical, raw):
    """Deduplicate, reject future/other-boot samples and bound device elapsed time."""
    t, seq, boot = raw.get('sample_time_s'), raw.get('seq'), raw.get('boot_id')
    if not number(t) or type(seq) is not int or not boot:
        return [], []
    points = {}
    for row in list(physical.get('history') or [])[-200:] + [raw]:
        at, identity = row.get('sample_time_s'), row.get('seq')
        if (row.get('boot_id') == boot and type(identity) is int and 0 <= identity <= seq
                and number(at) and 0 <= t-at <= POLICY['history_s']):
            points[identity] = row
    ordered = sorted(points.values(), key=lambda row: row['seq'])
    tail = []
    for row in ordered:
        if tail:
            previous = tail[-1]
            gap = row['sample_time_s']-previous['sample_time_s']
            if row['seq'] != previous['seq']+1 or not 0 < gap <= 1.1:
                tail = []
        tail.append(row)
    return ordered, tail


def sustained(tail, condition, seconds=None):
    selected = []
    for row in reversed(tail):
        if not condition(row):
            break
        selected.append(row)
    required = POLICY['sustained_s'] if seconds is None else seconds
    return (list(reversed(selected)) if len(selected) >= POLICY['minimum_samples']
            and selected[0]['sample_time_s']-selected[-1]['sample_time_s'] >= required else [])


def driving(row):
    return (row.get('motor_output') in {'forward', 'backward', 'left', 'right'}
            and type(row.get('pwm_duty')) is int and 0 < row['pwm_duty'] <= 255)


def stopped(row):
    return row.get('motor_output') == 'stopped' and row.get('pwm_duty') == 0


def wheel_zero(row, sides=('left', 'right')):
    return all(number(row.get(side+'_pulse_hz')) and row[side+'_pulse_hz'] == 0 for side in sides)


def acceleration(row):
    values = [row.get('accel_'+axis+'_g') for axis in 'xyz']
    return math.sqrt(sum(v*v for v in values)) if all(number(v) for v in values) else None


def live_sensor_insights(physical):
    result = dict(source='Live physical observations', scope='physical_observation', ready=False,
                  metrics=[], recommendations=[], coverage=[], actions=ACTION_CATALOG,
                  policy=POLICY.copy(), observed_at=physical.get('received_at'), sample_age_s=physical.get('age_s'))
    def recommend(code, title, detail, *, category='Sensor health', priority='check', action='inspect', basis='Measured input', evidence=None):
        result['recommendations'].append(dict(code=code, title=title, detail=detail,
            tone='warning' if priority in {'stop', 'check'} else 'info', category=category,
            priority=priority, action=action, basis=basis, evidence=evidence or []))
    def metric(label, value, detail):
        result['metrics'].append(dict(label=label, value=value, detail=detail))
    def cover(name, available, detail):
        result['coverage'].append(dict(category=name, state='available' if available else 'unavailable', detail=detail))
    age = physical.get('age_s')
    if physical.get('fresh') is not True or not number(age) or not -1 <= age <= POLICY['fresh_s']:
        recommend('feed_unavailable', 'Restore the live ESP32 feed',
                  'Current guidance waits for a fresh stored packet. Check ESP32 power, Wi-Fi and sensor forwarding.',
                  category='Connection', action='check_feed')
        cover('Connection', False, 'No current packet within the five-second freshness window.')
        return result
    raw = physical.get('measurements') or {}
    if not raw or raw.get('robot_id') != 'amr01':
        recommend('waiting_sample', 'Wait for a complete ESP32 sample',
                  'The packet must identify AMR-01 before its readings can support a review.', category='Connection', action='check_feed')
        return result
    result['ready'] = True
    result['sample'] = dict(boot_id=raw.get('boot_id'), seq=raw.get('seq'), sample_time_s=raw.get('sample_time_s'))
    ordered, tail = history_window(physical, raw)
    result['window'] = dict(samples=len(ordered), continuous_samples=len(tail),
        duration_s=ordered[-1]['sample_time_s']-ordered[0]['sample_time_s'] if ordered else 0)
    voltage, current, power = (raw.get(key) for key in ('battery_voltage_v', 'battery_current_a', 'battery_power_w'))
    battery = _valid_sensor(raw, 'battery_available', 'battery_sample_time_s') and number(voltage) and 1 <= voltage <= 32
    corrected = (physical.get('gyro_estimates') or {}).get('corrected_gyro_rad_s')
    imu = _valid_sensor(raw, 'gyro_available', 'imu_sample_time_s') and number(corrected)
    if not battery:
        recommend('battery_input', 'Check the battery input connection',
                  'A usable INA219 sample is missing, delayed or below 1 V. Check battery power and INA219 VIN wiring before interpreting charge.', category='Battery', action='inspect_power')
    else:
        metric('Measured battery input', f'{voltage:.3f} V', '6.6 V is the existing remote-drive cutoff. Voltage alone does not establish charge percentage.')
        if voltage <= POLICY['drive_cutoff_v']:
            recommend('battery_low', 'Stop and check the battery before driving',
                      f'The input is {voltage:.3f} V, at or below 6.60 V. Stop before checking the pack and motor-power connections.',
                      category='Battery', priority='stop', action='recharge', evidence=[f'Battery {voltage:.3f} V', 'Cutoff 6.60 V'])
    if not imu:
        recommend('imu_input', 'Check the IMU connection',
                  'A current corrected gyro reading is missing. Check startup and I2C wiring.', category='Gyro / acceleration', action='calibrate_imu')
    motion = physical.get('motion_observation') or {}
    residual = motion.get('residual_rad_s')
    if number(residual):
        metric('Observed turning-rate difference', f'{residual:.5f} rad/s',
               'Corrected gyro minus command-inferred wheel turning rate. No unvalidated fault threshold is applied.')
    charge = (physical.get('energy_observation') or {}).get('soc_scenario') or {}
    percent = charge.get('percent')
    if number(percent):
        metric('Reported-start charge scenario', f'{percent:.2f}%',
               'Uses the reported 2.2 Ah pack and assumed 100% start; motor-branch current only. Actual remaining charge is unknown.')
        if charge.get('outside_physical_range'):
            recommend('charge_range', 'Inspect the charge scenario inputs',
                      'The scenario is outside 0–100%. Recheck current zero, polarity and the starting-charge reference.', category='Battery', action='inspect_power')
    if raw.get('battery_continuity') is False:
        recommend('charge_gap', 'Re-establish the battery measurement reference',
                  'A battery measurement gap was reported. Check the current sensor before using accumulated charge or runtime scenarios.', category='Battery', action='inspect_power')
    if battery and number(current):
        metric('Motor-branch current', f'{current:.3f} A', 'Positive means the reported discharge direction. This sensor does not measure the entire robot supply.')
    if battery and number(power):
        metric('Motor-branch power', f'{power:.2f} W', 'Measured voltage × current; neither a motor temperature nor a driver-current limit.')
    valid_battery = [p for p in ordered if _valid_sensor(p, 'battery_available', 'battery_sample_time_s')
                     and number(p.get('battery_voltage_v')) and p['battery_voltage_v'] >= 1]
    if len(valid_battery) >= 2:
        metric('Recent battery range', f'{min(p["battery_voltage_v"] for p in valid_battery):.2f}–{max(p["battery_voltage_v"] for p in valid_battery):.2f} V',
               'Up to 30 seconds from the current boot; inspect load-related drops even after idle voltage recovers.')
        sag = None
        # A pre-load baseline must precede the loaded reading and share its boot.
        for point in valid_battery:
            if not driving(point):
                continue
            baseline = [p['battery_voltage_v'] for p in valid_battery if stopped(p)
                        and 0 < point['sample_time_s']-p['sample_time_s'] <= 5]
            if len(baseline) >= 3:
                before = median(baseline)
                drop = before-point['battery_voltage_v']
                if drop >= POLICY['load_drop_v'] and (sag is None or drop > sag[0]):
                    sag = (drop, before, point)
        if sag:
            drop, before, point = sag
            recommend('voltage_sag', 'Inspect the supply under motor load',
                      f'Voltage fell from a preceding idle median of {before:.2f} V to {point["battery_voltage_v"]:.2f} V during reported output. Check the pack, connectors and motor load; this does not identify which part caused the drop.',
                      category='Battery', priority='stop' if point['battery_voltage_v'] <= 6.6 else 'check', action='inspect_power',
                      basis='Recent load comparison', evidence=[f'Drop {drop:.2f} V', f'Output PWM {point["pwm_duty"]}/255'])
    negative = sustained(tail, lambda p: driving(p) and _valid_sensor(p, 'battery_available', 'battery_sample_time_s')
                         and number(p.get('battery_current_a')) and p['battery_current_a'] < POLICY['reverse_current_a'])
    if negative:
        recommend('current_polarity', 'Check current polarity during motor output',
                  'Current remained negative during reported motor output. Check polarity, sensor zero and possible regeneration before interpreting charge.', category='Power', action='inspect_power', basis='Sustained screening check')
    if {'commanded_motion', 'motor_output', 'pwm_duty'} <= raw.keys():
        metric('Requested / reported output', f'{raw["commanded_motion"]} / {raw["motor_output"]}',
               f'Reported applied PWM {raw["pwm_duty"]}/255. GPIO output reports do not establish wheel travel.')
    pending = sustained(tail, lambda p: p.get('commanded_motion') in {'forward','backward','left','right'} and stopped(p))
    if pending:
        recommend('command_not_applied', 'Check why the drive request remains stopped',
                  'Motion was requested but reported motor output stayed stopped for at least two seconds. Check the local controller response and interlocks before changing power.', category='Controller', action='stop_and_inspect', basis='Sustained screening check')
    no_feedback = sustained(tail, lambda p: driving(p) and wheel_zero(p,
                           ('right',) if p.get('motor_output') == 'left' else ('left',) if p.get('motor_output') == 'right' else ('left','right')))
    if no_feedback:
        recommend('drive_no_pulses', 'Stop and check motor motion and encoder feedback',
                  'Reported motor output continued for at least two seconds without pulses from the expected moving wheel(s). Check actual wheel motion, obstruction, encoder alignment and wiring; a stall is not confirmed by this alone.', category='Wheel feedback', priority='stop', action='inspect_wheels', basis='Sustained screening check')
        no_current = sustained(tail, lambda p: driving(p) and wheel_zero(p) and _valid_sensor(p, 'battery_available', 'battery_sample_time_s')
                               and number(p.get('battery_current_a')) and abs(p['battery_current_a']) <= POLICY['zero_current_a'])
        if no_current:
            recommend('drive_no_current', 'Inspect motor supply and driver enable',
                      'Reported output has no wheel pulses and motor-branch current stayed near zero. With motor power off, check VM, GND, STBY and the motor leads; do not assume that raising PWM will fix it.', category='Power', priority='stop', action='inspect_power', basis='Combined output / current / encoder screening')
    for side, other in (('left','right'), ('right','left')):
        missing = sustained(tail, lambda p: driving(p) and p.get('motor_output') in {'forward','backward'}
                            and wheel_zero(p, (side,)) and number(p.get(other+'_pulse_hz')) and p[other+'_pulse_hz'] > 0)
        if missing:
            recommend(side+'_feedback_missing', f'Inspect {side} wheel feedback',
                      f'During straight-direction output, {other} encoder pulses continued while the {side} side stayed at zero. Check wheel motion, channel assignment and sensor wiring.', category='Wheel feedback', action='inspect_wheels', basis='Sustained screening check')
    straight = sustained(tail, lambda p: driving(p) and p.get('motor_output') in {'forward','backward'}
                         and all(number(p.get(side+'_pulse_hz')) and p[side+'_pulse_hz'] > 0 for side in ('left','right')))
    if straight:
        totals = [sum(p[side+'_pulse_hz']*p.get('interval_s', 0) for p in straight if number(p.get('interval_s'))) for side in ('left','right')]
        if min(totals) >= POLICY['minimum_wheel_pulses'] and abs(totals[0]-totals[1])/max(totals) >= POLICY['imbalance_fraction']:
            recommend('wheel_imbalance', 'Review the difference between wheel rates',
                      'The wheel pulse totals differ by at least 50% over a sustained straight-direction interval. First check whether steering was intended, then inspect wheel loading, slip and encoder counts.', category='Wheel feedback', action='inspect_wheels', basis='Sustained screening check', evidence=[f'Left {totals[0]:.0f} pulses', f'Right {totals[1]:.0f} pulses'])
    idle_pulses = sustained(tail, lambda p: stopped(p) and any(number(p.get(s+'_pulse_hz')) and p[s+'_pulse_hz'] > 0 for s in ('left','right')))
    if idle_pulses:
        recommend('pulses_while_stopped', 'Check wheel pulses while output is stopped',
                  'Pulses continued while reported PWM was zero. Check for hand movement, coasting, vibration or electrical noise before treating these counts as powered travel.', category='Wheel feedback', action='inspect_wheels', basis='Sustained screening check')
    if imu and 'gyro_bias_estimate_rad_s' in raw and not number(raw['gyro_bias_estimate_rad_s']):
        recommend('gyro_startup', 'Complete startup gyro calibration before heading-based control',
                  'This boot has no valid startup bias estimate. Keep the robot still for startup calibration before using heading or camera-route control.', category='Gyro / acceleration', action='calibrate_imu')
    stationary = sustained(tail, lambda p: stopped(p) and wheel_zero(p) and _valid_sensor(p, 'gyro_available', 'imu_sample_time_s'))
    if stationary and all(number(p.get('gyro_z_rad_s')) for p in stationary):
        bias = (physical.get('gyro_estimates') or {}).get('bias_rad_s')
        if number(bias) and all(abs(math.degrees(p['gyro_z_rad_s']-bias)) > POLICY['stationary_rate_dps'] for p in stationary):
            recommend('gyro_when_stopped', 'Confirm stillness and recheck gyro bias',
                      'The corrected gyro stayed above 5°/s while output and wheel pulse rates were zero. Confirm the robot was actually still, then check mounting and calibration.', category='Gyro / acceleration', action='calibrate_imu', basis='Sustained screening check')
    gravity_like = sustained(tail, lambda p: stopped(p) and wheel_zero(p) and _valid_sensor(p, 'gyro_available', 'imu_sample_time_s')
                             and number(acceleration(p)) and .9 <= acceleration(p) <= 1.1
                             and all(number(p.get('gyro_'+a+'_dps')) and abs(p['gyro_'+a+'_dps']) <= POLICY['stationary_rate_dps'] for a in 'xyz'))
    if gravity_like:
        angles = [math.degrees(math.atan2(math.hypot(p['accel_x_g'],p['accel_y_g']), p['accel_z_g'])) for p in gravity_like]
        if min(angles) >= POLICY['apparent_tilt_deg'] and max(angles)-min(angles) <= 5:
            recommend('apparent_tilt', 'Check robot level and IMU mounting',
                      f'The gravity-based apparent tilt is about {median(angles):.1f}°. Confirm the robot is level and the reported Z-up mounting is correct before a drive trial.', category='Gyro / acceleration', action='calibrate_imu', basis='Quasi-static screening estimate')
    acceleration_event = sustained(tail, lambda p: _valid_sensor(p, 'gyro_available', 'imu_sample_time_s')
                                   and number(acceleration(p)) and abs(acceleration(p)-1) > POLICY['acceleration_delta_g'])
    if acceleration_event:
        recommend('acceleration_change', 'Inspect motion and IMU mounting',
                  'Acceleration magnitude stayed more than 0.5 g from gravity for at least two seconds. Check actual motion and sensor mounting. The stored sample rate cannot identify vibration frequency or every brief impact.', category='Gyro / acceleration', action='stop_and_inspect', basis='Sustained screening check')
    gaps = sum(max(0, b['seq']-a['seq']-1) for a,b in zip(ordered, ordered[1:]))
    if gaps:
        recommend('packet_gap', 'Check recent gaps in sensor packets',
                  f'{gaps} sequence positions are missing in the recent window. Check forwarding and connection stability; sustained checks restart after a gap.', category='Connection', action='check_feed', basis='Packet sequence check')
    if motion.get('state') == 'reanchoring':
        recommend('motion_gap', 'Watch the new local motion origin',
                  'A missing or ambiguous wheel interval reset local odometry. Compare the estimate with the AMR during the next attended interval.', category='Wheel feedback', priority='info', action='inspect_wheels')
    wheel_data = all(number(raw.get(s+'_pulse_hz')) and raw[s+'_pulse_hz'] >= 0 for s in ('left','right'))
    cover('Battery', battery, f'{voltage:.2f} V measured' if battery else 'Check battery sampling and wiring.')
    cover('Power', battery and number(current) and number(power), 'Motor branch only; calibrated motor-current limits are not configured.')
    cover('Wheel feedback', wheel_data, 'Rotation magnitudes from counted pulses; ground travel and direction are not independently measured.')
    cover('Gyro / acceleration', imu, 'Turning rate and sampled acceleration; orientation checks require a stable, gravity-like interval.')
    cover('Controller', {'commanded_motion','motor_output','pwm_duty'} <= raw.keys(), 'Requested motion and reported outputs are compared with sensor feedback.')
    cover('Connection', True, f'Packet age {max(0,age):.1f} s; {len(ordered)} recent same-boot samples.')
    if not result['recommendations']:
        recommend('monitor', 'Continue attended monitoring',
                  'No configured live check is currently triggered. Observe the AMR alongside its readings and use direct Wi-Fi control for movement.', priority='info', action='no_action', basis='Available inputs only')
    rank = {'stop':0, 'check':1, 'info':2}
    result['recommendations'].sort(key=lambda item: rank[item['priority']])
    result['summary'] = dict(stop=sum(r['priority']=='stop' for r in result['recommendations']),
                            check=sum(r['priority']=='check' for r in result['recommendations']),
                            covered=sum(c['state']=='available' for c in result['coverage']), total=len(result['coverage']))
    return result
