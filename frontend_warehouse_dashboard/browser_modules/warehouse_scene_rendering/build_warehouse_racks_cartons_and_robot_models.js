import {
  STORAGE_RACKS,
  BIN_DESTINATIONS,
  referenceRouteGraph,
  paintLanePlan,
} from '../warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';
import { createIndustrialEnvironment } from './build_industrial_hall_and_equipment.js';
import { routeEdgeKey } from '../shortest_path_and_route_map/warehouse_graph_validation_and_dijkstra_routing.js';
import * as T from '../../external_browser_libraries/threejs_3d_rendering/threejs_3d_rendering_module.min.js';
import { RoundedBoxGeometry } from '../../external_browser_libraries/threejs_3d_rendering/threejs_rounded_box_geometry.js';
import { mergeGeometries } from '../../external_browser_libraries/threejs_3d_rendering/threejs_mesh_geometry_utilities.js';

export const WORLD_SCALE = 75;
export const worldPosition = (x, y) => new T.Vector3((x - 450) / 75, 0, (y - 250) / 75);
const geometryCache = new Map();
const signMaterials = new WeakMap();
const seeded =
  (seed = 7) =>
  () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
function texture(w, h, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  paint(ctx, w, h);
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function boxGeo(w, h, d, r = 0) {
  const key = [w, h, d, r].join('/');
  if (!geometryCache.has(key))
    geometryCache.set(
      key,
      r
        ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 3, h / 3, d / 3))
        : new T.BoxGeometry(w, h, d),
    );
  return geometryCache.get(key);
}
function box(parent, mat, x, y, z, w, h, d, r = 0) {
  const m = new T.Mesh(boxGeo(w, h, d, r), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cylinder(parent, mat, x, y, z, r, h, segments = 20) {
  const m = new T.Mesh(new T.CylinderGeometry(r, r, h, segments), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function beam(parent, mat, a, b, width = 0.035, depth = 0.035) {
  const d = new T.Vector3().subVectors(b, a);
  const m = box(
    parent,
    mat,
    ...new T.Vector3().addVectors(a, b).multiplyScalar(0.5).toArray(),
    width,
    d.length(),
    depth,
  );
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
  return m;
}
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inverse = new T.Matrix4().copy(group.matrixWorld).invert(),
    byMaterial = new Map();
  group.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || o.isInstancedMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(g);
  });
  group.clear();
  for (const [material, geos] of byMaterial) {
    const geometry = mergeGeometries(geos, false);
    if (!geometry) throw new Error('Static geometry merge failed');
    const m = new T.Mesh(geometry, material);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    geos.forEach((g) => g.dispose());
  }
}
function labelTexture(text, sub = '', bg = '#eef1f3', fg = '#28313d') {
  return texture(512, 192, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 512, 192);
    c.fillStyle = fg;
    c.font = 'bold 55px "IBM Plex Sans", sans-serif';
    c.fillText(text, 30, 76);
    c.font = '23px "IBM Plex Mono", monospace';
    c.fillText(sub, 31, 122);
    const rng = seeded(25);
    let x = 31;
    while (x < 310) {
      const w = 2 + Math.floor(rng() * 6);
      c.fillRect(x, 146, w, 28);
      x += w + 2 + Math.floor(rng() * 4);
    }
  });
}
function sign(parent, map, x, y, z, w, h, rotation = 0) {
  if (!signMaterials.has(map))
    signMaterials.set(
      map,
      new T.MeshStandardMaterial({ map, roughness: 0.8, metalness: 0, side: T.DoubleSide }),
    );
  const p = new T.Mesh(new T.PlaneGeometry(w, h), signMaterials.get(map));
  p.position.set(x, y, z);
  p.rotation.y = rotation;
  parent.add(p);
  return p;
}
export function createWarehouse() {
  const root = new T.Group();
  root.name = 'WH-01 industrial replenishment cell';
  const staticRoot = new T.Group();
  root.add(staticRoot);
  const rng = seeded(42);
  const mat = (color, roughness = 0.55, metalness = 0.1, other = {}) =>
    new T.MeshStandardMaterial({ color, roughness, metalness, ...other });
  const concreteMap = texture(1536, 968, (c, w, h) => {
    const data = c.createImageData(w, h);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = 172 + (rng() - 0.5) * 17;
      data.data[i] = v;
      data.data[i + 1] = v + 2;
      data.data[i + 2] = v - 3;
      data.data[i + 3] = 255;
    }
    c.putImageData(data, 0, 0);
    c.globalAlpha = 0.04;
    for (let i = 0; i < 3200; i++) {
      c.fillStyle = rng() > 0.5 ? '#ffffff' : '#394239';
      c.beginPath();
      c.ellipse(rng() * w, rng() * h, 1 + rng() * 16, 1 + rng() * 5, rng() * 3, 0, 7);
      c.fill();
    }
    c.globalAlpha = 1;
    c.save();
    c.scale(w / 1110, h / 700);
    c.translate(105, 100);
    c.strokeStyle = '#8a9289';
    c.lineWidth = 0.65;
    for (let x = -105; x <= 1005; x += 150) {
      c.beginPath();
      c.moveTo(x, -100);
      c.lineTo(x, 600);
      c.stroke();
    }
    for (let y = -100; y <= 600; y += 125) {
      c.beginPath();
      c.moveTo(-105, y);
      c.lineTo(1005, y);
      c.stroke();
    }
    paintLanePlan(c);
    c.restore();
  });
  const reliefRng = seeded(193);
  const concreteRelief = texture(512, 288, (c, w, h) => {
    const data = c.createImageData(w, h);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = 174 + reliefRng() * 36;
      data.data[i] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
    c.putImageData(data, 0, 0);
    c.globalAlpha = 0.06;
    c.strokeStyle = '#505050';
    c.lineWidth = 3;
    for (let i = 0; i < 26; i++) {
      const x = reliefRng() * w,
        y = reliefRng() * h;
      c.beginPath();
      c.moveTo(x, y);
      c.bezierCurveTo(x + 25, y + 4, x + 48, y - 9, x + 85, y + 8);
      c.stroke();
    }
    c.globalAlpha = 1;
  });
  concreteRelief.colorSpace = T.NoColorSpace;
  const cartonMap = texture(256, 256, (c, w, h) => {
    c.fillStyle = '#baa079';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      c.fillStyle = rng() > 0.5 ? '#e1c49525' : '#6a4e3620';
      c.fillRect(rng() * w, rng() * h, 1 + rng() * 5, 1);
    }
    c.strokeStyle = '#755a3970';
    c.lineWidth = 1;
    c.strokeRect(1, 1, 254, 254);
  });
  const woodMap = texture(256, 256, (c) => {
    c.fillStyle = '#9f8158';
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 160; i++) {
      c.strokeStyle = `rgba(62,42,24,${rng() * 0.18})`;
      c.lineWidth = rng() * 2;
      c.beginPath();
      const y = rng() * 256;
      c.moveTo(0, y);
      c.bezierCurveTo(90, y + rng() * 10, 180, y - rng() * 10, 256, y + 3);
      c.stroke();
    }
  });
  const rubberMap = texture(128, 128, (c) => {
    c.fillStyle = '#343837';
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = '#555b56';
    c.lineWidth = 3;
    for (let i = -128; i < 256; i += 13) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i + 128, 128);
      c.stroke();
    }
  });
  const M = {
    floor: mat('#eeeee9', 0.94, 0.055, {
      map: concreteMap,
      bumpMap: concreteRelief,
      bumpScale: 0.005,
      roughnessMap: concreteRelief,
    }),
    slab: mat('#4c565b', 0.74, 0.12),
    steel: mat('#244e75', 0.37, 0.7),
    galvanized: mat('#a2afb8', 0.3, 0.86),
    orange: mat('#cf711f', 0.47, 0.36),
    dark: mat('#192325', 0.72, 0.2),
    wall: mat('#c5cdc7', 0.77, 0.02),
    wood: mat('#ffffff', 0.91, 0, { map: woodMap }),
    box: mat('#ffffff', 0.95, 0, { map: cartonMap, bumpMap: cartonMap, bumpScale: 0.004 }),
    tape: mat('#bea674', 0.31, 0.01),
    rubber: mat('#292e2c', 0.87, 0, { bumpMap: rubberMap, bumpScale: 0.003 }),
    body: new T.MeshPhysicalMaterial({
      color: '#d9dfe2',
      roughness: 0.28,
      metalness: 0.34,
      clearcoat: 0.25,
      clearcoatRoughness: 0.38,
    }),
    yellow: mat('#efba42', 0.58, 0.1),
    white: mat('#e5e7dd', 0.42, 0.2),
    glass: mat('#1b343e', 0.13, 0.52),
    light: mat('#ffffff', 0.15, 0, { emissive: '#f2eedc', emissiveIntensity: 2.1 }),
  };
  const slab = box(staticRoot, M.slab, 0, -0.115, 0, 14.8, 0.23, 9.333, 0.018);
  const floor = new T.Mesh(new T.PlaneGeometry(14.8, 9.333, 28, 16), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.006;
  floor.receiveShadow = true;
  root.add(floor);
  // Soft contact shading separates load-bearing objects from the floor.
  const occlusionMap = texture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 12, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,.3)');
    g.addColorStop(0.55, 'rgba(0,0,0,.2)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  const occlusionMaterial = new T.MeshBasicMaterial({
    map: occlusionMap,
    transparent: true,
    depthWrite: false,
    opacity: 0.7,
  });
  const contactPatches = [];
  function contactPatch(x, z, w, d) {
    const mesh = new T.Mesh(new T.PlaneGeometry(w, d), occlusionMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.009, z);
    mesh.renderOrder = 1;
    root.add(mesh);
    contactPatches.push(mesh);
  }
  for (const z of [-4.66, 4.66]) box(staticRoot, M.dark, 0, -0.185, z, 14.8, 0.027, 0.021, 0.003);
  for (const x of [-7.39, 7.39]) box(staticRoot, M.dark, x, -0.185, 0, 0.021, 0.027, 9.32, 0.003);
  sign(
    staticRoot,
    labelTexture('WH-01', 'REFERENCE FACILITY', '#263340', '#d7e1ec'),
    -5.85,
    -0.106,
    4.672,
    1.32,
    0.12,
  );
  const grid = new T.GridHelper(12, 24, '#8caec9', '#8caec9');
  grid.scale.z = 6.66 / 12;
  grid.position.y = 0.015;
  grid.material.transparent = true;
  grid.material.opacity = 0.06;
  grid.material.depthWrite = false;
  root.add(grid);
  // Powder-coated shelving, cross-braces, mounting feet, shelf bolts and physical bin tags.
  const rackCenters = BIN_DESTINATIONS.map((b) => {
    const r = STORAGE_RACKS.find((r) => r.binId === b.id),
      p = worldPosition(r.x, r.y);
    return [p.x, p.z];
  });
  const allRackCenters = STORAGE_RACKS.map((r) => {
    const p = worldPosition(r.x, r.y);
    return [p.x, p.z];
  });
  const slots = [],
    slotsPerRack = 9;
  const levelTags = [1, 2, 3].map((level) =>
    labelTexture('L0' + level, 'SHELF LEVEL', '#eadfc2', '#374348'),
  );
  STORAGE_RACKS.forEach((definition, rack) => {
    const [x, z] = allRackCenters[rack];
    contactPatch(x, z, 1.86, 0.93);
    const group = new T.Group();
    group.position.set(x, 0, z);
    staticRoot.add(group);
    for (const dx of [-0.765, 0.765])
      for (const dz of [-0.265, 0.265]) {
        box(group, M.steel, dx, 1.08, dz, 0.055, 2.16, 0.055);
        box(group, M.galvanized, dx, 0.022, dz, 0.14, 0.045, 0.15);
        for (let y = 0.22; y < 2.1; y += 0.13)
          box(group, M.dark, dx, y, dz + 0.029, 0.013, 0.022, 0.003);
        box(group, M.yellow, dx, 0.15, dz, 0.115, 0.27, 0.12, 0.008);
      }
    for (const y of [0.19, 0.84, 1.49]) {
      box(group, M.galvanized, 0, y, 0, 1.53, 0.033, 0.53);
      for (const dz of [-0.29, 0.29]) box(group, M.orange, 0, y + 0.027, dz, 1.6, 0.087, 0.04);
    }
    for (const dx of [-0.765, 0.765]) {
      beam(
        group,
        M.galvanized,
        new T.Vector3(dx, 0.24, -0.24),
        new T.Vector3(dx, 0.95, 0.24),
        0.022,
        0.022,
      );
      beam(
        group,
        M.galvanized,
        new T.Vector3(dx, 0.95, 0.24),
        new T.Vector3(dx, 2.06, -0.24),
        0.022,
        0.022,
      );
    }
    const title = definition.address + (definition.binId ? ' / BIN ' + definition.binId : '');
    sign(
      group,
      labelTexture(title, definition.binId ? 'LINE SUPPLY / 100 UNITS' : 'RESERVE STORAGE'),
      0,
      2.02,
      definition.facing * 0.305,
      0.84,
      0.24,
      definition.facing === 1 ? 0 : Math.PI,
    );
    [0.19, 0.84, 1.49].forEach((y, level) =>
      sign(
        group,
        levelTags[level],
        -0.58,
        y + 0.027,
        definition.facing * 0.313,
        0.16,
        0.055,
        definition.facing === 1 ? 0 : Math.PI,
      ),
    );
    for (let level = 0; level < 3; level++)
      for (let col = 0; col < 3; col++)
        slots.push({
          rack,
          x: x - 0.48 + col * 0.48,
          y: 0.223 + level * 0.65,
          z: z + (rng() - 0.5) * 0.01,
          ry: (rng() - 0.5) * 0.03,
        });
  });
  const graph = referenceRouteGraph(),
    lookup = new Map(graph.nodes.map((n) => [n.id, n]));
  const networkGeometry = new T.BufferGeometry().setFromPoints(
    graph.edges.flatMap((e) =>
      [e.from, e.to].map((id) => {
        const n = lookup.get(id);
        return worldPosition(n.x_m * 75, n.y_m * 75).setY(0.022);
      }),
    ),
  );
  networkGeometry.setAttribute(
    'color',
    new T.Float32BufferAttribute(new Float32Array(graph.edges.length * 6), 3),
  );
  const network = new T.LineSegments(
    networkGeometry,
    new T.LineBasicMaterial({
      color: '#ffffff',
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  );
  network.name = 'Reference aisle graph';
  network.userData.edgeKeys = graph.edges.map(routeEdgeKey);
  root.add(network);
  // Nine illustrative carton slots per rack; reserve racks have static decoration.
  const count = STORAGE_RACKS.length * slotsPerRack;
  const cartons = new T.InstancedMesh(boxGeo(0.4, 0.34, 0.48, 0.012), M.box, count),
    tapes = new T.InstancedMesh(boxGeo(0.065, 0.004, 0.482), M.tape, count);
  const printMat = mat('#ffffff', 0.9, 0, { map: labelTexture('STOCK', 'HANDLE WITH CARE') }),
    prints = new T.InstancedMesh(new T.PlaneGeometry(0.22, 0.1), printMat, count);
  for (const m of [cartons, tapes, prints]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    root.add(m);
  }
  const temp = new T.Object3D(),
    lastStock = STORAGE_RACKS.map(() => -1);
  function syncStock(bins) {
    let changed = false;
    STORAGE_RACKS.forEach((definition, i) => {
      const stock = definition.binId
        ? bins.find((b) => b.id === definition.binId)?.stock
        : undefined;
      const n = definition.binId
        ? Math.max(0, Math.min(slotsPerRack, Math.ceil(((stock ?? 0) / 100) * slotsPerRack)))
        : 5 + (i % 3);
      if (lastStock[i] === n) return;
      lastStock[i] = n;
      changed = true;
      for (let j = 0; j < slotsPerRack; j++) {
        const k = i * slotsPerRack + j,
          s = slots[k];
        temp.scale.setScalar(j < n ? 1 : 0.00001);
        temp.rotation.set(0, s.ry, 0);
        temp.position.set(s.x, s.y + 0.17, s.z);
        temp.updateMatrix();
        cartons.setMatrixAt(k, temp.matrix);
        cartons.setColorAt(
          k,
          new T.Color().setRGB(1 - (k % 4) * 0.023, 1 - (k % 4) * 0.021, 1 - (k % 4) * 0.018),
        );
        temp.position.y = s.y + 0.343;
        temp.updateMatrix();
        tapes.setMatrixAt(k, temp.matrix);
        temp.position.set(s.x, s.y + 0.19, s.z + definition.facing * 0.244);
        temp.rotation.y = s.ry + (definition.facing === 1 ? 0 : Math.PI);
        temp.updateMatrix();
        prints.setMatrixAt(k, temp.matrix);
      }
    });
    if (changed)
      for (const m of [cartons, tapes, prints]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.computeBoundingSphere();
      }
  }
  // Three independent chargers with contact pads, status displays, cables and wheel stops.
  const dockLights = [];
  for (let i = 0; i < 3; i++) {
    const p = worldPosition(42, 170 + i * 80);
    const dock = new T.Group();
    dock.position.copy(p);
    staticRoot.add(dock);
    box(dock, M.dark, 0, 0.28, 0, 0.23, 0.56, 0.4, 0.035);
    box(dock, M.galvanized, -0.07, 0.3, 0, 0.1, 0.6, 0.43, 0.017);
    box(dock, M.glass, 0.121, 0.4, 0, 0.009, 0.13, 0.25);
    for (const z of [-0.12, 0.12]) box(dock, M.yellow, 0.14, 0.12, z, 0.025, 0.06, 0.045);
    box(dock, M.dark, 0.25, 0.022, 0, 0.4, 0.045, 0.51, 0.005);
    sign(dock, labelTexture('0' + (i + 1), 'DOCK'), 0.135, 0.53, 0, 0.13, 0.052, Math.PI / 2);
    const light = new T.Mesh(
      new T.BoxGeometry(0.013, 0.015, 0.19),
      new T.MeshStandardMaterial({ color: '#84e2b3', emissive: '#56c893', emissiveIntensity: 1.7 }),
    );
    light.position.copy(p).add(new T.Vector3(0.128, 0.45, 0));
    root.add(light);
    dockLights.push(light);
    const cable = new T.Mesh(
      new T.TubeGeometry(
        new T.CatmullRomCurve3([
          new T.Vector3(-0.09, 0.07, 0.17),
          new T.Vector3(-0.3, 0.06, 0.27),
          new T.Vector3(-0.34, 0.22, 0.32),
          new T.Vector3(-0.19, 0.4, 0.18),
        ]),
        16,
        0.011,
        7,
        false,
      ),
      M.rubber,
    );
    dock.add(cable);
  }
  const industrial = createIndustrialEnvironment({
    root,
    M,
    mat,
    box,
    cylinder,
    beam,
    sign,
    labelTexture,
    mergeStatic,
    worldPosition,
  });
  const walls = industrial.walls;
  mergeStatic(staticRoot);
  // Detailed, rounded AMRs, kept as separate assemblies for telemetry-driven animation.
  const contactTexture = texture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,.46)');
    g.addColorStop(0.5, 'rgba(0,0,0,.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  const robots = [];
  const makeRobot = (index, color) => {
    const assembly = new T.Group();
    assembly.name = 'AMR ' + (index + 1);
    root.add(assembly);
    const body = new T.Group();
    assembly.add(body);
    const ledMat = mat(color, 0.25, 0.25, { emissive: color, emissiveIntensity: 0.65 });
    box(body, M.rubber, 0, 0.125, 0, 0.68, 0.14, 0.51, 0.055);
    box(body, ledMat, 0, 0.195, 0, 0.656, 0.019, 0.496, 0.039);
    box(body, M.body, 0, 0.255, 0, 0.63, 0.12, 0.47, 0.04);
    box(body, M.galvanized, -0.035, 0.321, 0, 0.45, 0.018, 0.41, 0.015);
    for (const z of [-0.224, 0.224]) {
      box(body, M.dark, -0.05, 0.25, z, 0.22, 0.026, 0.006, 0.002);
      for (let i = 0; i < 5; i++)
        box(body, M.galvanized, -0.135 + i * 0.04, 0.25, z * 1.007, 0.008, 0.016, 0.005);
    }
    for (const x of [-0.22, 0.2])
      for (const z of [-0.17, 0.17]) cylinder(body, M.dark, x, 0.334, z, 0.007, 0.008, 8);
    for (const z of [-0.082, 0.082]) {
      const lens = cylinder(body, M.glass, 0.318, 0.268, z, 0.024, 0.012, 24);
      lens.rotation.z = Math.PI / 2;
      const ring = cylinder(body, M.dark, 0.315, 0.268, z, 0.03, 0.008, 24);
      ring.rotation.z = Math.PI / 2;
    }
    box(body, M.glass, 0.319, 0.24, 0, 0.008, 0.025, 0.063, 0.004);
    for (const z of [-0.185, 0.185]) box(body, ledMat, 0.317, 0.26, z, 0.008, 0.028, 0.03, 0.006);
    const lidar = new T.Group();
    lidar.position.set(0.19, 0.333, 0);
    assembly.add(lidar);
    cylinder(lidar, M.dark, 0, 0.019, 0, 0.059, 0.038, 28);
    cylinder(lidar, M.glass, 0, 0.047, 0, 0.055, 0.025, 28);
    cylinder(lidar, ledMat, 0, 0.06, 0, 0.056, 0.004, 28);
    cylinder(lidar, M.galvanized, 0, 0.066, 0, 0.047, 0.009, 28);
    box(lidar, M.dark, 0.027, 0.073, 0, 0.02, 0.006, 0.009, 0.002);
    sign(body, labelTexture('AMR 0' + (index + 1), 'REPLENISH'), -0.035, 0.26, 0.238, 0.185, 0.058);
    const emergency = cylinder(
      body,
      mat('#b7432c', 0.38, 0.1),
      -0.19,
      0.341,
      0.14,
      0.023,
      0.022,
      18,
    );
    cylinder(body, M.yellow, -0.19, 0.327, 0.14, 0.032, 0.007, 18);
    mergeStatic(body);
    mergeStatic(lidar);
    const wheels = [];
    for (const x of [-0.205, 0.195])
      for (const z of [-0.254, 0.254]) {
        const w = new T.Group();
        w.position.set(x, 0.088, z);
        assembly.add(w);
        const tire = cylinder(w, M.rubber, 0, 0, 0, 0.086, 0.049, 28);
        tire.rotation.x = Math.PI / 2;
        const rim = cylinder(w, M.galvanized, 0, 0, 0, 0.048, 0.052, 20);
        rim.rotation.x = Math.PI / 2;
        const hub = cylinder(w, M.dark, 0, 0, 0, 0.014, 0.055, 14);
        hub.rotation.x = Math.PI / 2;
        for (let i = 0; i < 3; i++) {
          const spoke = box(w, M.dark, 0, 0, 0, 0.063, 0.008, 0.056);
          spoke.rotation.z = (i * Math.PI) / 3;
        }
        mergeStatic(w);
        wheels.push(w);
      }
    const payload = new T.Group();
    payload.position.set(-0.065, 0.34, 0);
    assembly.add(payload);
    box(payload, M.box, 0, 0.13, 0, 0.29, 0.26, 0.31, 0.009);
    box(payload, M.tape, 0, 0.262, 0, 0.049, 0.004, 0.312);
    sign(payload, labelTexture('STOCK', '30 UNITS'), 0, 0.13, 0.157, 0.19, 0.07);
    mergeStatic(payload);
    const shadow = new T.Mesh(
      new T.PlaneGeometry(0.93, 0.75),
      new T.MeshBasicMaterial({
        map: contactTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.6,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.014;
    root.add(shadow);
    const ring = new T.Mesh(
      new T.RingGeometry(0.47, 0.48, 64),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.023;
    root.add(ring);
    const ghost = new T.Mesh(
      boxGeo(0.65, 0.3, 0.5, 0.04),
      new T.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    root.add(ghost);
    const route = new T.Line(
      new T.BufferGeometry(),
      new T.LineDashedMaterial({
        color,
        dashSize: 0.13,
        gapSize: 0.09,
        transparent: true,
        opacity: 0.8,
      }),
    );
    root.add(route);
    const destination = new T.Group();
    root.add(destination);
    const endpointMat = new T.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: T.DoubleSide,
    });
    const endpointRing = new T.Mesh(new T.RingGeometry(0.115, 0.135, 40), endpointMat);
    endpointRing.rotation.x = -Math.PI / 2;
    destination.add(endpointRing);
    const endpointCross = new T.Mesh(new T.PlaneGeometry(0.16, 0.018), endpointMat);
    endpointCross.rotation.x = -Math.PI / 2;
    destination.add(endpointCross);
    const endpointCross2 = endpointCross.clone();
    endpointCross2.rotation.z = Math.PI / 2;
    destination.add(endpointCross2);
    destination.visible = false;
    const sector = new T.Shape();
    sector.moveTo(0, 0);
    for (let i = 0; i <= 26; i++) {
      const a = -0.6 + (i / 26) * 1.2;
      sector.lineTo(Math.cos(a) * 1.35, Math.sin(a) * 1.35);
    }
    sector.lineTo(0, 0);
    const sensor = new T.Mesh(
      new T.ShapeGeometry(sector),
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.075,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    sensor.rotation.x = -Math.PI / 2;
    root.add(sensor);
    const robot = {
      assembly,
      wheels,
      lidar,
      payload,
      shadow,
      ring,
      ghost,
      route,
      destination,
      sensor,
      ledMat,
      color,
      index,
    };
    assembly.traverse((o) => {
      if (o.isMesh) o.userData.robotId = index;
    });
    robots.push(robot);
    return robot;
  };
  ['#82b6ff', '#bca2ff', '#efbd68'].forEach((color, i) => makeRobot(i, color));
  root.updateMatrixWorld(true);
  return {
    root,
    robots,
    grid,
    walls,
    floor,
    materials: M,
    contactPatches,
    cartons,
    tapes,
    prints,
    slots,
    dockLights,
    syncStock,
    rackCenters,
    allRackCenters,
    network,
    industrial,
    worldPosition,
  };
}
