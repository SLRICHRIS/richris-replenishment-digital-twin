import { createManualMotorPanel } from './manual_motor_control.js?v=held-drive-20261120';
import { createPhysicalRoutePanel } from './physical_route_execution.js';
import { createVisionWorkspace } from './overhead_camera_workspace.js';

// One page, two explicit modes. Practice never maintains a physical execution grant.
export function createVisionRoutingWorkspace(scope) {
  const d = scope.document,
    root = d.getElementById('vision-routing-shell');
  if (!root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const manual = createManualMotorPanel(scope),
    physical = createPhysicalRoutePanel(scope),
    practice = createVisionWorkspace(scope);
  const modes = ['physical', 'manual', 'practice'],
    listeners = [];
  const on = (target, type, fn) => {
    target.addEventListener(type, fn);
    listeners.push(() => target.removeEventListener(type, fn));
  };
  function select(mode, focus = false) {
    if (!modes.includes(mode)) return;
    root.dataset.mode = mode;
    modes.forEach((name) => {
      const selected = name === mode,
        button = d.getElementById('vision-mode-' + name);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      d.getElementById('vision-' + name + '-pane').hidden = !selected;
    });
    d.dispatchEvent(new scope.CustomEvent('vision-routing:mode', { detail: { mode } }));
    if (focus) d.getElementById('vision-mode-' + mode).focus();
  }
  modes.forEach((mode, index) => {
    const button = d.getElementById('vision-mode-' + mode);
    on(button, 'click', () => select(mode));
    on(button, 'keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      select(
        e.key === 'Home'
          ? 'physical'
          : e.key === 'End'
            ? 'practice'
            : modes[(index + (e.key === 'ArrowRight' ? 1 : 2)) % 3],
        true,
      );
    });
  });
  d.querySelectorAll('[data-vision-open-setup]').forEach((button) =>
    on(button, 'click', () => {
      select('physical');
      physical?.showStage(1);
      d.getElementById('pr-step-1')?.focus();
    }),
  );
  select('physical');
  return {
    manual,
    physical,
    practice,
    select,
    destroy() {
      manual?.destroy();
      practice?.destroy();
      physical?.destroy();
      listeners.forEach((remove) => remove());
      delete root.dataset.initialized;
    },
  };
}
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => createVisionRoutingWorkspace(window), {
      once: true,
    });
  else createVisionRoutingWorkspace(window);
}
