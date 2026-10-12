// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Shared illustrative layout. Coordinates use 75 model units per metre.
import {
  MANAGER_STANDING_ZONES,
  managerStandingZonesInMetres,
  managerZoneHatchSegments,
} from './warehouse_manager_standing_zones_and_route_clearance.js';
export const WAREHOUSE_LAYOUT = Object.freeze({
  width: 900,
  height: 500,
  scale: 75,
  rackWidth: 120,
  rackDepth: 45,
  rackFootprintWidth: 126,
  rackFootprintDepth: 56,
  robotRadius: 34,
  clearance: 2,
});
// Building and staging apron are illustrative context outside the mapped AMR zone.
export const INDUSTRIAL_HALL = Object.freeze({
  left: -105,
  right: 1005,
  top: -100,
  bottom: 600,
  heightM: 3.65,
});
export const FACILITY_ZONES = Object.freeze(
  [
    { id: 'receiving', label: 'RECEIVING', x: 95, y: -50, width: 190, depth: 72, color: '#657d89' },
    { id: 'dispatch', label: 'DISPATCH', x: 780, y: -50, width: 205, depth: 72, color: '#657d89' },
    {
      id: 'inspection',
      label: 'QUALITY CHECK',
      x: 100,
      y: 550,
      width: 190,
      depth: 75,
      color: '#728580',
    },
    {
      id: 'packing',
      label: 'PACKING / CONSOLIDATION',
      x: 595,
      y: 550,
      width: 450,
      depth: 75,
      color: '#728580',
    },
  ].map(Object.freeze),
);
export const INDUSTRIAL_FIXTURES = Object.freeze(
  [
    { id: 'inbound-01', kind: 'pallet', x: 65, y: -38, width: 74, depth: 54, height: 88 },
    { id: 'inbound-02', kind: 'pallet', x: 155, y: -38, width: 74, depth: 54, height: 64 },
    { id: 'outbound-01', kind: 'pallet', x: 755, y: -38, width: 74, depth: 54, height: 96 },
    { id: 'outbound-02', kind: 'pallet', x: 845, y: -38, width: 74, depth: 54, height: 76 },
    { id: 'quality-bench', kind: 'bench', x: 100, y: 550, width: 130, depth: 48, height: 108 },
    { id: 'packing-01', kind: 'conveyor', x: 465, y: 550, width: 155, depth: 48, height: 85 },
    { id: 'packing-02', kind: 'bench', x: 670, y: 550, width: 125, depth: 48, height: 108 },
    { id: 'packing-cart', kind: 'cart', x: 820, y: 548, width: 66, depth: 44, height: 75 },
    { id: 'service-cabinet', kind: 'cabinet', x: 950, y: 405, width: 48, depth: 65, height: 135 },
    {
      id: 'electrical-cabinet',
      kind: 'cabinet',
      x: 955,
      y: 250,
      width: 42,
      depth: 125,
      height: 155,
    },
  ].map(Object.freeze),
);
export const BIN_DESTINATIONS = Object.freeze(
  [
    { id: 'A', name: 'Assembly A', x: 335, y: 120, stock: 64, rate: 0.09 },
    { id: 'B', name: 'Assembly B', x: 755, y: 120, stock: 48, rate: 0.13 },
    { id: 'C', name: 'Packing C', x: 335, y: 380, stock: 77, rate: 0.07 },
    { id: 'D', name: 'Packing D', x: 755, y: 380, stock: 39, rate: 0.11 },
  ].map(Object.freeze),
);
export const STORAGE_RACKS = Object.freeze(
  [55, 185, 315, 445].flatMap((y, row) =>
    [335, 545, 755].map((x, col) => {
      const binId =
        row === 0
          ? col === 0
            ? 'A'
            : col === 2
              ? 'B'
              : null
          : row === 3
            ? col === 0
              ? 'C'
              : col === 2
                ? 'D'
                : null
            : null;
      return Object.freeze({
        id: 'R' + String(row * 3 + col + 1).padStart(2, '0'),
        address: 'ABCD'[row] + '-' + String(col + 1).padStart(2, '0'),
        x,
        y,
        binId,
        facing: row < 2 ? 1 : -1,
      });
    }),
  ),
);
export const AISLE_X = Object.freeze([230, 440, 650, 860]);
export const AISLE_Y = Object.freeze([120, 250, 380]);
export const LANE_SEGMENTS = Object.freeze([
  ...AISLE_Y.map((y) => Object.freeze({ x1: AISLE_X[0], y1: y, x2: AISLE_X.at(-1), y2: y })),
  ...AISLE_X.map((x) => Object.freeze({ x1: x, y1: AISLE_Y[0], x2: x, y2: AISLE_Y.at(-1) })),
  Object.freeze({ x1: 220, y1: 170, x2: 220, y2: 330 }),
  ...[170, 250, 330].map((y) => Object.freeze({ x1: 120, y1: y, x2: 220, y2: y })),
  Object.freeze({ x1: 220, y1: 250, x2: 230, y2: 250 }),
]);
export function referenceRouteGraph() {
  const node = (id, role, x, y, extra = {}) => ({ id, role, x_m: x / 75, y_m: y / 75, ...extra });
  const nodes = [
    node('bay01', 'bay', 120, 170, { assetId: 'amr-01' }),
    node('bay02', 'bay', 120, 250, { assetId: 'amr-02' }),
    node('bay03', 'bay', 120, 330, { assetId: 'amr-03' }),
    node('stage01', 'junction', 220, 170),
    node('entry', 'junction', 220, 250),
    node('stage03', 'junction', 220, 330),
  ];
  AISLE_Y.forEach((y, row) =>
    AISLE_X.forEach((x, col) => nodes.push(node('lane' + row + col, 'junction', x, y))),
  );
  BIN_DESTINATIONS.forEach((b) => nodes.push(node('bin' + b.id, 'bin', b.x, b.y, { binId: b.id })));
  const links = [
    ['bay01', 'stage01'],
    ['stage01', 'entry'],
    ['bay02', 'entry'],
    ['bay03', 'stage03'],
    ['stage03', 'entry'],
    ['entry', 'lane10'],
  ];
  AISLE_Y.forEach((y, row) => {
    for (let col = 0; col < 3; col++) {
      const bin = BIN_DESTINATIONS.find(
        (b) => b.y === y && b.x > AISLE_X[col] && b.x < AISLE_X[col + 1],
      );
      if (bin)
        links.push(
          ['lane' + row + col, 'bin' + bin.id],
          ['bin' + bin.id, 'lane' + row + (col + 1)],
        );
      else links.push(['lane' + row + col, 'lane' + row + (col + 1)]);
    }
  });
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 4; col++) links.push(['lane' + row + col, 'lane' + (row + 1) + col]);
  return {
    nodes,
    edges: links.map(([from, to]) => ({ from, to, bidirectional: true })),
    restrictedZones: managerStandingZonesInMetres(WAREHOUSE_LAYOUT.scale),
  };
}
export function paintLanePlan(c, managerZones = MANAGER_STANDING_ZONES) {
  c.save();
  c.lineCap = 'butt';
  // Staging outlines and a pedestrian spine occupy the apron, outside AMR routes.
  c.fillStyle = '#477c69';
  c.globalAlpha = 0.65;
  c.fillRect(-68, -84, 66, 665);
  c.globalAlpha = 1;
  c.strokeStyle = '#d5dbd0';
  c.lineWidth = 1.8;
  c.strokeRect(-68, -84, 66, 665);
  for (const zone of FACILITY_ZONES) {
    c.fillStyle = zone.color;
    c.globalAlpha = 0.3;
    c.fillRect(zone.x - zone.width / 2, zone.y - zone.depth / 2, zone.width, zone.depth);
    c.globalAlpha = 1;
    c.strokeStyle = '#e2c568';
    c.lineWidth = 1.8;
    c.strokeRect(zone.x - zone.width / 2, zone.y - zone.depth / 2, zone.width, zone.depth);
    c.fillStyle = '#384848';
    c.font = 'bold 9px monospace';
    c.fillText(zone.label, zone.x - zone.width / 2 + 7, zone.y - zone.depth / 2 + 12);
  }
  c.strokeStyle = '#deded0';
  c.lineWidth = 1.3;
  c.setLineDash([12, 6]);
  c.strokeRect(0, 0, 900, 500);
  c.setLineDash([]);
  for (const lane of LANE_SEGMENTS) {
    const depot = Math.max(lane.x1, lane.x2) <= 230;
    c.strokeStyle = depot ? '#75847f' : '#8c9795';
    c.lineWidth = depot ? 28 : 60;
    c.beginPath();
    c.moveTo(lane.x1, lane.y1);
    c.lineTo(lane.x2, lane.y2);
    c.stroke();
    c.strokeStyle = '#e2e8df';
    c.lineWidth = 1.2;
    c.setLineDash([9, 10]);
    c.beginPath();
    c.moveTo(lane.x1, lane.y1);
    c.lineTo(lane.x2, lane.y2);
    c.stroke();
    c.setLineDash([]);
  }
  c.strokeStyle = '#d6a83e';
  c.lineWidth = 2;
  for (const y of AISLE_Y)
    for (const offset of [-30, 30]) {
      c.beginPath();
      c.moveTo(230, y + offset);
      c.lineTo(860, y + offset);
      c.stroke();
    }
  for (let i = 0; i < 3; i++) {
    const y = 170 + i * 80;
    c.fillStyle = '#255f69';
    c.fillRect(54, y - 31, 105, 62);
    c.strokeStyle = '#e8af38';
    c.strokeRect(54, y - 31, 105, 62);
    c.fillStyle = '#e8ece3';
    c.font = 'bold 16px sans-serif';
    c.fillText('0' + (i + 1), 65, y + 6);
  }
  BIN_DESTINATIONS.forEach((b) => {
    c.strokeStyle = '#e1c25d';
    c.lineWidth = 1.5;
    c.strokeRect(b.x - 24, b.y - 18, 48, 36);
  });
  c.fillStyle = '#344f62';
  c.font = '9px monospace';
  ['NORTH CROSS AISLE', 'CENTRAL CROSS AISLE', 'SOUTH CROSS AISLE'].forEach((name, i) =>
    c.fillText(name, 495, AISLE_Y[i] + 22),
  );
  c.fillStyle = '#344c4c';
  c.font = 'bold 11px monospace';
  c.fillText('AMR CHARGING', 46, 129);
  c.fillText('LINE SUPPLY', 496, 20);
  c.fillText('FINISHED GOODS', 480, 490);
  for (const rack of STORAGE_RACKS) {
    c.fillStyle = '#384a48';
    c.font = 'bold 9px monospace';
    c.fillText(rack.address, rack.x - 14, rack.y + (rack.facing > 0 ? 40 : -36));
  }
  // Repeating chevrons designate reserved charging bays, without claiming a safety standard.
  c.strokeStyle = '#c19c40';
  c.lineWidth = 3;
  for (let y = 133; y <= 367; y += 16) {
    c.beginPath();
    c.moveTo(52, y);
    c.lineTo(40, y + 9);
    c.stroke();
  }
  // Manager areas stay visible independently of the optional route network layer.
  for (const zone of managerZones) paintManagerStandingZone(c, zone);
  c.restore();
}
export function paintManagerStandingZone(c, zone) {
  c.save();
  c.fillStyle = '#d8a33d';
  c.beginPath();
  c.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#8b3c2c';
  c.lineWidth = 2.5;
  c.stroke();
  c.strokeStyle = '#795a31';
  c.lineWidth = 2;
  for (const [a, b] of managerZoneHatchSegments(zone)) {
    c.beginPath();
    c.moveTo(...a);
    c.lineTo(...b);
    c.stroke();
  }
  c.fillStyle = '#422c20';
  c.textAlign = 'center';
  c.font = 'bold 9px monospace';
  c.fillText(zone.label.toUpperCase(), zone.x, zone.y + 25);
  c.font = 'bold 7px monospace';
  c.fillText('NO AMR ENTRY', zone.x, zone.y + 35);
  c.restore();
}
