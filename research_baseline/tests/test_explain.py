"""Presentation helpers must reflect actual model state, not invent events."""
from warehouse_twin import simulation
from warehouse_twin.explain import next_event, inventory_differences, interpret_event_logs
import copy


def test_first_event_is_pickup_not_completed_delivery():
    state, logs = simulation.new_state()
    proposed = next_event(state)
    assert proposed['kind'] == 'pickup'
    assert proposed['at'] == 4.0
    assert 'in-transit' in proposed['why']
    assert len(interpret_event_logs(logs)) == len(logs)


def test_pickup_changes_location_without_creating_stock():
    state, _ = simulation.new_state()
    before = copy.deepcopy(state)
    simulation.step(state)
    changes = inventory_differences(before, state)
    assert any(row['Quantity'] == 'Reserve shelf' and row['Change'] == '-14' for row in changes)
    assert any(row['Quantity'] == 'On the robot' and row['Change'] == '+14' for row in changes)
    assert not any(row['Quantity'] == 'Picking shelf' for row in changes)
    assert all(x['valid'] for x in simulation.conservation(state))


def test_demand_changes_only_picking_inventory():
    state, _ = simulation.new_state()
    simulation.step(state)
    before = copy.deepcopy(state)
    simulation.step(state)
    changes = inventory_differences(before, state)
    assert len(changes) == 1
    assert changes[0]['Quantity'] == 'Picking shelf'
    assert changes[0]['Change'] == '-4'
