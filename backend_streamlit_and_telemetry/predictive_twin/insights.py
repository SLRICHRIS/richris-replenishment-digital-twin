"""Evidence-based operator guidance from the existing six sensor models."""
import math


def observation_insights(physical):
    from .sensor_recommendations import live_sensor_insights
    return live_sensor_insights(physical)


def predictive_insights(payload):
    demo = payload.get('mode') == 'demo'
    robot = payload.get('robots', {}).get('amr01')
    source = 'Demo example' if demo else 'Physical sensor data'
    result = dict(source=source, ready=False, metrics=[], recommendations=[])
    if not demo and payload.get('physical_telemetry') is not None and (not robot or robot.get('stale') or robot.get('continuity_lost') or robot.get('quality')!='OK'):
        return observation_insights(payload['physical_telemetry'])
    if not demo and payload.get('physical_telemetry') is not None:
        # Keep raw-channel screening visible alongside a commissioned model.
        # Its observation-only actions do not change the model command contract.
        result['sensor_checks'] = observation_insights(payload['physical_telemetry'])

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
