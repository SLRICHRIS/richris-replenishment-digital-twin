// Apply a saved appearance before the first paint. Storage may be unavailable.
(() => {
  let theme = 'dark';
  try {
    const saved = localStorage.getItem('replenish.theme');
    if (saved === 'dark' || saved === 'bright') theme = saved;
  } catch {}
  document.documentElement.dataset.theme = theme;
  let motion = 'full';
  try { if (localStorage.getItem('replenish.motion') === 'reduced') motion = 'reduced'; } catch {}
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) motion = 'reduced';
  document.documentElement.dataset.motion = motion;
  document.getElementById('theme-meta').setAttribute('content', theme === 'bright' ? '#ffffff' : '#0b1118');
})();
