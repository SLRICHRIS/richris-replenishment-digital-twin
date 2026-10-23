import pytest
from warehouse_twin import simulation as engine


def test_initial_state_and_reservation():
    s, logs=engine.new_state()
    assert s['inventory']['KIT-A']['reserve']==70
    assert s['inventory']['KIT-A']['reserved']==14
    assert s['inventory']['KIT-A']['pick']==4
    assert engine.metrics(s)['requested']==0
    assert all(r['valid'] for r in engine.conservation(s))


def test_stock_moves_only_on_pickup_and_delivery():
    s,_=engine.new_state()
    assert s['inventory']['KIT-A']['transit']==0
    logs=engine.step(s)
    assert logs[0]['kind']=='PICKUP'
    assert s['inventory']['KIT-A']['reserve']==56
    assert s['inventory']['KIT-A']['transit']==14
    assert s['inventory']['KIT-A']['pick']==4
    # Run through scheduled delivery while demand intervenes
    for _ in range(40):
        logs=engine.step(s)
        if any(x['kind']=='DELIVERY' and x['details'].get('task_id')=='T001' for x in logs):
            break
    assert s['tasks']['T001']['status']=='completed'
    assert s['inventory']['KIT-A']['transit']==0
    assert all(c['valid'] for c in engine.conservation(s))


def test_restrictions_change_path_and_cost():
    direct,dist=engine.shortest_path('R','P2')
    altered,detour=engine.shortest_path('R','P2',['B'])
    assert 'B' in direct
    assert 'B' not in altered
    assert detour>=dist


def test_invalid_route_and_restrictions():
    with pytest.raises(ValueError): engine.new_state(blocked=['R'])
    with pytest.raises(ValueError): engine.shortest_path('R','P1',['R'])
    s,_=engine.new_state()
    with pytest.raises(ValueError): engine.set_block(s,'B',True)


def test_demand_and_inventory_conservation_after_every_event():
    for blocked in [[],['A'],['B'],['C'],['D'],['E'],['F']]:
        for policy in ('fifo','urgency'):
            state,_=engine.new_state(policy,blocked)
            for _ in range(200):
                if not state['queue']:break
                engine.step(state)
                assert all(c['valid'] for c in engine.conservation(state))
                assert all(i['pick']>=0 and i['reserve']>=0 and i['transit']>=0 for i in state['inventory'].values())


def test_policy_comparison_same_demand_and_no_mutation():
    first=engine.comparison(['B'],120)
    second=engine.comparison(['B'],120)
    assert first==second
    assert first['matched_inputs'] is True
    assert first['policies']['fifo']['metrics']['requested']==first['policies']['urgency']['metrics']['requested']


def test_timing_parameter_changes_duration():
    slow,_=engine.new_state(parameters={'speed_units_per_second':0.2})
    fast,_=engine.new_state(parameters={'speed_units_per_second':2})
    assert slow['tasks']['T001']['estimated_duration']>fast['tasks']['T001']['estimated_duration']


def test_comparison_does_not_claim_improvement():
    result=engine.comparison()
    assert result['mode']=='SYNTHETIC_UNCALIBRATED'
    assert 'not physical validation' in result['warning']
