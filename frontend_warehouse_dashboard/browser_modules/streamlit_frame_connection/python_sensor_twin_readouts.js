/* Display Python results in Sensor models. No model equations here. */
(() => {
  'use strict';
  let latest, pendingTrial, trialURL, trialJSON;
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => {
    const node = $(id);
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  };
  const number = (value, digits = 3, suffix = '') =>
    typeof value === 'number' && Number.isFinite(value)
      ? value.toFixed(digits) + suffix
      : 'Unavailable';
  const position = (pose) =>
    Array.isArray(pose) && pose.length === 3
      ? `x = ${number(pose[0], 3, ' m')}\ny = ${number(pose[1], 3, ' m')}\nHeading = ${number(pose[2], 3, ' rad')}`
      : 'Unavailable';
  function downloadJSON(value, filename) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    // The browser consumes the URL asynchronously, including inside Streamlit's iframe.
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }
  function updateTrialDownload(payload, trial) {
    const anchor = $('python-demo-export');
    const ready = payload.mode === 'demo' && trial && !pendingTrial;
    anchor.setAttribute('aria-disabled', String(!ready));
    anchor.tabIndex = ready ? 0 : -1;
    if (!ready) {
      anchor.removeAttribute('href');
      anchor.removeAttribute('download');
      return;
    }
    const evidence = {
      evidence_format: 'amr01.synthetic-trial.v1',
      source: 'synthetic',
      hardware_validation: false,
      trial,
      snapshot_time_s: 6,
      outputs: payload.robots,
      insights: payload.insights,
      limits: [
        'Generated inputs, not physical measurements.',
        'No packets are written to the physical database.',
        'Forecasts assume unchanged inputs and use a local odometry frame.',
      ],
    };
    const serialized = JSON.stringify(evidence, null, 2);
    if (serialized !== trialJSON) {
      const previous = trialURL;
      trialURL = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }));
      trialJSON = serialized;
      if (previous) setTimeout(() => URL.revokeObjectURL(previous), 1000);
    }
    anchor.href = trialURL;
    anchor.download = 'amr01_' + trial.id + '_synthetic_trial.json';
  }
  function render(payload) {
    if (!document.body || !$('python-sensor-panel')) {
      latest = payload;
      return;
    }
    document.documentElement.dataset.pythonTwin = 'true';
    document.documentElement.dataset.pythonSource = payload.mode;
    $('python-connection-details').hidden = payload.mode !== 'live';
    text('python-source-status', payload.status || 'Waiting for sensor status');
    text('python-source-label', payload.mode === 'live' ? 'Stored sensor data' : 'Demo data');
    for (const mode of ['demo', 'live']) {
      $('python-source-' + mode).setAttribute('aria-pressed', String(payload.mode === mode));
    }
    if (payload.database) renderDatabase(payload.database);
    renderPhysicalTelemetry(payload);
    const trial = payload.mode === 'demo' ? payload.demo_trial : null;
    $('python-demo-controls').hidden = !trial;
    if (payload.mode !== 'demo' || trial?.id === pendingTrial) pendingTrial = null;
    $('python-demo-controls').setAttribute('aria-busy', String(Boolean(pendingTrial)));
    $('python-sensor-panel').setAttribute('aria-busy', String(Boolean(pendingTrial)));
    updateTrialDownload(payload, trial);
    if (trial && !pendingTrial) {
      if ($('python-demo-trial').value !== trial.id) $('python-demo-trial').value = trial.id;
      text('python-demo-packets', trial.packet_count + ' generated packets');
    }
    if (pendingTrial && payload.mode === 'demo') return;
    const robots = payload.robots || {};
    const physical = payload.mode === 'live' ? payload.physical_telemetry : null;
    for (const rid of ['amr01']) {
      const r = robots[rid],
        key = 'python-' + rid + '-';
      const available = r && !r.stale;
      document.documentElement.dataset.readingsAvailable = String(Boolean(available));
      const d = available ? r.derived || {} : {};
      const physicalInput = !available && physical?.fresh === true;
      // Current raw observations do not authorize the calibrated model outputs.
      const raw = available ? r.raw || {} : physicalInput ? physical.measurements || {} : {};
      const age = available ? r.age_s : (physical?.age_s ?? r?.age_s);
      const demo = payload.mode === 'demo';
      const label =
        r?.quality_label || payload.notice?.label || (demo ? 'Demo data' : 'No sensor data');
      text(
        'hardware-summary',
        demo ? 'Sensor data: demo' : 'Sensor data: ' + (physical?.label || label),
      );
      text(key + 'quality', label);
      text('python-data-title', label);
      text(
        'python-data-detail',
        r?.quality_detail ||
          payload.notice?.detail ||
          (demo
            ? 'Generated sensor values for a fixed teaching example.'
            : 'No validated physical reading is available. Check the sensor connection and ingestion worker.'),
      );
      $('python-data-notice').dataset.tone =
        r?.quality_tone || payload.notice?.tone || (demo ? 'info' : 'neutral');
      text(key + 'age', demo ? 'Fixed demo trial' : number(age, 1, ' s'));
      text(
        'python-observation-label',
        demo
          ? trial
            ? trial.label + ' · 6 seconds'
            : 'Fixed demo trial · 6 seconds'
          : 'Sample age · ' + number(age, 1, ' s'),
      );
      text(key + 'soc', available ? number(r.soc * 100, 1, '%') : 'Unavailable');
      text(key + 'pose', available ? position(r.pose) : 'Unavailable');
      text(
        key + 'travel',
        `L = ${number(d.ds_left_m, 4, ' m')}\nR = ${number(d.ds_right_m, 4, ' m')}`,
      );
      text(key + 'gyro', number(raw.gyro_z_rad_s, 5));
      $(key + 'gyro-input-note').hidden = !physicalInput;
      text(
        key + 'gyro-input-note',
        'Raw device observation. Calibrated bias and the corrected model rate still require measured calibration.',
      );
      text(key + 'bias', number(r?.gyro_bias_rad_s, 5));
      text(key + 'corrected-gyro', number(d.corrected_gyro_rad_s, 5));
      text(
        key + 'battery-input',
        `Voltage = ${number(raw.battery_voltage_v, physicalInput ? 3 : 2, ' V')}\nCurrent = ${number(raw.battery_current_a, physicalInput ? 4 : 3, ' A')}`,
      );
      text(
        key + 'power',
        physicalInput ? number(raw.battery_power_w, 6, ' W') : number(d.power_w, 2, ' W'),
      );
      $(key + 'battery-input-note').hidden = !physicalInput;
      text(
        key + 'battery-input-note',
        'Raw electrical observations. SOC and accumulated energy require battery calibration.' +
          (Number.isFinite(raw.battery_voltage_v) && raw.battery_voltage_v < 1
            ? ' Input is below 1 V; check battery power and INA219 VIN connections.'
            : ''),
      );
      text(key + 'energy', available ? number(r.energy_wh, 4, ' Wh') : 'Unavailable');
      text(
        key + 'speed',
        `L = ${number(d.v_left_m_s, 3, ' m/s')}\nR = ${number(d.v_right_m_s, 3, ' m/s')}`,
      );
      text(key + 'residual', number(d.residual_rad_s, 5, ' rad/s'));
      const forecastAllowed =
        available && !r.continuity_lost && r.quality === 'OK' && d.residual_valid !== false;
      text(key + 'runtime', forecastAllowed ? number(r?.runtime_hours, 2, ' h') : 'Unavailable');
      text(key + 'forecast', forecastAllowed ? position(r?.forecast_pose) : 'Unavailable');
      text(
        key + 'forecast-note',
        !available
          ? payload.notice
            ? payload.notice.label + '. Forecasts are unavailable.'
            : 'Waiting for current, valid readings. Forecasts are withheld.'
          : r.continuity_lost
            ? 'Unavailable after data loss: the accumulated estimates are partial. A new measured trial is needed for quantitative forecasts.'
            : !Object.keys(d).length
              ? 'Waiting for a second valid sample to calculate motion and battery use.'
              : d.residual_valid === false
                ? 'Unavailable for this interval because sensor packets are missing.'
                : !(raw.battery_current_a > 0)
                  ? 'Runtime is unavailable while charging or at zero current. Motion projection assumes unchanged wheel speeds.'
                  : 'Assumes unchanged wheel speeds and battery current, until an assumed 20% charge reserve. This is not a planned route or a battery-life guarantee.',
      );
      text(key + 'state', raw.robot_state || 'Unavailable');
      const message = !available
        ? payload.notice
          ? payload.notice.label + '. Alerts and forecasts are unavailable.'
          : 'No fresh readings; alerts and forecasts suspended.'
        : r.continuity_lost
          ? 'Data was lost: position, charge and energy estimates are partial. Forecasts are withheld.'
          : d.soc_out_of_bounds
            ? 'SOC outside [0, 1]: check capacity, initial charge and current calibration.'
            : d.residual_valid === false
              ? 'Sensor packet gap: residual and short-term forecasts suppressed for this sample.'
              : d.advisory
                ? 'Sustained gyro/encoder disagreement. Inspect motion and sensors.'
                : Object.keys(d).length
                  ? 'No sustained motion disagreement at this sample. This does not establish that the robot is fault-free.'
                  : 'Waiting for a second valid sample to compare the motion sensors.';
      text(key + 'advisory', message);
      $(key + 'advisory').dataset.alert = String(
        Boolean(
          !available ||
            d.advisory ||
            d.soc_out_of_bounds ||
            r?.continuity_lost ||
            d.residual_valid === false,
        ),
      );
      const threshold = r?.residual_threshold_rad_s;
      const hasThreshold = Number.isFinite(threshold) && threshold > 0;
      text(
        key + 'threshold',
        hasThreshold
          ? `Advisory requires a difference beyond ±${number(threshold, 3)} rad/s for ${number(r.residual_hold_s, 2)} s continuously. Dashed lines show this threshold.`
          : 'Alert threshold requires measured calibration.',
      );
      const rows = (r?.history || []).filter((row) => Number.isFinite(row.sample_time_s));
      const start = rows[0]?.sample_time_s || 0;
      const duration = Math.max(0.05, (rows.at(-1)?.sample_time_s || 0) - start);
      const scale = Math.max(
        0.04,
        hasThreshold ? threshold * 1.2 : 0,
        ...rows
          .filter((row) => Number.isFinite(row.residual_rad_s))
          .map((row) => Math.abs(row.residual_rad_s)),
      );
      let connected = false;
      const path = rows
        .map((row) => {
          if (!Number.isFinite(row.residual_rad_s)) {
            connected = false;
            return '';
          }
          const command = connected && !row.plot_break_before ? 'L' : 'M';
          connected = true;
          return `${command}${(((row.sample_time_s - start) / duration) * 440 + 50).toFixed(2)},${(60 - (row.residual_rad_s / scale) * 45).toFixed(2)}`;
        })
        .join(' ');
      if ($(key + 'plot').getAttribute('d') !== path) $(key + 'plot').setAttribute('d', path);
      for (const [id, sign] of [
        ['upper', 1],
        ['lower', -1],
      ]) {
        const line = $(key + 'threshold-' + id);
        line.setAttribute('visibility', hasThreshold ? 'visible' : 'hidden');
        if (hasThreshold) {
          const y = String(60 - ((sign * threshold) / scale) * 45);
          line.setAttribute('y1', y);
          line.setAttribute('y2', y);
        }
      }
      text(key + 'plot-max', `+${scale.toFixed(2)}`);
      text(key + 'plot-min', `−${scale.toFixed(2)}`);
      text(
        key + 'plot-caption',
        rows.some((row) => Number.isFinite(row.residual_rad_s))
          ? `${available ? 'Time since boot' : 'Historical'} · ${start.toFixed(2)}–${(start + duration).toFixed(2)} s`
          : 'No comparison history',
      );
      text(
        key + 'plot-range',
        rows.some((row) => Number.isFinite(row.residual_rad_s))
          ? `Recorded difference · scale ±${scale.toFixed(3)} rad/s · time ${start.toFixed(2)}–${(start + duration).toFixed(2)} s since device boot${available ? '' : ' · historical data; current readings unavailable'}`
          : 'No comparison history available in this view.',
      );
    }
  }
  document.addEventListener('python-twin:render', (event) => {
    if (event.detail && ['demo', 'live'].includes(event.detail.mode)) render(event.detail);
  });
  let databaseOpen = false;
  let databaseRows;
  let databaseSignature = '';
  function browseDatabase(active) {
    document.querySelector('.twin-records-browser')?.setAttribute('aria-busy', String(active));
    document.dispatchEvent(
      new CustomEvent('python-twin:action', {
        detail: {
          action: 'database_browse',
          dataset: $('python-db-dataset').value,
          active,
        },
      }),
    );
  }
  function openDatabase() {
    if (databaseOpen) return;
    databaseOpen = true;
    browseDatabase(true);
  }
  const sensorColumnLabels = {
    seq: 'Packet',
    received_at: 'Received (UTC)',
    battery_voltage_v: 'Voltage (V)',
    battery_current_a: 'Current (A)',
    battery_power_w: 'Power (W)',
    left_pulses_total: 'Left pulses',
    right_pulses_total: 'Right pulses',
    left_pulse_hz: 'Left rate (Hz)',
    right_pulse_hz: 'Right rate (Hz)',
    gyro_z_rad_s: 'Gyro Z (rad/s)',
    yaw_estimate_deg: 'Relative yaw (°)',
  };
  function table(target, columns, rows, labels = {}) {
    const grid = document.createElement('table');
    const head = grid.createTHead().insertRow();
    for (const name of columns) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = labels[name] || name;
      th.title = name;
      head.append(th);
    }
    const body = grid.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const key of columns) {
        const td = tr.insertCell();
        const value = row[key];
        const cell = document.createElement('span');
        cell.className = 'twin-cell-value';
        cell.textContent =
          value === null || value === undefined
            ? '—'
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
        cell.title = cell.textContent;
        td.append(cell);
      }
    }
    $(target).replaceChildren(grid);
  }
  function renderPhysicalTelemetry(payload) {
    const panel = $('physical-telemetry');
    if (!panel) return;
    panel.hidden = payload.mode !== 'live';
    if (panel.hidden) return;
    const data = payload.physical_telemetry || {};
    const values = data.fresh ? data.measurements || {} : {};
    text('physical-status', data.label || 'Waiting for stored packets');
    panel.dataset.state = data.state || 'waiting';
    text(
      'physical-received',
      data.received_at
        ? 'Broker received ' +
            data.received_at +
            ' · ' +
            number(data.age_s, 1, ' s ago') +
            ' · packet ' +
            data.seq
        : 'No stored packet is available yet.',
    );
    text(
      'physical-wheel-left',
      number(values.left_pulses_total, 0) + ' pulses / ' + number(values.left_pulse_hz, 2, ' Hz'),
    );
    text(
      'physical-wheel-right',
      number(values.right_pulses_total, 0) + ' pulses / ' + number(values.right_pulse_hz, 2, ' Hz'),
    );
    text('physical-gyro', number(values.gyro_z_rad_s, 5, ' rad/s'));
    text('physical-yaw', number(values.yaw_estimate_deg, 2, '°'));
    text('physical-voltage', number(values.battery_voltage_v, 3, ' V'));
    text('physical-current', number(values.battery_current_a, 4, ' A'));
    text('physical-power', number(values.battery_power_w, 3, ' W'));
    text(
      'physical-model-limit',
      data.model_detail ||
        'Measured calibration and wheel direction are required before model predictions.',
    );
    const list = $('physical-recommendations');
    list.replaceChildren(
      ...(data.recommendations || ['Check the EMQX forwarding connection.']).map((message) => {
        const li = document.createElement('li');
        li.textContent = message;
        return li;
      }),
    );
  }
  function renderDatabase(data) {
    // A late response must never relabel old rows as the newly selected dataset.
    if (data.dataset !== $('python-db-dataset')?.value) return;
    const signature = JSON.stringify(data);
    if (signature === databaseSignature) return;
    databaseSignature = signature;
    databaseRows = data;
    document.querySelector('.twin-records-browser')?.setAttribute('aria-busy', 'false');
    const ready = data.state === 'ready';
    text('python-db-status', ready ? 'Connected' : data.label || 'Connection unavailable');
    $('python-db-status').dataset.state = data.state;
    text(
      'python-db-connection-detail',
      ready ? 'PostgreSQL · storage verified · read-only access' : data.detail,
    );
    text('python-db-title', data.title);
    text('python-db-description', data.description);
    text('python-db-kind', data.kind);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const hasRows = data.rows_state === 'ready' && rows.length > 0;
    $('python-db-empty').hidden = hasRows;
    $('python-db-records-table').hidden = !hasRows;
    $('python-db-export').disabled = !hasRows;
    text(
      'python-db-empty-title',
      data.rows_state === 'error'
        ? 'Records could not be read'
        : !ready
          ? 'Archive unavailable'
          : 'No records in ' + data.title,
    );
    text(
      'python-db-empty-detail',
      data.rows_state === 'error'
        ? 'Refresh to try reading this dataset again.'
        : !ready
          ? 'The table definitions remain available in Table attributes.'
          : data.dataset === 'amr_commissioning_samples'
            ? 'Physical ESP32 packets will appear here. Demo values are never stored in this archive.'
            : 'This dataset belongs to the calibrated-model pipeline. Choose Device telemetry for installed ESP32 wheel, IMU and battery observations.',
    );
    text(
      'python-db-row-count',
      data.rows_state === 'ready'
        ? rows.length + ' records shown · latest ' + data.limit + ' maximum'
        : 'Records unavailable',
    );
    if (hasRows) {
      const device = data.dataset === 'amr_commissioning_samples';
      const priority = Object.keys(sensorColumnLabels).filter((name) =>
        data.columns.includes(name),
      );
      const columns = device
        ? [...priority, ...data.columns.filter((name) => !priority.includes(name))]
        : data.columns;
      table('python-db-records-table', columns, rows, device ? sensorColumnLabels : {});
    }
    table(
      'python-db-attributes-table',
      ['Attribute', 'PostgreSQL type', 'Required', 'Key'],
      data.attributes || [],
    );
  }
  function bind() {
    $('physical-open-archive')?.addEventListener('click', () => {
      $('python-db-dataset').value = 'amr_commissioning_samples';
      $('python-database-inspection').click();
    });
    $('python-demo-trial')?.addEventListener('change', () => {
      pendingTrial = $('python-demo-trial').value;
      $('python-demo-controls').setAttribute('aria-busy', 'true');
      $('python-sensor-panel').setAttribute('aria-busy', 'true');
      updateTrialDownload({ mode: 'demo' }, null);
      text('python-data-detail', 'Loading the selected generated trial…');
      document.dispatchEvent(
        new CustomEvent('python-twin:action', {
          detail: { action: 'demo_trial', trial: pendingTrial },
        }),
      );
    });
    $('python-demo-export')?.addEventListener('click', (event) => {
      if ($('python-demo-export').getAttribute('aria-disabled') === 'true') event.preventDefault();
    });
    for (const mode of ['demo', 'live']) {
      $('python-source-' + mode)?.addEventListener('click', () => {
        document.dispatchEvent(
          new CustomEvent('python-twin:action', { detail: { action: 'sensor_source', mode } }),
        );
      });
    }
    $('python-model-inspection')?.addEventListener('click', () => {
      document.dispatchEvent(
        new CustomEvent('python-twin:action', { detail: { action: 'model_inspection' } }),
      );
    });
    // Navigation owns the open event, after closing the outgoing view. An
    // earlier click handler can be overwritten by that view's close action.
    document.addEventListener('python-twin:database-open', openDatabase);
    document.addEventListener('python-twin:database-close', () => {
      if (!databaseOpen) return;
      databaseOpen = false;
      browseDatabase(false);
    });
    $('python-db-dataset')?.addEventListener('change', () => {
      databaseRows = null;
      databaseSignature = '';
      $('python-db-attributes-table').replaceChildren();
      text('python-db-description', 'Loading the selected dataset and field definitions.');
      text('python-db-kind', '…');
      text('python-db-row-count', 'Loading records');
      $('python-db-export').disabled = true;
      $('python-db-records-table').hidden = true;
      $('python-db-empty').hidden = false;
      text('python-db-title', $('python-db-dataset').selectedOptions[0].textContent);
      text('python-db-empty-title', 'Loading records');
      text('python-db-empty-detail', 'Reading the selected sensor dataset.');
      browseDatabase(true);
    });
    $('python-db-refresh')?.addEventListener('click', () => browseDatabase(true));
    for (const view of ['records', 'attributes']) {
      const tab = $('python-db-' + view + '-tab');
      const activate = () => {
        for (const name of ['records', 'attributes']) {
          const on = name === view;
          $('python-db-' + name).hidden = !on;
          $('python-db-' + name + '-tab').setAttribute('aria-selected', String(on));
          $('python-db-' + name + '-tab').tabIndex = on ? 0 : -1;
        }
      };
      tab?.addEventListener('click', activate);
      tab?.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 'records'
            : event.key === 'End'
              ? 'attributes'
              : view === 'records'
                ? 'attributes'
                : 'records';
        $('python-db-' + next + '-tab').click();
        $('python-db-' + next + '-tab').focus();
      });
    }
    $('python-db-export')?.addEventListener('click', () => {
      if (!databaseRows?.rows?.length) return;
      downloadJSON(databaseRows.rows, databaseRows.dataset + '.json');
    });
    if (latest) {
      render(latest);
      latest = null;
    }
    document.dispatchEvent(new CustomEvent('python-twin:ready'));
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
