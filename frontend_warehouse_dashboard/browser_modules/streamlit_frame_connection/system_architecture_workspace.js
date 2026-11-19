/* Read-only architecture guide. Operational authority stays in the existing workspaces. */
(() => {
  'use strict';
  const paths = {
    sensors: {
      label: 'Sensor data',
      title: 'From a physical measurement to a stored reading',
      description:
        'The installed MH IR, IMU and INA219 observations travel over Wi-Fi into a protected archive. The website reads those records.',
      handoff:
        'MQTT over TLS carries device packets. EMQX forwards JSON over HTTPS to the authenticated receiver. The database preserves packet identity and original receive time.',
      outcome:
        'A fresh stored packet makes raw measurements available. Position, charge and forecasts each need their own valid calibration and inputs.',
      nodes: [
        {
          title: 'Physical sensors',
          where: 'On the AMR',
          icon: 'i-motion',
          brief: 'Wheel pulses, rotation and motor-branch electrical readings.',
          input: 'Wheel movement, IMU rotation and current through INA219.',
          output: 'Two unsigned wheel pulse streams, gyro readings, voltage and current.',
          role: 'MH IR inputs count pulses. The IMU measures rotation. INA219 measures the motor power branch.',
          gate: 'Single-channel pulses do not independently measure wheel direction. INA219 does not directly measure charge percentage.',
          page: 'hardware',
          pageLabel: 'Open sensor models',
        },
        {
          title: 'ESP32',
          where: 'On the AMR',
          icon: 'i-robot',
          brief: 'Samples sensors and labels every packet.',
          input: 'GPIO 18/19 wheel pulses and I2C sensors on GPIO 21/22.',
          output:
            'Commissioning JSON with robot ID, boot ID, sequence, device time and sensor availability.',
          role: 'The ESP32 publishes approximately two reports per second over Wi-Fi. Motor output and commanded direction are recorded separately from measured observations.',
          gate: 'Unavailable sensor values stay unavailable. Commands never become evidence of actual wheel direction.',
        },
        {
          title: 'EMQX + receiver',
          where: 'Cloud',
          icon: 'i-wifi',
          brief: 'Transports, authenticates and validates the packet.',
          input: 'MQTT/TLS messages on robot/amr01/commissioning.',
          output:
            'Validated typed records sent to PostgreSQL hosted on Neon through the protected HTTP receiver.',
          role: 'EMQX applies the forwarding rule. The receiver authenticates before reading the body, checks the schema and handles repeated packet identities.',
          gate: 'An identical retry is deduplicated; conflicting content for an existing identity is rejected. Private credentials stay outside the browser.',
        },
        {
          title: 'PostgreSQL on Neon',
          where: 'Cloud',
          icon: 'i-database',
          brief: 'PostgreSQL stores the records. Neon hosts the database.',
          input: 'Validated measurements and their original broker receive time.',
          output: 'Read-only device telemetry records and field definitions.',
          role: 'We use PostgreSQL hosted on Neon. PostgreSQL is the database engine; Neon provides its cloud hosting. Commissioning observations are stored separately from calibrated model states. The website uses a restricted reader.',
          gate: 'Storage time cannot make an old packet fresh. Records that reached the receiver can be retried; missing device packets cannot be reconstructed.',
          page: 'database',
          pageLabel: 'Inspect sensor records',
        },
        {
          title: 'Digital twin',
          where: 'Website',
          icon: 'i-chart',
          brief: 'Shows current readings, history and readiness.',
          input: 'Public read-only results from the Python server.',
          output: 'Telemetry cards, archive tables and explicit freshness notices.',
          role: 'The interface displays measurements with their source and age. Its wheel RPM and rim-speed magnitudes use the reported 65 mm wheels and 20 pulses per turn.',
          gate: 'Stale readings are hidden from current readouts and remain inspectable in the archive. Raw commissioning data does not enable full model predictions.',
          page: 'hardware',
          pageLabel: 'View sensor models',
        },
      ],
    },
    vision: {
      label: 'Vision & movement',
      title: 'From the overhead view to a human-approved journey',
      description:
        'One overhead Logitech USB webcam supplies the physical view. A laptop program processes that same webcam; the operator reviews routes on the website.',
      handoff:
        'USB brings images into the laptop. Authenticated EMQX scene, request and drive messages connect the laptop, server and ESP32. Camera feedback closes the loop.',
      outcome:
        'Arrival is verified from distinct fresh camera observations and stopped-state evidence. A sent command or controller reply alone is not arrival.',
      nodes: [
        {
          title: 'Logitech webcam',
          where: 'Above the floor',
          icon: 'i-focus',
          brief: 'Views the robot, floor markers and obstacles.',
          input: 'The 425 × 630 mm working paper and the robot marker.',
          output: 'USB camera frames on the laptop.',
          role: 'This is the single overhead camera, mounted at the reported 92 cm height. The robot has a 40 mm marker at a reported 15 cm height.',
          gate: 'Lens calibration, four floor references, marker alignment and a validated obstacle scene are required. Webcam placement preview is available in Practice.',
        },
        {
          title: 'Vision processor',
          where: 'Laptop',
          icon: 'i-map',
          brief: 'Finds the AMR pose and occupied floor regions.',
          input:
            'Logitech frames, measured camera configuration and an empty-floor reference image.',
          output:
            'Fresh signed camera scenes with robot pose, obstacles and configuration identity.',
          role: 'Our program runs on the Windows laptop and reads the Logitech webcam. It locates the marker, corrects for its height and mounting offset, and checks floor references and image continuity.',
          gate: 'Camera movement, missing references, obscured robot marker or stale frames invalidate the scene. The Windows Camera app is not required.',
        },
        {
          title: 'Plan + human review',
          where: 'Website + server',
          icon: 'i-check',
          brief: 'Proposes a route and asks the operator to decide.',
          input: 'A trusted current scene, destination and authenticated operator session.',
          output: 'An approved, rejected or held route with an audit record and expiry.',
          role: 'The server calculates a route with the measured footprint and stopping allowance. The operator checks the proposed path and chooses Approve & run, Reject or Hold.',
          gate: 'Changed evidence, expired proposals or missing readiness prevent execution. Browser drawings and practice decisions cannot authorize physical movement.',
          page: 'vision',
          pageLabel: 'Open vision routing',
        },
        {
          title: 'Route follower',
          where: 'Laptop',
          icon: 'i-motion',
          brief: 'Follows the approved path with camera feedback.',
          input: 'The matching approved route and fresh camera and receiver observations.',
          output: 'Short-lived authenticated motor requests through EMQX.',
          role: 'The same laptop process follows the approved route. It adjusts motion using current pose and verifies destination and stop observations.',
          gate: 'Stop, lost operator presence, stale evidence, a changed obstacle map or path departure ends the movement grant. A replacement route needs a new review.',
        },
        {
          title: 'ESP32 + motors',
          where: 'On the AMR',
          icon: 'i-robot',
          brief: 'Checks each request and drives the TB6612.',
          input: 'Valid bounded drive messages and local protection state.',
          output: 'TB6612 direction/PWM, receiver status and measured motion feedback.',
          role: 'The commissioned ESP32 receiver validates the command context and its lease. TB6612 supplies the left and right motors. The overhead camera observes the resulting movement.',
          gate: 'Receiver firmware, wheel polarities, PWM-to-speed response, stopping distance and electrical ratings need attended verification. Emergency protection remains local.',
        },
      ],
    },
    models: {
      label: 'Models & review',
      title: 'From calibrated evidence to a verified decision',
      description:
        'The full Python model pipeline has a separate calibrated input contract. The installed unsigned commissioning feed remains useful for raw observations.',
      handoff:
        'The full-model worker subscribes to robot/amr01/state. Its calibrated signed observations are separate from the commissioning topic and raw archive.',
      outcome:
        'Sensor recommendations require valid current inputs. Physical intervention reviews distinguish the request, controller acknowledgement and three fresh confirming sensor observations.',
      nodes: [
        {
          title: 'Calibrated input',
          where: 'On the AMR',
          icon: 'i-motion',
          brief: 'Supplies the measurements each model needs.',
          input: 'Measured geometry, direction feedback, stationary bias and battery calibration.',
          output: 'The validated full-model sensor contract.',
          role: 'Wheel travel and position need signed direction feedback. Battery charge and runtime need usable capacity, initial charge, current calibration and observation continuity.',
          gate: 'The current single-channel MH IR pulse counts remain unsigned. Supplying a geometry or bias value does not complete every model requirement.',
        },
        {
          title: 'Python worker',
          where: 'Independent service',
          icon: 'i-chart',
          brief: 'Checks data quality and computes model states.',
          input: 'Accepted calibrated packets, device times and the trial calibration.',
          output:
            'Wheel travel, local pose, corrected gyro, power/energy, charge and consistency results.',
          role: 'One worker owns the trial writer lease. The optional Connect AMR recorder starts a session-bound instance of this path. The always-on HTTP raw archive runs independently.',
          gate: 'A single writer, boot/sequence checks, retained-message rejection and gap handling protect state. Unknown intervals are not filled with invented samples.',
        },
        {
          title: 'Model evidence',
          where: 'Database',
          icon: 'i-database',
          brief: 'Links results to measurements and calibration.',
          input: 'Samples, derived states, quality events and checkpoint updates.',
          output: 'Replayable trial records with calibration fingerprints.',
          role: 'Atomic writes preserve sample/state consistency. A checkpoint allows the worker to recover committed state while marking unobserved downtime as uncertain.',
          gate: 'A changed calibration cannot silently reinterpret an existing trial. Starting a new trial preserves the previous evidence.',
          page: 'database',
          pageLabel: 'Inspect model evidence',
        },
        {
          title: 'Recommendations',
          where: 'Website',
          icon: 'i-chart',
          brief: 'Explains sensor agreement and conditional forecasts.',
          input: 'Current, continuous, calibrated Python results.',
          output: 'Motion-inspection guidance, charge-reserve advice and conditional forecasts.',
          role: 'The gyro–encoder residual flags sustained disagreement. The five-second position forecast assumes unchanged wheel speeds; runtime assumes future load. These are model estimates.',
          gate: 'Stale, incomplete or invalid evidence suppresses estimates. A residual does not diagnose a specific fault, and INA219 voltage alone does not establish SOC.',
          page: 'hardware',
          pageLabel: 'Review sensor models',
        },
        {
          title: 'Human decision',
          where: 'Operator + server',
          icon: 'i-check',
          brief: 'Records a decision and checks its outcome.',
          input: 'A recommendation with its exact sensor context and an operator reason.',
          output: 'An auditable decision with distinct delivery and verification states.',
          role: 'Review & decide captures the evidence, applies server checks and follows request, acknowledgement and sensor verification. Practice uses isolated generated examples.',
          gate: 'An approval is permission for an eligible request; it is not proof of execution. Vision-route arrival uses camera verification in its separate workflow.',
          page: 'hardware',
          pageLabel: 'Open review workspace',
        },
      ],
    },
    power: {
      label: 'Power',
      title: 'One battery, two power branches',
      description:
        'Motor power and ESP32 power split from the 2S battery. All modules share a common ground.',
      handoff:
        'The motor and electronics branches are parallel. TB6612 logic VCC and the sensor logic use the 3.3 V reference; ESP32 VIN/5V receives the verified 5 V buck output.',
      outcome:
        'INA219 currently observes the motor branch. Whole-pack charge and runtime cannot be established by treating that branch current as every load on the battery.',
      nodes: [
        {
          title: '2S lithium battery',
          where: 'On the AMR',
          icon: 'i-box',
          brief: '7.4 V nominal; 8.4 V when fully charged.',
          input: 'The charged two-cell series pack.',
          output: 'Parallel supplies to the motor branch and 5 V buck converter.',
          role: 'The reported capacity is 2,200 mAh and the reported trial starting charge is 100%. These are recorded setup values, rather than a current charge measurement.',
          gate: 'Usable capacity and a verified initial charge remain requirements for quantitative charge/runtime forecasts.',
        },
        {
          title: 'Motor branch',
          where: 'On the AMR',
          icon: 'i-motion',
          brief: 'Battery → INA219 → TB6612 VM → motors.',
          input: 'Battery positive through INA219 VIN+ and VIN−.',
          output: 'Motor supply through TB6612; measured motor-branch voltage/current.',
          role: 'The shunt is in series with the motor supply. TB6612 direction and PWM come from the ESP32; its VM provides motor power.',
          gate: 'Verify actual motor voltage/stall-current ratings, driver limits, current zero/polarity and sensor range.',
        },
        {
          title: 'Electronics branch',
          where: 'On the AMR',
          icon: 'i-robot',
          brief: 'Battery → 5 V buck → ESP32 VIN/5V.',
          input: 'Battery power stepped down by the buck converter.',
          output: 'ESP32 power, with 3.3 V logic supply to compatible peripherals.',
          role: 'The ESP32 reads the encoders, IMU and INA219 and controls TB6612 logic. The buck/ESP32 branch bypasses the motor-branch INA219 measurement.',
          gate: 'Confirm the buck output and actual board power arrangement. Common ground connects the logic, sensors, driver and battery reference.',
        },
      ],
    },
  };

  function initialize() {
    const root = document.getElementById('architecture');
    if (!root || root.dataset.initialized === 'true') return;
    root.dataset.initialized = 'true';
    const el = (id) => document.getElementById('arch-' + id);
    const text = (id, value) => {
      if (el(id).textContent !== String(value)) el(id).textContent = value;
    };
    let mode = 'sensors',
      selected = 0,
      payload = null,
      updatedAt = 0;
    function select(index, focus = false) {
      selected = Math.max(0, Math.min(paths[mode].nodes.length - 1, index));
      const node = paths[mode].nodes[selected];
      root.querySelectorAll('[data-arch-node]').forEach((button, i) => {
        button.setAttribute('aria-pressed', String(i === selected));
        if (focus && i === selected) button.focus();
      });
      for (const key of ['title', 'where', 'input', 'output', 'role', 'gate'])
        text('detail-' + key, node[key]);
      text('step', `Component ${selected + 1} of ${paths[mode].nodes.length}`);
      el('previous').disabled = selected === 0;
      el('next').disabled = selected === paths[mode].nodes.length - 1;
      el('open').hidden = !node.page;
      el('open').textContent = node.pageLabel || '';
      el('open').dataset.target = node.page || '';
    }
    function show(nextMode, focus = false) {
      if (!paths[nextMode]) return;
      mode = nextMode;
      const path = paths[mode];
      root.dataset.path = mode;
      root.querySelectorAll('[data-arch-path]').forEach((button) => {
        const active = button.dataset.archPath === mode;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        if (focus && active) button.focus();
      });
      el('path-panel').setAttribute('aria-labelledby', 'arch-tab-' + mode);
      text('path-title', path.title);
      text('path-description', path.description);
      text('handoff', path.handoff);
      text('outcome', path.outcome);
      const list = el('nodes');
      list.replaceChildren();
      path.nodes.forEach((node, i) => {
        const item = document.createElement('li'),
          button = document.createElement('button');
        button.type = 'button';
        button.dataset.archNode = String(i);
        button.setAttribute('aria-controls', 'arch-inspector');
        button.innerHTML = `<span class="arch-node-top"><svg class="icon" aria-hidden="true"><use href="#${node.icon}"/></svg><span>${node.where}</span></span><strong>${node.title}</strong><span class="arch-node-brief">${node.brief}</span><span class="arch-node-action">Explore component</span>`;
        button.addEventListener('click', () => {
          select(i);
          el('inspector').scrollIntoView?.({ block: 'nearest' });
        });
        item.append(button);
        list.append(item);
      });
      select(0);
    }
    root.querySelectorAll('[data-arch-path]').forEach((button, i, buttons) => {
      button.addEventListener('click', () => show(button.dataset.archPath));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (i + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        show(buttons[next].dataset.archPath, true);
      });
    });
    el('previous').addEventListener('click', () => select(selected - 1));
    el('next').addEventListener('click', () => select(selected + 1));
    el('open').addEventListener('click', () => {
      const target = el('open').dataset.target;
      if (['hardware', 'vision', 'database'].includes(target))
        document.querySelector(`[data-page="${target}"]`)?.click();
    });
    const badge = (id, label, state) => {
      text(id, label);
      if (el(id).dataset.state !== state) el(id).dataset.state = state;
    };
    function status() {
      // Streamlit may memoize identical reports. Preserve known blockers while
      // positive evidence expires below using its own measurement clock.
      if (!payload) {
        badge('raw-status', 'Awaiting server update', 'unknown');
        badge('model-status', 'Awaiting server update', 'unknown');
        badge('route-status', 'Awaiting server update', 'unknown');
        return;
      }
      const physical = payload.mode === 'live' ? payload.physical_telemetry : null;
      const age = Date.now() - Date.parse(physical?.received_at);
      if (physical?.fresh === true && physical.state === 'receiving' && age >= -1000 && age <= 5000)
        badge('raw-status', 'Fresh measurements available', 'good');
      else
        badge(
          'raw-status',
          payload.mode === 'demo'
            ? 'Physical source not selected'
            : physical?.fresh === true
              ? 'Waiting for fresh measurements'
              : physical?.label || 'Awaiting physical records',
          'pending',
        );
      const model = payload.mode === 'live' ? payload.robots?.amr01 : null;
      const modelAge =
        typeof model?.age_s === 'number' ? model.age_s + (Date.now() - updatedAt) / 1000 : Infinity;
      const modelReady =
        model?.quality === 'OK' &&
        !model.stale &&
        !model.continuity_lost &&
        model.derived &&
        modelAge >= -1 &&
        modelAge <= 2;
      badge(
        'model-status',
        modelReady ? 'Valid calibrated outputs' : 'Calibration / valid inputs required',
        modelReady ? 'good' : 'pending',
      );
      const route = payload.vision_execution,
        scene = route?.scene,
        now = Date.now();
      const ready =
        payload.mode === 'live' &&
        route?.authorized &&
        route.available &&
        route.physical_mode &&
        route.ready &&
        scene?.valid &&
        scene.floor_width_mm === 425 &&
        scene.floor_length_mm === 630 &&
        typeof scene.captured_at_ms === 'number' &&
        now - scene.captured_at_ms <= 500 &&
        now >= scene.captured_at_ms - 100 &&
        scene.hardware?.ready &&
        typeof scene.hardware.age_ms === 'number' &&
        scene.hardware.age_ms <= 500;
      badge(
        'route-status',
        ready
          ? 'Server reports route readiness'
          : route?.can_unlock
            ? 'Open Vision routing to check readiness'
            : 'Physical commissioning required',
        ready ? 'good' : 'pending',
      );
    }
    document.addEventListener('python-twin:render', (event) => {
      payload = event.detail;
      updatedAt = Date.now();
      status();
    });
    setInterval(status, 1000);
    show('sensors');
    status();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
