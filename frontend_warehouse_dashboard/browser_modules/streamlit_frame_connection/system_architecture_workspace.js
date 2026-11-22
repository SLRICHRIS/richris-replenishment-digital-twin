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
    direct: {
      label: 'Direct control',
      title: 'From a human decision to local Wi-Fi control',
      description:
        'The installed ESP32 page is embedded in the dashboard at 10.55.54.112. The operator applies movement and power changes on the same Wi-Fi network.',
      handoff:
        'Your browser talks directly to the ESP32 over local Wi-Fi. EMQX carries sensor telemetry separately; the cloud server does not relay local motor requests.',
      outcome:
        'A saved observation decision records intent. The operator applies it using the controller or performs the physical task. Later sensor readings record follow-up, not proof that the task was completed.',
      nodes: [
        {
          title: 'Recommendation + decision',
          where: 'Dashboard',
          icon: 'i-check',
          brief: 'Review fresh evidence and record a response.',
          input: 'Sensor findings, supporting readings and the operator reason.',
          output: 'A saved decision with its source evidence and review history.',
          role: 'Nine observation responses cover monitoring, stopping, lower power, battery, motor supply, wheels, IMU and connection checks. Recording a decision does not send a motor command.',
          gate: 'Expired or changed evidence requires a new review. A recorded decision cannot execute later on its own.',
          page: 'hardware',
          pageLabel: 'Open sensor review',
        },
        {
          title: 'Local controller page',
          where: 'Your browser',
          icon: 'i-wifi',
          brief: 'Loads the ESP32 controls after Connect controller.',
          input: 'Your explicit direction hold, Stop or motor-power selection.',
          output: 'Local requests to the ESP32 at 10.55.54.112.',
          role: 'The embedded native page owns its local requests. The laptop and ESP32 must share a Wi-Fi network; a separate-tab fallback uses the same saved address.',
          gate: 'An iframe loading is not a controller acknowledgement. Read the status inside the native page. This architecture guide sends no requests.',
          page: 'vision',
          mode: 'manual',
          pageLabel: 'Open direct Wi-Fi drive',
        },
        {
          title: 'ESP32 + TB6612',
          where: 'On the AMR',
          icon: 'i-robot',
          brief: 'Applies attended local control to the motors.',
          input: 'Local command and motor-power setting.',
          output: 'Reported direction and PWM; physical motor response must be observed.',
          role: 'The installed local controller refreshes a direction hold and expires it 700 ms after its last accepted command. Release, Stop or leaving the control context ends the hold.',
          gate: 'This local path does not inherit the separate cloud receiver’s gyro, low-voltage or PWM gates. Check readings and actual wheel response during an attended trial.',
        },
        {
          title: 'Sensor follow-up',
          where: 'AMR → archive → dashboard',
          icon: 'i-chart',
          brief: 'Compares fresh observations after the recorded decision.',
          input: 'New same-boot sensor packets through the existing telemetry path.',
          output: 'Three later readings in the review record and updated guidance.',
          role: 'The stored stream supplies voltage, motor-branch current, wheel pulses, gyro/acceleration and requested/reported output. Follow-up keeps its timestamps and packet identity.',
          gate: 'The installed local page has no dashboard approval API. These observations cannot certify that an inspection, charge or approved control change occurred.',
          page: 'hardware',
          pageLabel: 'View sensor follow-up',
        },
      ],
    },
    vision: {
      label: 'Vision & movement',
      title: 'ArUco routes: human approval over direct Wi-Fi',
      description:
        'The laptop captures the Logitech camera, calculates the measured robot pose and follows an approved route directly over local Wi-Fi. The camera workspace opens inside the dashboard.',
      handoff:
        'AMR01_LocalTwin sends signed, short-lived HTTP requests to AMR01_Local_Routes at 10.55.54.112. EMQX remains the sensor telemetry path.',
      outcome:
        'When commissioned, route verification requires distinct fresh camera observations and stopped-state evidence. A sent command or controller reply alone is not arrival.',
      nodes: [
        {
          title: 'Logitech webcam',
          where: 'Above the floor',
          icon: 'i-focus',
          brief: 'Views the robot, floor markers and obstacles.',
          input: 'The measured working floor, reference markers and robot marker.',
          output: 'USB camera frames on the laptop.',
          role: 'One overhead camera observes the scene. Use the current measured floor, camera height, marker size and marker height from Camera routes; this guide does not override that configuration.',
          gate: 'Lens calibration, floor references, marker alignment and a validated obstacle scene are required. A placement preview alone does not establish route readiness.',
        },
        {
          title: 'Vision processor',
          where: 'Laptop · local service',
          icon: 'i-map',
          brief: 'Finds the AMR pose and occupied floor regions.',
          input:
            'Logitech frames, measured camera configuration and an empty-floor reference image.',
          output:
            'Fresh signed camera scenes with robot pose, obstacles and configuration identity.',
          role: 'The local ArUco processor reads the Logitech webcam. It locates the marker, corrects for height and mounting offset, and checks floor references and image continuity.',
          gate: 'Camera movement, missing references, obscured robot marker or stale frames invalidate the scene. The Windows Camera app is not required.',
        },
        {
          title: 'Plan + human review',
          where: 'Dashboard + laptop',
          icon: 'i-check',
          brief: 'Proposes a route and asks the operator to decide.',
          input:
            'Measured A, B and E stations, a trusted current scene, selected start/destination and an attended operator session.',
          output: 'An approved, rejected or held route with an audit record and expiry.',
          role: 'The laptop checks the selected start against ArUco and plans with full-body clearance. Obstacle changes stop movement and propose a new path to the active target. Return to start and battery station E each require a new reviewed route.',
          gate: 'At 6.7–7.0 V the operator decides whether to continue or preview a route to E. Below 6.7 V the mission stops. Changed evidence and expired reviews invalidate approval; practice decisions cannot move the robot.',
          page: 'vision',
          mode: 'local',
          pageLabel: 'Open camera routes',
        },
        {
          title: 'Route follower',
          where: 'Laptop · route follower',
          icon: 'i-motion',
          brief: 'Follows the approved path with camera feedback.',
          input: 'The matching approved route and fresh camera and receiver observations.',
          output: 'Signed motor requests over direct Wi-Fi and signed applied-output feedback.',
          role: 'The local route service follows the approved route. It uses current pose to adjust motion and checks destination and stop observations.',
          gate: 'Stop, lost operator presence, stale evidence, a changed obstacle map or path departure ends the movement grant. A replacement route needs a new review.',
        },
        {
          title: 'ESP32 + motors',
          where: 'On the AMR',
          icon: 'i-robot',
          brief: 'Checks each request and drives the TB6612.',
          input: 'Valid bounded drive messages and local protection state.',
          output: 'TB6612 direction/PWM, receiver status and measured motion feedback.',
          role: 'The local-route ESP32 firmware validates HTTP command signatures, boot identity, sequence and expiry. TB6612 supplies the left and right motors. The overhead camera observes the resulting movement.',
          gate: 'Receiver firmware, wheel polarities, PWM-to-speed response, stopping distance and electrical ratings need attended verification. Emergency protection remains local.',
        },
      ],
    },
    models: {
      label: 'Models & review',
      title: 'Calibrated models: additional evidence requirements',
      description:
        'The full Python model pipeline has a separate calibrated input contract. The installed unsigned commissioning feed remains useful for raw observations.',
      handoff:
        'The full-model worker subscribes to robot/amr01/state. Its calibrated signed observations are separate from the commissioning topic and raw archive.',
      outcome:
        'Current observation reviews record a choice and later readings. The separate calibrated intervention contract requires a commissioned transport, matching acknowledgement and new sensor observations before reporting an effect.',
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
          role: 'The active observation review records a choice, then the operator applies it through direct controls or a physical task. Only the separate commissioned model-intervention path follows a delivered request, matching acknowledgement and sensor verification. Practice uses isolated generated examples.',
          gate: 'Recording an observation decision issues no motor command. Even in a commissioned command path, an approval is not proof of execution. Camera-route arrival has separate evidence requirements.',
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
      el('open').dataset.mode = node.mode || '';
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
      if (target === 'vision' && ['local', 'manual', 'physical'].includes(el('open').dataset.mode))
        document.getElementById('vision-mode-' + el('open').dataset.mode)?.click();
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
      const elapsed = Math.max(0, performance.now() - updatedAt) / 1000;
      const age = Number.isFinite(physical?.age_s) ? physical.age_s + elapsed : Infinity;
      if (physical?.fresh === true && physical.state === 'receiving' && age >= -1 && age <= 5)
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
      const modelAge = Number.isFinite(model?.age_s) ? model.age_s + elapsed : Infinity;
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
        Number.isFinite(scene.floor_width_mm) &&
        scene.floor_width_mm > 0 &&
        Number.isFinite(scene.floor_length_mm) &&
        scene.floor_length_mm > 0 &&
        typeof scene.captured_at_ms === 'number' &&
        now - scene.captured_at_ms <= 500 &&
        now >= scene.captured_at_ms - 100 &&
        scene.hardware?.ready &&
        Number.isFinite(scene.hardware.age_ms) &&
        scene.hardware.age_ms >= 0 &&
        scene.hardware.age_ms + elapsed * 1000 <= 500;
      badge(
        'route-status',
        ready
          ? 'Server reports route readiness'
          : route?.can_unlock
            ? 'Open Camera routes to check readiness'
            : 'Physical commissioning required',
        ready ? 'good' : 'pending',
      );
    }
    document.addEventListener('python-twin:render', (event) => {
      payload = event.detail;
      updatedAt = performance.now();
      status();
    });
    const timer = setInterval(status, 500);
    window.addEventListener('pagehide', (event) => {
      if (!event.persisted) clearInterval(timer);
    });
    show('sensors');
    status();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
