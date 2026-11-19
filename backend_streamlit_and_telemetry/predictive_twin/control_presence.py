"""Apply one canonical control-page state when Streamlit coalesces UI messages."""


def synchronize_control_view(state, mode):
    if mode not in (None, 'manual', 'vision'):
        return False
    state['manual_view'] = mode == 'manual'
    state['vision_view'] = mode == 'vision'
    for name in ('manual', 'vision'):
        if mode == name:
            continue
        service, owner = state.get(name + '_service'), state.get(name + '_owner')
        if service is not None and owner and not service.stop.is_set():
            try:
                service.coordinator.cancel(owner)
            except Exception:
                pass  # Existing short grants expire locally; no renewal is created.
    return True
