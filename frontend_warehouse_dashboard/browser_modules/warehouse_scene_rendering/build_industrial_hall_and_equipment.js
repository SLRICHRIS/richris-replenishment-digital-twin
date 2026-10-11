// Illustrative industrial context. These fixtures are not telemetry-controlled assets.
import * as T from '../../external_browser_libraries/threejs_3d_rendering/threejs_3d_rendering_module.min.js';
import { INDUSTRIAL_FIXTURES } from '../warehouse_reference_geometry/reference_warehouse_racks_aisles_and_route_graph.js';

export function createIndustrialEnvironment({
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
}) {
  const walls = [],
    equipment = new T.Group(),
    structure = new T.Group(),
    overhead = new T.Group(),
    fixtures = [];
  equipment.name = 'Receiving, packing and service equipment';
  structure.name = 'Cutaway building frame';
  overhead.name = 'Overhead services';
  root.add(equipment, structure, overhead);
  const grey = mat('#c3c9c7', 0.62, 0.35),
    door = mat('#8b9694', 0.51, 0.55),
    safety = mat('#bf4236', 0.64, 0.18),
    green = mat('#315b4d', 0.56, 0.22);
  const wall = (side) => {
    const group = new T.Group();
    group.name = side === 'back' ? 'Loading dock wall' : 'Service wall';
    root.add(group);
    walls.push({ group, side });
    return group;
  };
  const back = wall('back'),
    right = wall('right');
  box(back, M.wall, 0, 1.82, -4.59, 14.8, 3.64, 0.12);
  box(back, grey, 0, 0.34, -4.51, 14.6, 0.68, 0.035);
  for (let x = -7.25; x < 7.4; x += 0.24)
    box(back, M.galvanized, x, 1.99, -4.522, 0.009, 3.23, 0.008);
  box(back, M.dark, 0, 3.62, -4.48, 14.72, 0.12, 0.15);
  for (const [x, title, sub] of [
    [-4.75, '01 / RECEIVING', 'INBOUND MATERIAL'],
    [4.67, '02 / DISPATCH', 'FINISHED GOODS'],
  ]) {
    box(back, M.dark, x, 1.23, -4.43, 2.63, 2.48, 0.19);
    box(back, door, x, 1.24, -4.31, 2.32, 2.36, 0.055);
    for (let y = 0.14; y < 2.4; y += 0.105)
      box(back, M.galvanized, x, y, -4.271, 2.3, 0.015, 0.012);
    for (const dx of [-1.25, 1.25]) box(back, M.yellow, x + dx, 0.3, -4.16, 0.12, 0.6, 0.14);
    sign(back, labelTexture(title, sub, '#29383b', '#eef0e7'), x, 2.82, -4.49, 2.05, 0.36);
    box(back, M.dark, x, 0.15, -4.1, 2.24, 0.16, 0.16);
  }
  sign(
    back,
    labelTexture('WH-01', 'MATERIAL FLOW / REPLENISHMENT', '#e5e9e4', '#374549'),
    0,
    3.03,
    -4.51,
    2.7,
    0.42,
  );
  // Exit, extinguisher and hose cabinet sit away from the robot operating envelope.
  box(back, green, -6.5, 1.03, -4.42, 0.73, 2.06, 0.065);
  sign(
    back,
    labelTexture('EXIT', 'KEEP CLEAR', '#2e6b50', '#eff3e8'),
    -6.5,
    2.29,
    -4.39,
    0.73,
    0.23,
  );
  box(back, safety, -1.62, 0.86, -4.36, 0.4, 0.52, 0.18, 0.015);
  sign(
    back,
    labelTexture('FIRE', 'HOSE CABINET', '#b64236', '#f4e9df'),
    -1.62,
    0.89,
    -4.25,
    0.3,
    0.13,
  );
  cylinder(back, safety, -2.08, 0.72, -4.27, 0.066, 0.29, 16);
  cylinder(back, M.dark, -2.08, 0.9, -4.27, 0.025, 0.05, 12);
  box(right, M.wall, 7.33, 1.57, 0, 0.12, 3.14, 9.22);
  box(right, grey, 7.25, 0.34, 0, 0.035, 0.68, 9.1);
  for (let z = -4.45; z < 4.6; z += 0.26)
    box(right, M.galvanized, 7.26, 1.81, z, 0.01, 2.49, 0.009);
  box(right, M.dark, 7.22, 3.14, 0, 0.13, 0.12, 9.1);
  // Switchgear conduits and ventilation remain against the outer service wall.
  for (const z of [-2.8, -1.2, 0.4, 2.0]) {
    box(right, M.dark, 7.2, 2.5, z, 0.025, 0.38, 0.68);
    for (let i = 0; i < 5; i++)
      box(right, M.galvanized, 7.17, 2.35 + i * 0.06, z, 0.02, 0.019, 0.62);
  }
  box(right, M.galvanized, 7.08, 2.97, 0, 0.1, 0.15, 8.8);
  // Bolted I-section columns and a roof-edge truss make the building readable as a hall.
  function column(x, z) {
    box(structure, M.galvanized, x, 0.035, z, 0.3, 0.07, 0.3);
    box(structure, M.steel, x, 1.82, z, 0.055, 3.58, 0.17);
    for (const dx of [-0.075, 0.075]) box(structure, M.steel, x + dx, 1.82, z, 0.045, 3.58, 0.23);
    for (const dx of [-0.11, 0.11])
      for (const dz of [-0.11, 0.11])
        cylinder(structure, M.dark, x + dx, 0.075, z + dz, 0.014, 0.025, 8);
    box(structure, M.yellow, x, 0.28, z, 0.23, 0.48, 0.27);
    for (const y of [0.17, 0.34]) box(structure, M.dark, x, 0.0 + y, z + 0.142, 0.245, 0.06, 0.014);
  }
  for (const x of [-7.15, -3.55, 0, 3.55, 7.15]) column(x, -4.43);
  for (const x of [-7.15, 7.15]) column(x, 4.38);
  for (const z of [-4.43, 4.38]) {
    box(overhead, M.steel, 0, 3.52, z, 14.4, 0.1, 0.12);
    box(overhead, M.steel, 0, 3.17, z, 14.4, 0.07, 0.1);
    for (let x = -7.05; x < 7; x += 0.9)
      beam(
        overhead,
        M.galvanized,
        new T.Vector3(x, 3.19, z),
        new T.Vector3(x + 0.88, 3.5, z),
        0.025,
        0.025,
      );
  }
  // Services are confined to the perimeter to preserve sightlines into the AMR cell.
  for (const x of [-7.02, 7.02]) {
    box(overhead, M.galvanized, x, 3.42, 0, 0.12, 0.13, 8.8);
    for (const z of [-3.4, -1.1, 1.2, 3.45]) {
      box(overhead, M.dark, x, 3.13, z, 0.13, 0.065, 1.4);
      box(overhead, M.light, x, 3.092, z, 0.11, 0.016, 1.25);
    }
  }
  const sprinkler = mat('#aa4439', 0.47, 0.28);
  box(overhead, sprinkler, 0, 3.56, -4.2, 13.9, 0.045, 0.045);
  for (const x of [-5.5, -2.8, 0, 2.8, 5.5]) {
    cylinder(overhead, sprinkler, x, 3.47, -4.2, 0.022, 0.16, 12);
    cylinder(overhead, M.galvanized, x, 3.38, -4.2, 0.034, 0.022, 12);
  }
  // Each fixture is retained as a group for conservative world-space clearance checks.
  for (const definition of INDUSTRIAL_FIXTURES) {
    const g = new T.Group();
    g.name = definition.id;
    g.position.copy(worldPosition(definition.x, definition.y));
    equipment.add(g);
    fixtures.push({ definition, group: g });
    const w = definition.width / 75,
      d = definition.depth / 75,
      h = definition.height / 75;
    if (definition.kind === 'pallet') {
      for (const z of [-d * 0.36, 0, d * 0.36]) box(g, M.wood, 0, 0.048, z, w, 0.096, 0.09);
      for (let i = 0; i < 6; i++)
        box(g, M.wood, -w * 0.41 + i * w * 0.164, 0.112, 0, w * 0.135, 0.035, d);
      const levels = definition.height > 80 ? 3 : 2,
        step = (h - 0.15) / levels;
      for (let level = 0; level < levels; level++)
        for (const x of [-w * 0.23, w * 0.23])
          for (const z of [-d * 0.23, d * 0.23]) {
            box(
              g,
              M.box,
              x,
              0.15 + step * (level + 0.5),
              z,
              w * 0.43,
              step * 0.94,
              d * 0.43,
              0.008,
            );
            box(g, M.tape, x, 0.15 + step * (level + 1), z, 0.045, 0.004, d * 0.43);
          }
      // Narrow bands suggest pallet wrap without adding a large transparent mesh.
      for (const y of [0.26, h * 0.6, h - 0.05])
        for (const z of [-d * 0.47, d * 0.47]) box(g, grey, 0, y, z, w * 0.92, 0.012, 0.006);
      sign(g, labelTexture('WH-01', 'PALLET LOAD'), 0, h * 0.52, d * 0.472, 0.26, 0.12);
    } else if (definition.kind === 'bench') {
      const top = 0.82;
      for (const x of [-w * 0.43, w * 0.43])
        for (const z of [-d * 0.4, d * 0.4]) box(g, M.galvanized, x, top / 2, z, 0.05, top, 0.05);
      box(g, M.dark, 0, 0.18, 0, w * 0.94, 0.06, d * 0.88);
      box(g, grey, 0, top, 0, w, 0.05, d, 0.01);
      box(g, M.dark, -w * 0.28, top + 0.14, -d * 0.27, 0.07, 0.28, 0.07);
      box(g, M.dark, -w * 0.28, top + 0.31, -d * 0.25, 0.43, 0.25, 0.034, 0.009);
      box(g, M.glass, -w * 0.28, top + 0.31, -d * 0.229, 0.38, 0.2, 0.009);
      box(g, M.box, w * 0.22, top + 0.14, 0, 0.36, 0.24, 0.36, 0.01);
      box(g, M.tape, w * 0.22, top + 0.262, 0, 0.06, 0.004, 0.36);
      sign(
        g,
        labelTexture(definition.id === 'quality-bench' ? 'QC-01' : 'PACK-01', 'WORKSTATION'),
        0,
        0.58,
        d * 0.501,
        0.42,
        0.15,
      );
      box(g, M.orange, w * 0.31, 0.29, 0, 0.28, 0.36, d * 0.7, 0.01);
    } else if (definition.kind === 'conveyor') {
      for (const x of [-w * 0.42, w * 0.42])
        for (const z of [-d * 0.38, d * 0.38]) box(g, M.galvanized, x, 0.36, z, 0.045, 0.72, 0.045);
      for (const z of [-d * 0.46, d * 0.46]) box(g, M.dark, 0, 0.75, z, w, 0.11, 0.048);
      for (let i = 0; i < 15; i++) {
        const roller = cylinder(
          g,
          M.galvanized,
          -w * 0.45 + (i * w * 0.9) / 14,
          0.75,
          0,
          0.038,
          d * 0.83,
          14,
        );
        roller.rotation.x = Math.PI / 2;
      }
      box(g, M.box, w * 0.1, 0.95, 0, 0.4, 0.34, 0.36, 0.008);
      box(g, M.tape, w * 0.1, 1.123, 0, 0.055, 0.004, 0.36);
      box(g, M.yellow, -w * 0.42, 0.76, d * 0.51, 0.12, 0.13, 0.06);
      sign(g, labelTexture('PACKING', 'ROLLER TABLE'), 0, 0.49, d * 0.5, 0.59, 0.16);
    } else if (definition.kind === 'cart') {
      for (const x of [-w * 0.36, w * 0.36])
        for (const z of [-d * 0.35, d * 0.35]) {
          const wheel = cylinder(g, M.rubber, x, 0.075, z, 0.062, 0.04, 12);
          wheel.rotation.x = Math.PI / 2;
        }
      box(g, M.steel, 0, 0.16, 0, w, 0.075, d, 0.01);
      box(g, M.box, 0, 0.39, 0, w * 0.78, 0.38, d * 0.7, 0.01);
      for (const x of [-w * 0.43, w * 0.43])
        box(g, M.galvanized, x, 0.61, -d * 0.4, 0.03, 0.77, 0.03);
      box(g, M.galvanized, 0, 0.98, -d * 0.4, w * 0.86, 0.03, 0.03);
    } else {
      box(g, grey, 0, h / 2, 0, w, h, d, 0.015);
      box(g, M.dark, 0, 0.045, 0, w * 0.92, 0.09, d * 0.86);
      for (const x of [-w * 0.24, w * 0.24]) {
        box(g, M.wall, x, h * 0.52, d * 0.506, w * 0.47, h * 0.88, 0.018);
        box(g, M.dark, x + 0.045, h * 0.53, d * 0.525, 0.018, 0.11, 0.025);
      }
      for (let i = 0; i < 5; i++)
        box(g, M.dark, 0, 0.22 + i * 0.05, d * 0.521, w * 0.68, 0.015, 0.008);
      sign(
        g,
        labelTexture(
          definition.id === 'electrical-cabinet' ? 'E-01' : 'SERVICE',
          'AUTHORIZED ACCESS',
          '#d8daca',
          '#404b48',
        ),
        0,
        h * 0.79,
        d * 0.526,
        w * 0.7,
        0.17,
      );
    }
    mergeStatic(g);
  }
  // Guard rail behind the mapped zone and at the service cabinet; never across AMR links.
  const rails = new T.Group();
  rails.name = 'Perimeter guard rails';
  equipment.add(rails);
  for (const [x, z, length] of [
    [-3.05, 4.52, 3.4],
    [3.3, 4.52, 5.4],
  ]) {
    for (const dx of [-length / 2, 0, length / 2]) {
      box(rails, M.dark, x + dx, 0.035, z, 0.15, 0.07, 0.15);
      cylinder(rails, M.yellow, x + dx, 0.4, z, 0.032, 0.8, 12);
    }
    for (const y of [0.39, 0.76]) box(rails, M.yellow, x, y, z, length, 0.044, 0.044);
  }
  const palletJack = new T.Group();
  palletJack.name = 'Parked pallet jack';
  palletJack.position.copy(worldPosition(270, -50));
  equipment.add(palletJack);
  fixtures.push({ definition: { id: 'pallet-jack', kind: 'pallet-jack' }, group: palletJack });
  for (const z of [-0.2, 0.2]) {
    box(palletJack, M.yellow, 0.12, 0.095, z, 0.8, 0.1, 0.095, 0.015);
    cylinder(palletJack, M.rubber, 0.43, 0.064, z, 0.05, 0.08, 12).rotation.x = Math.PI / 2;
  }
  box(palletJack, M.yellow, -0.3, 0.17, 0, 0.27, 0.24, 0.55, 0.03);
  cylinder(palletJack, M.dark, -0.38, 0.51, 0, 0.024, 0.72, 12);
  box(palletJack, M.dark, -0.38, 0.88, 0, 0.035, 0.055, 0.37, 0.014);
  mergeStatic(palletJack);
  mergeStatic(rails);
  mergeStatic(structure);
  mergeStatic(overhead);
  mergeStatic(back);
  mergeStatic(right);
  return { walls, equipment, structure, overhead, fixtures };
}
