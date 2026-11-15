/* Display Python results in the existing Hardware view. No model equations here. */
(() => {
  'use strict';
  let latest;
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
  function render(payload) {
    if (!document.body || !$('python-sensor-panel')) {
      latest = payload;
      return;
    }
    document.documentElement.dataset.pythonTwin = 'true';
    document.documentElement.dataset.pythonSource = payload.mode;
    text('python-source-status', payload.status || 'Waiting for Python');
    text(
      'python-source-label',
      payload.mode === 'live' ? 'Physical sensor records' : 'Synthetic example only',
    );
    for (const mode of ['demo', 'live']) {
      $('python-source-' + mode).setAttribute('aria-pressed', String(payload.mode === mode));
    }
    const robots = payload.robots || {};
    for (const rid of ['amr01']) {
      const r = robots[rid],
        key = 'python-' + rid + '-';
      const available = r && !r.stale;
      const d = available ? r.derived || {} : {};
      const raw = available ? r.raw || {} : {};
      const demo = payload.mode === 'demo';
      const label = r?.quality_label || (demo ? 'Demonstration data' : 'No sensor data');
      text(key + 'quality', label);
      text('python-data-title', label);
      text(
        'python-data-detail',
        r?.quality_detail ||
          (demo
            ? 'Synthetic teaching example. No physical robot is connected.'
            : 'No validated physical reading is available. Check the sensor connection and ingestion worker.'),
      );
      $('python-data-notice').dataset.tone = r?.quality_tone || (demo ? 'info' : 'neutral');
      text(key + 'age', demo ? 'Fixed demo trial' : number(r?.age_s, 1, ' s'));
      text(key + 'soc', available ? number(r.soc * 100, 1, '%') : 'Unavailable');
      text(key + 'pose', available ? position(r.pose) : 'Unavailable');
      text(
        key + 'travel',
        `L = ${number(d.ds_left_m, 4, ' m')}\nR = ${number(d.ds_right_m, 4, ' m')}`,
      );
      text(key + 'gyro', number(raw.gyro_z_rad_s, 5));
      text(key + 'bias', number(r?.gyro_bias_rad_s, 5));
      text(key + 'corrected-gyro', number(d.corrected_gyro_rad_s, 5));
      text(
        key + 'battery-input',
        `Voltage = ${number(raw.battery_voltage_v, 2, ' V')}\nCurrent = ${number(raw.battery_current_a, 3, ' A')}`,
      );
      text(key + 'power', number(d.power_w, 2, ' W'));
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
          ? 'Waiting for current, valid readings. Forecasts are withheld.'
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
      text(key + 'state', raw.robot_state || 'No fresh packet');
      const message = !available
        ? 'No fresh readings; alerts and forecasts suspended.'
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
          : 'Alert threshold is unavailable. Wait for the configured calibration.',
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
        key + 'plot-range',
        rows.some((row) => Number.isFinite(row.residual_rad_s))
          ? `Recorded difference · scale ±${scale.toFixed(3)} rad/s · time ${start.toFixed(2)}–${(start + duration).toFixed(2)} s since device boot${available ? '' : ' · historical data; current readings unavailable'}`
          : 'No valid comparison history yet.',
      );
    }
  }
  document.addEventListener('python-twin:render', (event) => {
    if (event.detail && ['demo', 'live'].includes(event.detail.mode)) render(event.detail);
  });
  function bind() {
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
    if (latest) {
      render(latest);
      latest = null;
    }
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
