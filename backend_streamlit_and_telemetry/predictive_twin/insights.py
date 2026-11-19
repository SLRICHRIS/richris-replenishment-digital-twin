"""Evidence-based operator guidance from the existing six sensor models."""
import math


def observation_insights(physical):
    """Read-only guidance from current commissioning evidence, not full models."""
    result=dict(source='Live physical observations',scope='physical_observation',
                ready=False,metrics=[],recommendations=[])
    def recommend(code,title,detail,tone='info'):
        result['recommendations'].append(dict(code=code,title=title,detail=detail,tone=tone))
    def number(value):return type(value) in (int,float) and math.isfinite(value)
    age=physical.get('age_s')
    if physical.get('fresh') is not True or not number(age) or not -1<=age<=5:
        recommend('feed_unavailable','Restore the live ESP32 feed',
                  'Power the ESP32 and check Wi-Fi and sensor forwarding. Current recommendations wait for a fresh stored packet.','warning')
        return result
    raw=physical.get('measurements') or {}
    if not raw or raw.get('robot_id')!='amr01':
        recommend('waiting_sample','Wait for a complete ESP32 sample',
                  'The current packet must identify AMR-01 before its observations can be reviewed.','warning')
        return result
    result['ready']=True
    voltage=raw.get('battery_voltage_v')
    if raw.get('battery_available') is not True or not number(voltage) or voltage<1:
        recommend('battery_input','Check the battery input connection',
                  'A usable INA219 battery sample is missing or below 1 V. Check battery power and INA219 VIN wiring before interpreting charge.','warning')
    else:
        result['metrics'].append(dict(label='Measured battery input',value=f'{voltage:.3f} V',
            detail='The current remote-drive cutoff is 6.6 V; voltage alone does not establish charge percentage.'))
        if voltage<6.6:
            recommend('battery_low','Charge the battery before driving',
                      f'The measured input is {voltage:.3f} V, below the 6.6 V remote-drive cutoff. Stop the vehicle before checking or charging its battery.','warning')
    if raw.get('gyro_available') is not True or not number((physical.get('gyro_estimates') or {}).get('corrected_gyro_rad_s')):
        recommend('imu_input','Check the IMU connection',
                  'A current corrected Z gyro reading is missing. Check sensor startup and I2C wiring. Wheel observations remain separate.','warning')
    motion=physical.get('motion_observation') or {}
    if motion.get('state')=='reanchoring':
        recommend('motion_gap','Watch the new local motion origin',
                  'A missing or ambiguous wheel interval reset local odometry. Compare the estimate with the vehicle during the next attended drive interval.')
    residual=motion.get('residual_rad_s')
    if number(residual):
        result['metrics'].append(dict(label='Observed turning-rate difference',value=f'{residual:.5f} rad/s',
            detail='Corrected gyro minus command-inferred wheel turning rate. This observation does not apply an unvalidated fault threshold.'))
    charge=(physical.get('energy_observation') or {}).get('soc_scenario') or {}
    percent=charge.get('percent')
    if number(percent):
        result['metrics'].append(dict(label='Reported-start charge scenario',value=f'{percent:.2f}%',
            detail='Uses the reported 2.2 Ah pack and assumed 100% start; recorded motor-branch current only. Actual remaining charge is unknown.'))
        if charge.get('outside_physical_range'):
            recommend('charge_range','Inspect the charge scenario inputs',
                      'The recorded-current scenario is outside 0–100%. Treat it as an inconsistent assumption, not an actual battery percentage.','warning')
    if not result['recommendations']:
        recommend('monitor','Continue attended monitoring',
                  'The current battery and IMU samples are available. Observe the AMR alongside its wheel and gyro readings; use Drive control for any movement.')
    return result


def predictive_insights(payload):
    demo = payload.get('mode') == 'demo'
    robot = payload.get('robots', {}).get('amr01')
    source = 'Demo example' if demo else 'Physical sensor data'
    result = dict(source=source, ready=False, metrics=[], recommendations=[])
    if not demo and payload.get('physical_telemetry') is not None and (not robot or robot.get('stale') or robot.get('continuity_lost') or robot.get('quality')!='OK'):
        return observation_insights(payload['physical_telemetry'])

    def recommend(title, detail, tone='info'):
        result['recommendations'].append(dict(title=title, detail=detail, tone=tone))

    if not robot:
        notice = payload.get('notice') or {}
        recommend(notice.get('label', 'Connect the AMR'),
                  notice.get('detail', 'Wait for validated physical sensor readings.'), 'warning')
        return result
    if robot.get('stale') or robot.get('continuity_lost') or robot.get('quality') != 'OK':
        recommend(robot.get('quality_label', 'Check sensor continuity'),
                  robot.get('quality_detail', 'Fresh, continuous readings are required before using predictions.'), 'warning')
        return result
    derived = robot.get('derived') or {}
    if not derived or not robot.get('raw'):
        recommend('Wait for complete model inputs',
                  'Current raw sensor values and derived results are required before interpreting predictions.', 'warning')
        return result
    soc = robot.get('soc')
    if not isinstance(soc, (int, float)) or not math.isfinite(soc) or not 0 <= soc <= 1:
        recommend('Check battery calibration',
                  'The calculated state of charge is outside its valid range. Verify capacity, initial charge and current polarity.', 'warning')
        return result
    result['ready'] = True
    result['metrics'].append(dict(label='Estimated charge', value=f'{soc * 100:.1f}%',
                                  detail='Coulomb counting; usable capacity and initial charge must be measured.'))
    runtime = robot.get('runtime_hours')
    if isinstance(runtime, (int, float)) and math.isfinite(runtime) and runtime >= 0:
        result['metrics'].append(dict(label='Time to 20% reserve', value=f'{runtime:.2f} h',
                                      detail='Assumes unchanged current; not a battery-life guarantee.'))
    else:
        result['metrics'].append(dict(label='Time to 20% reserve', value='Unavailable',
                                      detail='A positive discharge current and valid battery state are required.'))
    forecast = robot.get('forecast_pose')
    if isinstance(forecast, (list, tuple)) and len(forecast) == 3 and all(
            isinstance(v, (int, float)) and math.isfinite(v) for v in forecast):
        result['metrics'].append(dict(label='Position in 5 seconds',
                                      value=f'x {forecast[0]:.3f} / y {forecast[1]:.3f} m',
                                      detail='Local odometry; assumes unchanged wheel speeds.'))
    if derived.get('advisory') is True and derived.get('residual_valid', False):
        recommend('Inspect the motion sensors',
                  'Gyro and encoder turning rates disagree beyond the configured hold threshold. Check wheel slip, encoder counts, IMU mounting and gyro bias. This does not identify a specific fault.', 'warning')
    elif derived.get('residual_valid') is not True:
        recommend('Restore the gyro–encoder comparison',
                  'The current motion comparison is unavailable. Check packet continuity before interpreting the motion advisory.', 'warning')
    if soc <= .2:
        recommend('Recharge before extending the trial',
                  'Estimated charge has reached the assumed 20% reserve. Confirm battery voltage and the measured state of charge before continuing.', 'warning')
    elif not result['recommendations']:
        recommend('Continue monitoring',
                  'No sustained gyro–encoder disagreement is present at this sample and estimated charge is above the assumed reserve. Recheck data freshness before each decision.')
    return result
