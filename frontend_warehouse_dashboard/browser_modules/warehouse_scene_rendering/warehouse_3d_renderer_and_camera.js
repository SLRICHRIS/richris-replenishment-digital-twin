import * as T from '../../external_browser_libraries/threejs_3d_rendering/threejs_3d_rendering_module.min.js';
import { RoomEnvironment } from '../../external_browser_libraries/threejs_3d_rendering/threejs_room_environment_lighting.js';
import {
  createWarehouse,
  worldPosition,
} from './build_warehouse_racks_cartons_and_robot_models.js';
import { CanvasTwinScene } from './warehouse_2d_canvas_fallback_renderer.js';
import { projectMotion } from '../robot_mission_simulation/virtual_mission_scheduling_and_robot_motion.js';
import { STORAGE_RACKS } from '../warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';

export function projectedRobot(r, state) {
  if (state.live) return r.tracked && r.futurePose ? { ...r, ...r.futurePose } : null;
  if (
    !r.route.length ||
    state.stopped ||
    r.state === 'Paused' ||
    r.state === 'Stopped' ||
    !state.running ||
    r.battery <= 0
  )
    return null;
  return { ...r, ...projectMotion(r, 5, state.slow) };
}
export function animateWarehouse(
  model,
  state,
  dt,
  time,
  layers = { routes: true, sensors: false, ghosts: false, grid: true },
) {
  model.syncStock(state.bins);
  model.grid.visible = layers.grid;
  if (model.network) model.network.visible = !state.live && layers.routes;
  if (model.network) {
    const blocked = state.routing?.blockedEdges || [],
      signature = blocked.join('/');
    if (model.network.userData.availability !== signature) {
      const colors = model.network.geometry.getAttribute('color');
      model.network.userData.edgeKeys.forEach((key, i) => {
        const color = new T.Color(blocked.includes(key) ? '#f08075' : '#7aa7bb');
        color.toArray(colors.array, i * 6);
        color.toArray(colors.array, i * 6 + 3);
      });
      colors.needsUpdate = true;
      model.network.userData.availability = signature;
    }
  }
  state.robots.forEach((r, i) => {
    const o = model.robots[i],
      p = worldPosition(r.x, r.y);
    o.assembly.visible = !state.live || r.tracked;
    o.shadow.visible = o.assembly.visible;
    if (!o.assembly.visible) {
      o.ring.visible = o.route.visible = o.sensor.visible = o.ghost.visible = false;
      if (o.destination) o.destination.visible = false;
      model.dockLights[i].material.emissiveIntensity = 0.1;
      return;
    }
    o.assembly.position.copy(p);
    if (state.live) o.assembly.rotation.y = -(r.heading || 0);
    const heading = -(r.heading || 0);
    let delta = Math.atan2(
      Math.sin(heading - o.assembly.rotation.y),
      Math.cos(heading - o.assembly.rotation.y),
    );
    if (state.running && !state.stopped && !['Paused', 'Stopped'].includes(r.state))
      o.assembly.rotation.y += delta * (1 - Math.exp(-12 * Math.max(dt, 0.001)));
    o.wheels.forEach((w) => (w.rotation.z = -(r.distance / 75) / 0.086));
    if (state.running && !state.stopped && r.state !== 'Stopped') o.lidar.rotation.y += dt * 3;
    o.payload.visible = !state.live && r.task !== null;
    const led = ['Stopped', 'Fault'].includes(r.state)
      ? '#ff6b50'
      : r.state === 'Paused' || (r.battery !== null && r.battery < 15)
        ? '#efb04d'
        : o.color;
    o.ledMat.color.set(led);
    o.ledMat.emissive.set(led);
    o.shadow.position.set(p.x, 0.014, p.z);
    o.shadow.rotation.z = -o.assembly.rotation.y;
    o.ring.position.set(p.x, 0.023, p.z);
    o.ring.visible = i === state.selected;
    const dock = model.dockLights[i];
    dock.material.emissiveIntensity = state.live
      ? 0.1
      : r.state === 'Idle' && r.x < 150
        ? 1.8
        : 0.35;
    o.route.visible = !state.live && layers.routes && r.route.length > 0;
    o.route.material.opacity = i === state.selected ? 0.95 : 0.48;
    if (o.destination) {
      o.destination.visible = o.route.visible;
      if (o.destination.visible) {
        const end = r.route.at(-1);
        o.destination.position.copy(worldPosition(end.x, end.y)).y = 0.034;
        o.destination.scale.setScalar(i === state.selected ? 1.15 : 0.85);
      }
    }
    if (o.route.visible) {
      const points = [
        new T.Vector3(p.x, 0.027, p.z),
        ...r.route.map((q) => worldPosition(q.x, q.y).setY(0.027)),
      ];
      if (o.route.geometry.getAttribute('position')?.count !== points.length) {
        o.route.geometry.dispose();
        o.route.geometry = new T.BufferGeometry().setFromPoints(points);
      } else o.route.geometry.setFromPoints(points);
      o.route.computeLineDistances();
      o.route.geometry.computeBoundingSphere();
    }
    o.sensor.position.set(p.x, 0.028, p.z);
    o.sensor.rotation.set(-Math.PI / 2, o.assembly.rotation.y, 0, 'YXZ');
    o.sensor.visible = !state.live && layers.sensors;
    const ghost = layers.ghosts ? projectedRobot(r, state) : null;
    o.ghost.visible = !!ghost;
    if (ghost) {
      o.ghost.position.copy(worldPosition(ghost.x, ghost.y)).y = 0.18;
      o.ghost.rotation.y = -(ghost.heading || 0);
    }
  });
  model.root.updateMatrixWorld(true);
}
export function cameraFrame(camera, width, height, follow = false, preset = 'iso') {
  const yaw = camera.yaw,
    e = camera.elevation,
    aspect = width / height,
    fov = 39;
  const blend = typeof follow === 'number' ? Math.max(0, Math.min(1, follow)) : follow ? 1 : 0;
  const target = worldPosition(camera.x, camera.y).setY(0.68 - 0.41 * blend);
  const right = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
    up = new T.Vector3(-Math.sin(yaw) * Math.sin(e), Math.cos(e), -Math.cos(yaw) * Math.sin(e)),
    toward = new T.Vector3(Math.sin(yaw) * Math.cos(e), Math.sin(e), Math.cos(yaw) * Math.cos(e));
  const tangent = Math.tan((fov * Math.PI) / 360);
  let base = 1;
  for (const x of [-7.55, 7.55])
    for (const z of [-4.8, 4.8])
      for (const y of [0, 3.75]) {
        const q = new T.Vector3(x, y, z).sub(target);
        base = Math.max(
          base,
          q.dot(toward) + Math.abs(q.dot(right)) / (tangent * aspect * 0.89),
          q.dot(toward) + Math.abs(q.dot(up)) / (tangent * 0.81),
        );
      }
  const distance = (base * (1 - blend) + 3.9 * 1.7 * blend) / camera.zoom;
  const position = target
    .clone()
    .add(
      new T.Vector3(
        Math.sin(yaw) * Math.cos(e),
        Math.sin(e),
        Math.cos(yaw) * Math.cos(e),
      ).multiplyScalar(distance),
    );
  return {
    target,
    position,
    fov,
    aspect,
    distance,
    orthoHeight: Math.max(10.8, 16.7 / aspect) / camera.zoom,
  };
}
export class WebGLTwinScene {
  constructor(canvas, onSelect, onCamera) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.onCamera = onCamera;
    this.camera = { yaw: -0.56, elevation: 0.76, zoom: 1.06, x: 450, y: 250 };
    this.layers = { routes: false, sensors: false, ghosts: false, grid: false, facility: true };
    this.width = 800;
    this.height = 650;
    this.follow = false;
    this.followBlend = 0;
    this.autoOrbit = false;
    this.transition = null;
    this.lastDraw = 0;
    this.preset = 'iso';
    this.pointers = new Map();
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
    this.rendererKind = 'WebGL 3D';
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.world = new T.Scene();
    this.world.background = new T.Color('#0c161f');
    this.world.fog = new T.Fog('#0c161f', 30, 75);
    this.model = createWarehouse();
    this.world.add(this.model.root);
    this.perspective = new T.PerspectiveCamera(39, 1, 0.07, 140);
    this.orthographic = new T.OrthographicCamera(-8, 8, 5, -5, 0.05, 140);
    this.activeCamera = this.perspective;
    this.world.add(new T.HemisphereLight('#e5edf7', '#303a45', 1.25));
    this.sun = new T.DirectionalLight('#fff1dc', 2.85);
    this.sun.position.set(-3, 10, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    Object.assign(this.sun.shadow.camera, {
      left: -9,
      right: 9,
      top: 7,
      bottom: -7,
      near: 0.3,
      far: 35,
    });
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 2;
    this.world.add(this.sun);
    this.world.add(this.sun.target);
    const fill = new T.DirectionalLight('#bdd9fc', 1.05);
    fill.position.set(7, 5, -5);
    this.world.add(fill);
    const room = new RoomEnvironment(),
      pmrem = new T.PMREMGenerator(this.renderer);
    this.envTarget = pmrem.fromScene(room, 0.035);
    this.world.environment = this.envTarget.texture;
    this.world.environmentIntensity = 0.68;
    room.dispose();
    pmrem.dispose();
    const ground = new T.Mesh(
      new T.PlaneGeometry(100, 100),
      new T.MeshStandardMaterial({ color: '#14232e', roughness: 0.96, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.242;
    ground.receiveShadow = true;
    this.world.add(ground);
    this.ground = ground;
    this.raycaster = new T.Raycaster();
    this.bind();
    this.makeLabels();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      window.dispatchEvent(new Event('twin-renderer-lost'));
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
    });
  }
  setTheme(theme) {
    this.theme = theme === 'bright' ? 'bright' : 'dark';
    const bright = this.theme === 'bright',
      background = bright ? '#e7ebe8' : '#202b30';
    this.world.background.set(background);
    this.world.fog.color.set(background);
    this.ground.material.color.set(bright ? '#c4cdc8' : '#303b3f');
  }
  makeLabels() {
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'world-labels';
    this.labelLayer.setAttribute('aria-hidden', 'true');
    this.canvas.parentElement.append(this.labelLayer);
    this.rackLabels = STORAGE_RACKS.map((rack) => {
      const el = document.createElement('div');
      el.className = 'world-label rack-world-label';
      el.dataset.rackId = rack.id;
      el.dataset.kind = rack.binId ? 'active' : 'reserve';
      this.labelLayer.append(el);
      return el;
    });
    this.robotLabel = document.createElement('div');
    this.robotLabel.className = 'world-label robot-world-label';
    this.labelLayer.append(this.robotLabel);
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.width = r.width;
    this.height = r.height;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, r.width < 650 ? 1.5 : 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(r.width, r.height, false);
    const size = r.width < 650 ? 1024 : 1536;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }
  cameraChanged(preset) {
    this.preset = preset;
    this.onCamera?.(preset, this.camera);
  }
  zoomBy(f, smooth = false) {
    const zoom = Math.max(
        0.65,
        Math.min(
          2.8,
          (smooth ? (this.transition?.to?.zoom ?? this.camera.zoom) : this.camera.zoom) * f,
        ),
      ),
      preset = !smooth && this.transition?.to?.elevation !== undefined ? 'custom' : this.preset;
    if (smooth && !this.reducedMotion)
      this.transition = {
        from: { ...this.camera },
        to: { ...this.transition?.to, zoom },
        start: performance.now(),
        duration: 240,
      };
    else {
      this.transition = null;
      this.camera.zoom = zoom;
    }
    this.cameraChanged(preset);
  }
  setView(name) {
    const from = { ...this.camera };
    this.follow = false;
    this.autoOrbit = false;
    const to = { ...this.camera, x: 450, y: 250, zoom: 1.06 };
    if (name === 'top') {
      to.yaw = 0;
      to.elevation = Math.PI / 2 - 0.003;
    } else if (name === 'close') {
      to.yaw = -0.74;
      to.elevation = 0.35;
      to.zoom = 1.05;
    } else {
      to.yaw = this.width < 500 ? -1.04 : -0.56;
      to.elevation = this.width < 500 ? 0.84 : 0.7;
    }
    if (this.reducedMotion) {
      Object.assign(this.camera, to);
      this.transition = null;
    } else this.transition = { from, to, start: performance.now(), duration: 680 };
    this.cameraChanged(name);
  }
  focus() {
    this.autoOrbit = false;
    this.follow = true;
    const to = { zoom: 1.7, elevation: 0.46 };
    if (this.reducedMotion) {
      Object.assign(this.camera, to);
      this.transition = null;
      this.followBlend = 1;
    } else
      this.transition = { from: { ...this.camera }, to, start: performance.now(), duration: 650 };
    this.cameraChanged('focus');
  }
  pointerDistance() {
    const p = [...this.pointers.values()];
    return p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
  }
  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragged = false;
      this.startPoint = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) this.pinch = this.pointerDistance();
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      this.transition = null;
      this.autoOrbit = false;
      const dx = e.clientX - prev.x,
        dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (Math.hypot(e.clientX - this.startPoint.x, e.clientY - this.startPoint.y) > 4)
        this.dragged = true;
      if (this.pointers.size === 2) {
        const d = this.pointerDistance();
        if (this.pinch) this.zoomBy(d / this.pinch);
        this.pinch = d;
        this.dragged = true;
      } else {
        this.camera.yaw -= dx * 0.006;
        this.camera.elevation = Math.max(0.2, Math.min(1.565, this.camera.elevation + dy * 0.005));
        this.cameraChanged(this.follow ? 'focus' : 'custom');
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (!this.dragged && this.pointers.size === 1) {
        const r = c.getBoundingClientRect();
        this.raycaster.setFromCamera(
          new T.Vector2(
            ((e.clientX - r.left) / r.width) * 2 - 1,
            (-(e.clientY - r.top) / r.height) * 2 + 1,
          ),
          this.activeCamera,
        );
        const hits = this.raycaster.intersectObjects(
          this.model.robots.filter((o) => o.assembly.visible).map((o) => o.assembly),
          true,
        );
        if (hits.length) this.onSelect(hits[0].object.userData.robotId);
      }
      this.pointers.delete(e.pointerId);
      this.pinch = null;
    });
    c.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(Math.exp(-e.deltaY * 0.0012));
      },
      { passive: false },
    );
    c.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0'].includes(e.key))
        return;
      e.preventDefault();
      this.transition = null;
      this.autoOrbit = false;
      if (e.key === 'ArrowLeft') this.camera.yaw -= 0.12;
      if (e.key === 'ArrowRight') this.camera.yaw += 0.12;
      if (e.key === 'ArrowUp') this.camera.elevation = Math.min(1.565, this.camera.elevation + 0.1);
      if (e.key === 'ArrowDown') this.camera.elevation = Math.max(0.2, this.camera.elevation - 0.1);
      if (e.key === '+' || e.key === '=') this.zoomBy(1.12);
      if (e.key === '-') this.zoomBy(1 / 1.12);
      if (e.key === '0') this.setView('iso');
      else this.cameraChanged(this.follow ? 'focus' : 'custom');
    });
  }
  placeLabel(el, p, text) {
    const q = p.clone().project(this.activeCamera);
    const x = (q.x * 0.5 + 0.5) * this.width,
      y = (-q.y * 0.5 + 0.5) * this.height,
      half = el === this.robotLabel ? (this.width < 650 ? 78 : 88) : this.width < 650 ? 20 : 34;
    const visible =
      q.z > -1 && q.z < 1 && x > 0 && x < this.width && y > 52 && y < this.height - 55;
    el.hidden = !visible;
    if (!visible) return;
    if (text !== null) el.textContent = text;
    const placedX = Math.max(half + 8, Math.min(this.width - half - 8, x));
    el.style.transform = `translate(${placedX}px,${y}px) translate(-50%,-100%)`;
  }
  updateRackLabels(state) {
    STORAGE_RACKS.forEach((rack, i) => {
      const el = this.rackLabels[i],
        bin = rack.binId ? state.bins.find((b) => b.id === rack.binId) : null;
      const hasStock = bin && (!state.live || bin.measured) && Number.isFinite(bin.stock);
      const detail = rack.binId
        ? 'Bin ' + rack.binId + (hasStock ? ' · ' + Math.floor(bin.stock) : ' · —')
        : 'Reserve';
      const html = /* HTML */ `
        <strong class="world-rack-id">${rack.id}</strong>
        <small class="world-rack-detail">${detail}</small>
      `;
      if (el.innerHTML !== html) el.innerHTML = html;
      el.title =
        rack.id +
        ' / ' +
        rack.address +
        ' / ' +
        (rack.binId ? 'Replenishment station ' + rack.binId : 'Reserve storage');
      el.classList.toggle('low', !!hasStock && bin.stock < 35);
      this.placeLabel(el, worldPosition(rack.x, rack.y).setY(2.43), null);
      if (this.follow) el.hidden = true;
    });
  }
  draw(state, time) {
    if (!state?.robots || this.contextLost) return;
    const dt = Math.min(0.1, Math.max(0, (time - this.lastDraw) / 1000));
    this.lastDraw = time;
    if (this.transition) {
      const tr = this.transition,
        u = Math.max(0, Math.min(1, (time - tr.start) / tr.duration)),
        eased = 1 - Math.pow(1 - u, 3);
      for (const k of Object.keys(tr.to))
        this.camera[k] = tr.from[k] + (tr.to[k] - tr.from[k]) * eased;
      if (u === 1) this.transition = null;
      this.onCamera?.(this.preset, this.camera);
    }
    if (this.autoOrbit) {
      this.camera.yaw += dt * 0.075;
      this.onCamera?.('custom', this.camera);
    }
    if (this.follow && (!state.live || state.robots[state.selected].tracked)) {
      const r = state.robots[state.selected],
        a = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
      this.camera.x += (r.x - this.camera.x) * a;
      this.camera.y += (r.y - this.camera.y) * a;
    }
    animateWarehouse(this.model, state, dt, time, this.layers);
    this.followBlend = this.reducedMotion
      ? this.follow
        ? 1
        : 0
      : this.followBlend + ((this.follow ? 1 : 0) - this.followBlend) * (1 - Math.exp(-dt * 8));
    const f = cameraFrame(this.camera, this.width, this.height, this.followBlend, this.preset),
      top =
        this.preset === 'top' &&
        (!this.transition || Object.keys(this.transition.to).every((key) => key === 'zoom'));
    this.activeCamera = top ? this.orthographic : this.perspective;
    if (top) {
      this.orthographic.left = (-f.orthoHeight * f.aspect) / 2;
      this.orthographic.right = -this.orthographic.left;
      this.orthographic.top = f.orthoHeight / 2;
      this.orthographic.bottom = -this.orthographic.top;
    } else {
      this.perspective.aspect = f.aspect;
    }
    this.activeCamera.position.copy(f.position);
    this.activeCamera.lookAt(f.target);
    this.activeCamera.updateProjectionMatrix();
    this.activeCamera.updateMatrixWorld();
    const facility = this.layers.facility !== false;
    this.model.walls.forEach(
      (w) =>
        (w.group.visible =
          facility && !top && (w.side === 'back' ? f.position.z > -2.8 : f.position.x < 6)),
    );
    if (this.model.industrial) {
      const environment = this.model.industrial;
      environment.equipment.visible = facility;
      environment.structure.visible = facility && !top;
      environment.overhead.visible = facility && !top && !this.follow;
    }
    this.renderer.render(this.world, this.activeCamera);
    this.labelLayer.classList.toggle('compact', this.width < 650);
    this.updateRackLabels(state);
    const r = state.robots[state.selected],
      html = /* HTML */ `
        <span class="world-unit-id">AMR-0${r.id + 1}</span>
        <span class="world-unit-state">${r.state}</span>
      `;
    if (this.robotLabel.innerHTML !== html) this.robotLabel.innerHTML = html;
    this.robotLabel.dataset.state = r.state;
    this.placeLabel(this.robotLabel, worldPosition(r.x, r.y).setY(0.72), null);
    this.robotLabel.style.borderColor = r.color;
    if (state.live && !r.tracked) this.robotLabel.hidden = true;
  }
}
export class TwinScene {
  constructor(canvas, onSelect, onCamera) {
    try {
      return new WebGLTwinScene(canvas, onSelect, onCamera);
    } catch (error) {
      console.warn('3D rendering unavailable; using compatibility view.', error);
      const replacement = canvas.cloneNode(false);
      canvas.replaceWith(replacement);
      const scene = new CanvasTwinScene(replacement, onSelect, onCamera);
      scene.rendererKind = 'Compatibility view';
      const notice = document.createElement('div');
      notice.className = 'compatibility-notice';
      notice.textContent = 'Compatibility view: detailed 3D needs WebGL 2.';
      replacement.parentElement.append(notice);
      return scene;
    }
  }
}
