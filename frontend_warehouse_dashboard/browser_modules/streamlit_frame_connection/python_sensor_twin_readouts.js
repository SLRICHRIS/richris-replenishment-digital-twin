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
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) + suffix : '—';
  function render(payload) {
    if (!document.body || !$('python-sensor-panel')) {
      latest = payload;
      return;
    }
    document.documentElement.dataset.pythonTwin = 'true';
    text('python-source-status', payload.status || 'Waiting for Python');
    text(
      'python-source-label',
      payload.mode === 'live' ? 'EMQX to PostgreSQL' : 'Synthetic demonstration',
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
      text(key + 'quality', r?.quality || 'WAITING');
      text(key + 'age', number(r?.age_s, 2, ' s'));
      text(key + 'soc', available ? number(r.soc * 100, 3, '%') : '—');
      text(key + 'pose', available ? r.pose.map((v) => number(v)).join(' / ') : '—');
      text(key + 'travel', [d.ds_left_m, d.ds_right_m].map((v) => number(v, 5)).join(' / '));
      text(key + 'gyro', number(raw.gyro_z_rad_s, 5));
      text(key + 'bias', number(r?.gyro_bias_rad_s, 5));
      text(key + 'corrected-gyro', number(d.corrected_gyro_rad_s, 5));
      text(
        key + 'battery-input',
        [number(raw.battery_voltage_v, 3), number(raw.battery_current_a, 4)].join(' / '),
      );
      text(key + 'power', number(d.power_w, 4, ' W'));
      text(key + 'energy', available ? number(r.energy_wh, 5, ' Wh') : '—');
      text(key + 'speed', [d.v_left_m_s, d.v_right_m_s].map((v) => number(v, 4)).join(' / '));
      text(key + 'residual', number(d.residual_rad_s, 5, ' rad/s'));
      text(key + 'runtime', number(r?.runtime_hours, 2, ' h'));
      text(key + 'forecast', r?.forecast_pose?.map((v) => number(v)).join(' / ') || 'Unavailable');
      text(key + 'state', raw.robot_state || 'No fresh packet');
      const message = !available
        ? 'No fresh readings; alerts and forecasts suspended.'
        : r.continuity_lost
          ? 'Observation gap: integrals are partial; reinitialise from measured state.'
          : d.soc_out_of_bounds
            ? 'SOC outside [0, 1]: check capacity, initial charge and current calibration.'
            : d.residual_valid === false
              ? 'Sensor packet gap: residual and short-term forecasts suppressed for this sample.'
            : d.advisory
              ? 'Sustained gyro/encoder disagreement. Inspect motion and sensors.'
              : Object.keys(d).length
                ? 'No sustained residual advisory at this sample.'
                : 'First sample anchors counts and time.';
      text(key + 'advisory', message);
      $(key + 'advisory').dataset.alert = String(
        Boolean(d.advisory || d.soc_out_of_bounds || r?.continuity_lost),
      );
      const rows = (r?.history || []).filter(
        (row) => Number.isFinite(row.sample_time_s) && Number.isFinite(row.residual_rad_s),
      );
      const start = rows[0]?.sample_time_s || 0;
      const duration = Math.max(0.05, (rows.at(-1)?.sample_time_s || 0) - start);
      const scale = Math.max(0.04, ...rows.map((row) => Math.abs(row.residual_rad_s)));
      const points = rows
        .map(
          (row) =>
            `${(((row.sample_time_s - start) / duration) * 480 + 10).toFixed(2)},${(60 - (row.residual_rad_s / scale) * 45).toFixed(2)}`,
        )
        .join(' ');
      if ($(key + 'plot').getAttribute('points') !== points)
        $(key + 'plot').setAttribute('points', points);
      text(
        key + 'plot-range',
        `Residual history · ±${scale.toFixed(3)} rad/s · ${duration.toFixed(2)} s window`,
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
