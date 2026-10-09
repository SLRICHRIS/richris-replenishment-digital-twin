// DOM behavior checks; run with jsdom available through NODE_PATH.
// Animation timing is controlled here. This is not a visual/browser test.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const base = require('node:path').resolve(__dirname, '../frontend');
const html = fs.readFileSync(base + '/index.html', 'utf8');

function workspace({ savedMotion = null, osReduced = false, animationsSupported = true } = {}) {
  const dom = new JSDOM(html, { url: 'https://test.invalid/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, doc = w.document, frames = [], effects = [], listeners = new Map();
  const media = { matches: osReduced, addEventListener(type, fn) { listeners.set(type, fn); } };
  w.matchMedia = () => media;
  if (savedMotion) w.localStorage.setItem('replenish.motion', savedMotion);
  w.HTMLElement.prototype.getClientRects = w.SVGElement.prototype.getClientRects = function () { return this.isConnected ? [{ width: 500, height: 80 }] : []; };
  if (animationsSupported) w.Element.prototype.animate = function (keyframes, options) {
    let resolve, reject;
    const effect = { target: this, keyframes, options, ended: false,
      finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
      finish() { if (!this.ended) { this.ended = true; resolve(); } },
      cancel() { if (!this.ended) { this.ended = true; reject(new Error('cancelled')); } }
    };
    effects.push(effect); return effect;
  };
  const returnFocus = new WeakMap();
  w.HTMLDialogElement.prototype.showModal = function () { returnFocus.set(this, doc.activeElement); this.open = true; this.querySelector('button')?.focus(); };
  w.HTMLDialogElement.prototype.close = function (value = '') { this.returnValue = value; this.open = false; this.dispatchEvent(new w.Event('close')); returnFocus.get(this)?.focus(); };
  w.ResizeObserver = class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } };
  w.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  w.setInterval = () => 1; w.clearInterval = () => {};
  w.setTimeout = () => 1; w.clearTimeout = () => {};
  w.scrollTo = () => {};
  w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
  w.Worker = class { postMessage() {} };
  w.TwinScene = class {
    constructor() { this.camera = { yaw: 0, elevation: .7, zoom: 1 }; this.layers = { routes: true, grid: true }; this.width = 1000; this.rendererKind = 'DOM fixture'; }
    setView() {} setTheme() {} resize() {} draw() {} focus() {} zoomBy() {} cameraChanged() {}
  };
  const context = dom.getInternalVMContext();
  const run = source => vm.runInContext(source, context);
  for (const name of ['telemetry', 'dispatch', 'hardware', 'motion', 'app']) {
    run(fs.readFileSync(base + '/' + name + '.js', 'utf8').replace(/^import[^\n]*\n/gm, '').replace(/export /g, '').replace('if(document.fonts)await document.fonts.ready;', ''));
  }
  function flush() { const batch = frames.splice(0); for (const fn of batch) fn(100); }
  async function settle() { for (const effect of effects) effect.finish(); await Promise.resolve(); await Promise.resolve(); }
  return { dom, w, doc, run, flush, settle, effects, media, changeOS(value) { media.matches = value; listeners.get('change')?.(); } };
}

(async () => {
  const ui = workspace(), { doc, run, effects } = ui, $ = id => doc.getElementById(id);
  ui.flush(); await ui.settle();
  const initialRows = [...$('tasks').children], bins = [...$('bins').children];
  const log = $('log').firstElementChild;
  run('step(.2);render()'); ui.flush();
  assert.deepEqual([...$('tasks').children], initialRows, 'refreshes must preserve mission rows');
  assert.deepEqual([...$('bins').children], bins, 'stock updates must preserve meter elements');
  assert.equal($('log').firstElementChild, log);
  run("log('New operator action');render()"); ui.flush();
  assert.equal($('log').children[1], log, 'prepending a log must keep older rows attached');

  $('demo').focus(); $('demo').click();
  assert($('dispatch-dialog').open);
  assert.equal($('dispatch-review').children.length, 3);
  const body = doc.querySelector('.dispatch-body'), footer = doc.querySelector('.dispatch-actions');
  assert.equal(body.parentElement, $('dispatch-dialog'));
  assert.equal(footer.parentElement, $('dispatch-dialog'));
  assert(!body.contains(footer), 'approval controls must stay outside scrolling cards');
  $('confirm-dispatch').click();
  assert.equal(run('tasks.filter(t=>t.status==="Active").length'), 1, 'animation must not defer dispatch');
  assert.equal(run('tasks.filter(t=>t.status==="Queued").length'), 2);
  assert($('dispatch-dialog').inert, 'a closing approval dialog cannot be clicked twice');
  ui.flush(); await ui.settle();
  assert(!$('dispatch-dialog').open);
  const row = doc.querySelector('[data-motion-key="mission-1-1"]'), progress = row.querySelector('.task-progress i');
  run('step(2);render()'); ui.flush();
  assert.equal(doc.querySelector('[data-motion-key="mission-1-1"]'), row);
  assert.equal(row.querySelector('.task-progress i'), progress);
  assert(parseFloat(progress.style.width) > 0);
  run('pauseRobot(0)'); const paused = run('robots[0].x'); run('step(3)'); assert.equal(run('robots[0].x'), paused);

  run('reset();activatePage("missions")'); ui.flush(); await ui.settle();
  const select = $('tasks').querySelector('select'); select.focus(); const selection = select.value;
  run('step(1);render()'); ui.flush();
  assert.equal(doc.activeElement, select); assert.equal(select.value, selection);
  select.blur();
  run('reassign(tasks[0],1);render()');
  assert.equal(doc.querySelector('[data-reassign="1"]').value, '1', 'reconciled select must reflect the assigned robot');
  run('activatePage("telemetry")'); ui.flush();
  const lines = [...$('energy-chart').querySelectorAll('polyline')];
  run('step(2);render()'); ui.flush();
  assert.deepEqual([...$('energy-chart').querySelectorAll('polyline')], lines);
  run('activatePage("environment");selected=2;render()'); ui.flush();
  assert(effects.some(effect => effect.target.classList?.contains('inspector-stats')));
  await ui.settle();
  const stableEffectCount = effects.length;
  run('render()'); ui.flush();
  assert.equal(effects.length, stableEffectCount, 'unchanged values must not continuously replay motion');

  run("motion.openDialog(document.getElementById('help-dialog'));motion.closeDialog(document.getElementById('help-dialog'));motion.openDialog(document.getElementById('help-dialog'))");
  await ui.settle(); assert($('help-dialog').open, 'a cancelled exit cannot close a reopened dialog');
  run("motion.closeDialog(document.getElementById('help-dialog'))");
  $('motion-toggle').click();
  assert.equal(doc.documentElement.dataset.motion, 'reduced');
  assert(!$('help-dialog').open, 'reducing motion must complete a pending modal exit');
  assert.equal(ui.w.localStorage.getItem('replenish.motion'), 'reduced');
  assert(run('scene.reducedMotion')); assert($('auto-orbit').disabled);
  const reducedCount = effects.length;
  run('activatePage("missions");selected=0;render()'); ui.flush();
  $('demo').click(); $('cancel-dispatch').click();
  assert(!$('dispatch-dialog').open);
  assert.equal(effects.length, reducedCount, 'reduced motion must suppress JS animations too');
  $('motion-toggle').click(); assert.equal(doc.documentElement.dataset.motion, 'full');
  ui.changeOS(true); assert.equal(doc.documentElement.dataset.motion, 'reduced'); assert($('motion-toggle').disabled);
  ui.changeOS(false); assert.equal(doc.documentElement.dataset.motion, 'full');
  $('theme-bright').click(); assert.equal(doc.documentElement.dataset.theme, 'bright');
  $('theme-dark').click(); assert.equal(doc.documentElement.dataset.theme, 'dark');
  run('activatePage("environment");setFloorSource("hardware")');
  assert($('stop').disabled); assert.equal($('unit-battery').textContent, '—');
  assert.equal(doc.querySelectorAll('.navigation-cursor').length, 1);
  await ui.settle(); ui.dom.window.close();

  const saved = workspace({ savedMotion: 'reduced' }); saved.flush();
  assert.equal(saved.doc.documentElement.dataset.motion, 'reduced'); assert.equal(saved.effects.length, 0); saved.dom.window.close();
  const os = workspace({ osReduced: true }); os.flush();
  assert.equal(os.doc.documentElement.dataset.motion, 'reduced'); assert.equal(os.effects.length, 0); os.dom.window.close();
  const fallback = workspace({ animationsSupported: false });
  fallback.doc.getElementById('demo').click(); fallback.doc.getElementById('confirm-dispatch').click();
  assert.equal(fallback.run('tasks.filter(t=>t.status==="Active").length'), 1); fallback.dom.window.close();
  console.log('PASS: persistent DOM rows/bars/charts, focus and select preservation, immediate mission actions, modal close/reopen races, stable animation counts, both themes, saved and device reduced-motion preferences, graceful fallback, and live/simulation isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
