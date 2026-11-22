import { createLocalArUcoPanel } from './local_aruco_control.js?v=preset-embed-20261123';
import { createManualMotorPanel } from './manual_motor_control.js?v=abe-floor-20261122';
import { createPhysicalRoutePanel } from './physical_route_execution.js?v=abe-floor-20261122';
import { createVisionWorkspace } from './overhead_camera_workspace.js?v=abe-floor-20261122';

// Direct driving, commissioned camera routes and command-free practice stay distinct.
export function createVisionRoutingWorkspace(scope) {
  const d = scope.document,
    root = d.getElementById('vision-routing-shell');
  if (!root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const local = createLocalArUcoPanel(scope),
    manual = createManualMotorPanel(scope),
    physical = createPhysicalRoutePanel(scope),
    practice = createVisionWorkspace(scope);
  const modes = ['local', 'manual', 'physical', 'practice'],
    listeners = [];
  const on = (target, type, fn) => {
    target.addEventListener(type, fn);
    listeners.push(() => target.removeEventListener(type, fn));
  };
  function select(mode, focus = false) {
    if (!modes.includes(mode)) return;
    root.dataset.mode = mode;
    d.body.dataset.visionMode = mode;
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
  modes.forEach((mode) => {
    const button = d.getElementById('vision-mode-' + mode);
    on(button, 'click', () => select(mode));
    on(button, 'keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const visibleModes = modes.filter(
        (name) =>
          !['physical', 'practice'].includes(name) ||
          d.documentElement.dataset.amrAdvanced === 'true',
      );
      const index = visibleModes.indexOf(mode);
      select(
        e.key === 'Home'
          ? visibleModes[0]
          : e.key === 'End'
            ? visibleModes.at(-1)
            : visibleModes[
                (index + (e.key === 'ArrowRight' ? 1 : visibleModes.length - 1)) %
                  visibleModes.length
              ],
        true,
      );
    });
  });
  d.querySelectorAll('[data-vision-open-setup]').forEach((button) =>
    on(button, 'click', () => {
      d.documentElement.dataset.amrAdvanced = 'true';
      select('physical');
      physical?.showStage(1);
      d.getElementById('pr-step-1')?.focus();
    }),
  );
  select('local');
  return {
    local,
    manual,
    physical,
    practice,
    select,
    destroy() {
      local?.destroy();
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
