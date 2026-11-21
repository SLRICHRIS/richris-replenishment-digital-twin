import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLiveSensorRecommendations } from '../../frontend_warehouse_dashboard/browser_modules/vision_routing/live_sensor_recommendations.js';

const dom = new JSDOM('<div id="guidance"></div>', { pretendToBeVisual: true });
const w = dom.window,
  d = w.document,
  root = d.getElementById('guidance');
let elapsed = 0,
  tick,
  cleared = false;
Object.defineProperty(w.performance, 'now', { value: () => elapsed });
w.setInterval = (fn) => {
  tick = fn;
  return 17;
};
w.clearInterval = (id) => {
  assert.equal(id, 17);
  cleared = true;
};
w.fetch = () => {
  throw Error('Recommendations cannot contact a motor controller');
};
const opened = [],
  commands = [];
d.addEventListener('human-review:open', (e) => opened.push(e.detail.action));
d.addEventListener('python-twin:action', (e) => commands.push(e.detail));
const panel = createLiveSensorRecommendations(w, root);
const p = {
  mode: 'live',
  physical_telemetry: { fresh: true, age_s: 0.2 },
  insights: {
    scope: 'physical_observation',
    ready: true,
    summary: { stop: 1, check: 0, covered: 6, total: 6 },
    coverage: [{ category: 'Battery', state: 'available', detail: '5.72 V' }],
    actions: [
      { id: 'inspect_power', label: 'Inspect power', detail: 'Check the supply with power off.' },
    ],
    recommendations: [
      {
        code: 'sag',
        title: 'Inspect the supply',
        detail: 'Recent voltage drop',
        category: 'Battery',
        priority: 'stop',
        action: 'inspect_power',
        basis: 'Recent load comparison',
        evidence: ['Drop 1.48 V'],
      },
    ],
  },
};
const send = (value) => d.dispatchEvent(new w.CustomEvent('python-twin:render', { detail: value }));
assert.equal(root.querySelectorAll('button').length, 0);
send(p);
assert.match(root.textContent, /1 stop-and-check/);
assert.match(root.textContent, /Drop 1.48 V/);
assert.equal(root.querySelector('article').dataset.priority, 'stop');
const button = root.querySelector('button');
button.click();
assert.deepEqual(opened, ['inspect_power']);
assert.deepEqual(commands, [], 'Choosing a response does not capture, approve or actuate');
elapsed = 4900;
tick();
assert.match(root.textContent, /Live feed unavailable/);
assert.doesNotMatch(root.textContent, /Drop 1.48/);
assert.equal(root.querySelectorAll('button').length, 0);
button.click();
assert.equal(opened.length, 1, 'Detached stale controls cannot reopen a review');
assert.match(
  d.getElementById('mc-guidance-actions').textContent,
  /Inspect power/,
  'Response descriptions remain available without presenting old findings',
);
send({ ...p, mode: 'demo' });
assert.match(root.textContent, /Practice readings do not describe the robot/);
assert.equal(root.querySelectorAll('button').length, 0);
for (const age of [6, -2, NaN, true, null]) {
  send({ ...p, physical_telemetry: { fresh: true, age_s: age } });
  assert.equal(root.querySelectorAll('button').length, 0);
}
const hostile = structuredClone(p);
hostile.insights.recommendations[0].title = '<img src=x onerror=alert(1)>';
hostile.insights.actions[0].detail = '<script>unsafe</script>';
send(hostile);
assert.match(root.textContent, /<img/);
assert.equal(root.querySelector('img,script'), null, 'Sensor text is never HTML');
send({ ...p, insights: { sensor_checks: p.insights }, human_review: { observation_only: false } });
assert.match(root.textContent, /Inspect the supply/);
assert.equal(root.querySelector('button').textContent, 'Open operator review');
panel.destroy();
assert.equal(cleared, true);
send(p);
tick();
assert.equal(root.children.length, 0);
w.close();
console.log(
  'PASS: sensor guidance expires locally, excludes demo data, renders safe text and opens review without actuation.',
);
