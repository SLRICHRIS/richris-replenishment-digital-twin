// © 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
// Configured reference locations, not detected or tracked personnel.
export const MANAGER_STANDING_ZONES = Object.freeze(
  [
    { id: 'manager-01', label: 'Manager M1', x: 130, y: 60, radius: 40 },
    { id: 'manager-02', label: 'Manager M2', x: 130, y: 440, radius: 40 },
  ].map(Object.freeze),
);

export function managerStandingZonesInMetres(scale) {
  return MANAGER_STANDING_ZONES.map(({ id, label, x, y, radius }) => ({
    id,
    label,
    x_m: x / scale,
    y_m: y / scale,
    radius_m: radius / scale,
  }));
}

export function checkedManagerStandingZones(input, widthM, heightM) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 12)
    throw Error('Provide at most twelve configured manager standing zones.');
  const ids = new Set();
  return input.map((zone) => {
    if (
      !zone ||
      typeof zone.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,48}$/.test(zone.id) ||
      ids.has(zone.id) ||
      typeof zone.label !== 'string' ||
      !/^[a-zA-Z0-9 ._-]{1,48}$/.test(zone.label) ||
      !Number.isFinite(zone.x_m) ||
      !Number.isFinite(zone.y_m) ||
      !Number.isFinite(zone.radius_m) ||
      zone.radius_m < 0.1 ||
      zone.radius_m > 2 ||
      zone.x_m - zone.radius_m < 0 ||
      zone.x_m + zone.radius_m > widthM ||
      zone.y_m - zone.radius_m < 0 ||
      zone.y_m + zone.radius_m > heightM
    )
      throw Error(
        'Manager zones need unique IDs, plain labels and bounded circles inside the facility.',
      );
    ids.add(zone.id);
    return {
      id: zone.id,
      label: zone.label,
      x_m: zone.x_m,
      y_m: zone.y_m,
      radius_m: zone.radius_m,
    };
  });
}

// Check the entire segment, including tangency and the AMR footprint clearance.
// Checking only route nodes would miss a segment crossing a manager's standing area.
export function segmentIntersectsManagerZone(a, b, zone, clearanceM) {
  const dx = b.x_m - a.x_m,
    dy = b.y_m - a.y_m,
    lengthSquared = dx * dx + dy * dy,
    fraction = lengthSquared
      ? Math.max(
          0,
          Math.min(1, ((zone.x_m - a.x_m) * dx + (zone.y_m - a.y_m) * dy) / lengthSquared),
        )
      : 0;
  return (
    Math.hypot(a.x_m + fraction * dx - zone.x_m, a.y_m + fraction * dy - zone.y_m) <=
    zone.radius_m + clearanceM + 1e-9
  );
}

// Diagonal hatch chords in model coordinates, shared by both floor renderers.
export function managerZoneHatchSegments(zone) {
  const segments = [],
    unit = Math.SQRT1_2;
  for (let offset = -zone.radius + 5; offset < zone.radius; offset += 11) {
    const halfChord = Math.sqrt(zone.radius * zone.radius - offset * offset);
    segments.push([
      [zone.x + (offset - halfChord) * unit, zone.y + (offset + halfChord) * unit],
      [zone.x + (offset + halfChord) * unit, zone.y + (offset - halfChord) * unit],
    ]);
  }
  return segments;
}
