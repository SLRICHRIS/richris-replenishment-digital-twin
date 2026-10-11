// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
import {
  SLOT_IDS,
  TelemetryStore,
  connectionConfig,
} from './robot_telemetry_validation_and_freshness.js';
import { decodeInventory } from '../robot_state_models_and_policy_experiments/robot_state_estimation_calibration_and_replay.js';

export function createHardwareWorkspace({
  onChange,
  onView,
  onObservation,
  onInventory,
  onInventoryError,
  onNewSession,
}) {
  const $ = (id) => document.getElementById(id),
    store = new TelemetryStore();
  let client = null,
    generation = 0,
    state = 'disconnected',
    config = null,
    subscriptionTimer = null;
  const set = (id, value) => {
    if ($(id).textContent !== value) $(id).textContent = value;
  };
  const snapshot = () => store.snapshot(state === 'connected');
  function render() {
    const slots = snapshot(),
      live = slots.filter((s) => s.status === 'live').length;
    set('hardware-live-count', String(live));
    set('hardware-summary', `${live} / 3 hardware slots live`);
    set(
      'hardware-broker-state',
      {
        disconnected: 'Disconnected',
        loading: 'Loading connection',
        connecting: 'Connecting',
        connected: 'Subscribed',
        reconnecting: 'Reconnecting',
        error: 'Connection failed',
      }[state],
    );
    $('hardware-broker-state').dataset.state = state;
    slots.forEach((slot, i) => {
      const p = slot.data,
        key = 'hw-' + i + '-';
      $('hardware-slot-' + i).dataset.status = slot.status;
      set(
        key + 'status',
        { live: 'Live', stale: 'Stale', offline: 'Offline', waiting: 'Waiting for device' }[
          slot.status
        ],
      );
      set(key + 'battery', p?.battery_pct == null ? '—' : `${p.battery_pct.toFixed(0)}%`);
      set(key + 'speed', p?.speed_mps == null ? '—' : `${p.speed_mps.toFixed(2)} m/s`);
      set(
        key + 'position',
        p?.pose ? `${p.pose.x_m.toFixed(2)} / ${p.pose.y_m.toFixed(2)} m` : 'Not measured',
      );
      set(key + 'signal', p?.wifi_rssi_dbm == null ? 'Not reported' : `${p.wifi_rssi_dbm} dBm`);
      set(
        key + 'age',
        slot.age === null
          ? 'No packets received'
          : `${(slot.age / 1000).toFixed(1)} s since capture`,
      );
      set(key + 'state', p ? p.state : 'Awaiting telemetry');
      set(key + 'firmware', p?.firmware || 'No firmware reported');
      set(key + 'packets', `${slot.accepted} accepted · ${slot.rejected} rejected`);
      set(
        key + 'topic',
        `${config?.prefix || $('hardware-prefix').value.trim() || 'richris/warehouse01'}/${slot.id}/telemetry`,
      );
      set(
        key + 'issue',
        slot.issue ||
          (p && slot.status !== 'live'
            ? 'Last received values. This device is not currently live.'
            : p && !p.pose
              ? 'Wi-Fi is reporting. Add localization to place this AMR on the floor.'
              : ''),
      );
      $(key + 'issue').hidden = !$(key + 'issue').textContent;
      $(key + 'view').disabled = !slot.tracked;
      const d = slot.diagnostics;
      for (const name of ['pose', 'battery', 'speed', 'state']) {
        const chip = $(key + 'measurements').querySelector(`[data-measurement="${name}"]`);
        chip.dataset.measured = String(slot.measurements[name]);
        chip.setAttribute(
          'title',
          name +
            ': ' +
            (slot.measurements[name]
              ? slot.status === 'live'
                ? 'reported'
                : 'last reported, not fresh'
              : 'not measured'),
        );
      }
      $(key + 'measurements').dataset.fresh = String(slot.status === 'live');
      set(
        key + 'quality',
        slot.status !== 'live'
          ? 'Not fresh'
          : d.windowGaps
            ? 'Sequence gaps'
            : d.windowSamples < 5
              ? 'Collecting'
              : 'Receiving',
      );
      set(key + 'rate', d.rateHz === null ? '—' : d.rateHz.toFixed(2) + ' Hz');
      set(key + 'gaps', String(d.windowGaps));
      set(
        key + 'offset',
        d.p95OffsetMs === null ? 'Collecting' : Math.round(d.p95OffsetMs) + ' ms',
      );
      set(key + 'reboots', String(slot.reboots));
      const samples = d.intervals,
        max = Math.max(1000, ...samples);
      const bars = samples
        .map(
          (interval, j) => /* HTML */ `
            <rect
              x="${j * 9 + 3}"
              y="${40 - Math.max(2, (interval / max) * 36)}"
              width="5"
              height="${Math.max(2, (interval / max) * 36)}"
              rx="1"
            />
          `,
        )
        .join('');
      const spark = /* HTML */ `
        <path d="M0 40H280" />
        ${bars}
      `;
      if ($(key + 'cadence').innerHTML !== spark) $(key + 'cadence').innerHTML = spark;
      $(key + 'cadence').setAttribute(
        'aria-label',
        samples.length
          ? samples.length + ' recent arrival intervals; maximum ' + Math.round(max) + ' ms.'
          : 'No packet arrival history yet.',
      );
      set(
        key + 'diagnostic-note',
        `${d.windowSamples} accepted samples in the last 60 s (up to 120). ${d.p95IntervalMs === null ? 'Waiting for five samples.' : 'P95 interval ' + Math.round(d.p95IntervalMs) + ' ms.'} Capture offset includes clock error. Sequence gaps are not a measured radio-loss rate.`,
      );
      set(key + 'last-issue', slot.lastIssue ? 'Last rejection: ' + slot.lastIssue : '');
      $(key + 'last-issue').hidden = !slot.lastIssue;
    });
  }
  function changed() {
    render();
    onChange?.();
  }
  function busy(value) {
    for (const id of [
      'hardware-url',
      'hardware-user',
      'hardware-password',
      'hardware-prefix',
      'hardware-connect',
    ])
      $(id).disabled = value;
    $('hardware-disconnect').disabled = !value;
  }
  function endClient() {
    clearTimeout(subscriptionTimer);
    subscriptionTimer = null;
    if (client) {
      const old = client;
      client = null;
      old.end(true);
      old.options.password = '';
      old.options.username = '';
    }
  }
  function fail(message) {
    generation++;
    endClient();
    state = 'error';
    config = null;
    busy(false);
    $('hardware-password').value = '';
    set('hardware-message', message);
    changed();
  }
  function disconnect() {
    generation++;
    endClient();
    state = 'disconnected';
    config = null;
    busy(false);
    $('hardware-password').value = '';
    set('hardware-message', 'Disconnected. Re-enter the viewer password to reconnect.');
    changed();
  }
  async function connect(event) {
    event.preventDefault();
    let next;
    try {
      next = connectionConfig({
        url: $('hardware-url').value,
        username: $('hardware-user').value,
        password: $('hardware-password').value,
        prefix: $('hardware-prefix').value,
      });
    } catch (error) {
      set('hardware-message', error.message);
      return;
    }
    const ticket = ++generation;
    endClient();
    config = next;
    store.reset();
    onNewSession?.();
    state = 'loading';
    busy(true);
    set('hardware-message', 'Opening a secure connection to your broker…');
    changed();
    try {
      const { default: mqtt } = await import(
        '../../external_browser_libraries/mqtt_telemetry_messaging/mqtt_browser_telemetry_client.esm.js'
      );
      if (ticket !== generation) return;
      state = 'connecting';
      client = mqtt.connect(next.url, {
        username: next.username,
        password: next.password,
        clientId: 'richris_view_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
        protocolVersion: 4,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
        resubscribe: false,
        queueQoSZero: false,
        forceNativeWebSocket: true,
        timerVariant: 'native',
      });
      next.password = '';
      $('hardware-password').value = '';
      const liveClient = client;
      liveClient.on('connect', () => {
        if (ticket !== generation) return;
        state = 'connecting';
        set('hardware-message', 'Broker connected. Subscribing to all three device topics…');
        changed();
        clearTimeout(subscriptionTimer);
        subscriptionTimer = setTimeout(() => {
          if (ticket === generation)
            fail(
              'The broker did not confirm the three subscriptions. Check the viewer’s topic permissions.',
            );
        }, 10000);
        liveClient.subscribe(next.topics, { qos: 0 }, (error, grants) => {
          if (ticket !== generation) return;
          clearTimeout(subscriptionTimer);
          if (error || !grants || grants.length !== 3 || grants.some((g) => g.qos > 2))
            return fail(
              'Access to a device topic was denied. Give the viewer read permission for all three telemetry topics.',
            );
          state = 'connected';
          set(
            'hardware-message',
            'Listening for fresh ESP32 telemetry. Sensor values appear only after a device reports them.',
          );
          changed();
          // Inventory is optional: its ACL cannot prevent the three AMR subscriptions from working.
          liveClient.subscribe(
            next.inventoryTopic,
            { qos: 0 },
            (inventoryError, inventoryGrants) => {
              if (ticket !== generation) return;
              if (
                inventoryError ||
                !inventoryGrants?.length ||
                inventoryGrants.some((g) => g.qos > 2)
              )
                onInventoryError?.(
                  'Inventory subscription unavailable. Allow read access to the /inventory topic to feed the twin’s stock model.',
                );
            },
          );
        });
      });
      liveClient.on('message', (topic, payload, packet) => {
        if (ticket !== generation || state !== 'connected') return;
        const index = next.topics.indexOf(topic);
        if (index >= 0) {
          const now = Date.now(),
            tick = performance.now();
          if (store.ingest(index, payload, packet, now, tick))
            onObservation?.(store.slots[index].data, now, tick);
          changed();
        } else if (topic === next.inventoryTopic) {
          try {
            if (packet.retain)
              throw Error('Retained inventory ignored; waiting for a fresh camera observation.');
            if (payload.length > 4096) throw Error('Inventory packet exceeds 4 KB.');
            const now = Date.now(),
              tick = performance.now();
            onInventory?.(
              decodeInventory(new TextDecoder('utf-8', { fatal: true }).decode(payload), now),
              now,
              tick,
            );
            changed();
          } catch (error) {
            onInventoryError?.(error.message);
          }
        }
      });
      liveClient.on('reconnect', () => {
        if (ticket !== generation) return;
        state = 'reconnecting';
        set('hardware-message', 'Connection interrupted. Retrying every 3 seconds…');
        changed();
      });
      liveClient.on('close', () => {
        if (ticket !== generation) return;
        clearTimeout(subscriptionTimer);
        state = 'reconnecting';
        changed();
      });
      liveClient.on('error', (error) => {
        if (ticket !== generation) return;
        if ([1, 2, 3, 4, 5, 128, 134, 135].includes(error.code))
          return fail(
            'Broker connection refused. Check its address, username and read-only permissions.',
          );
        set(
          'hardware-message',
          'Unable to reach the broker. Check its WSS endpoint, certificate and network access.',
        );
      });
      changed();
    } catch {
      if (ticket === generation)
        fail('The MQTT connection could not start. Check the broker details and try again.');
    }
  }
  $('hardware-form').addEventListener('submit', connect);
  $('hardware-disconnect').addEventListener('click', disconnect);
  $('hardware-prefix').addEventListener('input', render);
  SLOT_IDS.forEach((_, i) =>
    $('hw-' + i + '-view').addEventListener('click', () => {
      if (snapshot()[i].tracked) onView(i);
    }),
  );
  let timer = setInterval(changed, 1000);
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    timer = null;
    disconnect();
  });
  window.addEventListener('pageshow', () => {
    if (timer === null) timer = setInterval(changed, 1000);
    changed();
  });
  document.addEventListener('visibilitychange', changed);
  render();
  return {
    snapshot,
    get state() {
      return state;
    },
    disconnect,
  };
}
