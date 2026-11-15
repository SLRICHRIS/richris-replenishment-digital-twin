from backend_streamlit_and_telemetry.predictive_twin.insights import predictive_insights


def data():
    return dict(mode='live', robots=dict(amr01=dict(quality='OK', stale=False,
        continuity_lost=False, soc=.7, runtime_hours=2.1, forecast_pose=[1,2,0],
        raw=dict(battery_current_a=.6), derived=dict(advisory=False, residual_valid=True))))


def test_fresh_evidence_produces_bounded_insights_and_monitoring_guidance():
    result = predictive_insights(data())
    assert result['ready']
    assert result['source'] == 'Physical sensor data'
    assert len(result['metrics']) == 3
    assert result['recommendations'][0]['title'] == 'Continue monitoring'
    assert 'Assumes unchanged current' in result['metrics'][1]['detail']


def test_old_forecasts_and_alerts_cannot_generate_current_guidance():
    for field in ['stale', 'continuity_lost']:
        payload = data()
        payload['robots']['amr01'][field] = True
        payload['robots']['amr01']['derived']['advisory'] = True
        payload['robots']['amr01']['soc'] = .1
        result = predictive_insights(payload)
        assert not result['ready']
        assert result['metrics'] == []
        assert not any('Recharge' in r['title'] or 'Inspect the motion' in r['title']
                       for r in result['recommendations'])


def test_low_charge_and_sustained_disagreement_have_specific_operator_actions():
    payload = data()
    robot = payload['robots']['amr01']
    robot['soc'] = .2
    robot['derived']['advisory'] = True
    titles = [r['title'] for r in predictive_insights(payload)['recommendations']]
    assert titles == ['Inspect the motion sensors', 'Recharge before extending the trial']


def test_invalid_comparison_and_invalid_soc_do_not_claim_normal_operation():
    payload = data()
    payload['robots']['amr01']['derived']['residual_valid'] = False
    assert predictive_insights(payload)['recommendations'][0]['title'] == 'Restore the gyro–encoder comparison'
    payload['robots']['amr01']['soc'] = 1.2
    assert not predictive_insights(payload)['ready']
    assert predictive_insights(payload)['recommendations'][0]['title'] == 'Check battery calibration'


def test_missing_calibration_and_demo_sources_are_distinguished():
    result = predictive_insights(dict(mode='live', robots={}, notice=dict(
        label='Measured calibration required', detail='Confirm measured settings.')))
    assert not result['ready']
    assert result['recommendations'][0]['title'] == 'Measured calibration required'
    payload = data()
    payload['mode'] = 'demo'
    assert predictive_insights(payload)['source'] == 'Demo example'
