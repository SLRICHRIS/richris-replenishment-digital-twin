// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Motion decorates state changes. It never schedules or changes fleet operations.

const markup = new WeakMap();
const keyOf = (node) =>
  node.nodeType === 1 ? node.getAttribute('data-motion-key') || node.id || null : null;

function reconcile(parent, next) {
  const keyed = new Map(
    [...parent.childNodes].map((node) => [keyOf(node), node]).filter(([key]) => key),
  );
  let cursor = parent.firstChild;
  for (const incoming of [...next.childNodes]) {
    const key = keyOf(incoming);
    let current = key ? keyed.get(key) : cursor && !keyOf(cursor) ? cursor : null;
    if (
      !current ||
      current.nodeType !== incoming.nodeType ||
      current.nodeName !== incoming.nodeName
    ) {
      current = incoming.cloneNode(true);
      parent.insertBefore(current, cursor);
    } else {
      if (current !== cursor) parent.insertBefore(current, cursor);
      if (current.nodeType === 1) {
        for (const attr of [...current.attributes])
          if (!incoming.hasAttribute(attr.name)) current.removeAttribute(attr.name);
        for (const attr of [...incoming.attributes])
          if (current.getAttribute(attr.name) !== attr.value)
            current.setAttribute(attr.name, attr.value);
        reconcile(current, incoming);
        if (current.tagName === 'SELECT' && document.activeElement !== current)
          current.value = incoming.value;
      } else if (current.nodeValue !== incoming.nodeValue) current.nodeValue = incoming.nodeValue;
    }
    cursor = current.nextSibling;
  }
  while (cursor) {
    const nextNode = cursor.nextSibling;
    cursor.remove();
    cursor = nextNode;
  }
}

// Keep live bars, rows, SVG lines and focused controls attached across refreshes.
export function patchContent(element, html) {
  if (markup.get(element) === html) return false;
  const range = document.createRange?.();
  if (range) {
    range.selectNodeContents(element);
    reconcile(element, range.createContextualFragment(html));
  } else element.innerHTML = html;
  markup.set(element, html);
  return true;
}

export function createMotionSystem({ scene } = {}) {
  const root = document.documentElement,
    $ = (id) => document.getElementById(id);
  const fallback = {
    page() {},
    sync() {},
    content() {},
    notify() {},
    expand() {},
    openDialog(dialog) {
      if (!dialog.open) dialog.showModal();
    },
    closeDialog(dialog, value) {
      dialog.close(value);
    },
  };
  if (typeof root.animate !== 'function') {
    root.dataset.motion = 'reduced';
    scene.reducedMotion = true;
    const button = $('motion-toggle');
    button.disabled = true;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', 'Interface animation is unavailable in this browser');
    button.title = 'Interface animation is unavailable in this browser';
    button.querySelector('span').textContent = 'Motion off';
    $('auto-orbit').disabled = true;
    return fallback;
  }

  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map(),
    states = new WeakMap(),
    values = new Map(),
    closings = new Map();
  const ease = 'cubic-bezier(.22,1,.36,1)';
  let preference = 'auto',
    lastPage = null,
    lastSelection = null,
    syncPending = false;
  try {
    if (localStorage.getItem('replenish.motion') === 'reduced') preference = 'reduced';
  } catch {}
  const reduced = () => media.matches || preference === 'reduced';
  const visible = (el) =>
    el &&
    el.isConnected &&
    !document.hidden &&
    !el.closest('[hidden], dialog:not([open])') &&
    el.getClientRects().length > 0;
  function cancel(el) {
    animations.get(el)?.cancel();
    animations.delete(el);
  }
  function play(el, frames, duration = 320, delay = 0) {
    cancel(el);
    if (reduced() || !visible(el)) return null;
    const animation = el.animate(frames, { duration, delay, easing: ease, fill: 'backwards' });
    animations.set(el, animation);
    const clean = () => {
      if (animations.get(el) === animation) animations.delete(el);
    };
    animation.finished.then(clean, clean);
    return animation;
  }
  const enter = (el, delay = 0, distance = 8) =>
    play(
      el,
      [
        { opacity: 0.45, transform: `translateY(${distance}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      380,
      delay,
    );
  const signal = (el) =>
    play(
      el,
      [
        { boxShadow: 'inset 2px 0 0 var(--blue)', backgroundColor: 'var(--selected-bg)' },
        { boxShadow: 'inset 2px 0 0 transparent', backgroundColor: 'transparent' },
      ],
      600,
    );

  const nav = document.querySelector('.workspace-nav');
  const cursor = document.createElement('span');
  cursor.className = 'navigation-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  nav.append(cursor);
  root.dataset.motionReady = 'true';
  function alignCursor() {
    const selected = nav.querySelector('[aria-selected="true"]');
    if (!selected) return;
    const horizontal = window.innerWidth < 900;
    cursor.style.width = (horizontal ? selected.offsetWidth : 2) + 'px';
    cursor.style.height = (horizontal ? 2 : selected.offsetHeight) + 'px';
    cursor.style.transform = `translate(${horizontal ? selected.offsetLeft : 0}px,${horizontal ? 0 : selected.offsetTop}px)`;
  }
  new ResizeObserver(alignCursor).observe(nav);

  function finishClose(dialog) {
    closings.delete(dialog);
    cancel(dialog);
    dialog.removeAttribute('data-closing');
    dialog.inert = false;
    if (dialog.open) dialog.close(dialog.dataset.returnValue || '');
    delete dialog.dataset.returnValue;
  }
  function applyPreference() {
    root.dataset.motion = reduced() ? 'reduced' : 'full';
    const button = $('motion-toggle');
    button.setAttribute('aria-pressed', String(!reduced()));
    button.setAttribute(
      'aria-label',
      media.matches
        ? 'Interface motion reduced by your device settings'
        : reduced()
          ? 'Enable interface motion'
          : 'Reduce interface motion',
    );
    button.title = media.matches
      ? 'Reduced motion follows your device settings'
      : reduced()
        ? 'Enable interface motion'
        : 'Reduce interface motion';
    button.querySelector('span').textContent = reduced() ? 'Motion off' : 'Motion on';
    button.disabled = media.matches;
    scene.reducedMotion = reduced();
    if (reduced()) {
      for (const dialog of [...closings.keys()]) finishClose(dialog);
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
      if (scene.transition) {
        Object.assign(scene.camera, scene.transition.to);
        scene.transition = null;
      }
      scene.autoOrbit = false;
      const orbit = $('auto-orbit');
      orbit.classList.remove('active');
      orbit.setAttribute('aria-pressed', 'false');
    }
    $('auto-orbit').disabled = reduced();
    $('auto-orbit').title = reduced()
      ? 'Automatic orbit is off while motion is reduced'
      : 'Slowly orbit the camera';
    alignCursor();
  }
  $('motion-toggle').addEventListener('click', () => {
    preference = reduced() ? 'auto' : 'reduced';
    try {
      localStorage.setItem('replenish.motion', preference);
    } catch {}
    applyPreference();
  });
  media.addEventListener('change', applyPreference);
  window.addEventListener('storage', (event) => {
    if (event.key !== 'replenish.motion') return;
    preference = event.newValue === 'reduced' ? 'reduced' : 'auto';
    applyPreference();
  });
  document.addEventListener('visibilitychange', () => {
    root.dataset.motionPaused = String(document.hidden);
    if (document.hidden) {
      for (const dialog of [...closings.keys()]) finishClose(dialog);
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
    }
  });
  root.dataset.motionPaused = String(document.hidden);

  function openDialog(dialog) {
    closings.delete(dialog);
    cancel(dialog);
    dialog.inert = false;
    dialog.removeAttribute('data-closing');
    delete dialog.dataset.returnValue;
    if (!dialog.open) dialog.showModal();
    play(
      dialog,
      [
        { opacity: 0.7, transform: 'translateY(12px) scale(.99)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      240,
    );
    dialog
      .querySelectorAll('.review-card')
      .forEach((card, i) => enter(card, Math.min(i, 3) * 40, 5));
  }
  function closeDialog(dialog, value = '') {
    if (!dialog.open || closings.has(dialog)) return;
    dialog.dataset.returnValue = value;
    if (reduced() || document.hidden) {
      finishClose(dialog);
      return;
    }
    dialog.inert = true;
    dialog.dataset.closing = 'true';
    const token = {};
    closings.set(dialog, token);
    const animation = play(
      dialog,
      [
        { opacity: 1, transform: 'translateY(0)' },
        { opacity: 0, transform: 'translateY(7px)' },
      ],
      130,
    );
    const finish = () => {
      if (closings.get(dialog) === token) finishClose(dialog);
    };
    if (animation) animation.finished.then(finish, finish);
    else finish();
  }
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog(dialog);
    });
    dialog.addEventListener('submit', (event) => {
      if (event.target.getAttribute('method') === 'dialog' && !event.defaultPrevented) {
        event.preventDefault();
        closeDialog(dialog, event.submitter?.value || '');
      }
    });
    dialog.addEventListener('close', () => {
      closings.delete(dialog);
      cancel(dialog);
      dialog.inert = false;
      dialog.removeAttribute('data-closing');
    });
  });
  document.querySelectorAll('details').forEach((details) =>
    details.addEventListener('toggle', () => {
      if (details.open)
        [...details.children]
          .filter((child) => child.tagName !== 'SUMMARY')
          .forEach((child, i) => enter(child, Math.min(i, 3) * 25, 4));
    }),
  );

  function content(id) {
    const container = $(id);
    const selectors = {
      tasks: '[data-motion-key]',
      log: '.log-row',
      bins: '.bin',
      'dispatch-review': '.review-card',
    };
    const selector = selectors[id];
    if (selector) {
      const initialized = states.has(container);
      states.set(container, true);
      container.querySelectorAll(selector).forEach((el) => {
        const value = el.dataset.motionState || el.className;
        if (!states.has(el)) {
          if (initialized) enter(el, 0, 5);
        } else if (states.get(el) !== value) signal(el);
        states.set(el, value);
      });
    }
    if (id === 'alerts') {
      const signature = [...container.children]
        .map((el) => el.firstChild?.textContent + el.className)
        .join('|');
      if (states.has(container) && states.get(container) !== signature)
        play(container, [{ opacity: 0.65 }, { opacity: 1 }], 240);
      states.set(container, signature);
    }
  }
  function sync() {
    if (syncPending) return;
    syncPending = true;
    requestAnimationFrame(() => {
      syncPending = false;
      const selection = document.body.dataset.source + ':' + $('inspect-title').textContent;
      if (lastSelection !== null && lastSelection !== selection) {
        document
          .querySelectorAll(
            '.inspector-heading,.inspector-stats,.unit-location,.mission-detail,.unit-journey',
          )
          .forEach((el, i) => enter(el, i * 20, 4));
        signal(document.querySelector('.robot-card.selected'));
      }
      lastSelection = selection;
      for (const id of [
        'completed',
        'health',
        'available',
        'mission-pending-count',
        'mission-active-count',
        'mission-completed-count',
        'brief-title',
        'inspect-status',
        'hardware-live-count',
        'hardware-broker-state',
        'hw-0-status',
      ]) {
        const el = $(id),
          value = el.textContent;
        if (values.has(id) && values.get(id) !== value)
          play(el, [{ opacity: 0.6 }, { opacity: 1 }], 260);
        values.set(id, value);
      }
    });
  }
  function page(name) {
    alignCursor();
    if (name === lastPage) return;
    for (const [el, animation] of animations)
      if (el.closest('[data-screen]')) {
        animation.cancel();
        animations.delete(el);
      }
    const first = lastPage === null;
    lastPage = name;
    enter(document.querySelector('.page-title-block'), 0, 4);
    const surfaces = $(name).querySelectorAll(
      '.source-strip,.operation-brief,.stage-panel,.fleet-strip,.inspector,.outlook,.view-intro,.mission-summary,.mission-panel,.hardware-intro,.hardware-slot,.hardware-connect-panel,.hardware-guide,.hardware-boundary,.inventory,.telemetry,.scenario-panel,.activity-panel,.session-card,.model',
    );
    surfaces.forEach((el, i) => enter(el, Math.min(i, 5) * 32));
    if (name === 'telemetry')
      play(
        $('energy-chart'),
        [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
        700,
        80,
      );
    if (first)
      document.querySelectorAll('.metrics article').forEach((el, i) => enter(el, 90 + i * 30, 5));
  }
  applyPreference();
  return {
    page,
    content,
    sync,
    openDialog,
    closeDialog,
    notify() {
      const el = $('toast');
      play(
        el,
        [
          { transform: 'translate(-50%,8px)', opacity: 0.5 },
          { transform: 'translate(-50%,0)', opacity: 1 },
        ],
        260,
      );
    },
    expand(panel) {
      cancel(panel);
      play(panel, [{ opacity: 0.7 }, { opacity: 1 }], 240);
    },
  };
}
